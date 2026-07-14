import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const port = 4587;
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), 'docuhub-smoke-'));

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // Server is still starting.
    }
    await wait(250);
  }
  throw new Error('Timed out waiting for /api/health');
}

const server = spawn(process.execPath, ['dist/server.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    DATA_DIR: dataDir,
    SESSION_SECRET: 'smoke-test-session-secret',
    DEMO_MODE: 'true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
server.stdout.on('data', chunk => { output += chunk.toString(); });
server.stderr.on('data', chunk => { output += chunk.toString(); });

try {
  await waitForHealth();

  const configRes = await fetch(`${baseUrl}/api/config`);
  assert.equal(configRes.status, 200);
  const config = await configRes.json();
  assert.equal(config.demoMode, true);
  assert.equal(config.uploads.directToStorage, false);

  const anonSessionRes = await fetch(`${baseUrl}/api/session`);
  assert.equal(anonSessionRes.status, 200);
  assert.deepEqual(await anonSessionRes.json(), { user: null });

  const switchRes = await fetch(`${baseUrl}/api/users/switch-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'admin-1' }),
  });
  assert.equal(switchRes.status, 200);
  const cookie = switchRes.headers.get('set-cookie');
  assert.ok(cookie?.includes('sid='), 'profile switch should mint a session cookie');

  const docsRes = await fetch(`${baseUrl}/api/documents`, {
    headers: { cookie },
  });
  assert.equal(docsRes.status, 200);
  assert.ok(Array.isArray(await docsRes.json()), 'documents endpoint should return an array');

  const invalidUploadRes = await fetch(`${baseUrl}/api/documents/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ title: 'Missing file data', fileName: 'missing.txt' }),
  });
  assert.equal(invalidUploadRes.status, 400);
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
  await rm(dataDir, { recursive: true, force: true });
}

if (server.exitCode && server.exitCode !== 0 && server.exitCode !== null) {
  throw new Error(`Server exited unexpectedly with ${server.exitCode}:\n${output}`);
}
