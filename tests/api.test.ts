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

test('protected endpoints reject unauthenticated requests', async () => {
  for (const p of ['/api/documents', '/api/users', '/api/stats', '/api/folders', '/api/activity']) {
    const res = await api(null, 'GET', p);
    assert.equal(res.status, 401, `${p} should be 401`);
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

  const create = await api('staff', 'POST', '/api/users', {
    fullName: 'X', email: 'x@example.com', role: 'Admin', department: 'IT'
  });
  assert.equal(create.status, 403);
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

test('password-protected link gates content until the password is supplied', async () => {
  const create = await api('admin', 'POST', `/api/documents/${docId}/external-link`, {
    expiresInDays: 7, requiresPassword: true, password: 'hunter22'
  });
  const { link } = await create.json();
  assert.equal(link.hasPassword, true);

  const gate = await api(null, 'GET', `/s/${link.shortCode}`);
  assert.equal(gate.status, 200);
  assert.match(await gate.text(), /protected/i);

  const wrong = await api(null, 'GET', `/s/${link.shortCode}?pw=nope`);
  assert.equal(wrong.status, 401);

  const right = await api(null, 'GET', `/s/${link.shortCode}?pw=hunter22`);
  assert.equal(right.status, 200);
  assert.match(await right.text(), /Total amount due/);
});

test('admin reset issues a fresh temp password and invalidates the old one', async () => {
  const res = await api('admin', 'POST', `/api/users/${staffId}/reset-password`, {});
  assert.equal(res.status, 200);
  const { tempPassword } = await res.json();
  assert.ok(tempPassword && tempPassword !== staffTempPassword);

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
