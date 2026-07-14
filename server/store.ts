/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Data-access layer for Chore Box DMS.
 *
 * The server talks to a `DataStore` interface with two implementations:
 *  - MemoryStore   (server/store-memory.ts): in-memory + JSON file, used for
 *    local dev and tests. Single-process only.
 *  - SupabaseStore (server/store-supabase.ts): one Postgres row per entity,
 *    safe across multiple server instances / Workers isolates. This is the
 *    production backend.
 *
 * Entities keep their existing camelCase API shape; the Supabase backend maps
 * to snake_case columns (see supabase/migrations/0001_relational_schema.sql).
 */

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
  Institution
} from '../src/types';

// Server-side auth fields. Kept out of src/types.ts so the client never sees
// them; every API response must go through publicUser() before serialization.
export interface UserAuth {
  passwordHash?: string;         // "pbkdf2$<iterations>$<salt b64>$<hash b64>"
  mustChangePassword?: boolean;
  resetTokenHash?: string;       // sha256 of the emailed reset token
  resetTokenExpiresAt?: string;  // ISO timestamp
  lastLoginAt?: string;
}

export type StoredUser = User & UserAuth;

// Strip server-only fields before returning a user to any client.
export function publicUser(u: StoredUser): User & { mustChangePassword?: boolean } {
  const { passwordHash, resetTokenHash, resetTokenExpiresAt, ...rest } = u;
  return rest;
}

export interface DocumentFilter {
  deleted?: 'only' | 'exclude' | 'any';
  archived?: boolean;           // undefined = both
  folderId?: string | null;     // null => root; undefined => any folder
  status?: string;
  starred?: boolean;
  category?: string;
  query?: string;               // full-text (Supabase) / substring (memory)
}

export interface DataStore {
  readonly kind: 'memory' | 'supabase';
  /** Load persisted state / seed initial data. Called once per process. */
  init(): Promise<void>;

  // Users
  listUsers(): Promise<StoredUser[]>;
  getUser(id: string): Promise<StoredUser | null>;
  getUserByEmail(email: string): Promise<StoredUser | null>;
  getUserByResetTokenHash(tokenHash: string): Promise<StoredUser | null>;
  createUser(u: StoredUser): Promise<StoredUser>;
  updateUser(id: string, patch: Partial<StoredUser>): Promise<StoredUser | null>;

  // Institutions
  listInstitutions(): Promise<Institution[]>;
  getInstitution(id: string): Promise<Institution | null>;
  updateInstitution(id: string, patch: Partial<Institution>): Promise<Institution | null>;

  // Folders
  listFolders(): Promise<Folder[]>;
  getFolder(id: string): Promise<Folder | null>;
  createFolder(f: Folder): Promise<Folder>;
  deleteFolders(ids: string[]): Promise<void>;

  // Documents
  listDocuments(filter?: DocumentFilter): Promise<Document[]>;
  getDocument(id: string): Promise<Document | null>;
  createDocument(d: Document): Promise<Document>;
  updateDocument(id: string, patch: Partial<Document>): Promise<Document | null>;
  /** Hard delete; cascades versions/permissions/approvals/comments/links. */
  deleteDocument(id: string): Promise<void>;

  // Versions (returned newest-first)
  listVersions(documentId: string): Promise<DocumentVersion[]>;
  listVersionsForDocuments(documentIds: string[]): Promise<DocumentVersion[]>;
  getVersion(id: string): Promise<DocumentVersion | null>;
  createVersion(v: DocumentVersion): Promise<DocumentVersion>;
  updateVersion(id: string, patch: Partial<DocumentVersion>): Promise<void>;
  listVersionsPendingOffload(): Promise<DocumentVersion[]>;

  // Share permissions
  listPermissionsForDocument(documentId: string): Promise<SharePermission[]>;
  listPermissionsForUser(userId: string): Promise<SharePermission[]>;
  upsertPermission(p: SharePermission): Promise<void>;

  // Approvals
  listApprovalsForDocument(documentId: string): Promise<ApprovalRequest[]>;
  listPendingApprovalsForApprover(approverId: string): Promise<ApprovalRequest[]>;
  getApproval(id: string): Promise<ApprovalRequest | null>;
  createApproval(a: ApprovalRequest): Promise<void>;
  updateApproval(id: string, patch: Partial<ApprovalRequest>): Promise<ApprovalRequest | null>;

  // Comments (returned oldest-first)
  listCommentsForDocument(documentId: string): Promise<Comment[]>;
  createComment(c: Comment): Promise<void>;

  // Activity logs (returned newest-first)
  listLogs(limit?: number): Promise<ActivityLog[]>;
  listLogsForDocument(documentId: string): Promise<ActivityLog[]>;
  createLog(l: ActivityLog): Promise<void>;

  // External share links
  getLinkByToken(token: string): Promise<ExternalShareLink | null>;
  getLinkByCode(code: string): Promise<ExternalShareLink | null>;
  listActiveLinksForDocument(documentId: string): Promise<ExternalShareLink[]>;
  createLink(l: ExternalShareLink): Promise<void>;
  updateLink(id: string, patch: Partial<ExternalShareLink>): Promise<void>;
}

// ----------------------------------------------------
// Seed data
// ----------------------------------------------------
export const DEFAULT_INSTITUTION_ID = 'inst-smartdocs';

export const DEFAULT_INSTITUTIONS: Institution[] = [
  {
    id: DEFAULT_INSTITUTION_ID,
    name: 'Chore Box DMS Organization',
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

export const DEFAULT_ADMIN: StoredUser = {
  id: 'admin-1',
  fullName: 'Mohamed Bangura',
  email: 'mohamedbangura@avdp.org.sl',
  role: 'Admin',
  department: 'Procurement',
  isActive: true,
  institutionId: DEFAULT_INSTITUTION_ID,
  mustChangePassword: true
};

// Case-insensitive substring match used by the memory backend's search.
export function matchesQuery(d: Document, q: string): boolean {
  const needle = q.toLowerCase().trim();
  return (
    d.title.toLowerCase().includes(needle) ||
    d.description.toLowerCase().includes(needle) ||
    (!!d.ocrText && d.ocrText.toLowerCase().includes(needle)) ||
    d.tags.some(t => t.toLowerCase().includes(needle)) ||
    d.ownerName.toLowerCase().includes(needle) ||
    (!!d.department && d.department.toLowerCase().includes(needle))
  );
}

export function applyDocumentFilter(docs: Document[], filter: DocumentFilter = {}): Document[] {
  let out = docs;
  const deleted = filter.deleted ?? 'exclude';
  if (deleted === 'only') out = out.filter(d => d.isDeleted);
  else if (deleted === 'exclude') out = out.filter(d => !d.isDeleted);
  if (filter.archived !== undefined) out = out.filter(d => d.isArchived === filter.archived);
  if (filter.folderId !== undefined) {
    out = filter.folderId === null
      ? out.filter(d => d.folderId === null)
      : out.filter(d => d.folderId === filter.folderId);
  }
  if (filter.status) out = out.filter(d => d.status === filter.status);
  if (filter.starred !== undefined) out = out.filter(d => d.isStarred === filter.starred);
  if (filter.category) out = out.filter(d => d.documentType === filter.category);
  if (filter.query) out = out.filter(d => matchesQuery(d, filter.query!));
  return out;
}
