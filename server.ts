/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
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

dotenv.config();

const app = express();
// Railway (and most PaaS) inject the port to bind via the PORT env var.
const PORT = Number(process.env.PORT) || 3000;

// Body parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// DB File Path. DATA_DIR lets the JSON datastore live on a mounted persistent
// volume in production (e.g. a Railway volume at /data) so it survives deploys.
// We resolve a writable directory at startup: try DATA_DIR (or ./data), and if
// it can't be created/written (e.g. the volume isn't mounted yet), fall back to
// a temp dir so the server still boots instead of crash-looping with a 502.
function resolveDataDir(): string {
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
  // Last resort: current working directory (always writable in the container).
  return process.cwd();
}

const DB_DIR = resolveDataDir();
const DB_FILE = path.join(DB_DIR, 'db.json');

// ----------------------------------------------------
// Persistence backend selection
// ----------------------------------------------------
// Durable persistence is backed by Supabase when SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY are configured (the production path on Railway,
// which has no persistent disk). The whole datastore is kept as a single JSONB
// row, mirroring the previous single-file JSON model, so all in-memory logic is
// unchanged. When the env vars are absent (e.g. local dev), we fall back to the
// JSON file on disk so the app still runs with zero extra setup.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const STATE_TABLE = 'docuhub_state';
const STATE_ID = 'docuhub';
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

let supabase: SupabaseClient | null = null;
if (useSupabase) {
  supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  console.log('[startup] Persistence backend: Supabase (durable)');
} else {
  console.log(`[startup] Persistence backend: local file at ${DB_FILE}`);
}

// Serialize Supabase writes through a single promise chain so concurrent
// mutations persist in order (last write wins, consistently).
let writeChain: Promise<void> = Promise.resolve();

// Initial Mock Data
const DEFAULT_INSTITUTION_ID = 'inst-smartdocs';

const DEFAULT_USERS: User[] = [
  { id: 'admin-1', fullName: 'Sarah Jenkins', email: 'sarah.j@smartsdocs.org', role: 'Admin', department: 'IT', isActive: true, institutionId: DEFAULT_INSTITUTION_ID },
  { id: 'manager-1', fullName: 'David Vance', email: 'david.v@smartsdocs.org', role: 'Manager', department: 'Finance', isActive: true, institutionId: DEFAULT_INSTITUTION_ID },
  { id: 'staff-1', fullName: 'Mohamed Bangura', email: 'mohamedamadubangura@gmail.com', role: 'Staff', department: 'Procurement', isActive: true, institutionId: DEFAULT_INSTITUTION_ID },
  { id: 'viewer-1', fullName: 'Alice Cooper', email: 'alice.c@smartsdocs.org', role: 'Viewer', department: 'Marketing', isActive: true, institutionId: DEFAULT_INSTITUTION_ID },
  { id: 'auditor-1', fullName: 'Robert Sterling', email: 'robert.s@smartsdocs.org', role: 'Auditor', department: 'Compliance', isActive: true, institutionId: DEFAULT_INSTITUTION_ID }
];

const DEFAULT_INSTITUTIONS: Institution[] = [
  {
    id: DEFAULT_INSTITUTION_ID,
    name: 'SmartDocs Organization',
    units: ['Procurement', 'Finance', 'Administration', 'IT', 'Management', 'Compliance', 'Marketing'],
    categoryFolders: {
      Contract: 'Contracts',
      Invoice: 'Invoices',
      Memo: 'Memos & Correspondence',
      Report: 'Reports',
      Support: 'Support & Technical',
      Other: 'General Documents'
    },
    activityDimension: 'none'
  }
];

const DEFAULT_FOLDERS: Folder[] = [
  // Predefined department structures
  { id: 'proc-root', name: 'Procurement', parentFolderId: null, ownerId: 'admin-1', department: 'Procurement', createdAt: new Date().toISOString() },
  { id: 'proc-bids', name: 'Bid Documents', parentFolderId: 'proc-root', ownerId: 'admin-1', department: 'Procurement', createdAt: new Date().toISOString() },
  { id: 'proc-contracts', name: 'Contracts', parentFolderId: 'proc-root', ownerId: 'staff-1', department: 'Procurement', createdAt: new Date().toISOString() },
  
  { id: 'fin-root', name: 'Finance', parentFolderId: null, ownerId: 'admin-1', department: 'Finance', createdAt: new Date().toISOString() },
  { id: 'fin-invoices', name: 'Invoices', parentFolderId: 'fin-root', ownerId: 'manager-1', department: 'Finance', createdAt: new Date().toISOString() },
  { id: 'fin-vouchers', name: 'Payment Vouchers', parentFolderId: 'fin-root', ownerId: 'manager-1', department: 'Finance', createdAt: new Date().toISOString() },
  
  { id: 'admin-root', name: 'Administration', parentFolderId: null, ownerId: 'admin-1', department: 'Administration', createdAt: new Date().toISOString() },
  { id: 'it-root', name: 'IT Configs', parentFolderId: null, ownerId: 'admin-1', department: 'IT', createdAt: new Date().toISOString() },
  { id: 'mgmt-root', name: 'Management Papers', parentFolderId: null, ownerId: 'manager-1', department: 'Management', createdAt: new Date().toISOString() }
];

// Let's seed preloaded sample files
const DEFAULT_DOCUMENTS: Document[] = [
  {
    id: 'doc-1',
    title: 'Supplier Supply Chain Agreement 2026',
    description: 'Annual procurement agreement template for tier-1 supply vendors.',
    ownerId: 'staff-1',
    ownerName: 'Mohamed Bangura',
    department: 'Procurement',
    folderId: 'proc-contracts',
    documentType: 'Contract',
    status: 'Approved',
    confidentialityLevel: 'Official Record',
    currentVersion: 'v2',
    isStarred: true,
    isArchived: false,
    isDeleted: false,
    tags: ['contract', 'procurement', 'vendor', 'approved'],
    ocrText: 'This SUPPLY CHAIN AGREEMENT is entered into on this 1st day of January 2026. PARTIES: DocuHub logistics and Tier-1 vendors. DELIVERABLES: Weekly fulfillment auditing, dynamic routing optimization, SLA 99.5% accuracy. TERMS: Net 30 days.',
    createdAt: '2026-05-15T10:00:00Z',
    updatedAt: '2026-05-20T14:30:00Z'
  },
  {
    id: 'doc-2',
    title: 'Q1 System Audit Report',
    description: 'Initial performance log of storage systems and local database backups.',
    ownerId: 'admin-1',
    ownerName: 'Sarah Jenkins',
    department: 'IT',
    folderId: 'it-root',
    documentType: 'Report',
    status: 'Pending Approval',
    confidentialityLevel: 'Normal File',
    currentVersion: 'v1',
    isStarred: false,
    isArchived: false,
    isDeleted: false,
    tags: ['it', 'report', 'backup', 'audit'],
    ocrText: 'SYSTEM AUDIT REPORT:\n- Backup storage node: ONLINE\n- Disk utility: 42% utilized\n- SSL Certs updated for all load balance units.\n- Recommendation: Setup multi-disk raid configurations.',
    createdAt: '2026-05-25T09:12:00Z',
    updatedAt: '2026-05-25T09:12:00Z'
  },
  {
    id: 'doc-3',
    title: 'Acme Invoice AI-12903',
    description: 'Hardware provisioning order for local engineering staff.',
    ownerId: 'manager-1',
    ownerName: 'David Vance',
    department: 'Finance',
    folderId: 'fin-invoices',
    documentType: 'Invoice',
    status: 'Approved',
    confidentialityLevel: 'Official Record',
    currentVersion: 'v1',
    isStarred: false,
    isArchived: false,
    isDeleted: false,
    tags: ['invoice', 'finance', 'hardware', 'approved-2026'],
    ocrText: 'INVOICE: #AI-12903\nDATE: April 12, 2026\nAcme Hardware Supplies LLC\nTO: SmartDocs organization Finance Unit.\n- 5x Enterprise Workstations - $7,500.00\n- 3x IPS Developer Monitors - $1,200.00\nTOTAL: $8,700.00\nPAID on May 1st 2026.',
    createdAt: '2026-04-15T11:00:00Z',
    updatedAt: '2026-05-01T16:00:00Z'
  }
];

const DEFAULT_VERSIONS: DocumentVersion[] = [
  {
    id: 'ver-1a',
    documentId: 'doc-1',
    fileName: 'supplier_agreement_v1.txt',
    fileSize: 4500,
    fileType: 'txt',
    versionNumber: 'v1',
    uploadedBy: 'staff-1',
    uploadedByName: 'Mohamed Bangura',
    fileData: 'This SUPPLY CHAIN AGREEMENT is entered into on this 1st day of January 2026.',
    createdAt: '2026-05-15T10:00:00Z'
  },
  {
    id: 'ver-1b',
    documentId: 'doc-1',
    fileName: 'supplier_agreement_final.txt',
    fileSize: 5200,
    fileType: 'txt',
    versionNumber: 'v2',
    uploadedBy: 'staff-1',
    uploadedByName: 'Mohamed Bangura',
    fileData: 'This SUPPLY CHAIN AGREEMENT is entered into on this 1st day of January 2026. PARTIES: DocuHub logistics and Tier-1 vendors. DELIVERABLES: Weekly fulfillment auditing, dynamic routing optimization, SLA 99.5% accuracy. TERMS: Net 30 days.',
    createdAt: '2026-05-20T14:30:00Z'
  },
  {
    id: 'ver-2',
    documentId: 'doc-2',
    fileName: 'system_backups_log.txt',
    fileSize: 2100,
    fileType: 'txt',
    versionNumber: 'v1',
    uploadedBy: 'admin-1',
    uploadedByName: 'Sarah Jenkins',
    fileData: 'SYSTEM AUDIT REPORT:\n- Backup storage node: ONLINE\n- Disk utility: 42% utilized\n- SSL Certs updated for all load balance units.\n- Recommendation: Setup multi-disk raid configurations.',
    createdAt: '2026-05-25T09:12:00Z'
  },
  {
    id: 'ver-3',
    documentId: 'doc-3',
    fileName: 'invoice_AI_12903.txt',
    fileSize: 3100,
    fileType: 'txt',
    versionNumber: 'v1',
    uploadedBy: 'manager-1',
    uploadedByName: 'David Vance',
    fileData: 'INVOICE: #AI-12903\nDATE: April 12, 2026\nAcme Hardware Supplies LLC\nTO: SmartDocs organization Finance Unit.\n- 5x Enterprise Workstations - $7,500.00\n- 3x IPS Developer Monitors - $1,200.00\nTOTAL: $8,700.00\nPAID on May 1st 2026.',
    createdAt: '2026-04-15T11:00:00Z'
  }
];

const DEFAULT_LOGS: ActivityLog[] = [
  { id: 'log-1', userId: 'staff-1', userName: 'Mohamed Bangura', userRole: 'Staff', action: 'Upload', documentId: 'doc-1', documentTitle: 'Supplier Supply Chain Agreement 2026', details: 'Uploaded v1 version of document into Contracts folder.', createdAt: '2026-05-15T10:00:05Z' },
  { id: 'log-2', userId: 'staff-1', userName: 'Mohamed Bangura', userRole: 'Staff', action: 'Upload', documentId: 'doc-1', documentTitle: 'Supplier Supply Chain Agreement 2026', details: 'Uploaded revised v2 of document with SLA constraints.', createdAt: '2026-05-20T14:30:05Z' },
  { id: 'log-3', userId: 'manager-1', userName: 'David Vance', userRole: 'Manager', action: 'Approve', documentId: 'doc-1', documentTitle: 'Supplier Supply Chain Agreement 2026', details: 'Approved agreement and finalized document status to Approved.', createdAt: '2026-05-20T14:35:00Z' }
];

const DEFAULT_COMMENTS: Comment[] = [
  { id: 'c-1', documentId: 'doc-1', userId: 'manager-1', userName: 'David Vance', userRole: 'Manager', text: 'This version looks fully complete. Standard SLA metrics are noted.', createdAt: '2026-05-20T14:34:30Z' }
];

const DEFAULT_APPROVALS: ApprovalRequest[] = [];
const DEFAULT_PERMISSIONS: SharePermission[] = [];
const DEFAULT_EXTERNAL_LINKS: ExternalShareLink[] = [];

// Load Database Store
let db = {
  users: DEFAULT_USERS,
  folders: DEFAULT_FOLDERS,
  documents: DEFAULT_DOCUMENTS,
  versions: DEFAULT_VERSIONS,
  logs: DEFAULT_LOGS,
  comments: DEFAULT_COMMENTS,
  approvals: DEFAULT_APPROVALS,
  permissions: DEFAULT_PERMISSIONS,
  externalLinks: DEFAULT_EXTERNAL_LINKS,
  institutions: DEFAULT_INSTITUTIONS as Institution[]
};

function readDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db = { ...db, ...parsed };
    }
  } catch (err) {
    console.error('Error reading db file, falling back to in-memory seed.', err);
  }
  migrateDb();
}

// Backfill data persisted before newer fields existed (e.g. a Railway volume or
// local data dir from an earlier version), so upgrades stay functional.
function migrateDb() {
  let changed = false;
  // Ensure at least one institution exists.
  if (!Array.isArray(db.institutions) || db.institutions.length === 0) {
    db.institutions = DEFAULT_INSTITUTIONS;
    changed = true;
  }
  const fallbackInstitutionId = db.institutions[0].id;
  // Legacy users may predate institutionId; assign them to the default.
  for (const user of db.users) {
    if (!user.institutionId) {
      user.institutionId = fallbackInstitutionId;
      changed = true;
    }
  }
  if (changed) writeDb();
}

function writeDb() {
  if (useSupabase && supabase) {
    // Snapshot synchronously so the persisted blob reflects this exact moment,
    // even if db mutates again before the queued async upsert runs.
    const snapshot = JSON.parse(JSON.stringify(db));
    writeChain = writeChain
      .then(async () => {
        const { error } = await supabase!
          .from(STATE_TABLE)
          .upsert({ id: STATE_ID, data: snapshot, updated_at: new Date().toISOString() });
        if (error) console.error('[supabase] Failed to persist state:', error.message);
      })
      .catch(err => console.error('[supabase] Persist chain error:', err));
    return;
  }
  try {
    // Write to a temp file then atomically rename so a crash mid-write cannot
    // leave a truncated/corrupt db.json behind.
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error('Error saving database.', err);
  }
}

// Load the datastore at startup. Supabase (durable) when configured, otherwise
// the local JSON file. Returns once the in-memory db reflects persisted state.
async function initStore(): Promise<void> {
  if (useSupabase && supabase) {
    try {
      const { data, error } = await supabase
        .from(STATE_TABLE)
        .select('data')
        .eq('id', STATE_ID)
        .maybeSingle();
      if (error) throw error;
      if (data && data.data) {
        db = { ...db, ...(data.data as typeof db) };
        console.log('[startup] Loaded persisted state from Supabase.');
      } else {
        console.log('[startup] No existing Supabase state found; seeding initial data.');
      }
    } catch (err) {
      console.error('[startup] Failed to load state from Supabase; using in-memory seed.', (err as Error).message);
    }
    migrateDb();
    // Guarantee a row exists on first boot (and persist any migration backfill).
    writeDb();
  } else {
    readDb();
  }
}

// ----------------------------------------------------
// Session-based identity (replaces spoofable x-user-* headers)
// ----------------------------------------------------
// A profile switch mints a server-side session id stored in an HttpOnly
// cookie. Identity is resolved from the session, so a client can no longer
// impersonate another user/role by setting request headers.
const sessions: Record<string, string> = {}; // sessionId -> userId

function genToken(prefix = 's'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

// Short, human-shareable code for /s/<code> links. Retries on the (unlikely)
// chance of a collision so codes stay unique.
function genShortCode(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 7; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return db.externalLinks.some(l => l.shortCode === code) ? genShortCode() : code;
}

// Strip the server-only password from a share link before returning it to a
// client, exposing only whether a password is set.
function publicLink(l: ExternalShareLink) {
  const { password, passwordHash, ...rest } = l;
  return { ...rest, hasPassword: Boolean(passwordHash || password) };
}

function parseCookies(req: express.Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx > -1) {
      acc[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
    return acc;
  }, {} as Record<string, string>);
}

function getUser(req: express.Request): User | null {
  const sid = parseCookies(req)['sid'];
  if (sid && sessions[sid]) {
    return db.users.find(u => u.id === sessions[sid]) || null;
  }
  return null;
}

// ----------------------------------------------------
// Authorization helpers
// ----------------------------------------------------
function canViewDocument(user: Pick<User, 'id' | 'role' | 'department'>, doc: Document): boolean {
  // Admin/Manager/Auditor have organization-wide visibility.
  if (user.role === 'Admin' || user.role === 'Manager' || user.role === 'Auditor') return true;
  if (doc.ownerId === user.id) return true;
  const shared = db.permissions.some(p => p.documentId === doc.id && p.sharedWithUserId === user.id);
  if (user.role === 'Staff') return shared || doc.department === user.department;
  if (user.role === 'Viewer') return shared || (doc.department === user.department && doc.status === 'Approved');
  return false;
}

function canEditDocument(user: Pick<User, 'id' | 'role'>, doc: Document): boolean {
  if (user.role === 'Admin' || user.role === 'Manager') return true;
  if (doc.ownerId === user.id) return true;
  return db.permissions.some(
    p => p.documentId === doc.id && p.sharedWithUserId === user.id && p.permissionType === 'Editor'
  );
}

// Map a stored fileType to a sensible MIME type for downloads / inline serving.
function mimeForType(fileType?: string): string {
  const t = (fileType || '').toLowerCase();
  if (t.includes('png')) return 'image/png';
  if (t.includes('jpg') || t.includes('jpeg')) return 'image/jpeg';
  if (t.includes('gif')) return 'image/gif';
  if (t.includes('pdf')) return 'application/pdf';
  return 'text/plain';
}

// ----------------------------------------------------
// Institution profiles & automatic document filing
// ----------------------------------------------------
// Each institution has its own profile (units + category folder names + an
// optional activity dimension). The system uses the uploader's institution
// profile to auto-build a folder taxonomy and file each document under
//   <Unit / Department>  →  <Category>  [→ <Activity>]
// creating any missing folders on demand (and reusing existing ones).

// Fallback profile used if a user has no institution or it can't be found.
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

function getInstitution(institutionId?: string): Institution {
  return db.institutions.find(i => i.id === institutionId) || db.institutions[0] || FALLBACK_INSTITUTION;
}

function categoryFolderName(inst: Institution, category: Document['documentType']): string {
  return inst.categoryFolders[category] || inst.categoryFolders.Other || category;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

// Find-or-create a folder by name under a given parent (within a department
// scope). Reuses an existing match so we don't duplicate the seed taxonomy.
function ensureFolder(
  name: string,
  parentFolderId: string | null,
  department: string | undefined,
  ownerId: string
): Folder {
  const existing = db.folders.find(
    f =>
      f.parentFolderId === parentFolderId &&
      f.name.toLowerCase() === name.toLowerCase() &&
      (department ? (f.department || undefined) === department : true)
  );
  if (existing) return existing;

  const folder: Folder = {
    id: `auto-${slugify(name)}-${slugify(parentFolderId || 'root')}-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    name,
    parentFolderId,
    ownerId,
    department,
    createdAt: new Date().toISOString()
  };
  db.folders.push(folder);
  return folder;
}

// Normalize an AI-extracted activity label into a tidy folder name.
function normalizeActivity(activity?: string): string {
  const cleaned = (activity || '').replace(/[^a-zA-Z0-9 &/-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'General Activity';
  // Title-case, capped to a few words so folder names stay sensible.
  return cleaned
    .split(' ')
    .slice(0, 4)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Resolve (creating as needed) the destination folder for a document based on
// the institution profile. Returns the folder id plus a human-readable path
// for logging / UI feedback.
function resolveAutoFolder(
  ownerId: string,
  inst: Institution,
  department: string | undefined,
  category: Document['documentType'],
  activity?: string
): { folderId: string; path: string } {
  const unitName = department && department.trim() ? department.trim() : 'Unassigned Unit';
  const unitFolder = ensureFolder(unitName, null, department, ownerId);

  const categoryName = categoryFolderName(inst, category);
  const categoryFolder = ensureFolder(categoryName, unitFolder.id, department, ownerId);

  // Optional third level: an AI-extracted activity/project label.
  if (inst.activityDimension === 'ai-activity') {
    const activityName = normalizeActivity(activity);
    const activityFolder = ensureFolder(activityName, categoryFolder.id, department, ownerId);
    return { folderId: activityFolder.id, path: `${unitName} / ${categoryName} / ${activityName}` };
  }

  return { folderId: categoryFolder.id, path: `${unitName} / ${categoryName}` };
}

// Heuristic: stored file payloads are base64 for uploads but raw text for the
// seed data. Decide which so we can serve real bytes either way.
function looksLikeBase64(s: string): boolean {
  const compact = s.replace(/\s/g, '');
  return compact.length > 0 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

function storedFileToBuffer(fileData: string): Buffer {
  return looksLikeBase64(fileData) ? Buffer.from(fileData, 'base64') : Buffer.from(fileData, 'utf8');
}

// Best-effort decode of a base64 payload back to readable text. The client
// base64-encodes everything before upload, so text documents arrive encoded;
// analysing them requires decoding first. Returns the original string if it
// does not round-trip cleanly as base64.
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

// Lazy Gemini API Client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY environment variable is missing. Multimodal OCR & Tags will use premium local heuristics simulation.');
      return null;
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return aiClient;
}

// Helper to log audit details
function addAuditLog(userId: string, action: string, docId?: string, docTitle?: string, details = '') {
  const user = db.users.find(u => u.id === userId) || { fullName: 'Unknown', role: 'Viewer' as const };
  const newLog: ActivityLog = {
    id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    userId,
    userName: user.fullName,
    userRole: user.role,
    action,
    documentId: docId,
    documentTitle: docTitle,
    details,
    createdAt: new Date().toISOString()
  };
  db.logs.unshift(newLog);
  writeDb();
}

/**
 * AI-OCR and Automated Tagging Engine via Gemini 3.5-flash
 */
async function runAiOcrAndTagging(fileName: string, mimeType: string, fileDataB64OrText: string) {
  const ai = getGeminiClient();
  const lowerName = fileName.toLowerCase();
  const isImage = mimeType.startsWith('image/');
  // Text files arrive base64-encoded from the client; decode before analysing.
  const decodedText = isImage ? '' : decodeMaybeBase64(fileDataB64OrText);

  if (ai) {
    try {
      console.log(`Running smart Gemini OCR & Automated Tagging for: ${fileName}`);

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
              text: `You are an integrated AI engine inside an enterprise Document Management System (DocuHub). 
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
        // Plain text file analysis
        contents = {
          parts: [
            {
              text: `You are an integrated AI engine inside DocuHub. This file is titled "${fileName}".
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
        console.log('Gemini Analysis successfully completed:', result);
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

  // Local heuristic indexer and tagging engine (used when no API key is set
  // or the API call fails). Operates on decoded text, not the raw base64.
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

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// Users List
app.get('/api/users', (req, res) => {
  res.json(db.users);
});

// Switch the active demo profile. This mints a server-side session and sets
// an HttpOnly cookie; all subsequent identity is resolved from that session.
app.post('/api/users/switch-profile', (req, res) => {
  const { userId } = req.body;
  const user = db.users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User does not exist.' });
  }

  const sid = genToken('sess');
  sessions[sid] = user.id;
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`);

  // Audit switched
  addAuditLog(userId, 'Login', undefined, undefined, `User switched profile to ${user.fullName} (${user.role}).`);
  res.json({ success: true, user });
});

// Return the currently authenticated profile (or null) for session bootstrap.
app.get('/api/session', (req, res) => {
  const user = getUser(req);
  res.json({ user: user || null });
});

// Lightweight health check for the platform's uptime probe.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// The current user's institution profile. Drives the auto-file taxonomy and
// the destination preview in the upload modal.
app.get('/api/institution', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  res.json(getInstitution(user.institutionId));
});

// List institutions. Admins see all; everyone else sees just their own.
app.get('/api/institutions', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  if (user.role === 'Admin') return res.json(db.institutions);
  res.json(db.institutions.filter(i => i.id === user.institutionId));
});

// Update the current user's institution profile (Admin only). Validates the
// category map covers every document category so filing can't break.
const DOCUMENT_CATEGORIES: Document['documentType'][] = ['Contract', 'Invoice', 'Memo', 'Report', 'Support', 'Other'];

app.put('/api/institution', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  if (user.role !== 'Admin') {
    return res.status(403).json({ error: 'Only an Admin can edit the institution profile.' });
  }

  // Fall back to the first institution if the user's id is missing/stale, so a
  // legacy (pre-migration) admin can still edit a real, persisted profile.
  const inst = db.institutions.find(i => i.id === user.institutionId) || db.institutions[0];
  if (!inst) return res.status(404).json({ error: 'Institution not found.' });

  const { name, units, categoryFolders, activityDimension } = req.body || {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Institution name must be a non-empty string.' });
    }
    inst.name = name.trim();
  }

  if (units !== undefined) {
    if (!Array.isArray(units) || units.some(u => typeof u !== 'string')) {
      return res.status(400).json({ error: 'Units must be an array of strings.' });
    }
    inst.units = units.map(u => u.trim()).filter(Boolean);
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
    inst.categoryFolders = merged;
  }

  if (activityDimension !== undefined) {
    if (activityDimension !== 'none' && activityDimension !== 'ai-activity') {
      return res.status(400).json({ error: "activityDimension must be 'none' or 'ai-activity'." });
    }
    inst.activityDimension = activityDimension as ActivityDimension;
  }

  writeDb();
  addAuditLog(user.id, 'Update Institution', undefined, inst.name, `Updated institution profile "${inst.name}" (activity dimension: ${inst.activityDimension}).`);
  res.json(inst);
});

// Get Database Info & Stats
app.get('/api/stats', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated. Please select a profile.' });
  const userId = user.id;

  // Counts are scoped to the documents this user is allowed to see.
  const visibleDocs = db.documents.filter(d => !d.isDeleted && canViewDocument(user, d));

  const approved = visibleDocs.filter(d => d.status === 'Approved').length;
  
  // Storage size sum
  const fileIds = visibleDocs.map(d => d.id);
  const sizeSum = db.versions
    .filter(v => fileIds.includes(v.documentId))
    .reduce((sum, v) => sum + v.fileSize, 0);

  // Approvals awaiting
  const awaitingCount = db.approvals.filter(a => a.approverId === userId && a.status === 'Pending Approval').length;

  const dashboardStats: DashboardStats = {
    totalFiles: visibleDocs.length,
    totalSize: sizeSum,
    approvedCount: approved,
    pendingMyApprovalCount: awaitingCount,
    totalUsers: db.users.filter(u => u.isActive).length,
    recentUploadsCount: visibleDocs.filter(d => {
      const docDate = new Date(d.createdAt).getTime();
      const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      return docDate > weekAgo;
    }).length
  };

  res.json(dashboardStats);
});

// Folders List
app.get('/api/folders', (req, res) => {
  res.json(db.folders);
});

// Create Folder
app.post('/api/folders', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const { name, parentFolderId, department } = req.body;
  
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Folder name is required.' });
  }

  const newFolder: Folder = {
    id: `folder-${Date.now()}`,
    name,
    parentFolderId: parentFolderId || null,
    ownerId: userId,
    department: department || undefined,
    createdAt: new Date().toISOString()
  };

  db.folders.push(newFolder);
  writeDb();
  
  addAuditLog(userId, 'Create Folder', undefined, name, `Created a folder: "${name}"`);
  res.status(201).json(newFolder);
});

// Documents search and lists
app.get('/api/documents', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated. Please select a profile.' });
  const userId = user.id;

  const { folderId, status, category, query, starred, filterType } = req.query;

  // Base visibility is enforced centrally via canViewDocument so the list
  // matches the per-document access rules.
  let docs = db.documents.filter(d => canViewDocument(user, d));

  // Filter out Trash vs Standard Active docs
  if (filterType === 'trash') {
    docs = docs.filter(d => d.isDeleted);
  } else {
    docs = docs.filter(d => !d.isDeleted);

    if (filterType === 'archive') {
      docs = docs.filter(d => d.isArchived);
    } else if (filterType === 'shared') {
      // "Shared with me": documents explicitly shared with the user by someone else.
      docs = docs.filter(d =>
        !d.isArchived &&
        db.permissions.some(p => p.documentId === d.id && p.sharedWithUserId === userId && p.sharedById !== userId)
      );
    } else {
      docs = docs.filter(d => !d.isArchived);
    }
  }

  // Filter: Folder
  if (folderId !== undefined) {
    if (folderId === 'root' || folderId === null || folderId === '') {
      docs = docs.filter(d => d.folderId === null);
    } else {
      docs = docs.filter(d => d.folderId === folderId);
    }
  }

  // Filter: Status
  if (status) {
    docs = docs.filter(d => d.status === status);
  }

  // Filter: Starred
  if (starred === 'true') {
    docs = docs.filter(d => d.isStarred);
  }

  // Filter: Document Category
  if (category) {
    docs = docs.filter(d => d.documentType === category);
  }

  // Unified Search (Query) across title, description, content, tags, ocrText
  if (query) {
    const q = (query as string).toLowerCase().trim();
    docs = docs.filter(d => 
      d.title.toLowerCase().includes(q) ||
      d.description.toLowerCase().includes(q) ||
      (d.ocrText && d.ocrText.toLowerCase().includes(q)) ||
      d.tags.some(t => t.toLowerCase().includes(q)) ||
      d.ownerName.toLowerCase().includes(q) ||
      (d.department && d.department.toLowerCase().includes(q))
    );
  }

  res.json(docs);
});

// Single Document Detail
app.get('/api/documents/:id', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });

  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  if (!canViewDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }

  // Fetch version history
  const versions = db.versions
    .filter(v => v.documentId === doc.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Fetch comments
  const comments = db.comments
    .filter(c => c.documentId === doc.id)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Fetch approvals
  const approvals = db.approvals
    .filter(a => a.documentId === doc.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Fetch permissions
  const permissions = db.permissions.filter(p => p.documentId === doc.id);

  // External Share Links
  const links = db.externalLinks.filter(l => l.documentId === doc.id && l.isActive);

  res.json({
    document: doc,
    versions,
    comments,
    approvals,
    permissions,
    externalLinks: links.map(publicLink)
  });
});

// Upload File (with OCR & Tagging base64 payload)
app.post('/api/documents/upload', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated. Please select a profile.' });
  const userId = user.id;
  const dept = user.department;

  const { title, description, folderId, documentType, fileName, fileSize, fileType, fileData, department, autoFile } = req.body;

  if (!title || !fileName || !fileData) {
    return res.status(400).json({ error: 'Title, file name, and file data stream are required.' });
  }

  // Auto-filing is on by default: the system routes the document into its
  // Unit/Category folder. Pass autoFile === false to use an explicit folderId.
  const useAutoFile = autoFile !== false;

  try {
    // 1. Run OCR and tags extraction
    const aiResult = await runAiOcrAndTagging(
      fileName,
      fileType || 'text/plain',
      fileData
    );

    // Resolve final classification, then route into a folder accordingly,
    // using the uploader's institution profile to drive the taxonomy.
    const finalCategory: Document['documentType'] = (documentType as any) || aiResult.documentType || 'Other';
    const finalDept = department || dept;
    const institution = getInstitution(user.institutionId);

    let destinationFolderId: string | null;
    let filedInto: string | null = null;
    if (useAutoFile) {
      const resolved = resolveAutoFolder(userId, institution, finalDept, finalCategory, aiResult.activity);
      destinationFolderId = resolved.folderId;
      filedInto = resolved.path;
    } else {
      destinationFolderId = folderId || null;
    }

    // 2. Insert Document
    const docId = `doc-${Date.now()}`;
    const newDoc: Document = {
      id: docId,
      title,
      description: description || aiResult.description,
      ownerId: userId,
      ownerName: user.fullName,
      department: finalDept,
      folderId: destinationFolderId,
      documentType: finalCategory,
      status: 'Draft', // initial state is draft
      confidentialityLevel: 'Normal File',
      currentVersion: 'v1',
      isStarred: false,
      isArchived: false,
      isDeleted: false,
      tags: aiResult.tags,
      ocrText: aiResult.ocrText,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 3. Insert Version
    const verId = `ver-${Date.now()}`;
    const newVersion: DocumentVersion = {
      id: verId,
      documentId: docId,
      fileName,
      fileSize: fileSize || Buffer.byteLength(fileData, 'base64') || 1024,
      fileType: fileType || 'txt',
      versionNumber: 'v1',
      uploadedBy: userId,
      uploadedByName: user.fullName,
      fileData, // base64 payload stored in the JSON datastore
      createdAt: new Date().toISOString()
    };

    db.documents.push(newDoc);
    db.versions.push(newVersion);
    writeDb();

    const filingNote = filedInto
      ? ` Auto-filed into "${filedInto}".`
      : '';
    addAuditLog(userId, 'Upload', docId, title, `Uploaded first version "${fileName}" representing "${title}". AI-OCR detected type: ${newDoc.documentType}.${filingNote}`);

    res.status(201).json({
      success: true,
      document: newDoc,
      version: newVersion,
      filedInto
    });

  } catch (err: any) {
    console.error('File upload logic failure:', err);
    res.status(500).json({ error: 'Failed to process document upload.', details: err.message });
  }
});

// Upload New Version of Existing File
app.post('/api/documents/:id/version', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const { fileName, fileSize, fileType, fileData } = req.body;
  const docId = req.params.id;

  const doc = db.documents.find(d => d.id === docId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  if (!canEditDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have permission to add versions to this document.' });
  }

  if (!fileName || !fileData) {
    return res.status(400).json({ error: 'File name and data are required.' });
  }

  try {
    // Read numeric part of current version (e.g. "v2" -> 2)
    const currentVerNum = parseInt(doc.currentVersion.replace('v', '')) || 1;
    const nextVerStr = `v${currentVerNum + 1}`;

    const newVersion: DocumentVersion = {
      id: `ver-${Date.now()}`,
      documentId: docId,
      fileName,
      fileSize: fileSize || Buffer.byteLength(fileData, 'base64'),
      fileType: fileType || 'txt',
      versionNumber: nextVerStr,
      uploadedBy: userId,
      uploadedByName: user.fullName,
      fileData,
      createdAt: new Date().toISOString()
    };

    // Re-run processing to update indexing/tags of document based on new version
    const aiResult = await runAiOcrAndTagging(fileName, fileType || 'text/plain', fileData);

    doc.currentVersion = nextVerStr;
    doc.updatedAt = new Date().toISOString();
    doc.ocrText = aiResult.ocrText;
    
    // Merge new active tags
    const mergedTags = Array.from(new Set([...doc.tags, ...aiResult.tags]));
    doc.tags = mergedTags;

    db.versions.push(newVersion);
    writeDb();

    addAuditLog(userId, 'Upload Version', docId, doc.title, `Uploaded version ${nextVerStr} replacing former draft.`);

    res.json({ success: true, document: doc, version: newVersion });
  } catch (err: any) {
    res.status(500).json({ error: 'Version update failed.', details: err.message });
  }
});

// Star/Unstar a Document
app.post('/api/documents/:id/star', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  if (!canViewDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }

  doc.isStarred = !doc.isStarred;
  writeDb();

  const actionName = doc.isStarred ? 'Star' : 'Unstar';
  addAuditLog(userId, actionName, doc.id, doc.title, `${actionName}red document.`);
  res.json({ success: true, document: doc });
});

// Move Document to Trash (Soft Delete)
app.post('/api/documents/:id/delete', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  if (!canEditDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have permission to delete this document.' });
  }

  doc.isDeleted = true;
  writeDb();

  addAuditLog(userId, 'Delete', doc.id, doc.title, 'Soft-deleted the file and moved to Trash directory.');
  res.json({ success: true, document: doc });
});

// Restore from Trash
app.post('/api/documents/:id/restore', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  if (!canEditDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have permission to restore this document.' });
  }

  doc.isDeleted = false;
  writeDb();

  addAuditLog(userId, 'Restore', doc.id, doc.title, 'Restored file from trash folder back into original directory.');
  res.json({ success: true, document: doc });
});

// Permanently Delete Document
app.post('/api/documents/:id/permanently-delete', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const index = db.documents.findIndex(d => d.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  if (!canEditDocument(user, db.documents[index])) {
    return res.status(403).json({ error: 'You do not have permission to purge this document.' });
  }

  const title = db.documents[index].title;
  
  // Splice from collections
  db.documents.splice(index, 1);
  db.versions = db.versions.filter(v => v.documentId !== req.params.id);
  db.approvals = db.approvals.filter(a => a.documentId !== req.params.id);
  db.comments = db.comments.filter(c => c.documentId !== req.params.id);
  db.permissions = db.permissions.filter(p => p.documentId !== req.params.id);
  
  writeDb();

  addAuditLog(userId, 'Purge Document', req.params.id, title, 'Permanently purged document binaries and all historic trace assets.');
  res.json({ success: true });
});

// Archive Document
app.post('/api/documents/:id/archive', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  if (!canEditDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have permission to archive this document.' });
  }

  // Archive state is tracked independently of confidentiality classification
  // so that e.g. an "Official Record" keeps its classification after archiving.
  doc.isArchived = !doc.isArchived;
  doc.updatedAt = new Date().toISOString();
  writeDb();

  const detailsStr = doc.isArchived ? 'Moved document and marked as official Archived file.' : 'Restored document from Archive database.';
  addAuditLog(userId, 'Archive', doc.id, doc.title, detailsStr);
  res.json({ success: true, document: doc });
});

// Rename Document
app.post('/api/documents/:id/rename', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const { title } = req.body;
  
  if (!title || title.trim() === '') {
    return res.status(400).json({ error: 'Title is required for rename.' });
  }

  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  if (!canEditDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have permission to rename this document.' });
  }

  const oldTitle = doc.title;
  doc.title = title;
  doc.updatedAt = new Date().toISOString();
  writeDb();

  addAuditLog(userId, 'Rename', doc.id, doc.title, `Renamed document from "${oldTitle}" to "${title}".`);
  res.json({ success: true, document: doc });
});

// Move Document folder location
app.post('/api/documents/:id/move', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const { folderId } = req.body;

  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  if (!canEditDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have permission to move this document.' });
  }

  doc.folderId = folderId || null;
  doc.updatedAt = new Date().toISOString();
  
  // Inherit department from folder if any
  if (folderId) {
    const f = db.folders.find(fold => fold.id === folderId);
    if (f && f.department) {
      doc.department = f.department;
    }
  }
  
  writeDb();

  const folderName = folderId ? (db.folders.find(f => f.id === folderId)?.name || folderId) : 'Root Storage';
  addAuditLog(userId, 'Move', doc.id, doc.title, `Relocated document path registry contents to: "${folderName}"`);
  res.json({ success: true, document: doc });
});

// Request Approval
app.post('/api/documents/:id/request-approval', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const { approverId, comment } = req.body;
  const docId = req.params.id;

  const doc = db.documents.find(d => d.id === docId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  if (!canEditDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have permission to submit this document for approval.' });
  }

  const requester = user;
  const approver = db.users.find(u => u.id === approverId);

  if (!approver) {
    return res.status(404).json({ error: 'Selected approver manager was not found.' });
  }

  doc.status = 'Pending Approval';
  doc.updatedAt = new Date().toISOString();

  const appReq: ApprovalRequest = {
    id: `appr-${Date.now()}`,
    documentId: docId,
    requestedBy: userId,
    requestedByName: requester.fullName,
    approverId,
    approverName: approver.fullName,
    status: 'Pending Approval',
    requestComment: comment || 'Official document submitted for review approval.',
    approvalComment: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.approvals.push(appReq);
  
  // Automatically grant permissions to the approver (Approver permission level)
  const masterPermission: SharePermission = {
    id: `perm-${Date.now()}`,
    documentId: docId,
    sharedWithUserId: approverId,
    permissionType: 'Approver',
    sharedById: userId,
    createdAt: new Date().toISOString()
  };
  db.permissions.push(masterPermission);
  
  writeDb();

  addAuditLog(userId, 'Approval Requested', docId, doc.title, `Requested official status review from Manager: ${approver.fullName}`);
  res.json({ success: true, document: doc, approval: appReq });
});

// Process Approval Trigger
app.post('/api/approvals/:id/decide', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const { status, comment } = req.body; // status: 'Approved' | 'Changes Requested' | 'Rejected'

  const allowedStatuses = ['Approved', 'Changes Requested', 'Rejected'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid approval decision.' });
  }

  const approval = db.approvals.find(a => a.id === req.params.id);
  if (!approval) {
    return res.status(404).json({ error: 'Approval request registry trace not found.' });
  }

  // Only the assigned approver (or an Admin) may decide the request.
  if (approval.approverId !== userId && user.role !== 'Admin') {
    return res.status(403).json({ error: 'Only the assigned approver can decide this request.' });
  }

  const doc = db.documents.find(d => d.id === approval.documentId);
  if (!doc) {
    return res.status(404).json({ error: 'Target document was not found.' });
  }

  approval.status = status;
  approval.approvalComment = comment || `${status} feedback registered.`;
  approval.updatedAt = new Date().toISOString();

  // Cascade status to original document
  doc.status = status;
  if (status === 'Approved') {
    doc.confidentialityLevel = 'Official Record'; // marked as locked official backup
  }
  doc.updatedAt = new Date().toISOString();

  // Add inline comment reflecting approval choice
  const systemComment: Comment = {
    id: `sys-c-${Date.now()}`,
    documentId: doc.id,
    userId,
    userName: user.fullName,
    userRole: user.role,
    text: `[Approval System Verdict: ${status}] Comment: ${comment || 'Resolved without details.'}`,
    createdAt: new Date().toISOString()
  };
  db.comments.push(systemComment);

  writeDb();

  addAuditLog(userId, status, doc.id, doc.title, `Manager ${user.fullName} decided "${status}" for document. Statement: "${comment}"`);
  res.json({ success: true, document: doc, approval });
});

// Share Document with other users/roles
app.post('/api/documents/:id/share', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const { targetUserId, permissionType } = req.body;
  const docId = req.params.id;

  const doc = db.documents.find(d => d.id === docId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  if (!canEditDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have permission to share this document.' });
  }

  const targetUser = db.users.find(u => u.id === targetUserId);
  if (!targetUser) {
    return res.status(404).json({ error: 'Target recipient not found.' });
  }

  // Check if permission already exists
  const existing = db.permissions.find(p => p.documentId === docId && p.sharedWithUserId === targetUserId);
  if (existing) {
    existing.permissionType = permissionType;
    existing.createdAt = new Date().toISOString();
  } else {
    const newPerm: SharePermission = {
      id: `perm-${Date.now()}`,
      documentId: docId,
      sharedWithUserId: targetUserId,
      permissionType,
      sharedById: userId,
      createdAt: new Date().toISOString()
    };
    db.permissions.push(newPerm);
  }

  writeDb();

  addAuditLog(userId, 'Share', docId, doc.title, `Shared document access level: ${permissionType} configuration with recipient user ${targetUser.fullName}`);
  res.json({ success: true });
});

// Create External Secure sharing link
app.post('/api/documents/:id/external-link', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const docId = req.params.id;

  const doc = db.documents.find(d => d.id === docId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  if (!canEditDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have permission to create a share link for this document.' });
  }

  // Link options: WeTransfer-style metadata (optional message, download limit,
  // password) combined with Dropbox-style expiry and view/comment permission.
  const { message, allowDownload, requiresPassword, password, maxDownloads, expiresInDays, permissionType } = req.body || {};

  // expiresInDays: positive number of days, or null for a non-expiring link.
  let expiresAt: string;
  if (expiresInDays === null) {
    expiresAt = new Date('2999-12-31T00:00:00Z').toISOString();
  } else {
    const days = typeof expiresInDays === 'number' && expiresInDays > 0 ? Math.min(expiresInDays, 365) : 7;
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const perm: ExternalShareLink['permissionType'] = permissionType === 'Commenter' ? 'Commenter' : 'Viewer';
  const pwPlain = typeof password === 'string' && password.trim() ? password.trim() : undefined;
  const passwordHash = (requiresPassword || pwPlain) && pwPlain
    ? crypto.createHash('sha256').update(pwPlain).digest('hex')
    : undefined;

  // File metadata from the latest version (powers the share landing page).
  const latest = db.versions
    .filter(v => v.documentId === docId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const token = `ext-${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;

  const extLink: ExternalShareLink = {
    id: `ext-link-${Date.now()}`,
    documentId: docId,
    token,
    shortCode: genShortCode(),
    createdBy: userId,
    permissionType: perm,
    expiresAt,
    isActive: true,
    accessCount: 0,
    createdAt: new Date().toISOString(),
    fileName: latest?.fileName || doc.title,
    fileSize: latest?.fileSize || 0,
    fileType: latest?.fileType || 'unknown',
    downloadCount: 0,
    maxDownloads: maxDownloads ?? null,
    message: message || undefined,
    allowDownload: allowDownload !== false,
    requiresPassword: Boolean(passwordHash),
    passwordHash,
  };

  db.externalLinks.push(extLink);
  writeDb();

  addAuditLog(userId, 'Create Secure Link', docId, doc.title, `Generated a ${passwordHash ? 'password-protected ' : ''}share link (/s/${extLink.shortCode}).`);
  res.json({ success: true, link: publicLink(extLink) });
});

// Revoke external sharing link
app.post('/api/external-link/:token/revoke', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const link = db.externalLinks.find(l => l.token === req.params.token);
  if (!link) {
    return res.status(404).json({ error: 'External token not found.' });
  }

  const linkedDoc = db.documents.find(d => d.id === link.documentId);
  const mayRevoke = link.createdBy === userId || user.role === 'Admin' || (linkedDoc && canEditDocument(user, linkedDoc));
  if (!mayRevoke) {
    return res.status(403).json({ error: 'You do not have permission to revoke this link.' });
  }

  link.isActive = false;
  writeDb();

  const doc = db.documents.find(d => d.id === link.documentId);
  addAuditLog(userId, 'Revoke Link', link.documentId, doc?.title, `Revoked static view capabilities of remote external link key token.`);
  res.json({ success: true });
});

// Add inline Comment
app.post('/api/comments', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const userId = user.id;
  const { documentId, text } = req.body;

  if (!documentId || !text || text.trim() === '') {
    return res.status(400).json({ error: 'Document target reference and text content are required.' });
  }

  const doc = db.documents.find(d => d.id === documentId);
  if (!doc) {
    return res.status(404).json({ error: 'Target document was not found.' });
  }
  if (!canViewDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }

  const newComment: Comment = {
    id: `c-${Date.now()}`,
    documentId,
    userId,
    userName: user.fullName,
    userRole: user.role,
    text,
    createdAt: new Date().toISOString()
  };

  db.comments.push(newComment);
  writeDb();

  addAuditLog(userId, 'Comment', documentId, doc.title, `Added comment: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
  res.json(newComment);
});

// Get Audit Logs (Admin / Auditor scopes only)
app.get('/api/activity', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  if (user.role !== 'Admin' && user.role !== 'Auditor') {
    return res.status(403).json({ error: 'Audit trail is restricted to Admin and Auditor roles.' });
  }
  res.json(db.logs);
});

// Fetch active document logs (must be able to view the document)
app.get('/api/documents/:id/activity', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!canViewDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }
  const fileLogs = db.logs.filter(l => l.documentId === req.params.id);
  res.json(fileLogs);
});

// Approvals assigned to the current user that are awaiting a decision.
app.get('/api/approvals/mine', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const mine = db.approvals
    .filter(a => a.approverId === user.id && a.status === 'Pending Approval')
    .map(a => {
      const doc = db.documents.find(d => d.id === a.documentId && !d.isDeleted);
      if (!doc) return null;
      return {
        ...a,
        documentTitle: doc.title,
        documentOwner: doc.ownerName,
        documentType: doc.documentType,
        documentDepartment: doc.department
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(mine);
});

// Public JSON endpoint: file info for a WeTransfer-style share link landing page.
// Returns metadata without serving the actual file content. No auth required.
app.get('/api/share/:token', (req, res) => {
  const link = db.externalLinks.find(l => l.token === req.params.token);
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
    exhausted,
  });
});

// Public access to a document via a secure external share link token.
// Validates active state and expiry, increments the access counter, and
// serves the latest version inline.
// Minimal password gate served when a protected link is opened without (or with
// a wrong) password. Submits the password back as a ?pw= query on the same path.
function passwordGateHtml(actionPath: string, wrong: boolean): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Protected document</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#1e293b;padding:2rem;border-radius:16px;max-width:340px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,.4)}
h1{font-size:1.1rem;margin:0 0 .25rem}p{color:#94a3b8;font-size:.85rem;margin:0 0 1.25rem}
input{width:100%;box-sizing:border-box;padding:.65rem .8rem;border-radius:9px;border:1px solid #334155;background:#0f172a;color:#fff;font-size:.95rem}
button{width:100%;margin-top:.8rem;padding:.65rem;border:0;border-radius:9px;background:#6366f1;color:#fff;font-weight:600;font-size:.95rem;cursor:pointer}
.err{color:#fb7185;font-size:.8rem;margin-top:.6rem}</style></head>
<body><form class="card" method="GET" action="${actionPath}">
<h1>🔒 This document is protected</h1><p>Enter the password to view it.</p>
<input type="password" name="pw" placeholder="Password" autofocus required>
<button type="submit">Unlock</button>
${wrong ? '<div class="err">Incorrect password. Try again.</div>' : ''}
</form></body></html>`;
}

// Validate a share link (active, not expired, password) and stream the latest
// version inline. Shared by the long token route and the short /s/<code> route.
function serveSharedLink(req: express.Request, res: express.Response, link?: ExternalShareLink) {
  if (!link) return res.status(404).send('This share link is invalid.');
  if (!link.isActive) return res.status(403).send('This share link has been revoked.');
  if (new Date(link.expiresAt).getTime() < Date.now()) {
    return res.status(410).send('This share link has expired.');
  }
  if (link.maxDownloads != null && (link.downloadCount || 0) >= link.maxDownloads) {
    return res.status(410).send('This share link has reached its download limit.');
  }

  // Password gate: accepts ?pw= (from the HTML unlock form) or ?password= (API
  // style), checked against the stored sha256 hash. Serves a friendly page.
  if (link.requiresPassword && link.passwordHash) {
    const provided = (typeof req.query.pw === 'string' && req.query.pw)
      || (typeof req.query.password === 'string' ? req.query.password : '');
    const ok = !!provided && crypto.createHash('sha256').update(provided).digest('hex') === link.passwordHash;
    if (!ok) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(provided ? 401 : 200).send(passwordGateHtml(req.path, Boolean(provided)));
    }
  }

  const doc = db.documents.find(d => d.id === link.documentId && !d.isDeleted);
  if (!doc) return res.status(404).send('The shared document is no longer available.');

  link.accessCount = (link.accessCount || 0) + 1;
  if (link.allowDownload !== false) {
    link.downloadCount = (link.downloadCount || 0) + 1;
  }
  writeDb();
  addAuditLog(link.createdBy, 'External Access', doc.id, doc.title, `Document opened via share link (view #${link.accessCount}).`);

  const latest = db.versions
    .filter(v => v.documentId === doc.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  if (!latest || !latest.fileData) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(doc.ocrText || 'No content available for this document.');
  }

  const buffer = storedFileToBuffer(latest.fileData);
  res.setHeader('Content-Type', mimeForType(latest.fileType));
  const disposition = link.allowDownload !== false ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disposition}; filename="${latest.fileName}"`);
  return res.send(buffer);
}

app.get('/api/external/:token', (req, res) => {
  serveSharedLink(req, res, db.externalLinks.find(l => l.token === req.params.token));
});

// Short shareable link. Registered as a normal route (before the SPA fallback,
// which is added later in startServer), so /s/<code> resolves to a document.
app.get('/s/:code', (req, res) => {
  serveSharedLink(req, res, db.externalLinks.find(l => l.shortCode === req.params.code));
});

// Download the latest version of a document as an attachment (authenticated).
app.get('/api/documents/:id/download', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!canViewDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }

  const latest = db.versions
    .filter(v => v.documentId === doc.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  addAuditLog(user.id, 'Download', doc.id, doc.title, `Downloaded ${latest ? latest.versionNumber : 'document'}.`);

  if (!latest || !latest.fileData) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.title}.txt"`);
    return res.send(doc.ocrText || 'No content available for this document.');
  }

  const buffer = storedFileToBuffer(latest.fileData);
  res.setHeader('Content-Type', mimeForType(latest.fileType));
  res.setHeader('Content-Disposition', `attachment; filename="${latest.fileName}"`);
  return res.send(buffer);
});

// Make a copy of a document (Google Drive style). Duplicates the document and
// its latest version as a fresh Draft owned by the current user.
app.post('/api/documents/:id/copy', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!canViewDocument(user, doc)) {
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }

  const now = new Date().toISOString();
  const newId = `doc-${Date.now()}`;
  const copy: Document = {
    ...doc,
    id: newId,
    title: `Copy of ${doc.title}`,
    ownerId: user.id,
    ownerName: user.fullName,
    status: 'Draft',
    confidentialityLevel: 'Normal File',
    currentVersion: 'v1',
    isStarred: false,
    isArchived: false,
    isDeleted: false,
    createdAt: now,
    updatedAt: now
  };
  db.documents.push(copy);

  const latest = db.versions
    .filter(v => v.documentId === doc.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (latest) {
    db.versions.push({
      ...latest,
      id: `ver-${Date.now()}`,
      documentId: newId,
      versionNumber: 'v1',
      uploadedBy: user.id,
      uploadedByName: user.fullName,
      createdAt: now
    });
  }

  writeDb();
  addAuditLog(user.id, 'Copy', newId, copy.title, `Made a copy of "${doc.title}".`);
  res.status(201).json({ success: true, document: copy });
});

// Initialize Vite (dev) or static serving (production) and start listening.
async function startServer() {
  // Load persisted state before accepting traffic so the first request sees a
  // fully hydrated datastore.
  await initStore();

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SmartDocs DMS Full-Stack Engine booting on port: ${PORT}`);
    console.log(`Active workspace location: ${process.cwd()}`);
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
process.on('uncaughtException', (err) => fatal('uncaughtException', err));
process.on('unhandledRejection', (reason) => fatal('unhandledRejection', reason));

// Spark up
startServer().catch((err) => {
  console.error('[fatal] Failed to start server:', err);
  process.exit(1);
});
