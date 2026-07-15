/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'Admin' | 'Manager' | 'Staff' | 'Viewer' | 'Auditor';

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  department: string;
  isActive: boolean;
  institutionId?: string; // which institution profile this user belongs to
}

// How a document category maps to a human-friendly folder name.
export type CategoryFolderMap = Record<Document['documentType'], string>;

// Optional third dimension in the auto-filing taxonomy.
// 'none' => Unit/Category. 'ai-activity' => Unit/Category/<AI-extracted activity>.
export type ActivityDimension = 'none' | 'ai-activity';

// An institution's profile drives the automatic folder taxonomy and labels.
export interface Institution {
  id: string;
  name: string;
  units: string[];                 // unit/department names this institution uses
  categoryFolders: CategoryFolderMap;
  activityDimension: ActivityDimension;
}

export interface Department {
  id: string;
  name: string;
  description: string;
}

export interface Folder {
  id: string;
  name: string;
  parentFolderId: string | null; // null represents Root
  ownerId: string;
  department?: string; // department scope, e.g., 'Finance'
  createdAt: string;
}

export type DocumentStatus = 'Draft' | 'Pending Approval' | 'Changes Requested' | 'Approved' | 'Rejected';
export type ConfidentialityLevel = 'Normal File' | 'Official Record' | 'Confidential' | 'Archive';

export interface Document {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  ownerName: string;
  department?: string;
  folderId: string | null; // null is 'root'
  documentType: 'Contract' | 'Invoice' | 'Memo' | 'Report' | 'Support' | 'Other';
  status: DocumentStatus;
  confidentialityLevel: ConfidentialityLevel;
  currentVersion: string; // e.g. "v1", "v2"
  isStarred: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  tags: string[];
  ocrText?: string; // AI extracted OCR text
  fileName?: string; // latest version file name, added by API responses
  fileSize?: number; // latest version file size, added by API responses
  fileType?: string; // latest version MIME/extension, added by API responses
  createdAt: string;
  updatedAt: string;
  lastAuditedAt?: string;
  lastAuditedBy?: string;
  lastAuditedByName?: string;
  needsAudit?: boolean; // computed by the API: never audited, or modified since the last audit
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  fileName: string;
  fileSize: number; // in bytes
  fileType: string; // e.g. "pdf", "docx", "png", "txt"
  versionNumber: string; // e.g. "v1", "v2"
  uploadedBy: string; // userId
  uploadedByName: string; // userName
  fileData?: string; // Base64 data / plain text (legacy + local-dev fallback)
  storagePath?: string; // object path in Supabase Storage when offloaded
  createdAt: string;
}

export type PermissionType = 'Viewer' | 'Commenter' | 'Editor' | 'Approver';

export interface SharePermission {
  id: string;
  documentId: string;
  sharedWithUserId: string;
  permissionType: PermissionType;
  sharedById: string;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  documentId: string;
  requestedBy: string; // userId
  requestedByName: string;
  approverId: string; // userId
  approverName: string;
  status: DocumentStatus;
  requestComment: string;
  approvalComment: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  action: string; // e.g., "Upload", "Preview", "Download", "Rename", "Move", "Share", "Approve", "Delete", "Restore"
  documentId?: string;
  documentTitle?: string;
  details: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  documentId: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  text: string;
  createdAt: string;
}

export interface ExternalShareLink {
  id: string;
  documentId: string;
  token: string;
  shortCode?: string;       // short, shareable code served at /s/<code>
  createdBy: string;
  permissionType: 'Viewer' | 'Commenter';
  expiresAt: string;
  isActive: boolean;
  accessCount: number;
  password?: string;        // server-only; never returned to clients
  hasPassword?: boolean;    // client-facing flag (whether a password is set)
  label?: string;
  createdAt: string;
  // WeTransfer-style sharing fields
  fileName: string;
  fileSize: number;
  fileType: string;
  downloadCount: number;
  maxDownloads?: number | null;
  message?: string;
  allowDownload: boolean;
  requiresPassword: boolean;
  passwordHash?: string;
}

export interface DashboardStats {
  totalFiles: number;
  totalSize: number; // bytes
  approvedCount: number;
  pendingMyApprovalCount: number;
  totalUsers: number;
  recentUploadsCount: number;
  needsAuditCount: number; // 0 for roles that cannot audit (Manager/Admin/Auditor only)
}
