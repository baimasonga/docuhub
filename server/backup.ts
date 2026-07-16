/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * External backup engine: mirrors document file binaries and a full metadata
 * snapshot to an S3-compatible bucket (iDrive e2 by default, but anything
 * that speaks the S3 API works -- Backblaze B2, Wasabi, Cloudflare R2, MinIO).
 *
 * Incremental: only file binaries whose version was created at/after the
 * last *successful* run are re-uploaded (versions are immutable once
 * created, so "new since last success" is a complete and correct delta).
 * The metadata snapshot is small and always re-exported in full so it's
 * never stale.
 *
 * This module has no dependency on server.ts or Supabase specifically --
 * server.ts injects everything (the DataStore, a function to fetch a
 * version's raw bytes regardless of where they're stored, and the target
 * bucket config) so this stays testable and reusable for any S3-compatible
 * target, not just iDrive.
 */

import { AwsClient } from 'aws4fetch';
import { DataStore } from './store';
import { BackupRun, BackupTrigger, DocumentVersion } from '../src/types';

export interface BackupTargetConfig {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string; // e.g. https://<id>.idrivee2-<region>.com
  bucket: string;
  region?: string; // most S3-compatible providers ignore this; default 'us-east-1'
}

export function backupTargetFromEnv(env: NodeJS.ProcessEnv): BackupTargetConfig | null {
  const accessKeyId = env.IDRIVE_ACCESS_KEY_ID;
  const secretAccessKey = env.IDRIVE_SECRET_ACCESS_KEY;
  const endpoint = env.IDRIVE_ENDPOINT;
  const bucket = env.IDRIVE_BUCKET;
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) return null;
  return { accessKeyId, secretAccessKey, endpoint, bucket, region: env.IDRIVE_REGION || 'us-east-1' };
}

function safeKeySegment(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function putObject(
  client: AwsClient,
  target: BackupTargetConfig,
  key: string,
  body: Uint8Array | string,
  contentType: string
): Promise<void> {
  const base = target.endpoint.replace(/\/$/, '');
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const url = `${base}/${target.bucket}/${encodedKey}`;
  const res = await client.fetch(url, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': contentType }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`upload failed for ${key} (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
}

// A time budget, not a hard guarantee -- Workers bill CPU time, not wall-clock
// I/O wait, but a scheduled/HTTP invocation still has to return eventually.
// If exceeded mid-run, the run is marked 'error' (not 'success') so the next
// invocation retries from the same last-known-good cutoff; re-uploading an
// already-backed-up file is a harmless overwrite, so this is always safe to
// retry, just not maximally efficient.
const TIME_BUDGET_MS = 20_000;

export interface RunBackupDeps {
  db: DataStore;
  /** Raw bytes for a version, wherever they live (inline or offloaded storage). */
  getVersionBytes: (version: DocumentVersion) => Promise<{ buffer: Uint8Array; mime: string } | null>;
  target: BackupTargetConfig;
  trigger: BackupTrigger;
  triggeredByName?: string;
  newId: (prefix: string) => string;
}

export async function runBackup(deps: RunBackupDeps): Promise<BackupRun> {
  const { db, getVersionBytes, target, trigger, triggeredByName, newId } = deps;
  const startedAt = new Date().toISOString();
  const run: BackupRun = {
    id: newId('backup'),
    trigger,
    triggeredByName,
    status: 'running',
    startedAt,
    filesUploaded: 0,
    bytesUploaded: 0
  };
  await db.createBackupRun(run);

  const client = new AwsClient({
    accessKeyId: target.accessKeyId,
    secretAccessKey: target.secretAccessKey,
    region: target.region || 'us-east-1',
    service: 's3'
  });

  const deadline = Date.now() + TIME_BUDGET_MS;
  let filesUploaded = 0;
  let bytesUploaded = 0;

  try {
    const lastSuccess = await db.getLastSuccessfulBackupRun();
    const cutoff = lastSuccess?.startedAt || new Date(0).toISOString();
    const pending = await db.listVersionsCreatedSince(cutoff);

    for (const version of pending) {
      if (Date.now() > deadline) {
        throw new Error(
          `Time budget exceeded after uploading ${filesUploaded}/${pending.length} file(s); ` +
          `will resume from the same cutoff on the next run.`
        );
      }
      const content = await getVersionBytes(version);
      if (!content) continue; // binary genuinely missing (shouldn't happen); skip rather than fail the whole run
      const key = `files/${version.documentId}/${version.id}/${safeKeySegment(version.fileName)}`;
      await putObject(client, target, key, content.buffer, content.mime);
      filesUploaded += 1;
      bytesUploaded += content.buffer.byteLength;
    }

    const snapshot = await buildMetadataSnapshot(db, run);
    const snapshotBytes = new TextEncoder().encode(JSON.stringify(snapshot, null, 2));
    await putObject(client, target, 'metadata/latest.json', snapshotBytes, 'application/json');
    bytesUploaded += snapshotBytes.byteLength;

    const completedAt = new Date().toISOString();
    await db.updateBackupRun(run.id, { status: 'success', completedAt, filesUploaded, bytesUploaded });
    return { ...run, status: 'success', completedAt, filesUploaded, bytesUploaded };
  } catch (err) {
    const completedAt = new Date().toISOString();
    const error = (err as Error).message;
    await db.updateBackupRun(run.id, { status: 'error', completedAt, filesUploaded, bytesUploaded, error });
    return { ...run, status: 'error', completedAt, filesUploaded, bytesUploaded, error };
  }
}

// Full-state export, minus anything security-sensitive (password hashes,
// reset tokens, share-link passwords never leave the server -- a restore
// from this snapshot means every account needs a fresh password/reset,
// which is the safer default for something copied to third-party storage).
async function buildMetadataSnapshot(db: DataStore, run: Pick<BackupRun, 'id' | 'startedAt'>) {
  const [institutions, users, folders, documents, permissions, approvals, comments, links, logs] = await Promise.all([
    db.listInstitutions(),
    db.listUsers(),
    db.listFolders(),
    db.listDocuments({ deleted: 'any' }),
    db.listAllPermissions(),
    db.listAllApprovals(),
    db.listAllComments(),
    db.listAllLinks(),
    db.listLogs(5000)
  ]);
  const documentIds = documents.map(d => d.id);
  const versions = await db.listVersionsForDocuments(documentIds);

  return {
    backupRunId: run.id,
    generatedAt: run.startedAt,
    institutions,
    users: users.map(u => ({
      id: u.id, fullName: u.fullName, email: u.email, role: u.role,
      department: u.department, isActive: u.isActive, institutionId: u.institutionId
    })),
    folders,
    documents,
    versions: versions.map(v => ({ ...v, fileData: undefined })), // metadata only; binaries live under files/
    permissions,
    approvals,
    comments,
    externalLinks: links.map(l => ({ ...l, passwordHash: undefined })),
    activityLogs: logs
  };
}
