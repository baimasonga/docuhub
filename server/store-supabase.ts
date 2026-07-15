/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Supabase (Postgres) DataStore: one row per entity, safe across multiple
 * server instances / Workers isolates. Schema lives in
 * supabase/migrations/0001_relational_schema.sql.
 *
 * On first boot against an empty schema it imports the legacy single-JSONB
 * blob (docuhub_state) if present, otherwise seeds the default institution
 * and admin account.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  User, Folder, Document, DocumentVersion, SharePermission,
  ApprovalRequest, ActivityLog, Comment, ExternalShareLink, Institution
} from '../src/types';
import {
  DataStore, DocumentFilter, StoredUser,
  DEFAULT_INSTITUTIONS, DEFAULT_ADMIN
} from './store';

// ---- snake_case <-> camelCase row mapping ------------------------------

type Row = Record<string, any>;

const userFromRow = (r: Row): StoredUser => ({
  id: r.id, fullName: r.full_name, email: r.email, role: r.role,
  department: r.department, isActive: r.is_active,
  institutionId: r.institution_id ?? undefined,
  passwordHash: r.password_hash ?? undefined,
  mustChangePassword: r.must_change_password ?? undefined,
  resetTokenHash: r.reset_token_hash ?? undefined,
  resetTokenExpiresAt: r.reset_token_expires_at ?? undefined,
  lastLoginAt: r.last_login_at ?? undefined
});
const userToRow = (u: Partial<StoredUser>): Row => omitUndefined({
  id: u.id, full_name: u.fullName, email: u.email, role: u.role,
  department: u.department, is_active: u.isActive,
  institution_id: u.institutionId,
  password_hash: u.passwordHash, must_change_password: u.mustChangePassword,
  reset_token_hash: u.resetTokenHash, reset_token_expires_at: u.resetTokenExpiresAt,
  last_login_at: u.lastLoginAt
});
// Auth fields that must be explicitly clearable (set to null) when a patch
// carries them as undefined-meaning-delete is not expressible in JSON.
const USER_CLEARABLE = ['resetTokenHash', 'resetTokenExpiresAt'] as const;

const institutionFromRow = (r: Row): Institution => ({
  id: r.id, name: r.name, units: r.units || [],
  categoryFolders: r.category_folders || {}, activityDimension: r.activity_dimension || 'none'
});
const institutionToRow = (i: Partial<Institution>): Row => omitUndefined({
  id: i.id, name: i.name, units: i.units,
  category_folders: i.categoryFolders, activity_dimension: i.activityDimension
});

const folderFromRow = (r: Row): Folder => ({
  id: r.id, name: r.name, parentFolderId: r.parent_folder_id,
  ownerId: r.owner_id, department: r.department ?? undefined, createdAt: r.created_at
});
const folderToRow = (f: Partial<Folder>): Row => omitUndefined({
  id: f.id, name: f.name, parent_folder_id: f.parentFolderId,
  owner_id: f.ownerId, department: f.department, created_at: f.createdAt
});

const documentFromRow = (r: Row): Document => ({
  id: r.id, title: r.title, description: r.description || '',
  ownerId: r.owner_id, ownerName: r.owner_name,
  department: r.department ?? undefined, folderId: r.folder_id,
  documentType: r.document_type, status: r.status,
  confidentialityLevel: r.confidentiality_level, currentVersion: r.current_version,
  isStarred: r.is_starred, isArchived: r.is_archived, isDeleted: r.is_deleted,
  tags: r.tags || [], ocrText: r.ocr_text ?? undefined,
  createdAt: r.created_at, updatedAt: r.updated_at,
  lastAuditedAt: r.last_audited_at ?? undefined,
  lastAuditedBy: r.last_audited_by ?? undefined,
  lastAuditedByName: r.last_audited_by_name ?? undefined
});
const documentToRow = (d: Partial<Document>): Row => {
  const row = omitUndefined({
    id: d.id, title: d.title, description: d.description,
    owner_id: d.ownerId, owner_name: d.ownerName,
    department: d.department, document_type: d.documentType,
    status: d.status, confidentiality_level: d.confidentialityLevel,
    current_version: d.currentVersion, is_starred: d.isStarred,
    is_archived: d.isArchived, is_deleted: d.isDeleted,
    tags: d.tags, ocr_text: d.ocrText,
    created_at: d.createdAt, updated_at: d.updatedAt,
    last_audited_at: d.lastAuditedAt, last_audited_by: d.lastAuditedBy,
    last_audited_by_name: d.lastAuditedByName
  });
  // folderId: null is a meaningful value ("root"), not an omission.
  if ('folderId' in d) row.folder_id = d.folderId;
  return row;
};

const versionFromRow = (r: Row): DocumentVersion => ({
  id: r.id, documentId: r.document_id, fileName: r.file_name,
  fileSize: Number(r.file_size) || 0, fileType: r.file_type || '',
  versionNumber: r.version_number, uploadedBy: r.uploaded_by,
  uploadedByName: r.uploaded_by_name,
  fileData: r.file_data ?? undefined, storagePath: r.storage_path ?? undefined,
  createdAt: r.created_at
});
const versionToRow = (v: Partial<DocumentVersion>): Row => omitUndefined({
  id: v.id, document_id: v.documentId, file_name: v.fileName,
  file_size: v.fileSize, file_type: v.fileType, version_number: v.versionNumber,
  uploaded_by: v.uploadedBy, uploaded_by_name: v.uploadedByName,
  file_data: v.fileData, storage_path: v.storagePath, created_at: v.createdAt
});

const permissionFromRow = (r: Row): SharePermission => ({
  id: r.id, documentId: r.document_id, sharedWithUserId: r.shared_with_user_id,
  permissionType: r.permission_type, sharedById: r.shared_by_id, createdAt: r.created_at
});
const permissionToRow = (p: Partial<SharePermission>): Row => omitUndefined({
  id: p.id, document_id: p.documentId, shared_with_user_id: p.sharedWithUserId,
  permission_type: p.permissionType, shared_by_id: p.sharedById, created_at: p.createdAt
});

const approvalFromRow = (r: Row): ApprovalRequest => ({
  id: r.id, documentId: r.document_id, requestedBy: r.requested_by,
  requestedByName: r.requested_by_name, approverId: r.approver_id,
  approverName: r.approver_name, status: r.status,
  requestComment: r.request_comment || '', approvalComment: r.approval_comment || '',
  createdAt: r.created_at, updatedAt: r.updated_at
});
const approvalToRow = (a: Partial<ApprovalRequest>): Row => omitUndefined({
  id: a.id, document_id: a.documentId, requested_by: a.requestedBy,
  requested_by_name: a.requestedByName, approver_id: a.approverId,
  approver_name: a.approverName, status: a.status,
  request_comment: a.requestComment, approval_comment: a.approvalComment,
  created_at: a.createdAt, updated_at: a.updatedAt
});

const commentFromRow = (r: Row): Comment => ({
  id: r.id, documentId: r.document_id, userId: r.user_id, userName: r.user_name,
  userRole: r.user_role, text: r.text, createdAt: r.created_at
});
const commentToRow = (c: Partial<Comment>): Row => omitUndefined({
  id: c.id, document_id: c.documentId, user_id: c.userId, user_name: c.userName,
  user_role: c.userRole, text: c.text, created_at: c.createdAt
});

const logFromRow = (r: Row): ActivityLog => ({
  id: r.id, userId: r.user_id, userName: r.user_name, userRole: r.user_role,
  action: r.action, documentId: r.document_id ?? undefined,
  documentTitle: r.document_title ?? undefined, details: r.details || '',
  createdAt: r.created_at
});
const logToRow = (l: Partial<ActivityLog>): Row => omitUndefined({
  id: l.id, user_id: l.userId, user_name: l.userName, user_role: l.userRole,
  action: l.action, document_id: l.documentId, document_title: l.documentTitle,
  details: l.details, created_at: l.createdAt
});

const linkFromRow = (r: Row): ExternalShareLink => ({
  id: r.id, documentId: r.document_id, token: r.token,
  shortCode: r.short_code ?? undefined, createdBy: r.created_by,
  permissionType: r.permission_type, expiresAt: r.expires_at,
  isActive: r.is_active, accessCount: r.access_count || 0,
  createdAt: r.created_at, fileName: r.file_name, fileSize: Number(r.file_size) || 0,
  fileType: r.file_type || '', downloadCount: r.download_count || 0,
  maxDownloads: r.max_downloads, message: r.message ?? undefined,
  allowDownload: r.allow_download, requiresPassword: r.requires_password,
  passwordHash: r.password_hash ?? undefined
});
const linkToRow = (l: Partial<ExternalShareLink>): Row => {
  const row = omitUndefined({
    id: l.id, document_id: l.documentId, token: l.token, short_code: l.shortCode,
    created_by: l.createdBy, permission_type: l.permissionType, expires_at: l.expiresAt,
    is_active: l.isActive, access_count: l.accessCount, created_at: l.createdAt,
    file_name: l.fileName, file_size: l.fileSize, file_type: l.fileType,
    download_count: l.downloadCount, message: l.message,
    allow_download: l.allowDownload, requires_password: l.requiresPassword,
    password_hash: l.passwordHash
  });
  if ('maxDownloads' in l) row.max_downloads = l.maxDownloads;
  return row;
};

function omitUndefined(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (v !== undefined) out[k] = v;
  return out;
}

// Columns fetched for document lists/details: everything except the heavy
// ocr_text is still needed by the UI (detail + search preview), so we fetch
// full rows; file bytes live on document_versions, not here.
const DOC_COLUMNS = 'id,title,description,owner_id,owner_name,department,folder_id,document_type,status,confidentiality_level,current_version,is_starred,is_archived,is_deleted,tags,ocr_text,created_at,updated_at,last_audited_at,last_audited_by,last_audited_by_name';
// Version metadata without the (potentially huge) inline file_data payload.
const VERSION_META_COLUMNS = 'id,document_id,file_name,file_size,file_type,version_number,uploaded_by,uploaded_by_name,storage_path,created_at';

export class SupabaseStore implements DataStore {
  readonly kind = 'supabase' as const;

  constructor(private supabase: SupabaseClient) {}

  private from(table: string) { return this.supabase.from(table); }

  private static unwrap<T>(res: { data: T | null; error: { message: string } | null }, ctx: string): T {
    if (res.error) throw new Error(`[supabase:${ctx}] ${res.error.message}`);
    return res.data as T;
  }

  async init(): Promise<void> {
    const { count, error } = await this.from('dms_users').select('id', { count: 'exact', head: true });
    if (error) throw new Error(`[supabase:init] ${error.message} — has the schema migration been applied?`);
    if ((count ?? 0) > 0) return;

    // Empty schema: import the legacy JSONB blob if one exists, else seed.
    const legacy = await this.from('docuhub_state').select('data').eq('id', 'docuhub').maybeSingle();
    const blob = !legacy.error && legacy.data?.data ? legacy.data.data as Record<string, any[]> : null;
    if (blob && Array.isArray(blob.users) && blob.users.length > 0) {
      console.log('[store] Importing legacy JSONB state into relational tables…');
      await this.importLegacy(blob);
      console.log('[store] Legacy import complete.');
      return;
    }

    console.log('[store] Seeding initial institution + admin.');
    await this.from('institutions').upsert(DEFAULT_INSTITUTIONS.map(institutionToRow));
    await this.from('dms_users').upsert([userToRow(DEFAULT_ADMIN)]);
  }

  private async importLegacy(blob: Record<string, any[]>): Promise<void> {
    const insert = async (table: string, rows: Row[], ctx: string) => {
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const { error } = await this.from(table).upsert(chunk);
        if (error) console.error(`[store] legacy import (${ctx}) failed:`, error.message);
      }
    };
    await insert('institutions', (blob.institutions || DEFAULT_INSTITUTIONS).map(institutionToRow), 'institutions');
    await insert('dms_users', (blob.users || []).map(userToRow), 'users');
    await insert('folders', (blob.folders || []).map(folderToRow), 'folders');
    await insert('documents', (blob.documents || []).map(documentToRow), 'documents');
    await insert('document_versions', (blob.versions || []).map(versionToRow), 'versions');
    await insert('share_permissions', (blob.permissions || []).map(permissionToRow), 'permissions');
    await insert('approval_requests', (blob.approvals || []).map(approvalToRow), 'approvals');
    await insert('doc_comments', (blob.comments || []).map(commentToRow), 'comments');
    await insert('activity_logs', (blob.logs || []).map(logToRow), 'logs');
    await insert('external_share_links', (blob.externalLinks || []).map(linkToRow), 'externalLinks');
  }

  // ---- Users ----
  async listUsers() {
    const data = SupabaseStore.unwrap(await this.from('dms_users').select('*').order('created_at'), 'listUsers');
    return (data as Row[]).map(userFromRow);
  }
  async getUser(id: string) {
    const data = SupabaseStore.unwrap(await this.from('dms_users').select('*').eq('id', id).maybeSingle(), 'getUser');
    return data ? userFromRow(data as Row) : null;
  }
  async getUserByEmail(email: string) {
    const data = SupabaseStore.unwrap(
      await this.from('dms_users').select('*').ilike('email', email).maybeSingle(), 'getUserByEmail');
    return data ? userFromRow(data as Row) : null;
  }
  async getUserByResetTokenHash(tokenHash: string) {
    const data = SupabaseStore.unwrap(
      await this.from('dms_users').select('*').eq('reset_token_hash', tokenHash).maybeSingle(), 'getUserByResetToken');
    return data ? userFromRow(data as Row) : null;
  }
  async createUser(u: StoredUser) {
    SupabaseStore.unwrap(await this.from('dms_users').insert(userToRow(u)).select().single(), 'createUser');
    return u;
  }
  async updateUser(id: string, patch: Partial<StoredUser>) {
    const row = userToRow(patch);
    for (const key of USER_CLEARABLE) {
      if (key in patch && patch[key] === undefined) {
        row[key === 'resetTokenHash' ? 'reset_token_hash' : 'reset_token_expires_at'] = null;
      }
    }
    const data = SupabaseStore.unwrap(
      await this.from('dms_users').update(row).eq('id', id).select().maybeSingle(), 'updateUser');
    return data ? userFromRow(data as Row) : null;
  }

  // ---- Institutions ----
  async listInstitutions() {
    const data = SupabaseStore.unwrap(await this.from('institutions').select('*').order('id'), 'listInstitutions');
    return (data as Row[]).map(institutionFromRow);
  }
  async getInstitution(id: string) {
    const data = SupabaseStore.unwrap(await this.from('institutions').select('*').eq('id', id).maybeSingle(), 'getInstitution');
    return data ? institutionFromRow(data as Row) : null;
  }
  async updateInstitution(id: string, patch: Partial<Institution>) {
    const data = SupabaseStore.unwrap(
      await this.from('institutions').update(institutionToRow(patch)).eq('id', id).select().maybeSingle(), 'updateInstitution');
    return data ? institutionFromRow(data as Row) : null;
  }

  // ---- Folders ----
  async listFolders() {
    const data = SupabaseStore.unwrap(await this.from('folders').select('*').order('created_at'), 'listFolders');
    return (data as Row[]).map(folderFromRow);
  }
  async getFolder(id: string) {
    const data = SupabaseStore.unwrap(await this.from('folders').select('*').eq('id', id).maybeSingle(), 'getFolder');
    return data ? folderFromRow(data as Row) : null;
  }
  async createFolder(f: Folder) {
    SupabaseStore.unwrap(await this.from('folders').insert(folderToRow(f)).select().single(), 'createFolder');
    return f;
  }
  async deleteFolders(ids: string[]) {
    if (ids.length === 0) return;
    SupabaseStore.unwrap(await this.from('folders').delete().in('id', ids).select('id'), 'deleteFolders');
  }

  // ---- Documents ----
  async listDocuments(filter: DocumentFilter = {}) {
    let q = this.from('documents').select(DOC_COLUMNS);
    const deleted = filter.deleted ?? 'exclude';
    if (deleted === 'only') q = q.eq('is_deleted', true);
    else if (deleted === 'exclude') q = q.eq('is_deleted', false);
    if (filter.archived !== undefined) q = q.eq('is_archived', filter.archived);
    if (filter.folderId !== undefined) {
      q = filter.folderId === null ? q.is('folder_id', null) : q.eq('folder_id', filter.folderId);
    }
    if (filter.status) q = q.eq('status', filter.status);
    if (filter.starred !== undefined) q = q.eq('is_starred', filter.starred);
    if (filter.category) q = q.eq('document_type', filter.category);

    if (filter.query) {
      // Full-text search plus a substring fallback (FTS only matches whole
      // lexemes; users expect partial matches on titles/tags too). Results
      // are merged, FTS hits first.
      const term = filter.query.trim();
      const ftsQ = q.textSearch('search_tsv', term, { type: 'websearch', config: 'english' }).order('created_at');
      const like = `%${term.replace(/[%_]/g, m => '\\' + m)}%`;

      // One .ilike() call per column, not a hand-built .or("col.ilike.$term")
      // string: `term` is untrusted and PostgREST's or() syntax treats
      // `,`/`(`/`)` as filter-structure characters, not literal text, so
      // interpolating it directly would let a search term inject extra
      // filter clauses. Passing the value through .ilike()'s own parameter
      // instead means the client encodes it safely.
      const substringCols = ['title', 'owner_name', 'department', 'tags_text'];
      const subQueries = substringCols.map(col => {
        let subQ = this.from('documents').select(DOC_COLUMNS);
        if (deleted === 'only') subQ = subQ.eq('is_deleted', true);
        else if (deleted === 'exclude') subQ = subQ.eq('is_deleted', false);
        if (filter.archived !== undefined) subQ = subQ.eq('is_archived', filter.archived);
        if (filter.folderId !== undefined) {
          subQ = filter.folderId === null ? subQ.is('folder_id', null) : subQ.eq('folder_id', filter.folderId);
        }
        if (filter.status) subQ = subQ.eq('status', filter.status);
        if (filter.starred !== undefined) subQ = subQ.eq('is_starred', filter.starred);
        if (filter.category) subQ = subQ.eq('document_type', filter.category);
        return subQ.ilike(col, like).order('created_at');
      });

      const results = await Promise.all([ftsQ, ...subQueries]);
      const rows: Row[] = [];
      const seen = new Set<string>();
      for (const result of results) {
        for (const r of SupabaseStore.unwrap(result, 'search') as Row[]) {
          if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); }
        }
      }
      return rows.map(documentFromRow);
    }

    const data = SupabaseStore.unwrap(await q.order('created_at'), 'listDocuments');
    return (data as Row[]).map(documentFromRow);
  }
  async getDocument(id: string) {
    const data = SupabaseStore.unwrap(
      await this.from('documents').select(DOC_COLUMNS).eq('id', id).maybeSingle(), 'getDocument');
    return data ? documentFromRow(data as Row) : null;
  }
  async createDocument(d: Document) {
    SupabaseStore.unwrap(await this.from('documents').insert(documentToRow(d)).select('id').single(), 'createDocument');
    return d;
  }
  async updateDocument(id: string, patch: Partial<Document>) {
    const data = SupabaseStore.unwrap(
      await this.from('documents').update(documentToRow(patch)).eq('id', id).select(DOC_COLUMNS).maybeSingle(), 'updateDocument');
    return data ? documentFromRow(data as Row) : null;
  }
  async deleteDocument(id: string) {
    // Child tables cascade via foreign keys.
    SupabaseStore.unwrap(await this.from('documents').delete().eq('id', id).select('id'), 'deleteDocument');
  }

  // ---- Versions ----
  async listVersions(documentId: string) {
    const data = SupabaseStore.unwrap(
      await this.from('document_versions').select(VERSION_META_COLUMNS)
        .eq('document_id', documentId).order('created_at', { ascending: false }), 'listVersions');
    return (data as Row[]).map(versionFromRow);
  }
  async listVersionsForDocuments(documentIds: string[]) {
    if (documentIds.length === 0) return [];
    const out: Row[] = [];
    for (let i = 0; i < documentIds.length; i += 150) {
      const data = SupabaseStore.unwrap(
        await this.from('document_versions').select(VERSION_META_COLUMNS)
          .in('document_id', documentIds.slice(i, i + 150))
          .order('created_at', { ascending: false }), 'listVersionsForDocuments');
      out.push(...(data as Row[]));
    }
    return out.map(versionFromRow);
  }
  async getVersion(id: string) {
    const data = SupabaseStore.unwrap(
      await this.from('document_versions').select('*').eq('id', id).maybeSingle(), 'getVersion');
    return data ? versionFromRow(data as Row) : null;
  }
  async createVersion(v: DocumentVersion) {
    SupabaseStore.unwrap(await this.from('document_versions').insert(versionToRow(v)).select('id').single(), 'createVersion');
    return v;
  }
  async updateVersion(id: string, patch: Partial<DocumentVersion>) {
    const row = versionToRow(patch);
    if ('fileData' in patch && patch.fileData === undefined) row.file_data = null;
    SupabaseStore.unwrap(await this.from('document_versions').update(row).eq('id', id).select('id'), 'updateVersion');
  }
  async listVersionsPendingOffload() {
    const data = SupabaseStore.unwrap(
      await this.from('document_versions').select('*')
        .not('file_data', 'is', null).is('storage_path', null).limit(100), 'listVersionsPendingOffload');
    return (data as Row[]).map(versionFromRow);
  }

  // ---- Permissions ----
  async listPermissionsForDocument(documentId: string) {
    const data = SupabaseStore.unwrap(
      await this.from('share_permissions').select('*').eq('document_id', documentId), 'listPermissionsForDocument');
    return (data as Row[]).map(permissionFromRow);
  }
  async listPermissionsForUser(userId: string) {
    const data = SupabaseStore.unwrap(
      await this.from('share_permissions').select('*').eq('shared_with_user_id', userId), 'listPermissionsForUser');
    return (data as Row[]).map(permissionFromRow);
  }
  async upsertPermission(p: SharePermission) {
    SupabaseStore.unwrap(
      await this.from('share_permissions').upsert(permissionToRow(p), { onConflict: 'document_id,shared_with_user_id' }).select('id'),
      'upsertPermission');
  }

  // ---- Approvals ----
  async listApprovalsForDocument(documentId: string) {
    const data = SupabaseStore.unwrap(
      await this.from('approval_requests').select('*')
        .eq('document_id', documentId).order('created_at', { ascending: false }), 'listApprovalsForDocument');
    return (data as Row[]).map(approvalFromRow);
  }
  async listPendingApprovalsForApprover(approverId: string) {
    const data = SupabaseStore.unwrap(
      await this.from('approval_requests').select('*')
        .eq('approver_id', approverId).eq('status', 'Pending Approval')
        .order('created_at', { ascending: false }), 'listPendingApprovalsForApprover');
    return (data as Row[]).map(approvalFromRow);
  }
  async getApproval(id: string) {
    const data = SupabaseStore.unwrap(
      await this.from('approval_requests').select('*').eq('id', id).maybeSingle(), 'getApproval');
    return data ? approvalFromRow(data as Row) : null;
  }
  async createApproval(a: ApprovalRequest) {
    SupabaseStore.unwrap(await this.from('approval_requests').insert(approvalToRow(a)).select('id').single(), 'createApproval');
  }
  async updateApproval(id: string, patch: Partial<ApprovalRequest>) {
    const data = SupabaseStore.unwrap(
      await this.from('approval_requests').update(approvalToRow(patch)).eq('id', id).select().maybeSingle(), 'updateApproval');
    return data ? approvalFromRow(data as Row) : null;
  }

  // ---- Comments ----
  async listCommentsForDocument(documentId: string) {
    const data = SupabaseStore.unwrap(
      await this.from('doc_comments').select('*')
        .eq('document_id', documentId).order('created_at'), 'listCommentsForDocument');
    return (data as Row[]).map(commentFromRow);
  }
  async createComment(c: Comment) {
    SupabaseStore.unwrap(await this.from('doc_comments').insert(commentToRow(c)).select('id').single(), 'createComment');
  }

  // ---- Logs ----
  async listLogs(limit = 500) {
    const data = SupabaseStore.unwrap(
      await this.from('activity_logs').select('*')
        .order('created_at', { ascending: false }).limit(limit), 'listLogs');
    return (data as Row[]).map(logFromRow);
  }
  async listLogsForDocument(documentId: string) {
    const data = SupabaseStore.unwrap(
      await this.from('activity_logs').select('*')
        .eq('document_id', documentId).order('created_at', { ascending: false }), 'listLogsForDocument');
    return (data as Row[]).map(logFromRow);
  }
  async createLog(l: ActivityLog) {
    SupabaseStore.unwrap(await this.from('activity_logs').insert(logToRow(l)).select('id').single(), 'createLog');
  }

  // ---- External links ----
  async getLinkByToken(token: string) {
    const data = SupabaseStore.unwrap(
      await this.from('external_share_links').select('*').eq('token', token).maybeSingle(), 'getLinkByToken');
    return data ? linkFromRow(data as Row) : null;
  }
  async getLinkByCode(code: string) {
    const data = SupabaseStore.unwrap(
      await this.from('external_share_links').select('*').eq('short_code', code).maybeSingle(), 'getLinkByCode');
    return data ? linkFromRow(data as Row) : null;
  }
  async listActiveLinksForDocument(documentId: string) {
    const data = SupabaseStore.unwrap(
      await this.from('external_share_links').select('*')
        .eq('document_id', documentId).eq('is_active', true), 'listActiveLinksForDocument');
    return (data as Row[]).map(linkFromRow);
  }
  async createLink(l: ExternalShareLink) {
    SupabaseStore.unwrap(await this.from('external_share_links').insert(linkToRow(l)).select('id').single(), 'createLink');
  }
  async updateLink(id: string, patch: Partial<ExternalShareLink>) {
    SupabaseStore.unwrap(
      await this.from('external_share_links').update(linkToRow(patch)).eq('id', id).select('id'), 'updateLink');
  }
}
