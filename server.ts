/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AVDP Document Management System API server. Runs on plain node (Railway) and on Cloudflare
 * Workers (via worker/index.ts + cloudflare:node). Persistence goes through
 * the DataStore interface (server/store.ts): Supabase Postgres in production,
 * an in-memory/JSON-file store for local dev and tests.
 */

import express from 'express';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  User,
  Folder,
  Document,
  DocumentVersion,
  SharePermission,
  ApprovalRequest,
  ActivityLog,
  Comment,
  ExternalShareLink,
  DashboardStats,
  Institution,
  ActivityDimension
} from './src/types';
import { DataStore, StoredUser, publicUser, DocumentFilter, DEFAULT_INSTITUTION_ID } from './server/store';
import { MemoryStore } from './server/store-memory';
import { SupabaseStore } from './server/store-supabase';
import {
  hashPassword, verifyPassword, validatePasswordStrength, generateTempPassword, sha256Hex,
  signSession, verifySession, parseCookies, sessionTokenFromRequest, setSessionCookie, clearSessionCookie,
  setSignedCookie, loginRateLimited, clearLoginAttempts
} from './server/auth';
import {
  sendEmail, sendTemplatedEmail, inviteEmail, passwordResetEmail, tempPasswordEmail,
  approvalRequestedEmail, approvalDecidedEmail, documentSharedEmail, externalLinkSharedEmail
} from './server/email';
import {
  OAuthProvider, isProviderConfigured, buildAuthorizeUrl, exchangeCodeForProfile
} from './server/oauth';
import { runBackup, backupTargetFromEnv } from './server/backup';

dotenv.config();

const app = express();
// Railway (and most PaaS) inject the port to bind via the PORT env var.
// (On Cloudflare Workers this stays 3000, matching worker/index.ts's
// httpServerHandler port.)
const PORT = Number(process.env.PORT) || 3000;

// Cloudflare Workers detection. Workers has no durable filesystem, and module
// scope there can neither perform async I/O nor see process.env (bindings are
// only populated inside a request context) — several startup paths below
// branch on this.
const isWorkersRuntime = typeof (globalThis as any).WebSocketPair !== 'undefined';

// Body parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (req.path.startsWith('/api/') || req.path.startsWith('/s/')) res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co",
    "frame-src 'self' https://*.supabase.co blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'"
  ].join('; '));
  next();
});
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    const expected = new URL(process.env.APP_URL || `${req.protocol}://${req.headers.host}`).origin;
    if (new URL(origin).origin !== expected) return res.status(403).json({ error: 'Cross-origin request rejected.' });
  } catch {
    return res.status(403).json({ error: 'Invalid request origin.' });
  }
  next();
});

// ----------------------------------------------------
// Persistence backend selection
// ----------------------------------------------------
// Supabase Postgres when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
// (production), else the in-memory/JSON-file store (local dev). Resolved
// lazily because Workers only populates process.env inside a request context.
let supabase: SupabaseClient | null = null;
let store: DataStore | null = null;
let storageEnabled = false;

function resolveDataDir(): string {
  if (isWorkersRuntime) return path.join(os.tmpdir(), 'docuhub-data');
  const candidates = [
    process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), 'data'),
    path.join(os.tmpdir(), 'docuhub-data')
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch (err) {
      console.error(`[startup] data directory "${dir}" is not usable, trying fallback.`, (err as Error).message);
    }
  }
  return process.cwd();
}

function createStoreFromEnv(): DataStore {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
      throw new Error('SESSION_SECRET (at least 32 characters) is required in production.');
    }
    try {
      if (!process.env.APP_URL || new URL(process.env.APP_URL).protocol !== 'https:') throw new Error();
    } catch {
      throw new Error('APP_URL must be a valid HTTPS URL in production.');
    }
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (url && key) {
    supabase = supabase || createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    storageEnabled = true;
    console.log('[startup] Persistence backend: Supabase (relational tables)');
    return new SupabaseStore(supabase);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production. Refusing non-durable fallback.');
  }
  storageEnabled = false;
  const filePath = isWorkersRuntime ? null : path.join(resolveDataDir(), 'db.json');
  console.log(`[startup] Persistence backend: in-memory${filePath ? ` + JSON file at ${filePath}` : ' (non-durable)'}`);
  return new MemoryStore(filePath);
}

// The store the handlers use. initRuntime() guarantees it's ready before any
// route runs (worker/index.ts awaits ensureRuntimeReady per request; node
// awaits it before listen()).
function db(): DataStore {
  if (!store) throw new Error('Datastore not initialized.');
  return store;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ----------------------------------------------------
// Object storage for file binaries (Supabase Storage)
// ----------------------------------------------------
const STORAGE_BUCKET = 'documents';

async function ensureBucket(): Promise<void> {
  if (!storageEnabled || !supabase) return;
  try {
    const { data, error } = await supabase.storage.getBucket(STORAGE_BUCKET);
    if (data && !error) return;
    const { error: createErr } = await supabase.storage.createBucket(STORAGE_BUCKET, { public: false });
    if (createErr && !/exists/i.test(createErr.message)) {
      console.error('[storage] Could not create bucket:', createErr.message);
    } else {
      console.log(`[storage] Bucket "${STORAGE_BUCKET}" ready.`);
    }
  } catch (err) {
    console.error('[storage] ensureBucket failed:', (err as Error).message);
  }
}

function safeObjectName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function safeDownloadName(fileName: string): string {
  return String(fileName || 'document').replace(/[\u0000-\u001f\u007f"\\]/g, '_').slice(0, 240);
}

const PENDING_UPLOAD_TTL_MS = 15 * 60 * 1000;

function uploadClaimSubject(objectPath: string, userId: string): string {
  return `upload:${userId}:${sha256Hex(objectPath)}`;
}

function issueUploadClaim(objectPath: string, userId: string): string {
  return signSession(uploadClaimSubject(objectPath, userId), Date.now() + PENDING_UPLOAD_TTL_MS);
}

function verifyUploadClaim(objectPath: string, userId: string, claim: unknown): boolean {
  return typeof claim === 'string' && verifySession(claim) === uploadClaimSubject(objectPath, userId);
}

async function uploadVersionFile(docId: string, versionId: string, fileName: string, buffer: Buffer, contentType: string): Promise<string | null> {
  if (!storageEnabled || !supabase) return null;
  const objectPath = `${docId}/${versionId}/${safeObjectName(fileName)}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(objectPath, buffer, { contentType, upsert: true });
  if (error) {
    console.error('[storage] upload failed:', error.message);
    return null;
  }
  return objectPath;
}

async function copyStoredVersionFile(sourcePath: string, docId: string, versionId: string, fileName: string): Promise<string> {
  if (!storageEnabled || !supabase) throw new Error('Object storage is unavailable.');
  const destination = `${docId}/${versionId}/${safeObjectName(fileName)}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).copy(sourcePath, destination);
  if (error) throw new Error(`Storage copy failed: ${error.message}`);
  return destination;
}

async function signedUrlFor(objectPath: string, opts: { download?: string | boolean } = {}): Promise<string | null> {
  if (!storageEnabled || !supabase) return null;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(objectPath, 60, opts);
  if (error || !data) {
    console.error('[storage] signed url failed:', error?.message);
    return null;
  }
  return data.signedUrl;
}

// Download a stored object back into memory (used to OCR direct uploads).
async function downloadStoredFile(objectPath: string): Promise<Buffer | null> {
  if (!storageEnabled || !supabase) return null;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(objectPath);
  if (error || !data) {
    console.error('[storage] download failed:', error?.message);
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

// Raw bytes for a version regardless of where they live -- inline in
// Postgres (small/legacy files) or offloaded to Supabase Storage. Used by
// the external backup job, which needs the actual bytes to re-upload
// elsewhere (unlike normal serving, which redirects to a signed URL for
// offloaded files instead of touching the bytes at all).
async function getVersionBytesForBackup(version: DocumentVersion): Promise<{ buffer: Buffer; mime: string } | null> {
  if (version.storagePath) {
    const buffer = await downloadStoredFile(version.storagePath);
    return buffer ? { buffer, mime: mimeForType(version.fileType) } : null;
  }
  const full = await db().getVersion(version.id);
  if (!full?.fileData) return null;
  return { buffer: storedFileToBuffer(full.fileData), mime: mimeForType(full.fileType) };
}

// Move a version's inline bytes into Storage; clears file_data on success.
async function offloadVersion(version: DocumentVersion, fileData?: string, fileType?: string): Promise<string | null> {
  const data = fileData ?? version.fileData;
  if (!storageEnabled || !data) return null;
  const buffer = storedFileToBuffer(data);
  const objectPath = await uploadVersionFile(version.documentId, version.id, version.fileName, buffer, mimeForType(fileType ?? version.fileType));
  if (objectPath) {
    await db().updateVersion(version.id, { storagePath: objectPath, fileData: undefined });
  }
  return objectPath;
}

// One-time backfill: move any inline file bytes into Storage (background).
async function migrateFilesToStorage(): Promise<void> {
  if (!storageEnabled) return;
  const pending = await db().listVersionsPendingOffload();
  if (pending.length === 0) return;
  console.log(`[storage] Migrating ${pending.length} inline file(s) to Storage…`);
  let migrated = 0;
  for (const v of pending) {
    try {
      if (await offloadVersion(v)) migrated++;
    } catch (err) {
      console.error('[storage] migrate failed for version', v.id, (err as Error).message);
    }
  }
  if (migrated > 0) console.log(`[storage] Migrated ${migrated}/${pending.length} file(s) to Storage.`);
}

// ----------------------------------------------------
// Identity & authorization
// ----------------------------------------------------
async function getUserFromRequest(req: express.Request): Promise<StoredUser | null> {
  const token = sessionTokenFromRequest(req);
  if (!token) return null;
  const subject = verifySession(token);
  if (!subject) return null;
  let userId: string;
  let tokenVersion: number;
  if (subject.startsWith('user:')) {
    const parts = subject.split(':');
    if (parts.length !== 3) return null;
    try { userId = Buffer.from(parts[1], 'base64url').toString('utf8'); } catch { return null; }
    tokenVersion = Number(parts[2]);
  } else {
    // One-release compatibility for sessions issued before session versioning.
    userId = subject;
    tokenVersion = 0;
  }
  if (!Number.isInteger(tokenVersion) || tokenVersion < 0) return null;
  const user = await db().getUser(userId);
  return user && user.isActive && (user.sessionVersion || 0) === tokenVersion ? user : null;
}

async function requireUser(req: express.Request, res: express.Response, allowPasswordChange = false): Promise<StoredUser | null> {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated.' });
    return null;
  }
  if (user.mustChangePassword && !allowPasswordChange) {
    res.status(403).json({ error: 'Password change required.', code: 'PASSWORD_CHANGE_REQUIRED' });
    return null;
  }
  return user;
}

async function requireAdmin(req: express.Request, res: express.Response): Promise<StoredUser | null> {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (user.role !== 'Admin') {
    res.status(403).json({ error: 'This action requires an Admin.' });
    return null;
  }
  return user;
}

type Viewer = Pick<User, 'id' | 'role' | 'department' | 'institutionId'>;

function canViewWithShares(user: Viewer, doc: Document, sharedDocIds: Set<string>): boolean {
  if (!user.institutionId || user.institutionId !== doc.institutionId) return false;
  if (doc.ownerId === user.id) return true;
  const shared = sharedDocIds.has(doc.id);
  if (doc.confidentialityLevel === 'Confidential') return user.role === 'Admin' || shared;
  if (user.role === 'Admin' || user.role === 'Manager' || user.role === 'Auditor') return true;
  if (user.role === 'Staff') return shared || doc.department === user.department;
  if (user.role === 'Viewer') return shared || (doc.department === user.department && doc.status === 'Approved');
  return false;
}

async function canViewDocument(user: Viewer, doc: Document): Promise<boolean> {
  const perms = await db().listPermissionsForDocument(doc.id);
  return canViewWithShares(user, doc, new Set(perms.filter(p => p.sharedWithUserId === user.id).map(p => p.documentId)));
}

async function canEditDocument(user: Pick<User, 'id' | 'role' | 'institutionId'>, doc: Document): Promise<boolean> {
  if (!user.institutionId || user.institutionId !== doc.institutionId) return false;
  if (doc.ownerId === user.id) return true;
  const perms = await db().listPermissionsForDocument(doc.id);
  const editor = perms.some(p => p.sharedWithUserId === user.id && p.permissionType === 'Editor');
  if (doc.confidentialityLevel === 'Confidential') return user.role === 'Admin' || editor;
  return user.role === 'Admin' || user.role === 'Manager' || editor;
}

function canDeleteFolder(user: Pick<User, 'id' | 'role' | 'institutionId'>, folder: Folder): boolean {
  return user.institutionId === folder.institutionId && (user.role === 'Admin' || user.role === 'Manager' || folder.ownerId === user.id);
}

// File History / audit trail: restricted to Manager, Admin, and Auditor roles.
function canAudit(user: Pick<User, 'role'>): boolean {
  return user.role === 'Admin' || user.role === 'Manager' || user.role === 'Auditor';
}

// A document needs (re-)audit if it has never been audited, or has changed since its last audit.
function documentNeedsAudit(doc: Document): boolean {
  if (!doc.lastAuditedAt) return true;
  return new Date(doc.updatedAt).getTime() > new Date(doc.lastAuditedAt).getTime();
}

// Documents this user may see, with basic filters pushed down to the store.
async function visibleDocuments(user: Viewer, filter: DocumentFilter = {}): Promise<Document[]> {
  const { starred, ...storeFilter } = filter;
  let docs = (await db().listDocuments(storeFilter)).filter(d => d.institutionId === user.institutionId);
  const perms = await db().listPermissionsForUser(user.id);
  const sharedIds = new Set(perms.map(p => p.documentId));
  docs = docs.filter(d => canViewWithShares(user, d, sharedIds));
  const starredIds = new Set(await db().listStarredDocumentIds(user.id));
  docs = docs.map(d => ({ ...d, isStarred: starredIds.has(d.id) }));
  return starred ? docs.filter(d => d.isStarred) : docs;
}

// ----------------------------------------------------
// Misc helpers
// ----------------------------------------------------
function mimeForType(fileType?: string): string {
  const t = (fileType || '').toLowerCase();
  const table: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', heic: 'image/heic',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', html: 'text/html',
    json: 'application/json', xml: 'application/xml', zip: 'application/zip',
    mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav'
  };
  if (t.includes('/')) return t; // already a MIME type
  for (const [ext, mime] of Object.entries(table)) {
    if (t === ext || t.endsWith(`.${ext}`)) return mime;
  }
  for (const [ext, mime] of Object.entries(table)) {
    if (t.includes(ext)) return mime;
  }
  return 'application/octet-stream';
}

function isPreviewableInline(fileType?: string): boolean {
  const mime = mimeForType(fileType);
  // SVG and HTML are never safe to serve inline (Content-Disposition: inline)
  // from the app's own origin: both can embed <script> that would then run
  // with the viewer's session. Everything else in the allowlist below is
  // inert when rendered (bitmap images, PDF, plain/non-HTML text, JSON).
  if (mime === 'image/svg+xml' || mime === 'text/html') return false;
  return mime.startsWith('image/') || mime === 'application/pdf' || mime.startsWith('text/') || mime === 'application/json';
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  'pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv', 'md', 'json',
  'png', 'jpg', 'jpeg', 'gif', 'webp'
]);

function validateUploadFile(fileName: unknown, fileType: unknown, declaredSize: unknown, buffer?: Buffer): string | null {
  const name = String(fileName || '').trim();
  const type = String(fileType || '').toLowerCase();
  const size = Number(declaredSize) || buffer?.byteLength || 0;
  if (!name || /[\u0000-\u001f\u007f]/.test(name) || name.length > 240) return 'Invalid file name.';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) return `Files of type .${ext || 'unknown'} are not allowed.`;
  if (size <= 0 || size > MAX_UPLOAD_BYTES || (buffer && buffer.byteLength > MAX_UPLOAD_BYTES)) {
    return 'File must be between 1 byte and 25 MB.';
  }
  if (/(html|svg|javascript|x-msdownload|x-sh|executable)/.test(type)) return 'Executable or active-content files are not allowed.';
  if (!buffer) return null;
  const starts = (...bytes: number[]) => bytes.every((byte, index) => buffer[index] === byte);
  const officeZip = ['docx', 'xlsx', 'pptx'].includes(ext);
  if (ext === 'pdf' && buffer.subarray(0, 5).toString() !== '%PDF-') return 'The file content does not match a PDF.';
  if (ext === 'png' && !starts(0x89, 0x50, 0x4e, 0x47)) return 'The file content does not match a PNG image.';
  if (['jpg', 'jpeg'].includes(ext) && !starts(0xff, 0xd8, 0xff)) return 'The file content does not match a JPEG image.';
  if (ext === 'gif' && !['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString())) return 'The file content does not match a GIF image.';
  if (ext === 'webp' && !(buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP')) return 'The file content does not match a WebP image.';
  if (officeZip && !(starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06))) return 'The Office file has an invalid container.';
  if (['txt', 'csv', 'md', 'json'].includes(ext) && buffer.subarray(0, 4096).includes(0)) return 'Text files may not contain binary data.';
  if (ext === 'json') {
    try { JSON.parse(buffer.toString('utf8')); } catch { return 'The JSON file is invalid.'; }
  }
  return null;
}

function latestOf(versions: DocumentVersion[]): DocumentVersion | undefined {
  return versions[0]; // store returns newest-first
}

function withFileMetadata<T extends Document>(doc: T, latest?: DocumentVersion): T & Pick<DocumentVersion, 'fileName' | 'fileSize' | 'fileType'> {
  return {
    ...doc,
    fileName: latest?.fileName || doc.fileName || '',
    fileSize: latest?.fileSize || doc.fileSize || 0,
    fileType: latest?.fileType || doc.fileType || '',
    needsAudit: documentNeedsAudit(doc)
  };
}

async function attachLatestFileMetadata(docs: Document[]): Promise<Document[]> {
  if (docs.length === 0) return docs;
  const versions = await db().listVersionsForDocuments(docs.map(d => d.id));
  const latestByDoc = new Map<string, DocumentVersion>();
  for (const v of versions) {
    if (!latestByDoc.has(v.documentId)) latestByDoc.set(v.documentId, v); // newest-first
  }
  return docs.map(d => withFileMetadata(d, latestByDoc.get(d.id)));
}

async function logActivity(user: Pick<User, 'id' | 'fullName' | 'role'>, action: string, docId?: string, docTitle?: string, details = '') {
  const entry: ActivityLog = {
    id: `log-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    userId: user.id,
    userName: user.fullName,
    userRole: user.role,
    action,
    documentId: docId,
    documentTitle: docTitle,
    details,
    createdAt: new Date().toISOString()
  };
  try {
    await db().createLog(entry);
  } catch (err) {
    console.error('[audit] failed to persist log entry:', (err as Error).message);
  }
}

function requestBaseUrl(req: express.Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')).split(',')[0];
  return `${proto}://${req.headers.host || 'localhost'}`;
}

function requestIp(req: express.Request): string {
  return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
}

async function rateLimited(key: string, maxAttempts = 10): Promise<boolean> {
  const hashedKey = sha256Hex(key);
  if (supabase && storageEnabled) {
    const { data, error } = await supabase.rpc('docuhub_check_rate_limit', {
      p_key: hashedKey, p_window_seconds: 15 * 60, p_max_attempts: maxAttempts
    });
    if (!error) return Boolean(data);
    console.error('[auth] durable rate limiter failed; using local fallback:', error.message);
  }
  return loginRateLimited(hashedKey);
}

async function clearRateLimit(...keys: string[]): Promise<void> {
  const hashes = keys.map(sha256Hex);
  hashes.forEach(clearLoginAttempts);
  if (supabase && storageEnabled) {
    await supabase.from('auth_rate_limits').delete().in('rate_key', hashes);
  }
}

// Share/share-link notifications use a Resend dashboard-authored template
// when RESEND_SHARE_TEMPLATE_ID is set, falling back to the raw-HTML
// mail (built by documentSharedEmail/externalLinkSharedEmail) otherwise --
// same optional-integration pattern as RESEND_API_KEY, GEMINI_API_KEY, etc.
// `variables` keys (RECIPIENT_NAME, SENDER_NAME, DOCUMENT_NAME, DOCUMENT_META,
// PERSONAL_MESSAGE, SECURITY_NOTICE, EXPIRY_DATE, DOCUMENT_URL, CURRENT_YEAR)
// match the placeholders in the "Document Shared" template in the Resend
// dashboard -- keep them in sync if that template's variables change.
async function sendShareEmail(
  to: string, mail: { subject: string; html: string }, variables: Record<string, unknown>
): Promise<boolean> {
  const templateId = process.env.RESEND_SHARE_TEMPLATE_ID;
  if (templateId) return sendTemplatedEmail({ to, templateId, variables });
  return sendEmail({ to, ...mail });
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

// Strip the server-only password hash from a share link before returning it.
function publicLink(l: ExternalShareLink) {
  const { password, passwordHash, ...rest } = l;
  return { ...rest, hasPassword: Boolean(passwordHash || password) };
}

async function genShortCode(): Promise<string> {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 8; attempt++) {
    let code = '';
    for (let i = 0; i < 10; i++) code += alphabet[crypto.randomInt(alphabet.length)];
    if (!(await db().getLinkByCode(code))) return code;
  }
  return crypto.randomBytes(6).toString('hex');
}

// Stored file payloads are base64 for uploads but raw text for seed data.
function looksLikeBase64(s: string): boolean {
  const compact = s.replace(/\s/g, '');
  return compact.length > 0 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

function storedFileToBuffer(fileData: string): Buffer {
  return looksLikeBase64(fileData) ? Buffer.from(fileData, 'base64') : Buffer.from(fileData, 'utf8');
}

function decodeMaybeBase64(input: string): string {
  if (!input) return '';
  try {
    const decoded = Buffer.from(input, 'base64').toString('utf8');
    const reencoded = Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/, '');
    if (reencoded === input.replace(/\s+/g, '').replace(/=+$/, '')) {
      return decoded;
    }
  } catch {
    /* fall through */
  }
  return input;
}

// ----------------------------------------------------
// Institution profiles & automatic document filing
// ----------------------------------------------------
const FALLBACK_INSTITUTION: Institution = {
  id: 'inst-fallback',
  name: 'Organization',
  units: [],
  categoryFolders: {
    Contract: 'Contracts',
    Invoice: 'Invoices',
    Memo: 'Memos & Correspondence',
    Report: 'Reports',
    Support: 'Support & Technical',
    Other: 'General Documents'
  },
  activityDimension: 'none'
};

async function getInstitutionFor(institutionId?: string): Promise<Institution> {
  if (institutionId) {
    const inst = await db().getInstitution(institutionId);
    if (inst) return inst;
  }
  const all = await db().listInstitutions();
  return all[0] || FALLBACK_INSTITUTION;
}

const DOCUMENT_CATEGORIES: Document['documentType'][] = ['Contract', 'Invoice', 'Memo', 'Report', 'Support', 'Other'];

function coerceDocumentCategory(value: unknown): Document['documentType'] | null {
  return DOCUMENT_CATEGORIES.includes(value as Document['documentType'])
    ? value as Document['documentType']
    : null;
}

function categoryFolderName(inst: Institution, category: Document['documentType']): string {
  return inst.categoryFolders[category] || inst.categoryFolders.Other || category;
}

function findFolderIn(folders: Folder[], name: string, parentFolderId: string | null, department: string | undefined): Folder | undefined {
  return folders.find(
    f =>
      f.parentFolderId === parentFolderId &&
      f.name.toLowerCase() === name.toLowerCase() &&
      (department ? (f.department || undefined) === department : true)
  );
}

function normalizeActivity(activity?: string): string {
  const cleaned = (activity || '').replace(/[^a-zA-Z0-9 &/-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'General Activity';
  return cleaned.split(' ').slice(0, 4).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

async function previewAutoFolder(
  inst: Institution,
  department: string | undefined,
  category: Document['documentType'],
  activity?: string
): Promise<{ path: string; exists: boolean; missingCabinets: string[] }> {
  const folders = (await db().listFolders()).filter(folder => folder.institutionId === inst.id);
  const unitName = department && department.trim() ? department.trim() : 'Unassigned Unit';
  const categoryName = categoryFolderName(inst, category);
  const activityName = inst.activityDimension === 'ai-activity' ? normalizeActivity(activity) : null;
  const pathParts = activityName ? [unitName, categoryName, activityName] : [unitName, categoryName];

  const missingCabinets: string[] = [];
  const unitFolder = findFolderIn(folders, unitName, null, department);
  if (!unitFolder) {
    missingCabinets.push(unitName, categoryName);
    if (activityName) missingCabinets.push(activityName);
    return { path: pathParts.join(' / '), exists: false, missingCabinets };
  }
  const categoryFolder = findFolderIn(folders, categoryName, unitFolder.id, department);
  if (!categoryFolder) {
    missingCabinets.push(categoryName);
    if (activityName) missingCabinets.push(activityName);
    return { path: pathParts.join(' / '), exists: false, missingCabinets };
  }
  if (activityName && !findFolderIn(folders, activityName, categoryFolder.id, department)) {
    missingCabinets.push(activityName);
    return { path: pathParts.join(' / '), exists: false, missingCabinets };
  }
  return { path: pathParts.join(' / '), exists: true, missingCabinets };
}

async function ensureFolder(
  folders: Folder[],
  name: string,
  parentFolderId: string | null,
  department: string | undefined,
  ownerId: string,
  institutionId: string
): Promise<Folder> {
  const existing = findFolderIn(folders, name, parentFolderId, department);
  if (existing) return existing;
  const folder: Folder = {
    id: `auto-${slugify(name)}-${slugify(parentFolderId || 'root')}-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    name,
    parentFolderId,
    ownerId,
    institutionId,
    department,
    createdAt: new Date().toISOString()
  };
  await db().createFolder(folder);
  folders.push(folder);
  return folder;
}

async function resolveAutoFolder(
  ownerId: string,
  inst: Institution,
  department: string | undefined,
  category: Document['documentType'],
  activity?: string
): Promise<{ folderId: string; path: string }> {
  const folders = (await db().listFolders()).filter(folder => folder.institutionId === inst.id);
  const unitName = department && department.trim() ? department.trim() : 'Unassigned Unit';
  const unitFolder = await ensureFolder(folders, unitName, null, department, ownerId, inst.id);
  const categoryName = categoryFolderName(inst, category);
  const categoryFolder = await ensureFolder(folders, categoryName, unitFolder.id, department, ownerId, inst.id);
  if (inst.activityDimension === 'ai-activity') {
    const activityName = normalizeActivity(activity);
    const activityFolder = await ensureFolder(folders, activityName, categoryFolder.id, department, ownerId, inst.id);
    return { folderId: activityFolder.id, path: `${unitName} / ${categoryName} / ${activityName}` };
  }
  return { folderId: categoryFolder.id, path: `${unitName} / ${categoryName}` };
}

function collectFolderTreeIds(folders: Folder[], folderId: string): string[] {
  const ids = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentFolderId && ids.has(folder.parentFolderId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return Array.from(ids);
}

// ----------------------------------------------------
// AI-OCR and automated tagging (Gemini, with local heuristic fallback)
// ----------------------------------------------------
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    if (process.env.ENABLE_EXTERNAL_AI !== 'true') return null;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY environment variable is missing. Multimodal OCR & Tags will use premium local heuristics simulation.');
      return null;
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
  }
  return aiClient;
}

async function runAiOcrAndTagging(fileName: string, mimeType: string, fileDataB64OrText: string) {
  const ai = getGeminiClient();
  const lowerName = fileName.toLowerCase();
  const isImage = mimeType.startsWith('image/');
  const decodedText = isImage ? '' : decodeMaybeBase64(fileDataB64OrText);

  if (ai) {
    try {
      let contents: any;
      if (isImage) {
        contents = {
          parts: [
            {
              inlineData: {
                data: fileDataB64OrText.includes('base64,') ? fileDataB64OrText.split('base64,')[1] : fileDataB64OrText,
                mimeType: mimeType
              }
            },
            {
              text: `You are an integrated AI engine inside an enterprise Document Management System (AVDP Document Management System).
This file is titled "${fileName}". It is an image.
Analyze the image content and perform these tasks:
1. Extract all legible printed or handwritten text (OCR). Clean it up & preserve layout or structure.
2. Formulate 3 to 5 highly practical metadata tags for categorizing this document (e.g., invoice, technical, agreement, board, HR, audit, compliance). Keep tags all-lowercase with no '#' symbol.
3. Classify document type into exactly one of: 'Contract', 'Invoice', 'Memo', 'Report', 'Support', 'Other'.
4. Write a brief 1-sentence description summarizes the document contents.
5. Infer a short (2-4 word) business activity or project this document relates to, in Title Case (e.g., "Vendor Onboarding", "Q1 Budgeting", "Office Lease"). Use "General" if unclear.

Format the output strictly as a JSON object with this shape:
{
  "ocrText": "Extracted OCR text here...",
  "tags": ["tag1", "tag2", "tag3"],
  "documentType": "Contract" | "Invoice" | "Memo" | "Report" | "Support" | "Other",
  "description": "Short description here...",
  "activity": "Short activity label"
}`
            }
          ]
        };
      } else {
        contents = {
          parts: [
            {
              text: `You are an integrated AI engine inside AVDP Document Management System. This file is titled "${fileName}".
Here is its core raw text/data:
"${decodedText}"

Analyze this text and perform these tasks:
1. Summarize and index this content cleanly for our full-text database indexer.
2. Provide a list of 3 to 5 tag keywords. Keep tags lowercase with no '#' sign.
3. Classify document type into exactly one of: 'Contract', 'Invoice', 'Memo', 'Report', 'Support', 'Other'.
4. Write a brief 1-sentence description summarizes the document contents.
5. Infer a short (2-4 word) business activity or project this document relates to, in Title Case (e.g., "Vendor Onboarding", "Q1 Budgeting", "Office Lease"). Use "General" if unclear.

Format the output strictly as JSON matching this shape:
{
  "ocrText": "Cleaned full indexed text contents...",
  "tags": ["tag1", "tag2", "tag3"],
  "documentType": "Contract" | "Invoice" | "Memo" | "Report" | "Support" | "Other",
  "description": "Short description here...",
  "activity": "Short activity label"
}`
            }
          ]
        };
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              ocrText: { type: Type.STRING },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } },
              documentType: { type: Type.STRING },
              description: { type: Type.STRING },
              activity: { type: Type.STRING }
            },
            required: ['ocrText', 'tags', 'documentType', 'description']
          }
        }
      });

      if (response && response.text) {
        const result = JSON.parse(response.text.trim());
        return {
          ocrText: result.ocrText || 'No text extracted during scan.',
          tags: result.tags || ['analyzed'],
          documentType: result.documentType || 'Other',
          description: result.description || 'AI analyzed upload.',
          activity: result.activity || 'General'
        };
      }
    } catch (err) {
      console.error('Gemini OCR analysis failed, falling back to local simulation heuristically', err);
    }
  }

  console.log('Using local heuristic indexer.');
  const testText = (isImage ? '' : decodedText).substring(0, 1000);

  let detectedType: Document['documentType'] = 'Other';
  let desc = 'Standard document upload.';
  let tagsObj = ['uploaded', 'indexed'];
  let activity = 'General';

  if (lowerName.includes('invoice') || lowerName.includes('bill') || lowerName.includes('payment') || testText.toLowerCase().includes('total') || testText.toLowerCase().includes('amount') || testText.toLowerCase().includes('invoice')) {
    detectedType = 'Invoice';
    desc = 'Simulated OCR recognized: Invoice transaction details matching smart templates.';
    tagsObj = ['invoice', 'finance', 'payment', 'ocr-simulated'];
    activity = 'Billing & Payments';
  } else if (lowerName.includes('agree') || lowerName.includes('contract') || lowerName.includes('lease') || testText.toLowerCase().includes('agreement') || testText.toLowerCase().includes('terms')) {
    detectedType = 'Contract';
    desc = 'Simulated OCR recognized: Commercial legal agreement and vendor service terms.';
    tagsObj = ['contract', 'legal', 'agreement', 'ocr-simulated'];
    activity = testText.toLowerCase().includes('lease') || lowerName.includes('lease') ? 'Leasing' : 'Vendor Agreements';
  } else if (lowerName.includes('memo') || lowerName.includes('letter') || lowerName.includes('internal')) {
    detectedType = 'Memo';
    desc = 'Simulated OCR recognized: Internal communications and organizational memo.';
    tagsObj = ['memo', 'admin', 'internal', 'ocr-simulated'];
    activity = 'Internal Communications';
  } else if (lowerName.includes('report') || lowerName.includes('audit') || lowerName.includes('metric') || lowerName.includes('q1') || lowerName.includes('q2')) {
    detectedType = 'Report';
    desc = 'Simulated OCR recognized: Quantitative progress report and department metrics sheet.';
    tagsObj = ['report', 'analytics', 'audit', 'ocr-simulated'];
    activity = testText.toLowerCase().includes('audit') || lowerName.includes('audit') ? 'Auditing' : 'Reporting';
  } else if (lowerName.includes('it') || lowerName.includes('sys') || lowerName.includes('tech') || lowerName.includes('api')) {
    detectedType = 'Support';
    desc = 'Simulated OCR recognized: Technical schema documentation with storage parameters.';
    tagsObj = ['tech', 'support', 'it-infra', 'ocr-simulated'];
    activity = 'Technical Operations';
  }

  return {
    ocrText: `[HEURISTIC OCR ANALYSIS] Document: ${fileName}\nDetected text patterns. Indexed at ${new Date().toLocaleString()}.\nPreview snippet:\n${testText.substring(0, 250) || 'Generic asset binary stream'}\nIndex complete.`,
    tags: tagsObj,
    documentType: detectedType,
    description: desc,
    activity
  };
}

// Resolve the analysis payload for uploads: inline base64 or a stored object.
// Direct-to-storage uploads are only pulled back for analysis when small
// enough to stay inside request memory/CPU budgets.
const MAX_ANALYZE_BYTES = 8 * 1024 * 1024;

async function analysisPayloadFor(opts: { fileData?: string; storagePath?: string; fileSize?: number; fileType?: string }): Promise<string | null> {
  if (opts.fileData) return String(opts.fileData);
  if (opts.storagePath && (opts.fileSize ?? Infinity) <= MAX_ANALYZE_BYTES) {
    const buffer = await downloadStoredFile(opts.storagePath);
    if (buffer) return buffer.toString('base64');
  }
  return null;
}

// Wrap an async route handler so rejections become 500s instead of hanging.
function h(fn: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler {
  return (req, res) => {
    fn(req, res).catch(err => {
      console.error(`[api] ${req.method} ${req.path} failed:`, err);
      if (!res.headersSent) res.status(500).json({
        error: 'Internal server error.',
        ...(process.env.NODE_ENV === 'production' ? {} : { details: (err as Error).message })
      });
    });
  };
}

// ----------------------------------------------------
// AUTH ROUTES
// ----------------------------------------------------
app.post('/api/auth/login', h(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const ipKey = `login-ip:${requestIp(req)}`;
  const emailKey = `login-email:${email}`;
  if (await rateLimited(ipKey, 50) || await rateLimited(emailKey, 10)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again in a few minutes.' });
  }

  const user = await db().getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (!user.isActive) {
    return res.status(403).json({ error: 'This account is inactive. Contact your administrator.' });
  }

  await clearRateLimit(ipKey, emailKey);
  setSessionCookie(req, res, user.id, user.sessionVersion || 0);
  await db().updateUser(user.id, { lastLoginAt: new Date().toISOString() });
  await logActivity(user, 'Login', undefined, undefined, `${user.fullName} signed in.`);
  res.json({ success: true, user: publicUser(user), mustChangePassword: Boolean(user.mustChangePassword) });
}));

// Which OAuth providers are configured, so the frontend knows whether to
// show a "Sign in with Google/Microsoft" button at all.
app.get('/api/auth/oauth/config', h(async (req, res) => {
  res.json({ google: isProviderConfigured('google'), microsoft: isProviderConfigured('microsoft') });
}));

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function isOAuthProvider(value: string): value is OAuthProvider {
  return value === 'google' || value === 'microsoft';
}

function oauthRedirectUri(req: express.Request, provider: OAuthProvider): string {
  return `${requestBaseUrl(req)}/api/auth/oauth/${provider}/callback`;
}

// Kicks off the provider's consent screen. `state` is a signed, expiring
// token (reusing the same signSession/verifySession the session cookie
// itself uses) rather than server-side memory: on Workers, the callback can
// land on a different isolate than the one that issued `state`, so it has
// to be self-verifying, not looked up.
app.get('/api/auth/oauth/:provider/start', h(async (req, res) => {
  const provider = req.params.provider;
  if (!isOAuthProvider(provider)) return res.status(404).send('Unknown provider.');
  if (!isProviderConfigured(provider)) {
    return res.status(503).send(`Sign-in with ${provider === 'google' ? 'Google' : 'Microsoft'} is not configured on this server.`);
  }
  const nonce = crypto.randomBytes(24).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const stateSubject = `oauth:${provider}:${nonce}:${verifier}`;
  const state = signSession(stateSubject, Date.now() + OAUTH_STATE_TTL_MS);
  setSignedCookie(req, res, 'oauth_state', stateSubject, OAUTH_STATE_TTL_MS, 'Lax');
  res.redirect(302, buildAuthorizeUrl(provider, oauthRedirectUri(req, provider), state, nonce, challenge));
}));

// This is an alternative login method for accounts an Admin has already
// created -- matched by email -- not a self-registration path. An email
// with no existing dms_users row is rejected, same as every other part of
// this app's admin-invite-only account model.
app.get('/api/auth/oauth/:provider/callback', h(async (req, res) => {
  const provider = req.params.provider;
  const baseUrl = requestBaseUrl(req);
  const failUrl = (reason: string) => `${baseUrl}/?oauthError=${encodeURIComponent(reason)}`;

  if (!isOAuthProvider(provider)) return res.status(404).send('Unknown provider.');

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const providerError = typeof req.query.error === 'string' ? req.query.error : '';
  const providerLabel = provider === 'google' ? 'Google' : 'Microsoft';

  if (providerError) return res.redirect(302, failUrl(`${providerLabel} sign-in was cancelled.`));
  if (!code || !state) return res.redirect(302, failUrl('Missing sign-in parameters. Please try again.'));

  const statePayload = verifySession(state);
  const cookieState = verifySession(parseCookies(req).oauth_state || '');
  if (!statePayload || statePayload !== cookieState || !statePayload.startsWith(`oauth:${provider}:`)) {
    return res.redirect(302, failUrl('This sign-in attempt expired. Please try again.'));
  }
  const [nonce, verifier] = statePayload.slice(`oauth:${provider}:`.length).split(':');
  if (!nonce || !verifier) return res.redirect(302, failUrl('This sign-in attempt is invalid. Please try again.'));

  const profile = await exchangeCodeForProfile(provider, code, oauthRedirectUri(req, provider), nonce, verifier);
  if (!profile) return res.redirect(302, failUrl(`Could not verify your ${providerLabel} account. Please try again.`));

  const existingUser = await db().getUserByEmail(profile.email);
  if (!existingUser) {
    return res.redirect(302, failUrl('No account found for this email. Contact your administrator.'));
  }
  if (!existingUser.isActive) {
    return res.redirect(302, failUrl('This account has been deactivated. Contact your administrator.'));
  }

  setSessionCookie(req, res, existingUser.id, existingUser.sessionVersion || 0);
  await db().updateUser(existingUser.id, { lastLoginAt: new Date().toISOString() });
  await logActivity(existingUser, 'Login', undefined, undefined, `${existingUser.fullName} signed in via ${providerLabel}.`);
  res.redirect(302, `${baseUrl}/`);
}));

app.post('/api/auth/logout', h(async (req, res) => {
  const user = await getUserFromRequest(req);
  clearSessionCookie(req, res);
  if (user) await logActivity(user, 'Logout', undefined, undefined, `${user.fullName} signed out.`);
  res.json({ success: true });
}));

app.post('/api/auth/change-password', h(async (req, res) => {
  const user = await requireUser(req, res, true);
  if (!user) return;
  const { currentPassword, newPassword } = req.body || {};

  const strengthError = validatePasswordStrength(String(newPassword || ''));
  if (strengthError) return res.status(400).json({ error: strengthError });

  // A user with a password must prove they know it; accounts created before
  // passwords existed (legacy import) may set one directly.
  if (user.passwordHash && !verifyPassword(String(currentPassword || ''), user.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const nextSessionVersion = (user.sessionVersion || 0) + 1;
  await db().updateUser(user.id, {
    passwordHash: hashPassword(String(newPassword)),
    mustChangePassword: false,
    sessionVersion: nextSessionVersion,
    resetTokenHash: undefined,
    resetTokenExpiresAt: undefined
  });
  setSessionCookie(req, res, user.id, nextSessionVersion);
  await logActivity(user, 'Change Password', undefined, undefined, 'Password changed.');
  res.json({ success: true });
}));

app.post('/api/auth/forgot-password', h(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  // Always answer 200 so the endpoint can't be used to enumerate accounts.
  res.json({ success: true, message: 'If that email belongs to an account, a reset link has been sent.' });
  if (!email) return;
  const user = await db().getUserByEmail(email);
  if (!user || !user.isActive) return;

  const token = crypto.randomBytes(32).toString('hex');
  await db().updateUser(user.id, {
    resetTokenHash: sha256Hex(token),
    resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
  const resetUrl = `${requestBaseUrl(req)}/reset-password?token=${token}`;
  const mail = passwordResetEmail({ fullName: user.fullName, resetUrl });
  await sendEmail({ to: user.email, ...mail });
}));

app.post('/api/auth/reset-password', h(async (req, res) => {
  const token = String(req.body?.token || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!token) return res.status(400).json({ error: 'Reset token is required.' });
  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) return res.status(400).json({ error: strengthError });

  const user = await db().getUserByResetTokenHash(sha256Hex(token));
  if (!user || !user.resetTokenExpiresAt || new Date(user.resetTokenExpiresAt).getTime() < Date.now()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  }

  await db().updateUser(user.id, {
    passwordHash: hashPassword(newPassword),
    mustChangePassword: false,
    sessionVersion: (user.sessionVersion || 0) + 1,
    resetTokenHash: undefined,
    resetTokenExpiresAt: undefined
  });
  await logActivity(user, 'Reset Password', undefined, undefined, 'Password reset via emailed link.');
  res.json({ success: true });
}));

// Session bootstrap: the currently authenticated profile (or null).
app.get('/api/session', h(async (req, res) => {
  const user = await getUserFromRequest(req);
  res.json({
    user: user ? publicUser(user) : null,
    mustChangePassword: Boolean(user?.mustChangePassword)
  });
}));

// Lightweight health check for the platform's uptime probe.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: typeof process.uptime === 'function' ? process.uptime() : 0, timestamp: new Date().toISOString() });
});

// ----------------------------------------------------
// USER MANAGEMENT
// ----------------------------------------------------
const USER_ROLES: User['role'][] = ['Admin', 'Manager', 'Staff', 'Viewer', 'Auditor'];

async function sanitizeUserPayload(body: Partial<User>): Promise<{ value?: Omit<User, 'id'>; error?: string }> {
  const fullName = String(body.fullName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const role = body.role as User['role'];
  const department = String(body.department || '').trim();
  const institutionId = body.institutionId ? String(body.institutionId) : DEFAULT_INSTITUTION_ID;

  if (!fullName) return { error: 'Full name is required.' };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'A valid email address is required.' };
  const allowedDomain = (process.env.ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase();
  if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
    return { error: `Only @${allowedDomain} email addresses are allowed.` };
  }
  if (!USER_ROLES.includes(role)) return { error: 'A valid role is required.' };
  if (!department) return { error: 'Department is required.' };
  const institutions = await db().listInstitutions();
  if (!institutions.some(i => i.id === institutionId) && institutions.length > 0) {
    return { error: 'Selected institution does not exist.' };
  }

  return {
    value: {
      fullName,
      email,
      role,
      department,
      isActive: body.isActive !== false,
      institutionId
    }
  };
}

// Users list (authenticated; powers share/approver pickers + user management).
app.get('/api/users', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const users = (await db().listUsers()).filter(candidate => candidate.institutionId === user.institutionId && candidate.isActive);
  res.json(users.map(publicUser));
}));

// Create a user (Admin only). Generates a temporary password, returned once
// in the response and emailed to the new user when email is configured.
app.post('/api/users', h(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const parsed = await sanitizeUserPayload({ ...(req.body || {}), institutionId: admin.institutionId });
  if (parsed.error || !parsed.value) return res.status(400).json({ error: parsed.error });
  if (await db().getUserByEmail(parsed.value.email)) {
    return res.status(409).json({ error: 'A user with this email already exists.' });
  }

  const tempPassword = generateTempPassword();
  const user: StoredUser = {
    id: newId('user'),
    ...parsed.value,
    passwordHash: hashPassword(tempPassword),
    mustChangePassword: true,
    sessionVersion: 0
  };

  await db().createUser(user);
  await logActivity(admin, 'Create User', undefined, user.fullName, `Created user profile for ${user.fullName} (${user.role}).`);
  const mail = inviteEmail({ fullName: user.fullName, email: user.email, tempPassword, baseUrl: requestBaseUrl(req) });
  const emailSent = await sendEmail({ to: user.email, ...mail });
  res.status(201).json({ ...publicUser(user), tempPassword, emailSent });
}));

// Update a user profile (Admin only).
app.put('/api/users/:id', h(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const target = await db().getUser(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  if (target.institutionId !== admin.institutionId) return res.status(403).json({ error: 'Cross-institution user management is not allowed.' });
  const parsed = await sanitizeUserPayload({ ...publicUser(target), ...(req.body || {}), institutionId: admin.institutionId });
  if (parsed.error || !parsed.value) return res.status(400).json({ error: parsed.error });

  const duplicate = await db().getUserByEmail(parsed.value.email);
  if (duplicate && duplicate.id !== target.id) {
    return res.status(409).json({ error: 'A user with this email already exists.' });
  }
  if (target.role === 'Admin' && target.isActive && (parsed.value.role !== 'Admin' || parsed.value.isActive === false)) {
    const otherAdmins = (await db().listUsers()).filter(candidate =>
      candidate.id !== target.id && candidate.institutionId === target.institutionId && candidate.role === 'Admin' && candidate.isActive
    );
    if (otherAdmins.length === 0) return res.status(400).json({ error: 'At least one active Admin is required.' });
  }

  const updated = await db().updateUser(target.id, parsed.value);
  await logActivity(admin, 'Update User', undefined, parsed.value.fullName, `Updated user profile for ${parsed.value.fullName} (${parsed.value.role}).`);
  res.json(updated ? publicUser(updated) : null);
}));

// Toggle active status (Admin only). The last Admin cannot be disabled.
app.post('/api/users/:id/toggle-active', h(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const target = await db().getUser(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.institutionId !== admin.institutionId) return res.status(403).json({ error: 'Cross-institution user management is not allowed.' });

  const nextActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : !target.isActive;
  if (!nextActive && target.role === 'Admin') {
    const users = await db().listUsers();
    const activeAdmins = users.filter(u => u.role === 'Admin' && u.isActive && u.id !== target.id).length;
    if (activeAdmins === 0) return res.status(400).json({ error: 'At least one active Admin is required.' });
  }

  const updated = await db().updateUser(target.id, { isActive: nextActive });
  await logActivity(admin, nextActive ? 'Activate User' : 'Deactivate User', undefined, target.fullName, `${nextActive ? 'Activated' : 'Deactivated'} ${target.fullName}.`);
  res.json(updated ? publicUser(updated) : null);
}));

// Admin resets a user's password to a fresh temporary one.
app.post('/api/users/:id/reset-password', h(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const target = await db().getUser(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.institutionId !== admin.institutionId) return res.status(403).json({ error: 'Cross-institution user management is not allowed.' });

  const tempPassword = generateTempPassword();
  await db().updateUser(target.id, {
    passwordHash: hashPassword(tempPassword),
    mustChangePassword: true,
    sessionVersion: (target.sessionVersion || 0) + 1,
    resetTokenHash: undefined,
    resetTokenExpiresAt: undefined
  });
  await logActivity(admin, 'Reset User Password', undefined, target.fullName, `Reset password for ${target.fullName}.`);
  const mail = tempPasswordEmail({ fullName: target.fullName, tempPassword, baseUrl: requestBaseUrl(req) });
  const emailSent = await sendEmail({ to: target.email, ...mail });
  res.json({ success: true, tempPassword, emailSent });
}));

// ----------------------------------------------------
// INSTITUTION PROFILE
// ----------------------------------------------------
app.get('/api/institution', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json(await getInstitutionFor(user.institutionId));
}));

app.get('/api/institutions', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const institutions = await db().listInstitutions();
  res.json(institutions.filter(i => i.id === user.institutionId));
}));

app.put('/api/institution', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== 'Admin') {
    return res.status(403).json({ error: 'Only an Admin can edit the institution profile.' });
  }

  const institutions = await db().listInstitutions();
  const inst = institutions.find(i => i.id === user.institutionId);
  if (!inst) return res.status(404).json({ error: 'Institution not found.' });

  const { name, units, categoryFolders, activityDimension } = req.body || {};
  const patch: Partial<Institution> = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Institution name must be a non-empty string.' });
    }
    patch.name = name.trim();
  }
  if (units !== undefined) {
    if (!Array.isArray(units) || units.some(u => typeof u !== 'string')) {
      return res.status(400).json({ error: 'Units must be an array of strings.' });
    }
    patch.units = units.map((u: string) => u.trim()).filter(Boolean);
  }
  if (categoryFolders !== undefined) {
    if (typeof categoryFolders !== 'object' || categoryFolders === null) {
      return res.status(400).json({ error: 'categoryFolders must be an object.' });
    }
    const merged = { ...inst.categoryFolders };
    for (const cat of DOCUMENT_CATEGORIES) {
      const val = categoryFolders[cat];
      if (val !== undefined) {
        if (typeof val !== 'string' || !val.trim()) {
          return res.status(400).json({ error: `Folder name for "${cat}" must be a non-empty string.` });
        }
        merged[cat] = val.trim();
      }
    }
    patch.categoryFolders = merged;
  }
  if (activityDimension !== undefined) {
    if (activityDimension !== 'none' && activityDimension !== 'ai-activity') {
      return res.status(400).json({ error: "activityDimension must be 'none' or 'ai-activity'." });
    }
    patch.activityDimension = activityDimension as ActivityDimension;
  }

  const updated = await db().updateInstitution(inst.id, patch);
  await logActivity(user, 'Update Institution', undefined, updated?.name || inst.name, `Updated institution profile "${updated?.name || inst.name}" (activity dimension: ${updated?.activityDimension || inst.activityDimension}).`);
  res.json(updated || inst);
}));

// ----------------------------------------------------
// STATS
// ----------------------------------------------------
app.get('/api/stats', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const [visibleDocs, users, pendingMine] = await Promise.all([
    visibleDocuments(user, { deleted: 'exclude' }),
    db().listUsers(),
    db().listPendingApprovalsForApprover(user.id)
  ]);
  const approved = visibleDocs.filter(d => d.status === 'Approved').length;
  const versions = await db().listVersionsForDocuments(visibleDocs.map(d => d.id));
  const sizeSum = versions.reduce((sum, v) => sum + v.fileSize, 0);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const dashboardStats: DashboardStats = {
    totalFiles: visibleDocs.length,
    totalSize: sizeSum,
    approvedCount: approved,
    pendingMyApprovalCount: pendingMine.length,
    totalUsers: users.filter(u => u.isActive && u.institutionId === user.institutionId).length,
    recentUploadsCount: visibleDocs.filter(d => new Date(d.createdAt).getTime() > weekAgo).length,
    needsAuditCount: canAudit(user) ? visibleDocs.filter(documentNeedsAudit).length : 0
  };
  res.json(dashboardStats);
}));

// ----------------------------------------------------
// FOLDERS
// ----------------------------------------------------
app.get('/api/folders', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json((await db().listFolders()).filter(folder => folder.institutionId === user.institutionId));
}));

app.post('/api/folders', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === 'Viewer') {
    return res.status(403).json({ error: 'Viewers cannot create folders.' });
  }
  const { name, parentFolderId, department } = req.body;

  if (!name || String(name).trim() === '') {
    return res.status(400).json({ error: 'Folder name is required.' });
  }
  if (parentFolderId) {
    const parent = await db().getFolder(String(parentFolderId));
    if (!parent || parent.institutionId !== user.institutionId) {
      return res.status(400).json({ error: 'Parent folder is invalid.' });
    }
  }

  const newFolder: Folder = {
    id: newId('folder'),
    name,
    parentFolderId: parentFolderId || null,
    ownerId: user.id,
    institutionId: user.institutionId!,
    department: ['Admin', 'Manager'].includes(user.role) ? (department || undefined) : user.department,
    createdAt: new Date().toISOString()
  };
  await db().createFolder(newFolder);
  await logActivity(user, 'Create Folder', undefined, name, `Created a folder: "${name}"`);
  res.status(201).json(newFolder);
}));

app.delete('/api/folders/:id', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const folder = await db().getFolder(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found.' });
  if (!canDeleteFolder(user, folder)) {
    return res.status(403).json({ error: 'You do not have permission to delete this folder.' });
  }

  const folders = (await db().listFolders()).filter(candidate => candidate.institutionId === user.institutionId);
  const folderIds = collectFolderTreeIds(folders, folder.id);
  const folderIdSet = new Set(folderIds);
  const allDocs = await db().listDocuments({ deleted: 'any' });
  const docsInTree = allDocs.filter(d => d.folderId && folderIdSet.has(d.folderId));
  for (const doc of docsInTree) {
    if (!(await canEditDocument(user, doc))) {
      return res.status(403).json({ error: `You do not have permission to delete document "${doc.title}" in this folder.` });
    }
  }

  const now = new Date().toISOString();
  for (const doc of docsInTree) {
    await db().updateDocument(doc.id, { isDeleted: true, folderId: null, updatedAt: now });
  }
  await db().deleteFolders(folderIds);

  await logActivity(
    user,
    'Delete Folder',
    undefined,
    folder.name,
    `Deleted folder "${folder.name}" plus ${folderIds.length - 1} subfolder(s), moving ${docsInTree.length} contained document(s) to Trash.`
  );
  res.json({ success: true, deletedFolderIds: folderIds, trashedDocumentCount: docsInTree.length });
}));

// ----------------------------------------------------
// DOCUMENTS
// ----------------------------------------------------
app.get('/api/documents', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { folderId, status, category, query, starred, filterType } = req.query;

  const filter: DocumentFilter = {};
  if (filterType === 'trash') {
    filter.deleted = 'only';
  } else {
    filter.deleted = 'exclude';
    if (filterType === 'archive') filter.archived = true;
    else if (filterType !== 'shared') filter.archived = false;
  }
  if (folderId !== undefined) {
    filter.folderId = (folderId === 'root' || folderId === null || folderId === '') ? null : String(folderId);
  }
  if (status) filter.status = String(status);
  if (starred === 'true') filter.starred = true;
  if (category) filter.category = String(category);
  if (query) filter.query = String(query);

  let docs = await visibleDocuments(user, filter);

  if (filterType === 'shared') {
    // "Shared with me": documents explicitly shared with the user by someone else.
    const perms = await db().listPermissionsForUser(user.id);
    const sharedIds = new Set(perms.filter(p => p.sharedById !== user.id).map(p => p.documentId));
    docs = docs.filter(d => !d.isArchived && sharedIds.has(d.id));
  }

  const withMeta = await attachLatestFileMetadata(docs);

  if (filterType === 'needs-audit') {
    // Restricted to Manager/Admin/Auditor -- other roles never see anything here.
    return res.json(canAudit(user) ? withMeta.filter(d => d.needsAudit) : []);
  }

  res.json(withMeta);
}));

app.get('/api/documents/:id', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canViewDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }

  const [versions, comments, approvals, permissions, links, activity] = await Promise.all([
    db().listVersions(doc.id),
    db().listCommentsForDocument(doc.id),
    db().listApprovalsForDocument(doc.id),
    db().listPermissionsForDocument(doc.id),
    canEditDocument(user, doc).then(canEdit => canEdit ? db().listActiveLinksForDocument(doc.id) : []),
    canAudit(user) ? db().listLogsForDocument(doc.id) : Promise.resolve([])
  ]);
  const isStarred = (await db().listStarredDocumentIds(user.id)).includes(doc.id);

  res.json({
    document: withFileMetadata({ ...doc, isStarred }, latestOf(versions)),
    versions,
    comments,
    approvals,
    permissions,
    externalLinks: links.map(publicLink),
    activity
  });
}));

// Manager/Admin/Auditor mark a document as formally audited -- resets the
// "needs audit" flag until the document changes again.
app.post('/api/documents/:id/audit', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!canAudit(user)) {
    return res.status(403).json({ error: 'Only Managers, Admins, and Auditors can audit documents.' });
  }

  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canViewDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }

  const now = new Date().toISOString();
  const updated = await db().updateDocument(doc.id, {
    lastAuditedAt: now,
    lastAuditedBy: user.id,
    lastAuditedByName: user.fullName
  });
  await logActivity(user, 'Audit', doc.id, doc.title, `Marked as audited by ${user.fullName} (${user.role}).`);

  const versions = await db().listVersions(doc.id);
  res.json({ success: true, document: updated ? withFileMetadata(updated, latestOf(versions)) : null });
}));

// Pre-upload scan: detected category, suggested metadata, and smart-cabinet
// destination before the document is persisted.
app.post('/api/documents/scan', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { fileName, fileType, fileData, storagePath, uploadClaim, fileSize, department } = req.body || {};
  if (!fileName || (!fileData && !storagePath)) {
    return res.status(400).json({ error: 'File name and file data (or a storagePath) are required for scanning.' });
  }
  const scanValidation = validateUploadFile(fileName, fileType, fileSize, fileData ? storedFileToBuffer(String(fileData)) : undefined);
  if (scanValidation) return res.status(400).json({ error: scanValidation });
  if (storagePath && !verifyUploadClaim(storagePath, user.id, uploadClaim)) {
    return res.status(403).json({ error: 'This storagePath was not issued to you.' });
  }

  try {
    const payload = await analysisPayloadFor({ fileData, storagePath, fileSize: Number(fileSize) || undefined, fileType });
    const aiResult = payload
      ? await runAiOcrAndTagging(String(fileName), String(fileType || 'text/plain'), payload)
      : await runAiOcrAndTagging(String(fileName), 'application/octet-stream', '');
    const institution = await getInstitutionFor(user.institutionId);
    const finalCategory = coerceDocumentCategory(aiResult.documentType) || 'Other';
    const requestedDept = String(department || user.department || '').trim() || user.department;
    const finalDept = ['Admin', 'Manager'].includes(user.role) ? requestedDept : user.department;
    const filing = await previewAutoFolder(institution, finalDept, finalCategory, aiResult.activity);

    res.json({
      ...aiResult,
      documentType: finalCategory,
      department: finalDept,
      filedInto: filing.path,
      cabinetExists: filing.exists,
      missingCabinets: filing.missingCabinets
    });
  } catch (err: any) {
    console.error('Pre-upload document scan failed:', err);
    res.status(500).json({ error: 'Failed to scan document before upload.', details: err.message });
  }
}));

// Direct-to-storage upload handshake: mints a short-lived signed upload URL so
// file bytes go straight to Supabase Storage instead of through JSON bodies.
// Falls back to { enabled: false } (client then posts base64) without storage.
app.post('/api/uploads/sign', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { fileName, fileType, fileSize } = req.body || {};
  if (!fileName) return res.status(400).json({ error: 'fileName is required.' });
  const signValidation = validateUploadFile(fileName, fileType, fileSize);
  if (signValidation) return res.status(400).json({ error: signValidation });

  if (!storageEnabled || !supabase) return res.json({ enabled: false });

  const objectPath = `direct/${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}/${safeObjectName(String(fileName))}`;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUploadUrl(objectPath);
  if (error || !data) {
    console.error('[storage] signed upload url failed:', error?.message);
    return res.json({ enabled: false });
  }
  const uploadClaim = issueUploadClaim(objectPath, user.id);
  res.json({ enabled: true, objectPath, uploadUrl: data.signedUrl, token: data.token, uploadClaim });
}));

// Upload: accepts inline base64 (`fileData`, local-dev/small files) or a
// pre-uploaded storage object (`storagePath` from /api/uploads/sign).
app.post('/api/documents/upload', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === 'Viewer') {
    return res.status(403).json({ error: 'Viewers cannot upload documents.' });
  }
  const userId = user.id;
  const dept = user.department;

  const { title, description, folderId, documentType, fileName, fileSize, fileType, fileData, storagePath, uploadClaim, department, autoFile, categoryMode } = req.body;

  if (!title || !fileName || (!fileData && !storagePath)) {
    return res.status(400).json({ error: 'Title, file name, and file data (or storagePath) are required.' });
  }
  if (storagePath && !verifyUploadClaim(storagePath, user.id, uploadClaim)) {
    return res.status(403).json({ error: 'This storagePath was not issued to you, or has already been used.' });
  }
  const incomingBuffer = fileData
    ? storedFileToBuffer(String(fileData))
    : storagePath ? await downloadStoredFile(String(storagePath)) : null;
  if (!incomingBuffer) return res.status(400).json({ error: 'Uploaded file content could not be verified.' });
  const uploadValidation = validateUploadFile(fileName, fileType, fileSize, incomingBuffer);
  if (uploadValidation) {
    if (storagePath && storageEnabled && supabase) await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return res.status(400).json({ error: uploadValidation });
  }

  const manualCategory = coerceDocumentCategory(documentType);
  if (documentType !== undefined && documentType !== null && documentType !== '' && !manualCategory) {
    return res.status(400).json({ error: 'Invalid document category.' });
  }
  if (folderId !== undefined && folderId !== null && typeof folderId !== 'string') {
    return res.status(400).json({ error: 'Destination folder id must be a string.' });
  }

  const useAutoFile = autoFile !== false;

  try {
    const payload = await analysisPayloadFor({ fileData, storagePath, fileSize: Number(fileSize) || undefined, fileType });
    const aiResult = payload
      ? await runAiOcrAndTagging(fileName, fileType || 'text/plain', payload)
      : await runAiOcrAndTagging(fileName, 'application/octet-stream', '');

    const scannedCategory = coerceDocumentCategory(aiResult.documentType) || 'Other';
    const finalCategory: Document['documentType'] = categoryMode === 'manual' && manualCategory
      ? manualCategory
      : scannedCategory;
    const requestedDept = String(department || dept).trim() || dept;
    const finalDept = ['Admin', 'Manager'].includes(user.role) ? requestedDept : dept;
    const institution = await getInstitutionFor(user.institutionId);

    let destinationFolderId: string | null;
    let filedInto: string | null = null;
    if (useAutoFile) {
      const resolved = await resolveAutoFolder(userId, institution, finalDept, finalCategory, aiResult.activity);
      destinationFolderId = resolved.folderId;
      filedInto = resolved.path;
    } else {
      if (folderId) {
        const destination = await db().getFolder(folderId);
        if (!destination || destination.institutionId !== user.institutionId) {
          return res.status(400).json({ error: 'Destination folder is invalid.' });
        }
      }
      destinationFolderId = folderId || null;
    }

    const now = new Date().toISOString();
    const docId = newId('doc');
    const newDoc: Document = {
      id: docId,
      title,
      description: description || aiResult.description,
      ownerId: userId,
      ownerName: user.fullName,
      institutionId: user.institutionId!,
      department: finalDept,
      folderId: destinationFolderId,
      documentType: finalCategory,
      status: 'Draft',
      confidentialityLevel: 'Normal File',
      currentVersion: 'v1',
      isStarred: false,
      isArchived: false,
      isDeleted: false,
      tags: aiResult.tags,
      ocrText: aiResult.ocrText,
      createdAt: now,
      updatedAt: now
    };

    const verId = newId('ver');
    const newVersion: DocumentVersion = {
      id: verId,
      documentId: docId,
      fileName,
      fileSize: Number(fileSize) || (fileData ? Buffer.byteLength(fileData, 'base64') : 0) || 1024,
      fileType: fileType || 'txt',
      versionNumber: 'v1',
      uploadedBy: userId,
      uploadedByName: user.fullName,
      fileData: storagePath ? undefined : fileData,
      storagePath: storagePath || undefined,
      createdAt: now
    };

    await db().createDocument(newDoc);
    await db().createVersion(newVersion);
    if (!storagePath && fileData) {
      const offloaded = await offloadVersion(newVersion, fileData, fileType);
      if (offloaded) {
        newVersion.storagePath = offloaded;
        delete newVersion.fileData;
      }
    }

    const filingNote = filedInto ? ` Auto-filed into "${filedInto}".` : '';
    await logActivity(user, 'Upload', docId, title, `Uploaded first version "${fileName}" representing "${title}". AI-OCR detected type: ${newDoc.documentType}.${filingNote}`);

    res.status(201).json({ success: true, document: newDoc, version: newVersion, filedInto });
  } catch (err: any) {
    console.error('File upload logic failure:', err);
    res.status(500).json({ error: 'Failed to process document upload.', details: err.message });
  }
}));

// Upload a new version of an existing document.
app.post('/api/documents/:id/version', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { fileName, fileSize, fileType, fileData, storagePath, uploadClaim } = req.body;
  const docId = req.params.id;

  const doc = await db().getDocument(docId);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canEditDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have permission to add versions to this document.' });
  }
  if (!fileName || (!fileData && !storagePath)) {
    return res.status(400).json({ error: 'File name and data are required.' });
  }
  if (storagePath && !verifyUploadClaim(storagePath, user.id, uploadClaim)) {
    return res.status(403).json({ error: 'This storagePath was not issued to you, or has already been used.' });
  }
  const incomingBuffer = fileData
    ? storedFileToBuffer(String(fileData))
    : storagePath ? await downloadStoredFile(String(storagePath)) : null;
  if (!incomingBuffer) return res.status(400).json({ error: 'Uploaded file content could not be verified.' });
  const versionValidation = validateUploadFile(fileName, fileType, fileSize, incomingBuffer);
  if (versionValidation) {
    if (storagePath && storageEnabled && supabase) await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return res.status(400).json({ error: versionValidation });
  }

  try {
    const currentVerNum = parseInt(doc.currentVersion.replace('v', '')) || 1;
    const nextVerStr = `v${currentVerNum + 1}`;
    const now = new Date().toISOString();

    const newVersion: DocumentVersion = {
      id: newId('ver'),
      documentId: docId,
      fileName,
      fileSize: Number(fileSize) || (fileData ? Buffer.byteLength(fileData, 'base64') : 0),
      fileType: fileType || 'txt',
      versionNumber: nextVerStr,
      uploadedBy: user.id,
      uploadedByName: user.fullName,
      fileData: storagePath ? undefined : fileData,
      storagePath: storagePath || undefined,
      createdAt: now
    };

    const payload = await analysisPayloadFor({ fileData, storagePath, fileSize: Number(fileSize) || undefined, fileType });
    const aiResult = payload
      ? await runAiOcrAndTagging(fileName, fileType || 'text/plain', payload)
      : await runAiOcrAndTagging(fileName, 'application/octet-stream', '');

    const mergedTags = Array.from(new Set([...doc.tags, ...aiResult.tags]));
    await db().createVersion(newVersion);
    if (!storagePath && fileData) {
      const offloaded = await offloadVersion(newVersion, fileData, fileType);
      if (offloaded) {
        newVersion.storagePath = offloaded;
        delete newVersion.fileData;
      }
    }

    const updatedDoc = await db().updateDocument(docId, {
      currentVersion: nextVerStr,
      updatedAt: now,
      ocrText: aiResult.ocrText,
      tags: mergedTags
    });

    await logActivity(user, 'Upload Version', docId, doc.title, `Uploaded version ${nextVerStr} replacing former draft.`);
    res.json({ success: true, document: updatedDoc, version: newVersion });
  } catch (err: any) {
    res.status(500).json({ error: 'Version update failed.', details: err.message });
  }
}));

// Star / unstar
app.post('/api/documents/:id/star', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canViewDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }

  const starredIds = await db().listStarredDocumentIds(user.id);
  const nextStarred = !starredIds.includes(doc.id);
  await db().setDocumentStar(user.id, doc.id, nextStarred);
  const updated = { ...doc, isStarred: nextStarred };
  const actionName = nextStarred ? 'Star' : 'Unstar';
  await logActivity(user, actionName, doc.id, doc.title, `${actionName}red document.`);
  res.json({ success: true, document: updated });
}));

// Soft delete → Trash
app.post('/api/documents/:id/delete', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canEditDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have permission to delete this document.' });
  }

  const updated = await db().updateDocument(doc.id, { isDeleted: true });
  await logActivity(user, 'Delete', doc.id, doc.title, 'Soft-deleted the file and moved to Trash directory.');
  res.json({ success: true, document: updated });
}));

// Restore from Trash
app.post('/api/documents/:id/restore', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canEditDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have permission to restore this document.' });
  }

  const updated = await db().updateDocument(doc.id, { isDeleted: false });
  await logActivity(user, 'Restore', doc.id, doc.title, 'Restored file from trash folder back into original directory.');
  res.json({ success: true, document: updated });
}));

// Permanent delete
app.post('/api/documents/:id/permanently-delete', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canEditDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have permission to purge this document.' });
  }

  // Grab Storage object paths before the DB rows (and their storagePath
  // columns) disappear via FK cascade.
  const versions = await db().listVersions(doc.id);
  const storagePaths = versions.map(v => v.storagePath).filter((p): p is string => Boolean(p));
  const exclusivelyOwnedPaths: string[] = [];
  for (const storagePath of storagePaths) {
    if (await db().countVersionsWithStoragePath(storagePath) === 1) exclusivelyOwnedPaths.push(storagePath);
  }

  await db().deleteDocument(doc.id);

  // Best-effort: the document is already gone from the app's perspective
  // either way. A failure here just leaves an orphaned (harmless, invisible)
  // Storage object rather than blocking the purge.
  if (exclusivelyOwnedPaths.length > 0 && storageEnabled && supabase) {
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(exclusivelyOwnedPaths);
    if (error) console.error('[storage] cleanup failed for purged document', doc.id, error.message);
  }

  await logActivity(user, 'Purge Document', doc.id, doc.title, 'Permanently purged document binaries and all historic trace assets.');
  res.json({ success: true });
}));

// Archive toggle
app.post('/api/documents/:id/archive', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canEditDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have permission to archive this document.' });
  }

  const updated = await db().updateDocument(doc.id, { isArchived: !doc.isArchived, updatedAt: new Date().toISOString() });
  const detailsStr = updated?.isArchived ? 'Moved document and marked as official Archived file.' : 'Restored document from Archive database.';
  await logActivity(user, 'Archive', doc.id, doc.title, detailsStr);
  res.json({ success: true, document: updated });
}));

app.post('/api/documents/:id/classification', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!['Admin', 'Manager'].includes(user.role)) {
    return res.status(403).json({ error: 'Only an Admin or Manager may change document classification.' });
  }
  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (doc.institutionId !== user.institutionId) return res.status(403).json({ error: 'Cross-institution access denied.' });
  const level = req.body?.confidentialityLevel as Document['confidentialityLevel'];
  if (!['Normal File', 'Official Record', 'Confidential', 'Archive'].includes(level)) {
    return res.status(400).json({ error: 'Invalid document classification.' });
  }
  const updated = await db().updateDocument(doc.id, {
    confidentialityLevel: level,
    isArchived: level === 'Archive',
    updatedAt: new Date().toISOString()
  });
  if (level === 'Confidential') {
    const links = await db().listActiveLinksForDocument(doc.id);
    await Promise.all(links.map(link => db().updateLink(link.id, { isActive: false })));
  }
  await logActivity(user, 'Classify', doc.id, doc.title, `Changed classification from ${doc.confidentialityLevel} to ${level}.`);
  res.json({ success: true, document: updated });
}));

// Rename
app.post('/api/documents/:id/rename', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { title } = req.body;
  if (!title || String(title).trim() === '') {
    return res.status(400).json({ error: 'Title is required for rename.' });
  }

  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canEditDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have permission to rename this document.' });
  }

  const updated = await db().updateDocument(doc.id, { title, updatedAt: new Date().toISOString() });
  await logActivity(user, 'Rename', doc.id, title, `Renamed document from "${doc.title}" to "${title}".`);
  res.json({ success: true, document: updated });
}));

// Move
app.post('/api/documents/:id/move', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { folderId } = req.body;

  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canEditDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have permission to move this document.' });
  }

  const patch: Partial<Document> = { folderId: folderId || null, updatedAt: new Date().toISOString() };
  let folderName = 'Root Storage';
  if (folderId) {
    const f = await db().getFolder(folderId);
    if (f && f.institutionId === user.institutionId) {
      folderName = f.name;
      if (f.department) patch.department = f.department;
    } else {
      return res.status(400).json({ error: 'Destination folder is invalid.' });
    }
  }

  const updated = await db().updateDocument(doc.id, patch);
  await logActivity(user, 'Move', doc.id, doc.title, `Relocated document path registry contents to: "${folderName}"`);
  res.json({ success: true, document: updated });
}));

// Request approval
app.post('/api/documents/:id/request-approval', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { approverId, comment } = req.body;
  const docId = req.params.id;

  const doc = await db().getDocument(docId);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canEditDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have permission to submit this document for approval.' });
  }

  const approver = await db().getUser(approverId);
  if (!approver) return res.status(404).json({ error: 'Selected approver manager was not found.' });
  if (!approver.isActive || approver.institutionId !== user.institutionId || !['Manager', 'Admin'].includes(approver.role)) {
    return res.status(400).json({ error: 'Approver must be an active Manager or Admin in your institution.' });
  }
  const existingApprovals = await db().listApprovalsForDocument(docId);
  if (existingApprovals.some(approval => approval.status === 'Pending Approval')) {
    return res.status(409).json({ error: 'This document already has a pending approval request.' });
  }

  const now = new Date().toISOString();
  const updatedDoc = await db().updateDocument(docId, { status: 'Pending Approval', updatedAt: now });

  const appReq: ApprovalRequest = {
    id: newId('appr'),
    documentId: docId,
    requestedBy: user.id,
    requestedByName: user.fullName,
    approverId,
    approverName: approver.fullName,
    status: 'Pending Approval',
    requestComment: comment || 'Official document submitted for review approval.',
    approvalComment: '',
    createdAt: now,
    updatedAt: now
  };
  await db().createApproval(appReq);

  // Grant the approver access automatically.
  await db().upsertPermission({
    id: newId('perm'),
    documentId: docId,
    sharedWithUserId: approverId,
    permissionType: 'Approver',
    sharedById: user.id,
    createdAt: now
  });

  await logActivity(user, 'Approval Requested', docId, doc.title, `Requested official status review from Manager: ${approver.fullName}`);
  const mail = approvalRequestedEmail({
    approverName: approver.fullName, requesterName: user.fullName,
    documentTitle: doc.title, comment: comment || '', baseUrl: requestBaseUrl(req)
  });
  await sendEmail({ to: approver.email, ...mail });
  res.json({ success: true, document: updatedDoc, approval: appReq });
}));

// Decide approval
app.post('/api/approvals/:id/decide', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { status, comment } = req.body;

  const allowedStatuses = ['Approved', 'Changes Requested', 'Rejected'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid approval decision.' });
  }

  const approval = await db().getApproval(req.params.id);
  if (!approval) return res.status(404).json({ error: 'Approval request registry trace not found.' });
  if (approval.status !== 'Pending Approval') {
    return res.status(409).json({ error: 'This approval request has already been decided.' });
  }
  if (approval.approverId !== user.id && user.role !== 'Admin') {
    return res.status(403).json({ error: 'Only the assigned approver can decide this request.' });
  }

  const doc = await db().getDocument(approval.documentId);
  if (!doc) return res.status(404).json({ error: 'Target document was not found.' });

  const now = new Date().toISOString();
  const updatedApproval = await db().updateApproval(approval.id, {
    status,
    approvalComment: comment || `${status} feedback registered.`,
    updatedAt: now
  });

  const docPatch: Partial<Document> = { status, updatedAt: now };
  if (status === 'Approved') docPatch.confidentialityLevel = 'Official Record';
  const updatedDoc = await db().updateDocument(doc.id, docPatch);

  await db().createComment({
    id: newId('sys-c'),
    documentId: doc.id,
    userId: user.id,
    userName: user.fullName,
    userRole: user.role,
    text: `[Approval System Verdict: ${status}] Comment: ${comment || 'Resolved without details.'}`,
    createdAt: now
  });

  await logActivity(user, status, doc.id, doc.title, `Manager ${user.fullName} decided "${status}" for document. Statement: "${comment}"`);
  const requester = await db().getUser(approval.requestedBy);
  if (requester) {
    const mail = approvalDecidedEmail({
      requesterName: requester.fullName, deciderName: user.fullName,
      documentTitle: doc.title, decision: status, comment: comment || '', baseUrl: requestBaseUrl(req)
    });
    await sendEmail({ to: requester.email, ...mail });
  }
  res.json({ success: true, document: updatedDoc, approval: updatedApproval });
}));

// Share with another user
app.post('/api/documents/:id/share', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { targetUserId, permissionType } = req.body;
  const docId = req.params.id;

  const doc = await db().getDocument(docId);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canEditDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have permission to share this document.' });
  }

  const targetUser = await db().getUser(targetUserId);
  if (!targetUser) return res.status(404).json({ error: 'Target recipient not found.' });
  if (!targetUser.isActive || targetUser.institutionId !== user.institutionId) {
    return res.status(400).json({ error: 'Recipient must be active and belong to your institution.' });
  }
  if (!['Viewer', 'Commenter', 'Editor'].includes(permissionType)) {
    return res.status(400).json({ error: 'Invalid share permission.' });
  }

  await db().upsertPermission({
    id: newId('perm'),
    documentId: docId,
    sharedWithUserId: targetUserId,
    permissionType,
    sharedById: user.id,
    createdAt: new Date().toISOString()
  });

  await logActivity(user, 'Share', docId, doc.title, `Shared document access level: ${permissionType} configuration with recipient user ${targetUser.fullName}`);
  const mail = documentSharedEmail({
    recipientName: targetUser.fullName, sharerName: user.fullName,
    documentTitle: doc.title, permissionType, baseUrl: requestBaseUrl(req)
  });
  await sendShareEmail(targetUser.email, mail, {
    RECIPIENT_NAME: targetUser.fullName,
    SENDER_NAME: user.fullName,
    DOCUMENT_NAME: doc.title,
    DOCUMENT_META: `${permissionType} access`,
    PERSONAL_MESSAGE: `You've been granted ${permissionType.toLowerCase()} access to this document.`,
    SECURITY_NOTICE: 'Only your AVDP account can open this document.',
    EXPIRY_DATE: 'No expiry — access remains until revoked',
    DOCUMENT_URL: requestBaseUrl(req),
    CURRENT_YEAR: String(new Date().getFullYear())
  });
  res.json({ success: true });
}));

// Create external share link
app.post('/api/documents/:id/external-link', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const docId = req.params.id;

  const doc = await db().getDocument(docId);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canEditDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have permission to create a share link for this document.' });
  }
  if (doc.confidentialityLevel === 'Confidential' && user.role !== 'Admin') {
    return res.status(403).json({ error: 'Only an Admin may create an external link for a confidential document.' });
  }

  const { message, allowDownload, requiresPassword, password, maxDownloads, expiresInDays, permissionType, recipientEmails } = req.body || {};

  let expiresAt: string;
  const days = typeof expiresInDays === 'number' && expiresInDays > 0 ? Math.min(expiresInDays, 365) : 7;
  expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const perm: ExternalShareLink['permissionType'] = permissionType === 'Commenter' ? 'Commenter' : 'Viewer';
  const pwPlain = typeof password === 'string' && password.trim() ? password.trim() : undefined;
  if ((requiresPassword || doc.confidentialityLevel === 'Confidential') && !pwPlain) {
    return res.status(400).json({ error: 'A password is required for this secure link.' });
  }
  if (pwPlain && (pwPlain.length < 10 || pwPlain.length > 128)) {
    return res.status(400).json({ error: 'Share-link passwords must be 10 to 128 characters.' });
  }
  const normalizedMaxDownloads = maxDownloads == null ? null : Number(maxDownloads);
  if (normalizedMaxDownloads !== null && (!Number.isInteger(normalizedMaxDownloads) || normalizedMaxDownloads < 1 || normalizedMaxDownloads > 10_000)) {
    return res.status(400).json({ error: 'Maximum downloads must be an integer from 1 to 10,000.' });
  }
  const passwordHash = (requiresPassword || pwPlain) && pwPlain ? hashPassword(pwPlain) : undefined;

  const versions = await db().listVersions(docId);
  const latest = latestOf(versions);
  const token = `ext-${crypto.randomBytes(16).toString('hex')}`;

  const extLink: ExternalShareLink = {
    id: newId('ext-link'),
    documentId: docId,
    token,
    shortCode: await genShortCode(),
    createdBy: user.id,
    permissionType: perm,
    expiresAt,
    isActive: true,
    accessCount: 0,
    createdAt: new Date().toISOString(),
    fileName: latest?.fileName || doc.title,
    fileSize: latest?.fileSize || 0,
    fileType: latest?.fileType || 'unknown',
    downloadCount: 0,
    maxDownloads: normalizedMaxDownloads,
    message: message || undefined,
    allowDownload: allowDownload !== false,
    requiresPassword: Boolean(passwordHash),
    passwordHash
  };

  await db().createLink(extLink);
  await logActivity(user, 'Create Secure Link', docId, doc.title, `Generated a ${passwordHash ? 'password-protected ' : ''}share link (/s/${extLink.shortCode}).`);

  // Optional: email the link directly to one or more external addresses,
  // instead of only handing the sharer a link to copy/paste themselves.
  let emailsSent: string[] = [];
  const recipients: string[] = Array.isArray(recipientEmails)
    ? recipientEmails
    : typeof recipientEmails === 'string' ? recipientEmails.split(',') : [];
  const validRecipients = recipients
    .map(e => String(e).trim())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    .slice(0, 20);
  if (validRecipients.length > 0) {
    const linkUrl = `${requestBaseUrl(req)}/s/${extLink.shortCode}`;
    const mail = externalLinkSharedEmail({
      sharerName: user.fullName, documentTitle: doc.title, message: message || undefined,
      linkUrl, requiresPassword: Boolean(passwordHash), allowDownload: extLink.allowDownload, expiresAt
    });
    const expiryLabel = new Date(expiresAt).getFullYear() > 2900 ? 'Never' : new Date(expiresAt).toLocaleDateString();
    const variables = {
      RECIPIENT_NAME: 'there',
      SENDER_NAME: user.fullName,
      DOCUMENT_NAME: doc.title,
      DOCUMENT_META: `${extLink.allowDownload ? 'View & download' : 'View only'} access`,
      PERSONAL_MESSAGE: message || `${user.fullName} shared this document with you.`,
      SECURITY_NOTICE: passwordHash
        ? 'This link is password-protected — ask the sender for the password separately.'
        : 'Do not forward this link — it grants direct access to the document.',
      EXPIRY_DATE: expiryLabel,
      DOCUMENT_URL: linkUrl,
      CURRENT_YEAR: String(new Date().getFullYear())
    };
    for (const to of validRecipients) {
      if (await sendShareEmail(to, mail, variables)) emailsSent.push(to);
    }
    if (emailsSent.length > 0) {
      await logActivity(user, 'Email Secure Link', docId, doc.title, `Emailed the share link to ${emailsSent.join(', ')}.`);
    }
  }

  res.json({ success: true, link: publicLink(extLink), emailsSent });
}));

// Revoke external link
app.post('/api/external-link/:token/revoke', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const link = await db().getLinkByToken(req.params.token);
  if (!link) return res.status(404).json({ error: 'External token not found.' });

  const linkedDoc = await db().getDocument(link.documentId);
  const mayRevoke = link.createdBy === user.id || user.role === 'Admin' || (linkedDoc && await canEditDocument(user, linkedDoc));
  if (!mayRevoke) {
    return res.status(403).json({ error: 'You do not have permission to revoke this link.' });
  }

  await db().updateLink(link.id, { isActive: false });
  await logActivity(user, 'Revoke Link', link.documentId, linkedDoc?.title, 'Revoked static view capabilities of remote external link key token.');
  res.json({ success: true });
}));

// Comments
app.post('/api/comments', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { documentId, text } = req.body;

  if (!documentId || !text || String(text).trim() === '') {
    return res.status(400).json({ error: 'Document target reference and text content are required.' });
  }

  const doc = await db().getDocument(documentId);
  if (!doc) return res.status(404).json({ error: 'Target document was not found.' });
  if (!(await canEditDocument(user, doc))) {
    return res.status(403).json({ error: 'Editor access is required to make a persistent copy.' });
  }

  const newComment: Comment = {
    id: newId('c'),
    documentId,
    userId: user.id,
    userName: user.fullName,
    userRole: user.role,
    text,
    createdAt: new Date().toISOString()
  };
  await db().createComment(newComment);
  await logActivity(user, 'Comment', documentId, doc.title, `Added comment: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
  res.json(newComment);
}));

// Audit logs (Admin / Auditor)
app.get('/api/activity', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== 'Admin' && user.role !== 'Auditor') {
    return res.status(403).json({ error: 'Audit trail is restricted to Admin and Auditor roles.' });
  }
  res.json(await db().listLogs());
}));

// ----------------------------------------------------
// EXTERNAL BACKUP (e.g. iDrive e2 or any S3-compatible target)
// ----------------------------------------------------
app.get('/api/backup/status', h(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const [runs, configured] = await Promise.all([
    db().listBackupRuns(20),
    Promise.resolve(Boolean(backupTargetFromEnv(process.env)))
  ]);
  res.json({ configured, runs });
}));

app.post('/api/backup/run', h(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const target = backupTargetFromEnv(process.env);
  if (!target) {
    return res.status(400).json({
      error: 'Backup target is not configured. Set IDRIVE_ACCESS_KEY_ID, IDRIVE_SECRET_ACCESS_KEY, IDRIVE_ENDPOINT, and IDRIVE_BUCKET.'
    });
  }

  const run = await runBackup({
    db: db(),
    getVersionBytes: getVersionBytesForBackup,
    target,
    trigger: 'manual',
    triggeredByName: admin.fullName,
    newId
  });
  await logActivity(admin, 'Run Backup', undefined, undefined,
    run.status === 'success'
      ? `Backed up ${run.filesUploaded} file(s), ${(run.bytesUploaded / 1024 / 1024).toFixed(1)} MB.`
      : `Backup failed: ${run.error}`);

  res.status(run.status === 'success' ? 200 : 500).json(run);
}));

// Called by worker/index.ts's scheduled() handler (Cron Trigger). Not an
// HTTP route -- no request/response, just the shared backup logic.
export async function runScheduledBackup(): Promise<void> {
  await ensureRuntimeReady();
  const target = backupTargetFromEnv(process.env);
  if (!target) {
    console.log('[backup] scheduled run skipped -- IDRIVE_* env vars not configured.');
    return;
  }
  const run = await runBackup({
    db: db(),
    getVersionBytes: getVersionBytesForBackup,
    target,
    trigger: 'scheduled',
    newId
  });
  console.log(`[backup] scheduled run ${run.status}: ${run.filesUploaded} file(s), ${run.bytesUploaded} bytes.${run.error ? ` Error: ${run.error}` : ''}`);
}

// Node-only equivalent of the Cloudflare Cron Trigger (wrangler.toml
// [triggers]), which has nothing to hook into outside Workers. Railway (and
// any other plain-node host) keeps this process running continuously, so a
// simple interval works: check every 30 minutes, fire once during the
// 02:00-02:29 UTC window per day -- the same "0 2 * * *" schedule the
// Workers cron uses. Whether it already ran today is read from the database
// (not in-memory), so this is safe across process restarts: no double-fires,
// and a missed window just waits for the next day rather than piling up.
function startNightlyBackupScheduler() {
  const CHECK_INTERVAL_MS = 30 * 60 * 1000;
  setInterval(async () => {
    try {
      if (new Date().getUTCHours() !== 2) return;
      const last = await db().getLastSuccessfulBackupRun();
      const today = new Date().toISOString().slice(0, 10);
      if (last && last.startedAt.slice(0, 10) === today) return; // already ran today
      console.log('[backup] nightly scheduler firing.');
      await runScheduledBackup();
    } catch (err) {
      console.error('[backup] nightly scheduler tick failed:', err);
    }
  }, CHECK_INTERVAL_MS);
}

app.get('/api/documents/:id/activity', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!canAudit(user)) {
    return res.status(403).json({ error: 'File history is restricted to Managers, Admins, and Auditors.' });
  }
  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canViewDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }
  res.json(await db().listLogsForDocument(req.params.id));
}));

// Approvals assigned to me, pending decision
app.get('/api/approvals/mine', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const pending = await db().listPendingApprovalsForApprover(user.id);
  const results = [] as any[];
  for (const a of pending) {
    const doc = await db().getDocument(a.documentId);
    if (!doc || doc.isDeleted) continue;
    const versions = await db().listVersions(doc.id);
    const latest = latestOf(versions);
    results.push({
      ...a,
      documentTitle: doc.title,
      documentOwner: doc.ownerName,
      documentType: doc.documentType,
      documentDepartment: doc.department,
      fileName: latest?.fileName || '',
      fileType: latest?.fileType || ''
    });
  }
  res.json(results);
}));

// ----------------------------------------------------
// PUBLIC SHARE LINKS
// ----------------------------------------------------
app.get('/api/share/:token', h(async (req, res) => {
  const link = await db().getLinkByToken(req.params.token);
  if (!link) return res.status(404).json({ error: 'This share link is invalid.' });
  if (!link.isActive) return res.status(403).json({ error: 'This share link has been revoked.' });

  const expired = new Date(link.expiresAt).getTime() < Date.now();
  const exhausted = link.maxDownloads != null && (link.downloadCount || 0) >= link.maxDownloads;

  res.json({
    fileName: link.fileName,
    fileSize: link.fileSize,
    fileType: link.fileType,
    message: link.message,
    expiresAt: link.expiresAt,
    allowDownload: link.allowDownload,
    requiresPassword: link.requiresPassword,
    downloadCount: link.downloadCount || 0,
    maxDownloads: link.maxDownloads,
    accessCount: link.accessCount || 0,
    expired,
    exhausted
  });
}));

function passwordGateHtml(actionPath: string, wrong: boolean): string {
  const safeAction = actionPath.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Protected document</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#1e293b;padding:2rem;border-radius:16px;max-width:340px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,.4)}
h1{font-size:1.1rem;margin:0 0 .25rem}p{color:#94a3b8;font-size:.85rem;margin:0 0 1.25rem}
input{width:100%;box-sizing:border-box;padding:.65rem .8rem;border-radius:9px;border:1px solid #334155;background:#0f172a;color:#fff;font-size:.95rem}
button{width:100%;margin-top:.8rem;padding:.65rem;border:0;border-radius:9px;background:#6366f1;color:#fff;font-weight:600;font-size:.95rem;cursor:pointer}
.err{color:#fb7185;font-size:.8rem;margin-top:.6rem}</style></head>
  <body><form class="card" method="POST" action="${safeAction}">
<h1>🔒 This document is protected</h1><p>Enter the password to view it.</p>
<input type="password" name="pw" placeholder="Password" autofocus required>
<button type="submit">Unlock</button>
${wrong ? '<div class="err">Incorrect password. Try again.</div>' : ''}
</form></body></html>`;
}

async function serveSharedLink(req: express.Request, res: express.Response, link: ExternalShareLink | null) {
  if (!link) return res.status(404).send('This share link is invalid.');
  if (!link.isActive) return res.status(403).send('This share link has been revoked.');
  if (new Date(link.expiresAt).getTime() < Date.now()) {
    return res.status(410).send('This share link has expired.');
  }
  if (link.maxDownloads != null && (link.downloadCount || 0) >= link.maxDownloads) {
    return res.status(410).send('This share link has reached its download limit.');
  }

  if (link.requiresPassword && link.passwordHash) {
    const cookieName = `share_${sha256Hex(link.id).slice(0, 16)}`;
    const unlocked = verifySession(parseCookies(req)[cookieName] || '') === `share:${link.id}`;
    if (!unlocked) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(passwordGateHtml(`${req.path}/unlock`, req.query.error === '1'));
    }
  }

  const doc = await db().getDocument(link.documentId);
  if (!doc || doc.isDeleted) return res.status(404).send('The shared document is no longer available.');

  const consumedLink = await db().consumeExternalLink(link.id, link.allowDownload !== false);
  if (!consumedLink) return res.status(410).send('This share link is no longer available.');
  link = consumedLink;

  const creator = await db().getUser(link.createdBy);
  await logActivity(
    creator || { id: link.createdBy, fullName: 'External viewer', role: 'Viewer' },
    'External Access', doc.id, doc.title,
    `Document opened via share link (view #${link.accessCount}).`
  );

  const versions = await db().listVersions(doc.id);
  const latest = latestOf(versions);

  if (latest && latest.storagePath) {
    const url = await signedUrlFor(latest.storagePath, { download: link.allowDownload !== false ? latest.fileName : false });
    if (url) return res.redirect(302, url);
  }

  const full = latest ? await db().getVersion(latest.id) : null;
  if (!full || !full.fileData) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(doc.ocrText || 'No content available for this document.');
  }

  const buffer = storedFileToBuffer(full.fileData);
  res.setHeader('Content-Type', mimeForType(full.fileType));
  // View-only links (allowDownload === false) want inline rendering, but only
  // for types that are actually safe to render inline (see isPreviewableInline)
  // — an anonymous visitor to a view-only link must never get inline SVG/HTML,
  // which would execute same-origin with no auth required at all.
  const disposition = link.allowDownload === false && isPreviewableInline(full.fileType) ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeDownloadName(full.fileName)}"`);
  return res.send(buffer);
}

async function unlockSharedLink(req: express.Request, res: express.Response, link: ExternalShareLink | null) {
  if (!link || !link.isActive || !link.requiresPassword || !link.passwordHash) {
    return res.status(404).send('This protected share link is invalid.');
  }
  const rateKey = `share:${link.id}:${requestIp(req)}`;
  if (await rateLimited(rateKey, 10)) return res.status(429).send('Too many attempts. Try again later.');
  const provided = String(req.body?.pw || '');
  const valid = link.passwordHash.startsWith('pbkdf2$')
    ? verifyPassword(provided, link.passwordHash)
    : sha256Hex(provided) === link.passwordHash; // legacy links; replaced on next creation
  if (!valid) return res.redirect(303, `${req.path.replace(/\/unlock$/, '')}?error=1`);
  if (!link.passwordHash.startsWith('pbkdf2$')) {
    await db().updateLink(link.id, { passwordHash: hashPassword(provided) });
  }
  await clearRateLimit(rateKey);
  const cookieName = `share_${sha256Hex(link.id).slice(0, 16)}`;
  setSignedCookie(req, res, cookieName, `share:${link.id}`, 15 * 60 * 1000);
  return res.redirect(303, req.path.replace(/\/unlock$/, ''));
}

app.post('/api/external/:token/unlock', h(async (req, res) => {
  await unlockSharedLink(req, res, await db().getLinkByToken(req.params.token));
}));

app.post('/s/:code/unlock', h(async (req, res) => {
  await unlockSharedLink(req, res, await db().getLinkByCode(req.params.code));
}));

app.get('/api/external/:token', h(async (req, res) => {
  await serveSharedLink(req, res, await db().getLinkByToken(req.params.token));
}));

app.get('/s/:code', h(async (req, res) => {
  await serveSharedLink(req, res, await db().getLinkByCode(req.params.code));
}));

// ----------------------------------------------------
// DOWNLOADS & PREVIEW
// ----------------------------------------------------
async function resolveVersionContent(version: DocumentVersion): Promise<{ buffer: Buffer; mime: string } | null> {
  if (version.storagePath) return null; // handled with a signed URL
  const full = await db().getVersion(version.id);
  if (!full || !full.fileData) return null;
  return { buffer: storedFileToBuffer(full.fileData), mime: mimeForType(full.fileType) };
}

app.get('/api/documents/:id/download', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canViewDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }

  const versions = await db().listVersions(doc.id);
  const latest = latestOf(versions);
  await logActivity(user, 'Download', doc.id, doc.title, `Downloaded ${latest ? latest.versionNumber : 'document'}.`);

  if (latest && latest.storagePath) {
    const url = await signedUrlFor(latest.storagePath, { download: latest.fileName });
    if (url) return res.redirect(302, url);
  }
  const content = latest ? await resolveVersionContent(latest) : null;
  if (!content) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeDownloadName(doc.title)}.txt"`);
    return res.send(doc.ocrText || 'No content available for this document.');
  }
  res.setHeader('Content-Type', content.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${safeDownloadName(latest!.fileName)}"`);
  return res.send(content.buffer);
}));

// Inline preview of the latest version (image/PDF/text render in-browser).
app.get('/api/documents/:id/preview', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canViewDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }

  const versions = await db().listVersions(doc.id);
  const latest = latestOf(versions);
  if (!latest) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(doc.ocrText || 'No content available for this document.');
  }

  if (latest.storagePath) {
    const url = await signedUrlFor(latest.storagePath);
    if (url) return res.redirect(302, url);
  }
  const content = await resolveVersionContent(latest);
  if (!content) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(doc.ocrText || 'No content available for this document.');
  }
  const canInline = isPreviewableInline(latest.fileType);
  res.setHeader('Content-Type', canInline ? content.mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${canInline ? 'inline' : 'attachment'}; filename="${safeDownloadName(latest.fileName)}"`);
  return res.send(content.buffer);
}));

app.get('/api/documents/:id/versions/:versionId/download', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canViewDocument(user, doc))) {
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }
  const ver = await db().getVersion(req.params.versionId);
  if (!ver || ver.documentId !== doc.id) return res.status(404).json({ error: 'Version not found.' });

  if (ver.storagePath) {
    const url = await signedUrlFor(ver.storagePath, { download: ver.fileName });
    if (url) return res.redirect(302, url);
  }
  if (!ver.fileData) return res.status(404).send('No content available for this version.');

  const buffer = storedFileToBuffer(ver.fileData);
  res.setHeader('Content-Type', mimeForType(ver.fileType));
  res.setHeader('Content-Disposition', `attachment; filename="${safeDownloadName(ver.fileName)}"`);
  return res.send(buffer);
}));

// Copy (Google Drive style)
app.post('/api/documents/:id/copy', h(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const doc = await db().getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!(await canEditDocument(user, doc))) {
    return res.status(403).json({ error: 'You need editor access to copy this document.' });
  }

  const now = new Date().toISOString();
  const newDocId = newId('doc');
  const copy: Document = {
    ...doc,
    id: newDocId,
    title: `Copy of ${doc.title}`,
    ownerId: user.id,
    ownerName: user.fullName,
    status: 'Draft',
    confidentialityLevel: doc.confidentialityLevel === 'Confidential' ? 'Confidential' : 'Normal File',
    currentVersion: 'v1',
    isStarred: false,
    isArchived: false,
    isDeleted: false,
    createdAt: now,
    updatedAt: now
  };
  const versions = await db().listVersions(doc.id);
  const latest = latestOf(versions);
  let copiedStoragePath: string | undefined;
  try {
    let copiedVersion: DocumentVersion | null = null;
    if (latest) {
      const full = await db().getVersion(latest.id);
      const versionId = newId('ver');
      if (latest.storagePath) {
        copiedStoragePath = await copyStoredVersionFile(latest.storagePath, newDocId, versionId, latest.fileName);
      }
      copiedVersion = {
        ...(full || latest),
        id: versionId,
        documentId: newDocId,
        versionNumber: 'v1',
        uploadedBy: user.id,
        uploadedByName: user.fullName,
        storagePath: copiedStoragePath,
        fileData: copiedStoragePath ? undefined : full?.fileData,
        createdAt: now
      };
    }
    await db().createDocument(copy);
    if (copiedVersion) await db().createVersion(copiedVersion);
  } catch (err) {
    await db().deleteDocument(newDocId).catch(() => undefined);
    if (copiedStoragePath && storageEnabled && supabase) {
      await supabase.storage.from(STORAGE_BUCKET).remove([copiedStoragePath]);
    }
    throw err;
  }

  await logActivity(user, 'Copy', newDocId, copy.title, `Made a copy of "${doc.title}".`);
  res.status(201).json({ success: true, document: copy });
}));

// ----------------------------------------------------
// STARTUP
// ----------------------------------------------------
// Load the datastore (and kick off storage init). On Workers this must run
// inside a request context — module scope there can't perform async I/O and
// doesn't see process.env yet — so worker/index.ts awaits ensureRuntimeReady()
// per request; on node it runs once from startServer().
async function initRuntime() {
  store = createStoreFromEnv();
  try {
    await withTimeout(store.init(), 15000, 'Datastore init');
  } catch (err) {
    console.error('[startup] Datastore init failed:', (err as Error).message);
    if (store.kind === 'supabase' && process.env.NODE_ENV !== 'production') {
      console.error('[startup] FALLING BACK to a non-durable in-memory store. Apply supabase/migrations and redeploy!');
      storageEnabled = false;
      store = new MemoryStore(isWorkersRuntime ? null : path.join(resolveDataDir(), 'db.json'));
      await store.init();
    } else {
      throw err;
    }
  }

  // Ensure the seed admin can actually log in: give it the configured (or
  // default) initial password if it has none yet.
  try {
    const admin = (await db().listUsers()).find(u => u.role === 'Admin' && !u.passwordHash);
    if (admin) {
      if (process.env.NODE_ENV === 'production' && !process.env.INITIAL_ADMIN_PASSWORD) {
        throw new Error('INITIAL_ADMIN_PASSWORD is required for a fresh production database.');
      }
      const initial = process.env.INITIAL_ADMIN_PASSWORD || 'ChangeMe!2026';
      await db().updateUser(admin.id, { passwordHash: hashPassword(initial), mustChangePassword: true });
      console.log(`[startup] Set initial password for admin ${admin.email}${process.env.INITIAL_ADMIN_PASSWORD ? ' (from INITIAL_ADMIN_PASSWORD)' : ` — default "ChangeMe!2026", must be changed on first login`}.`);
    }
  } catch (err) {
    console.error('[startup] Admin password bootstrap failed:', (err as Error).message);
    if (process.env.NODE_ENV === 'production') throw err;
  }

  // Prepare object storage and migrate any inline file bytes in the
  // background, so the first request isn't blocked by (potentially large)
  // uploads.
  if (storageEnabled) {
    withTimeout(ensureBucket(), 10000, 'Supabase storage setup')
      .then(() => withTimeout(migrateFilesToStorage(), 10000, 'Supabase storage migration'))
      .catch(err => console.error('[storage] background init failed:', err.message || err));
  }
}

let initPromise: Promise<void> | null = null;
export function ensureRuntimeReady(): Promise<void> {
  if (!initPromise) {
    initPromise = initRuntime().catch((err) => {
      console.error('[startup] Runtime init failed:', err);
      // Allow a later request to retry instead of wedging on a transient error.
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export { app };

// Initialize Vite (dev) or static serving (production) and start listening.
// node-only: on Workers, listen() happens at module scope below and static
// assets come from the ASSETS binding.
async function startServer() {
  await ensureRuntimeReady();
  startNightlyBackupScheduler();

  if (process.env.NODE_ENV !== 'production') {
    // Vite is a dev-only dependency for the API server; load it lazily so a
    // production bundle never requires it at startup.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files from compiled dist folder in production
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // SPA fallback: serve index.html for any non-API GET (Express 4 compatible).
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(distPath, 'index.html'), { root: '/' }, (err) => {
        if (err) next(err);
      });
    });
  }

  app.listen(PORT, () => {
    console.log(`AVDP Document Management System Full-Stack Engine booting on port: ${PORT}`);
  });
}

// Surface fatal errors in the deploy logs, then exit so the platform restarts a
// clean process. After an uncaughtException / unhandledRejection the process is
// in an undefined state; staying alive (only logging) leaves a wedged server
// that boots fine but stops answering requests. Fail fast and let Railway's
// auto-restart bring up a healthy container instead.
let shuttingDown = false;
function fatal(label: string, err: unknown) {
  console.error(`[fatal] ${label}:`, err);
  if (shuttingDown) return;
  shuttingDown = true;
  // Give stderr a tick to flush before exiting.
  setTimeout(() => process.exit(1), 100);
}
// `process.on` is unavailable in some runtimes (e.g. Cloudflare Workers
// nodejs_compat); skip the fatal handlers there so module init doesn't throw.
if (typeof process !== 'undefined' && typeof process.on === 'function' && !isWorkersRuntime) {
  process.on('uncaughtException', (err) => fatal('uncaughtException', err));
  process.on('unhandledRejection', (reason) => fatal('unhandledRejection', reason));
}

// Spark up. On Cloudflare Workers the HTTP server MUST be created and listen()
// in the global scope — that's cloudflare:node's documented httpServerHandler
// pattern, and it keeps the server object out of any single request's I/O
// context. listen() itself is legal at global scope (it only registers the
// port; no async I/O). Data loading stays deferred to the first request via
// ensureRuntimeReady(), where env vars and fetch() are available.
// DOCUHUB_NO_LISTEN=1 lets the test suite import the app without binding.
if (isWorkersRuntime) {
  app.listen(PORT, () => {
    console.log(`AVDP Document Management System Full-Stack Engine booting on port: ${PORT} (Workers)`);
  });
} else if (process.env.DOCUHUB_NO_LISTEN !== '1') {
  startServer().catch((err) => {
    console.error('[fatal] Failed to start server:', err);
    // On node, exit so the platform restarts a clean process.
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      process.exit(1);
    }
  });
}
