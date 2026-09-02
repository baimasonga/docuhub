/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * API integration tests. Boots the Express app against the in-memory store
 * (no Supabase needed) on an ephemeral port and exercises the main flows:
 * auth, RBAC, uploads, sharing, approvals, and search.
 *
 * Run with: npm test
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import { spawnSync } from 'child_process';

process.env.DOCUHUB_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'docuhub-test-'));
process.env.INITIAL_ADMIN_PASSWORD = 'TestAdmin1!';
process.env.SESSION_SECRET = 'test-session-secret';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.RESEND_API_KEY;

let server: Server;
let baseUrl = '';

// Minimal cookie jar: one session per named actor.
const jars = new Map<string, string>();

async function api(actor: string | null, method: string, pathName: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (actor && jars.has(actor)) headers['Cookie'] = jars.get(actor)!;
  const res = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual'
  });
  const setCookie = res.headers.get('set-cookie');
  if (actor && setCookie) {
    const sid = setCookie.split(';')[0];
    if (sid.startsWith('sid=') && sid.length > 4) jars.set(actor, sid);
    else if (sid === 'sid=') jars.delete(actor);
  }
  return res;
}

async function login(actor: string, email: string, password: string) {
  const res = await api(actor, 'POST', '/api/auth/login', { email, password });
  return res;
}

before(async () => {
  const mod = await import('../server');
  await mod.ensureRuntimeReady();
  server = mod.app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(() => {
  server?.close();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
});

test('health endpoint responds without auth', async () => {
  const res = await api(null, 'GET', '/api/health');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'ok');
});

test('production refuses to start without durable storage and required secrets', () => {
  const env = { ...process.env, NODE_ENV: 'production', DOCUHUB_NO_LISTEN: '1' };
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_KEY', 'SESSION_SECRET', 'APP_URL']) delete env[key];
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', '--input-type=module', '-e',
    "import('./server.ts').then(m => m.ensureRuntimeReady()).then(() => process.exit(0)).catch(() => process.exit(23))"
  ], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(result.status, 23, `production unexpectedly started: ${result.stdout}\n${result.stderr}`);
});

test('security migration uses concurrency-safe unique indexes', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/0006_security_hardening.sql'), 'utf8');
  assert.match(sql, /create unique index if not exists document_versions_doc_version_key/i);
  assert.match(sql, /create unique index if not exists document_versions_storage_path_key/i);
  assert.doesNotMatch(sql, /create trigger document_versions_no_duplicates/i);
});

test('protected endpoints reject unauthenticated requests', async () => {
  for (const p of ['/api/documents', '/api/users', '/api/stats', '/api/folders', '/api/activity']) {
    const res = await api(null, 'GET', p);
    assert.equal(res.status, 401, `${p} should be 401`);
  }
});

test('mutating requests are checked against the request origin when APP_URL is unset', async () => {
  const send = (origin: string) => fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: 'nobody@avdp.org.sl', password: 'wrong-password' })
  });

  const foreign = await send('https://evil.example');
  assert.equal(foreign.status, 403, 'a cross-origin POST must be rejected');

  const own = await send(baseUrl);
  assert.notEqual(own.status, 403, 'a same-origin POST must pass the origin check');
});

test('in production the origin is only derived from a workers.dev host', async () => {
  const { appOrigin } = await import('../server');
  const asRequest = (host: string) => ({ headers: { host } }) as never;
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(appOrigin(asRequest('docuhub.example.workers.dev')), 'https://docuhub.example.workers.dev');
    assert.equal(appOrigin(asRequest('avdpdocs.org')), null, 'an undeclared host must not be trusted');
    process.env.APP_URL = 'https://avdpdocs.org';
    assert.equal(appOrigin(asRequest('docuhub.example.workers.dev')), 'https://avdpdocs.org', 'APP_URL wins when set');
  } finally {
    delete process.env.APP_URL;
    process.env.NODE_ENV = previous;
  }
});

test('login rejects bad credentials and accepts the seeded admin', async () => {
  const bad = await login('admin', 'mohamedbangura@avdp.org.sl', 'wrong-password');
  assert.equal(bad.status, 401);

  const good = await login('admin', 'mohamedbangura@avdp.org.sl', 'TestAdmin1!');
  assert.equal(good.status, 200);
  const data = await good.json();
  assert.equal(data.user.role, 'Admin');
  assert.equal(data.mustChangePassword, true);
  assert.ok(!('passwordHash' in data.user), 'password hash must never be returned');
  assert.ok(jars.get('admin')?.startsWith('sid='));
});

test('forced password change works and the new password logs in', async () => {
  const weak = await api('admin', 'POST', '/api/auth/change-password', {
    currentPassword: 'TestAdmin1!', newPassword: 'short'
  });
  assert.equal(weak.status, 400);

  const res = await api('admin', 'POST', '/api/auth/change-password', {
    currentPassword: 'TestAdmin1!', newPassword: 'NewAdminPass9'
  });
  assert.equal(res.status, 200);

  jars.delete('admin');
  const relog = await login('admin', 'mohamedbangura@avdp.org.sl', 'NewAdminPass9');
  assert.equal(relog.status, 200);
  const data = await relog.json();
  assert.equal(data.mustChangePassword, false);
});

let staffEmail = 'staff.tester@example.com';
let staffTempPassword = '';
let staffId = '';

test('admin creates a user and receives a one-time temp password', async () => {
  const res = await api('admin', 'POST', '/api/users', {
    fullName: 'Staff Tester', email: staffEmail, role: 'Staff', department: 'IT'
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.ok(data.tempPassword, 'temp password returned once at creation');
  assert.ok(!('passwordHash' in data));
  staffTempPassword = data.tempPassword;
  staffId = data.id;

  const dup = await api('admin', 'POST', '/api/users', {
    fullName: 'Dup', email: staffEmail, role: 'Staff', department: 'IT'
  });
  assert.equal(dup.status, 409);
});

test('non-admin cannot manage users', async () => {
  const res = await login('staff', staffEmail, staffTempPassword);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.mustChangePassword, true);

  const blocked = await api('staff', 'GET', '/api/documents');
  assert.equal(blocked.status, 403, 'temporary-password sessions must be blocked from protected APIs');

  const create = await api('staff', 'POST', '/api/users', {
    fullName: 'X', email: 'x@example.com', role: 'Admin', department: 'IT'
  });
  assert.equal(create.status, 403);

  const changed = await api('staff', 'POST', '/api/auth/change-password', {
    currentPassword: staffTempPassword, newPassword: 'StaffPermanent9'
  });
  assert.equal(changed.status, 200);
});

let docId = '';

test('upload (base64) creates a document with OCR metadata', async () => {
  const content = Buffer.from('INVOICE\nTotal amount due: $1,250\nNet 30 terms.').toString('base64');
  const res = await api('admin', 'POST', '/api/documents/upload', {
    title: 'Vendor Invoice March',
    fileName: 'vendor_invoice_march.txt',
    fileType: 'text/plain',
    fileSize: 46,
    fileData: content,
    autoFile: false,
    folderId: null
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.document.status, 'Draft');
  assert.equal(data.document.documentType, 'Invoice'); // heuristic classifier
  assert.ok(Array.isArray(data.document.tags) && data.document.tags.length > 0);
  docId = data.document.id;
});

test('RBAC: staff in another department cannot see the doc until shared', async () => {
  const before = await api('staff', 'GET', '/api/documents');
  const beforeDocs = await before.json();
  assert.ok(!beforeDocs.some((d: any) => d.id === docId), 'unshared doc from another department must be hidden');

  const direct = await api('staff', 'GET', `/api/documents/${docId}`);
  assert.equal(direct.status, 403);

  const share = await api('admin', 'POST', `/api/documents/${docId}/share`, {
    targetUserId: staffId, permissionType: 'Viewer'
  });
  assert.equal(share.status, 200);

  const afterRes = await api('staff', 'GET', `/api/documents/${docId}`);
  assert.equal(afterRes.status, 200);

  const shared = await api('staff', 'GET', '/api/documents?filterType=shared');
  const sharedDocs = await shared.json();
  assert.ok(sharedDocs.some((d: any) => d.id === docId), 'doc should appear in Shared with me');
});

test('search finds the document by title and content', async () => {
  const byTitle = await api('admin', 'GET', '/api/documents?query=vendor%20invoice');
  const docs = await byTitle.json();
  assert.ok(docs.some((d: any) => d.id === docId));

  const noHit = await api('admin', 'GET', '/api/documents?query=zzz-no-such-thing');
  assert.equal((await noHit.json()).length, 0);
});

test('download and preview serve the stored bytes', async () => {
  const dl = await api('admin', 'GET', `/api/documents/${docId}/download`);
  assert.equal(dl.status, 200);
  const text = await dl.text();
  assert.match(text, /Total amount due/);

  const pv = await api('admin', 'GET', `/api/documents/${docId}/preview`);
  assert.equal(pv.status, 200);
  assert.match(pv.headers.get('content-disposition') || '', /inline/);
});

test('copies use independent stored content and require editor access', async () => {
  assert.equal(
    (await api('staff', 'POST', `/api/documents/${docId}/copy`, {})).status,
    403,
    'a viewer share must not grant copy permission'
  );

  const copied = await api('admin', 'POST', `/api/documents/${docId}/copy`, {});
  assert.equal(copied.status, 201);
  const copiedId = (await copied.json()).document.id;
  assert.match(await (await api('admin', 'GET', `/api/documents/${copiedId}/download`)).text(), /Total amount due/);

  assert.equal((await api('admin', 'POST', `/api/documents/${copiedId}/delete`, {})).status, 200);
  assert.equal((await api('admin', 'POST', `/api/documents/${copiedId}/permanently-delete`, {})).status, 200);
  const original = await api('admin', 'GET', `/api/documents/${docId}/download`);
  assert.equal(original.status, 200, 'purging a copy must not delete the original content');
  assert.match(await original.text(), /Total amount due/);
});

test('Commenter shares can comment but Viewer shares cannot', async () => {
  const denied = await api('staff', 'POST', '/api/comments', {
    documentId: docId, text: 'Viewer should not be able to comment.'
  });
  assert.equal(denied.status, 403);

  const share = await api('admin', 'POST', `/api/documents/${docId}/share`, {
    targetUserId: staffId, permissionType: 'Commenter'
  });
  assert.equal(share.status, 200);
  const allowed = await api('staff', 'POST', '/api/comments', {
    documentId: docId, text: 'Commenter access works.'
  });
  assert.equal(allowed.status, 200);
});

test('concurrent version uploads never create duplicate version numbers', async () => {
  const content = Buffer.from('INVOICE\nTotal amount due: $1,250\nConcurrent revision.').toString('base64');
  const payload = {
    fileName: 'vendor_invoice_revision.txt', fileType: 'text/plain',
    fileSize: 56, fileData: content
  };
  const responses = await Promise.all([
    api('admin', 'POST', `/api/documents/${docId}/version`, payload),
    api('admin', 'POST', `/api/documents/${docId}/version`, payload)
  ]);
  const statuses = responses.map(r => r.status);
  assert.ok(statuses.every(status => status === 200 || status === 409));
  assert.ok(statuses.includes(200));
  const detail = await (await api('admin', 'GET', `/api/documents/${docId}`)).json();
  const labels = detail.versions.map((version: any) => version.versionNumber);
  assert.equal(new Set(labels).size, labels.length, 'version labels must remain unique');
});

test('rolling back to an earlier version copies it forward without erasing history', async () => {
  const before = await (await api('admin', 'GET', `/api/documents/${docId}`)).json();
  const v1 = before.versions.find((v: any) => v.versionNumber === 'v1');
  assert.ok(v1, 'v1 should still be in the ledger');
  assert.notEqual(before.document.currentVersion, 'v1', 'a later version is current before the rollback');
  const v1Body = await (await api('admin', 'GET', `/api/documents/${docId}/versions/${v1.id}/download`)).text();

  const current = before.versions.find((v: any) => v.versionNumber === before.document.currentVersion);
  const alreadyCurrent = await api('admin', 'POST', `/api/documents/${docId}/versions/${current.id}/restore`, {});
  assert.equal(alreadyCurrent.status, 400, 'restoring the current version is a no-op, not a new version');
  const missing = await api('admin', 'POST', `/api/documents/${docId}/versions/ver-does-not-exist/restore`, {});
  assert.equal(missing.status, 404);

  const restore = await api('admin', 'POST', `/api/documents/${docId}/versions/${v1.id}/restore`, {});
  assert.equal(restore.status, 200);
  const result = await restore.json();
  assert.equal(result.restoredFrom, 'v1');

  const after = await (await api('admin', 'GET', `/api/documents/${docId}`)).json();
  assert.equal(after.document.currentVersion, result.version.versionNumber, 'the copy becomes current');
  assert.equal(
    after.versions.length, before.versions.length + 1,
    'the ledger only grows -- rolling back never deletes a version'
  );
  assert.ok(after.versions.some((v: any) => v.versionNumber === 'v1'), 'v1 is still readable after the rollback');

  const restoredBody = await (await api('admin', 'GET', `/api/documents/${docId}/versions/${result.version.id}/download`)).text();
  assert.equal(restoredBody, v1Body, 'the new version serves the restored content');

  const staffRestore = await api('staff', 'POST', `/api/documents/${docId}/versions/${v1.id}/restore`, {});
  assert.equal(staffRestore.status, 403, 'a Viewer share must not roll versions back');
});

test('approval flow: request, decide, status cascades', async () => {
  const req = await api('admin', 'POST', `/api/documents/${docId}/request-approval`, {
    approverId: 'admin-1', comment: 'Please review'
  });
  assert.equal(req.status, 200);
  const { approval } = await req.json();

  const mine = await api('admin', 'GET', '/api/approvals/mine');
  const list = await mine.json();
  assert.ok(list.some((a: any) => a.id === approval.id));

  const decide = await api('admin', 'POST', `/api/approvals/${approval.id}/decide`, {
    status: 'Approved', comment: 'Looks good'
  });
  assert.equal(decide.status, 200);
  const decided = await decide.json();
  assert.equal(decided.document.status, 'Approved');
  assert.equal(decided.document.confidentialityLevel, 'Official Record');

  const repeat = await api('admin', 'POST', `/api/approvals/${approval.id}/decide`, {
    status: 'Rejected', comment: 'Second decision'
  });
  assert.equal(repeat.status, 409, 'an approval may only be decided once');
});

test('external share link: public metadata, short-code serving, revoke', async () => {
  const create = await api('admin', 'POST', `/api/documents/${docId}/external-link`, {
    expiresInDays: 7, allowDownload: true
  });
  assert.equal(create.status, 200);
  const { link } = await create.json();
  assert.ok(link.token && link.shortCode);
  assert.ok(!('passwordHash' in link));

  const meta = await api(null, 'GET', `/api/share/${link.token}`);
  assert.equal(meta.status, 200);

  const served = await api(null, 'GET', `/s/${link.shortCode}`);
  assert.equal(served.status, 200);
  assert.match(await served.text(), /Total amount due/);

  const revoke = await api('admin', 'POST', `/api/external-link/${link.token}/revoke`, {});
  assert.equal(revoke.status, 200);
  const gone = await api(null, 'GET', `/s/${link.shortCode}`);
  assert.equal(gone.status, 403);
});

test('external link download limits are enforced atomically', async () => {
  const create = await api('admin', 'POST', `/api/documents/${docId}/external-link`, {
    expiresInDays: 7, allowDownload: true, maxDownloads: 1
  });
  assert.equal(create.status, 200);
  const { link } = await create.json();

  assert.equal((await api(null, 'GET', `/s/${link.shortCode}`)).status, 200);
  assert.equal((await api(null, 'GET', `/s/${link.shortCode}`)).status, 410);
});

test('security validation rejects active content and invalid permissions', async () => {
  const activeContent = Buffer.from('<script>alert(1)</script>').toString('base64');
  const upload = await api('admin', 'POST', '/api/documents/upload', {
    title: 'Unsafe HTML', fileName: 'unsafe.html', fileType: 'text/html',
    fileSize: 25, fileData: activeContent, autoFile: false, folderId: null
  });
  assert.equal(upload.status, 400);

  const permission = await api('admin', 'POST', `/api/documents/${docId}/share`, {
    targetUserId: staffId, permissionType: 'Owner'
  });
  assert.equal(permission.status, 400);

  const approver = await api('admin', 'POST', `/api/documents/${docId}/request-approval`, {
    approverId: staffId, comment: 'Invalid approver'
  });
  assert.equal(approver.status, 400);
});

test('confidential classification requires explicit access and revokes links', async () => {
  const managerCreated = await api('admin', 'POST', '/api/users', {
    fullName: 'Unshared Manager', email: 'manager@example.com', role: 'Manager', department: 'Finance'
  });
  assert.equal(managerCreated.status, 201);
  const manager = await managerCreated.json();
  await login('manager', manager.email, manager.tempPassword);
  assert.equal((await api('manager', 'POST', '/api/auth/change-password', {
    currentPassword: manager.tempPassword, newPassword: 'ManagerPermanent9'
  })).status, 200);

  const created = await api('admin', 'POST', '/api/users', {
    fullName: 'Procurement Viewer', email: 'viewer@example.com', role: 'Viewer', department: 'Procurement'
  });
  assert.equal(created.status, 201);
  const viewer = await created.json();
  await login('viewer', viewer.email, viewer.tempPassword);
  const changed = await api('viewer', 'POST', '/api/auth/change-password', {
    currentPassword: viewer.tempPassword, newPassword: 'ViewerPermanent9'
  });
  assert.equal(changed.status, 200);

  const before = await api('viewer', 'GET', `/api/documents/${docId}`);
  assert.equal(before.status, 200, 'approved same-department document is initially visible');

  const liveLinkResponse = await api('admin', 'POST', `/api/documents/${docId}/external-link`, { expiresInDays: 7 });
  assert.equal(liveLinkResponse.status, 200);
  const liveLink = (await liveLinkResponse.json()).link;

  const classified = await api('admin', 'POST', `/api/documents/${docId}/classification`, {
    confidentialityLevel: 'Confidential'
  });
  assert.equal(classified.status, 200);
  const managerDeclassify = await api('manager', 'POST', `/api/documents/${docId}/classification`, {
    confidentialityLevel: 'Normal File'
  });
  assert.equal(managerDeclassify.status, 403, 'an unshared Manager must not declassify a confidential document');
  assert.equal((await api('viewer', 'GET', `/api/documents/${docId}`)).status, 403);
  assert.equal((await api(null, 'GET', `/s/${liveLink.shortCode}`)).status, 403, 'classification revokes external links');
  assert.equal((await api('viewer', 'POST', `/api/documents/${docId}/copy`, {})).status, 403);

  const share = await api('admin', 'POST', `/api/documents/${docId}/share`, {
    targetUserId: viewer.id, permissionType: 'Viewer'
  });
  assert.equal(share.status, 200);
  assert.equal((await api('viewer', 'GET', `/api/documents/${docId}`)).status, 200);

  const star = await api('admin', 'POST', `/api/documents/${docId}/star`, {});
  assert.equal(star.status, 200);
  const viewerDetail = await (await api('viewer', 'GET', `/api/documents/${docId}`)).json();
  assert.equal(viewerDetail.document.isStarred, false, 'stars are personal, not global');
});

test('password-protected link gates content until the password is supplied', async () => {
  const create = await api('admin', 'POST', `/api/documents/${docId}/external-link`, {
    expiresInDays: 7, requiresPassword: true, password: 'hunter2200'
  });
  const { link } = await create.json();
  assert.equal(link.hasPassword, true);

  const gate = await api(null, 'GET', `/s/${link.shortCode}`);
  assert.equal(gate.status, 200);
  assert.match(await gate.text(), /protected/i);

  const wrong = await fetch(`${baseUrl}/s/${link.shortCode}/unlock`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pw: 'nope' }), redirect: 'manual'
  });
  assert.equal(wrong.status, 303);
  assert.ok(!(wrong.headers.get('location') || '').includes('pw='), 'password must never be placed in a URL');

  const unlock = await fetch(`${baseUrl}/s/${link.shortCode}/unlock`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pw: 'hunter2200' }), redirect: 'manual'
  });
  assert.equal(unlock.status, 303);
  const shareCookie = (unlock.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(shareCookie.startsWith('share_'));
  const right = await fetch(`${baseUrl}/s/${link.shortCode}`, { headers: { Cookie: shareCookie }, redirect: 'manual' });
  assert.equal(right.status, 200);
  assert.match(await right.text(), /Total amount due/);
});

test('an internal share can be revoked', async () => {
  const share = await api('admin', 'POST', `/api/documents/${docId}/share`, {
    targetUserId: staffId, permissionType: 'Viewer'
  });
  assert.equal(share.status, 200);
  const before = await (await api('admin', 'GET', `/api/documents/${docId}`)).json();
  assert.ok(before.permissions.some((p: any) => p.sharedWithUserId === staffId), 'share should be listed on the document');
  assert.equal((await api('staff', 'GET', `/api/documents/${docId}`)).status, 200);

  const staffRevoke = await api('staff', 'DELETE', `/api/documents/${docId}/share/${staffId}`);
  assert.equal(staffRevoke.status, 403, 'a Viewer share must not be able to manage sharing');

  const revoke = await api('admin', 'DELETE', `/api/documents/${docId}/share/${staffId}`);
  assert.equal(revoke.status, 200);

  assert.equal((await api('staff', 'GET', `/api/documents/${docId}`)).status, 403, 'access must end with the share');
  const after = await (await api('admin', 'GET', `/api/documents/${docId}`)).json();
  assert.ok(!after.permissions.some((p: any) => p.sharedWithUserId === staffId));
  const sharedWithMe = await (await api('staff', 'GET', '/api/documents?filterType=shared')).json();
  assert.ok(!sharedWithMe.some((d: any) => d.id === docId), 'doc must leave Shared with me');

  const again = await api('admin', 'DELETE', `/api/documents/${docId}/share/${staffId}`);
  assert.equal(again.status, 404, 'revoking a share that no longer exists is a 404');
});

test('folders can be renamed and moved, but never into their own subtree', async () => {
  const makeFolder = async (name: string, parentFolderId: string | null = null) => {
    const res = await api('admin', 'POST', '/api/folders', { name, parentFolderId });
    assert.equal(res.status, 201);
    return res.json();
  };
  const parent = await makeFolder('Contracts 2026');
  const child = await makeFolder('Q1', parent.id);
  const sibling = await makeFolder('Archive Cabinet');

  const renamed = await api('admin', 'PATCH', `/api/folders/${parent.id}`, { name: '  Contracts 2027  ' });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).folder.name, 'Contracts 2027', 'the new name is trimmed');

  assert.equal((await api('admin', 'PATCH', `/api/folders/${parent.id}`, { name: '   ' })).status, 400);
  assert.equal((await api('admin', 'PATCH', `/api/folders/${parent.id}`, {})).status, 400, 'an empty patch is rejected');
  assert.equal((await api('admin', 'PATCH', '/api/folders/folder-does-not-exist', { name: 'x' })).status, 404);

  assert.equal(
    (await api('admin', 'PATCH', `/api/folders/${parent.id}`, { parentFolderId: child.id })).status, 400,
    'moving a folder into its own descendant would detach the subtree'
  );
  assert.equal((await api('admin', 'PATCH', `/api/folders/${parent.id}`, { parentFolderId: parent.id })).status, 400);

  const moved = await api('admin', 'PATCH', `/api/folders/${child.id}`, { parentFolderId: sibling.id });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).folder.parentFolderId, sibling.id);

  const toRoot = await api('admin', 'PATCH', `/api/folders/${child.id}`, { parentFolderId: null });
  assert.equal(toRoot.status, 200);
  assert.equal((await toRoot.json()).folder.parentFolderId, null);

  const byStaff = await api('staff', 'PATCH', `/api/folders/${parent.id}`, { name: 'Hijacked' });
  assert.equal(byStaff.status, 403, 'Staff must not modify a folder they do not own');
});

test('admin reset issues a fresh temp password and invalidates the old one', async () => {
  const res = await api('admin', 'POST', `/api/users/${staffId}/reset-password`, {});
  assert.equal(res.status, 200);
  const { tempPassword } = await res.json();
  assert.ok(tempPassword && tempPassword !== staffTempPassword);

  const invalidated = await api('staff', 'GET', '/api/documents');
  assert.equal(invalidated.status, 401, 'admin reset must invalidate existing sessions');

  jars.delete('staff');
  const oldLogin = await login('staff', staffEmail, staffTempPassword);
  assert.equal(oldLogin.status, 401);
  const newLogin = await login('staff', staffEmail, tempPassword);
  assert.equal(newLogin.status, 200);
});

test('logout clears the session', async () => {
  const res = await api('staff', 'POST', '/api/auth/logout', {});
  assert.equal(res.status, 200);
  const after = await api('staff', 'GET', '/api/documents');
  assert.equal(after.status, 401);
});

test('trash, restore, and purge lifecycle', async () => {
  const del = await api('admin', 'POST', `/api/documents/${docId}/delete`, {});
  assert.equal(del.status, 200);

  const trash = await api('admin', 'GET', '/api/documents?filterType=trash');
  assert.ok((await trash.json()).some((d: any) => d.id === docId));

  const restore = await api('admin', 'POST', `/api/documents/${docId}/restore`, {});
  assert.equal(restore.status, 200);

  const purge = await api('admin', 'POST', `/api/documents/${docId}/permanently-delete`, {});
  assert.equal(purge.status, 200);
  const gone = await api('admin', 'GET', `/api/documents/${docId}`);
  assert.equal(gone.status, 404);
});
