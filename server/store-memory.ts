/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-memory DataStore backed by a JSON file (local dev + tests). Single
 * process only — production uses the Supabase backend.
 */

import fs from 'fs';
import path from 'path';
import {
  User, Folder, Document, DocumentVersion, SharePermission,
  ApprovalRequest, ActivityLog, Comment, ExternalShareLink, Institution, BackupRun
} from '../src/types';
import {
  DataStore, DocumentFilter, StoredUser,
  DEFAULT_INSTITUTIONS, DEFAULT_ADMIN, applyDocumentFilter
} from './store';

interface Collections {
  users: StoredUser[];
  institutions: Institution[];
  folders: Folder[];
  documents: Document[];
  versions: DocumentVersion[];
  permissions: SharePermission[];
  approvals: ApprovalRequest[];
  comments: Comment[];
  logs: ActivityLog[];
  externalLinks: ExternalShareLink[];
  backupRuns: BackupRun[];
}

const byNewest = (a: { createdAt: string }, b: { createdAt: string }) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
const byOldest = (a: { createdAt: string }, b: { createdAt: string }) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

export class MemoryStore implements DataStore {
  readonly kind = 'memory' as const;
  private db: Collections = {
    users: [], institutions: [], folders: [], documents: [], versions: [],
    permissions: [], approvals: [], comments: [], logs: [], externalLinks: [],
    backupRuns: []
  };

  /** filePath === null disables file persistence (Workers, tests). */
  constructor(private filePath: string | null) {}

  async init(): Promise<void> {
    if (this.filePath) {
      try {
        if (fs.existsSync(this.filePath)) {
          const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
          this.db = { ...this.db, ...parsed };
        }
      } catch (err) {
        console.error('[store] Error reading db file; starting from seed.', err);
      }
    }
    this.seedMissing();
    this.flush();
  }

  private seedMissing() {
    if (this.db.institutions.length === 0) this.db.institutions = structuredClone(DEFAULT_INSTITUTIONS);
    if (this.db.users.length === 0) this.db.users = [structuredClone(DEFAULT_ADMIN)];
    const fallbackInstitutionId = this.db.institutions[0].id;
    for (const user of this.db.users) {
      if (!user.institutionId) user.institutionId = fallbackInstitutionId;
    }
  }

  private flush() {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[store] Error saving database.', err);
    }
  }

  // ---- Users ----
  async listUsers() { return [...this.db.users]; }
  async getUser(id: string) { return this.db.users.find(u => u.id === id) || null; }
  async getUserByEmail(email: string) {
    const e = email.toLowerCase();
    return this.db.users.find(u => u.email.toLowerCase() === e) || null;
  }
  async getUserByResetTokenHash(tokenHash: string) {
    return this.db.users.find(u => u.resetTokenHash === tokenHash) || null;
  }
  async createUser(u: StoredUser) { this.db.users.push(u); this.flush(); return u; }
  async updateUser(id: string, patch: Partial<StoredUser>) {
    const u = this.db.users.find(x => x.id === id);
    if (!u) return null;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (u as any)[k];
      else (u as any)[k] = v;
    }
    this.flush();
    return u;
  }

  // ---- Institutions ----
  async listInstitutions() { return [...this.db.institutions]; }
  async getInstitution(id: string) { return this.db.institutions.find(i => i.id === id) || null; }
  async updateInstitution(id: string, patch: Partial<Institution>) {
    const inst = this.db.institutions.find(i => i.id === id);
    if (!inst) return null;
    Object.assign(inst, patch);
    this.flush();
    return inst;
  }

  // ---- Folders ----
  async listFolders() { return [...this.db.folders]; }
  async getFolder(id: string) { return this.db.folders.find(f => f.id === id) || null; }
  async createFolder(f: Folder) { this.db.folders.push(f); this.flush(); return f; }
  async deleteFolders(ids: string[]) {
    const set = new Set(ids);
    this.db.folders = this.db.folders.filter(f => !set.has(f.id));
    this.flush();
  }

  // ---- Documents ----
  async listDocuments(filter: DocumentFilter = {}) {
    return applyDocumentFilter(this.db.documents, filter).map(d => ({ ...d }));
  }
  async getDocument(id: string) {
    const d = this.db.documents.find(x => x.id === id);
    return d ? { ...d } : null;
  }
  async createDocument(d: Document) { this.db.documents.push(d); this.flush(); return d; }
  async updateDocument(id: string, patch: Partial<Document>) {
    const d = this.db.documents.find(x => x.id === id);
    if (!d) return null;
    Object.assign(d, patch);
    this.flush();
    return { ...d };
  }
  async deleteDocument(id: string) {
    this.db.documents = this.db.documents.filter(d => d.id !== id);
    this.db.versions = this.db.versions.filter(v => v.documentId !== id);
    this.db.approvals = this.db.approvals.filter(a => a.documentId !== id);
    this.db.comments = this.db.comments.filter(c => c.documentId !== id);
    this.db.permissions = this.db.permissions.filter(p => p.documentId !== id);
    this.db.externalLinks = this.db.externalLinks.filter(l => l.documentId !== id);
    this.flush();
  }

  // ---- Versions ----
  async listVersions(documentId: string) {
    return this.db.versions.filter(v => v.documentId === documentId).sort(byNewest).map(v => ({ ...v }));
  }
  async listVersionsForDocuments(documentIds: string[]) {
    const set = new Set(documentIds);
    return this.db.versions.filter(v => set.has(v.documentId)).sort(byNewest).map(v => ({ ...v }));
  }
  async getVersion(id: string) {
    const v = this.db.versions.find(x => x.id === id);
    return v ? { ...v } : null;
  }
  async createVersion(v: DocumentVersion) { this.db.versions.push(v); this.flush(); return v; }
  async updateVersion(id: string, patch: Partial<DocumentVersion>) {
    const v = this.db.versions.find(x => x.id === id);
    if (!v) return;
    for (const [k, val] of Object.entries(patch)) {
      if (val === undefined) delete (v as any)[k];
      else (v as any)[k] = val;
    }
    this.flush();
  }
  async listVersionsPendingOffload() {
    return this.db.versions.filter(v => v.fileData && !v.storagePath).map(v => ({ ...v }));
  }
  async listVersionsCreatedSince(sinceIso: string) {
    const since = new Date(sinceIso).getTime();
    return this.db.versions.filter(v => new Date(v.createdAt).getTime() >= since).map(v => ({ ...v }));
  }

  // ---- Permissions ----
  async listPermissionsForDocument(documentId: string) {
    return this.db.permissions.filter(p => p.documentId === documentId).map(p => ({ ...p }));
  }
  async listPermissionsForUser(userId: string) {
    return this.db.permissions.filter(p => p.sharedWithUserId === userId).map(p => ({ ...p }));
  }
  async upsertPermission(p: SharePermission) {
    const existing = this.db.permissions.find(
      x => x.documentId === p.documentId && x.sharedWithUserId === p.sharedWithUserId
    );
    if (existing) {
      existing.permissionType = p.permissionType;
      existing.createdAt = p.createdAt;
    } else {
      this.db.permissions.push(p);
    }
    this.flush();
  }
  async listAllPermissions() { return this.db.permissions.map(p => ({ ...p })); }

  // ---- Approvals ----
  async listApprovalsForDocument(documentId: string) {
    return this.db.approvals.filter(a => a.documentId === documentId).sort(byNewest).map(a => ({ ...a }));
  }
  async listPendingApprovalsForApprover(approverId: string) {
    return this.db.approvals
      .filter(a => a.approverId === approverId && a.status === 'Pending Approval')
      .sort(byNewest).map(a => ({ ...a }));
  }
  async getApproval(id: string) {
    const a = this.db.approvals.find(x => x.id === id);
    return a ? { ...a } : null;
  }
  async createApproval(a: ApprovalRequest) { this.db.approvals.push(a); this.flush(); }
  async updateApproval(id: string, patch: Partial<ApprovalRequest>) {
    const a = this.db.approvals.find(x => x.id === id);
    if (!a) return null;
    Object.assign(a, patch);
    this.flush();
    return { ...a };
  }
  async listAllApprovals() { return this.db.approvals.map(a => ({ ...a })); }

  // ---- Comments ----
  async listCommentsForDocument(documentId: string) {
    return this.db.comments.filter(c => c.documentId === documentId).sort(byOldest).map(c => ({ ...c }));
  }
  async createComment(c: Comment) { this.db.comments.push(c); this.flush(); }
  async listAllComments() { return this.db.comments.map(c => ({ ...c })); }

  // ---- Logs ----
  async listLogs(limit = 500) {
    return [...this.db.logs].sort(byNewest).slice(0, limit);
  }
  async listLogsForDocument(documentId: string) {
    return this.db.logs.filter(l => l.documentId === documentId).sort(byNewest);
  }
  async createLog(l: ActivityLog) { this.db.logs.unshift(l); this.flush(); }

  // ---- External links ----
  async getLinkByToken(token: string) {
    const l = this.db.externalLinks.find(x => x.token === token);
    return l ? { ...l } : null;
  }
  async getLinkByCode(code: string) {
    const l = this.db.externalLinks.find(x => x.shortCode === code);
    return l ? { ...l } : null;
  }
  async listActiveLinksForDocument(documentId: string) {
    return this.db.externalLinks.filter(l => l.documentId === documentId && l.isActive).map(l => ({ ...l }));
  }
  async createLink(l: ExternalShareLink) { this.db.externalLinks.push(l); this.flush(); }
  async updateLink(id: string, patch: Partial<ExternalShareLink>) {
    const l = this.db.externalLinks.find(x => x.id === id);
    if (!l) return;
    Object.assign(l, patch);
    this.flush();
  }
  async listAllLinks() { return this.db.externalLinks.map(l => ({ ...l })); }

  // ---- Backup runs ----
  async listBackupRuns(limit = 20) {
    const byNewestStart = (a: BackupRun, b: BackupRun) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    return [...this.db.backupRuns].sort(byNewestStart).slice(0, limit);
  }
  async getLastSuccessfulBackupRun() {
    const byNewestStart = (a: BackupRun, b: BackupRun) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    const runs = this.db.backupRuns.filter(b => b.status === 'success').sort(byNewestStart);
    return runs[0] ? { ...runs[0] } : null;
  }
  async createBackupRun(b: BackupRun) { this.db.backupRuns.unshift(b); this.flush(); }
  async updateBackupRun(id: string, patch: Partial<BackupRun>) {
    const b = this.db.backupRuns.find(x => x.id === id);
    if (!b) return;
    Object.assign(b, patch);
    this.flush();
  }
}
