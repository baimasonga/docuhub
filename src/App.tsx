/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Folder, 
  FolderPlus, 
  File, 
  FileText, 
  Upload, 
  Search, 
  Star, 
  CheckSquare, 
  Archive, 
  Trash2, 
  Plus, 
  MoreVertical, 
  Download, 
  Eye, 
  Share2, 
  Clock, 
  TrendingUp, 
  Database, 
  CheckCircle2, 
  AlertCircle, 
  Users, 
  Building2, 
  History, 
  Lock, 
  ChevronRight, 
  CornerDownRight, 
  X, 
  Check, 
  ArrowRight,
  RefreshCw,
  Sparkles,
  Link2,
  FileSpreadsheet,
  FileCode,
  Image,
  Send,
  UserCheck,
  Calendar,
  AlertTriangle,
  Copy,
  Pencil,
  LogOut,
  KeyRound,
  Camera,
  Menu,
  UserPlus,
  PenTool,
  ShieldCheck
} from 'lucide-react';
import { 
  User, 
  Folder as FolderType, 
  Document, 
  DocumentVersion, 
  SharePermission, 
  ApprovalRequest, 
  ActivityLog, 
  Comment,
  ExternalShareLink,
  DashboardStats,
  Institution
} from './types';
import Sidebar from './components/Sidebar';
import { LoginScreen, ResetPasswordScreen, ChangePasswordModal } from './components/Auth';
const PdfEditor = React.lazy(() => import('./components/PdfEditor'));
const WordPreview = React.lazy(() => import('./components/WordPreview'));

// Word documents (.doc/.docx) can't be rendered by the browser the way
// images/PDF/text can, so the preview modal routes them to WordPreview
// instead of the generic iframe.
function isWordDoc(fileType?: string, fileName?: string): boolean {
  const t = `${fileType || ''} ${fileName || ''}`.toLowerCase();
  return t.includes('word') || t.includes('docx') || t.includes('officedocument.word') || /\.docx?\b/.test(t);
}

// Map a stored fileType to a MIME type so downloads open correctly
// (e.g. images don't get mislabelled as text/plain).
function mimeForType(fileType?: string): string {
  const t = (fileType || '').toLowerCase();
  if (t.includes('png')) return 'image/png';
  if (t.includes('jpg') || t.includes('jpeg')) return 'image/jpeg';
  if (t.includes('gif')) return 'image/gif';
  if (t.includes('pdf')) return 'application/pdf';
  return 'text/plain';
}

// Stored payloads are base64 for uploads but raw text for seed data. Build a
// data: URL that is correct for whichever encoding a version actually uses.
function looksLikeBase64(s: string): boolean {
  const compact = s.replace(/\s/g, '');
  return compact.length > 0 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

function downloadHref(fileData: string | undefined, fileType?: string): string {
  const mime = mimeForType(fileType);
  const data = fileData || '';
  return looksLikeBase64(data)
    ? `data:${mime};base64,${data}`
    : `data:${mime};charset=utf-8,${encodeURIComponent(data)}`;
}

function getFileFormatInfo(fileType: string, docType?: string, fileName?: string): { label: string; bg: string; text: string; Icon: React.ElementType } {
  const t = `${fileType || ''} ${fileName || ''}`.toLowerCase();
  const d = (docType || '').toLowerCase();

  if (t.includes('pdf')) return { label: 'PDF', bg: 'bg-red-50', text: 'text-red-600', Icon: FileText };
  if (t.includes('word') || t.includes('docx') || t.includes('officedocument.word') || t === 'doc')
    return { label: 'DOC', bg: 'bg-blue-50', text: 'text-blue-600', Icon: FileText };
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('xlsx') || t.includes('xls') || t.includes('csv') || d.includes('invoice'))
    return { label: 'XLS', bg: 'bg-emerald-50', text: 'text-emerald-600', Icon: FileSpreadsheet };
  if (t.includes('png') || t.includes('jpg') || t.includes('jpeg') || t.includes('gif') || t.includes('webp') || t.startsWith('image/'))
    return { label: 'IMG', bg: 'bg-violet-50', text: 'text-violet-600', Icon: Image };
  if (t.includes('zip') || t.includes('rar') || t.includes('tar') || t.includes('7z'))
    return { label: 'ZIP', bg: 'bg-amber-50', text: 'text-amber-600', Icon: File };
  if (t.includes('json') || t.includes('xml') || t.includes('html') || t.includes('javascript') || t.includes('typescript'))
    return { label: 'CODE', bg: 'bg-orange-50', text: 'text-orange-600', Icon: FileCode };
  if (t.includes('.log') || t.includes('x-log'))
    return { label: 'LOG', bg: 'bg-cyan-50', text: 'text-cyan-600', Icon: FileText };
  if (t.includes('text') || t.includes('txt') || t.includes('plain') || t.includes('.md') || t.includes('.rtf'))
    return { label: 'TXT', bg: 'bg-slate-100', text: 'text-slate-500', Icon: FileText };
  return { label: 'FILE', bg: 'bg-slate-100', text: 'text-slate-500', Icon: File };
}

// Icon + color shown next to each entry in a document's File History feed.
function getActivityIconInfo(action: string): { Icon: React.ElementType; text: string } {
  const a = action.toLowerCase();
  if (a.includes('upload')) return { Icon: Upload, text: 'text-indigo-500' };
  if (a.includes('download')) return { Icon: Download, text: 'text-sky-500' };
  if (a.includes('rename')) return { Icon: Pencil, text: 'text-slate-500' };
  if (a.includes('move')) return { Icon: CornerDownRight, text: 'text-amber-500' };
  if (a.includes('share') || a.includes('link')) return { Icon: Share2, text: 'text-violet-500' };
  if (a.includes('comment')) return { Icon: Send, text: 'text-slate-500' };
  if (a.includes('approv') && !a.includes('reject')) return { Icon: CheckSquare, text: 'text-emerald-500' };
  if (a.includes('reject')) return { Icon: X, text: 'text-rose-500' };
  if (a.includes('archive')) return { Icon: Archive, text: 'text-amber-600' };
  if (a.includes('purge') || a.includes('delete')) return { Icon: Trash2, text: 'text-rose-500' };
  if (a.includes('restore')) return { Icon: RefreshCw, text: 'text-emerald-500' };
  if (a.includes('copy')) return { Icon: Copy, text: 'text-slate-500' };
  if (a.includes('login') || a.includes('logout')) return { Icon: UserCheck, text: 'text-slate-400' };
  return { Icon: History, text: 'text-slate-400' };
}

function FileFormatBadge({ fileType, docType, fileName, size = 'sm' }: { fileType?: string; docType?: string; fileName?: string; size?: 'sm' | 'md' | 'lg' }) {
  const { label, bg, text, Icon } = getFileFormatInfo(fileType || '', docType, fileName);
  const iconSize = size === 'lg' ? 'w-5 h-5' : size === 'md' ? 'w-4.5 h-4.5' : 'w-4 h-4';
  const pad = size === 'lg' ? 'p-2.5' : 'p-2';
  return (
    <div className={`relative ${pad} ${bg} ${text} rounded-lg shrink-0`}>
      <Icon className={iconSize} />
      <span className={`absolute -bottom-1.5 -right-1.5 text-[6px] font-black px-[3px] py-px rounded-sm leading-none ${bg} ${text} border border-white shadow-sm whitespace-nowrap`}>
        {label}
      </span>
    </div>
  );
}

export default function App() {
  // Global Workspace state
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  // Auth/session state
  const [authReady, setAuthReady] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  // Inline document preview modal ({id,title,fileType} of the doc being viewed)
  const [previewDoc, setPreviewDoc] = useState<{ id: string; title: string; fileType?: string; fileName?: string } | null>(null);
  // Sign & Edit PDF modal target (reuses previewDoc's id/title while open)
  const [editingPdfDoc, setEditingPdfDoc] = useState<{ id: string; title: string } | null>(null);
  // Mobile: sidebar drawer visibility
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [folders, setFolders] = useState<FolderType[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<(ApprovalRequest & {
    documentTitle: string;
    documentOwner: string;
    documentType: string;
    documentDepartment?: string;
    fileName?: string;
    fileType?: string;
  })[]>([]);
  const [currentView, setCurrentView] = useState<string>('dashboard');
  
  // Navigation
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  
  // Selected single document details and sub-state
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [docDetail, setDocDetail] = useState<{
    document: Document;
    versions: DocumentVersion[];
    comments: Comment[];
    approvals: ApprovalRequest[];
    permissions: SharePermission[];
    externalLinks: ExternalShareLink[];
    activity: ActivityLog[];
  } | null>(null);
  const [showFileHistory, setShowFileHistory] = useState(false);

  // Modals visibility triggers
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);

  // Active inputs / fields state
  const [newCommentText, setNewCommentText] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const folderUploadInputRef = useRef<HTMLInputElement | null>(null);
  const quickFileUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [bulkUploadStatus, setBulkUploadStatus] = useState<{ total: number; done: number } | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [notification, setNotification] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);
  
  // Upload wizard inputs
  const [upTitle, setUpTitle] = useState('');
  const [upDesc, setUpDesc] = useState('');
  const [upCategory, setUpCategory] = useState<Document['documentType']>('Other');
  // content = inline base64 (small files); storagePath = already uploaded
  // straight to object storage via a signed URL (large files).
  const [upCustomFile, setUpCustomFile] = useState<{ name: string; content?: string; storagePath?: string; size: number; type: string } | null>(null);
  const [upDept, setUpDept] = useState('');
  const [upAutoFile, setUpAutoFile] = useState(true);
  const [uploadScan, setUploadScan] = useState<{
    documentType: Document['documentType'];
    description: string;
    tags: string[];
    activity?: string;
    filedInto: string;
    cabinetExists: boolean;
    missingCabinets: string[];
  } | null>(null);
  const [uploadScanLoading, setUploadScanLoading] = useState(false);

  // Institution profile that drives automatic folder filing (Unit -> Category
  // [-> Activity]).
  const [orgProfile, setOrgProfile] = useState<{
    id: string;
    name: string;
    units: string[];
    categoryFolders: Record<string, string>;
    activityDimension: 'none' | 'ai-activity';
  } | null>(null);

  // Folder creation inputs
  const [folderName, setFolderName] = useState('');
  const [folderScopeDept, setFolderScopeDept] = useState('');

  // Sharing inputs
  const [shareTargetUserId, setShareTargetUserId] = useState('');
  const [sharePermissionType, setSharePermissionType] = useState<SharePermission['permissionType']>('Viewer');

  // Approval Request inputs
  const [approvalApproverId, setApprovalApproverId] = useState('');
  const [approvalRequestComment, setApprovalRequestComment] = useState('');

  // Move targets
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string>('root');

  // Decision fields (Approve/Reject/Action)
  const [decisionApprovalId, setDecisionApprovalId] = useState<string | null>(null);
  const [decisionComment, setDecisionComment] = useState('');

  // Google-Drive-style multi-selection + per-row action menu.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Which documents a Move action applies to (single row or a bulk selection).
  const [moveIds, setMoveIds] = useState<string[]>([]);

  // Unified "Share link" modal state (Dropbox shareable link + WeTransfer-style
  // options: message, view-only, download limit, password, expiry).
  const [linkModalDocId, setLinkModalDocId] = useState<string | null>(null);
  const [linkExpiry, setLinkExpiry] = useState<string>('7'); // days, or 'never'
  const [linkPassword, setLinkPassword] = useState<string>('');
  const [linkPermission, setLinkPermission] = useState<'Viewer' | 'Commenter'>('Viewer');
  const [linkMessage, setLinkMessage] = useState<string>('');
  const [linkAllowDownload, setLinkAllowDownload] = useState<boolean>(true);
  const [linkMaxDownloads, setLinkMaxDownloads] = useState<string>('');
  const [createdLink, setCreatedLink] = useState<ExternalShareLink | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);

  // Identity is carried by an HttpOnly session cookie. On mount, restore any
  // existing session; otherwise the login screen is shown. The users list
  // (share/approver pickers, user management) loads once authenticated.
  useEffect(() => {
    fetch('/api/session')
      .then(res => res.json())
      .then(session => {
        if (session && session.user) {
          setCurrentUser(session.user);
          setMustChangePassword(Boolean(session.mustChangePassword));
        }
      })
      .catch(err => console.error('[bootstrap] session restore failed:', err))
      .finally(() => setAuthReady(true));
  }, []);

  // Captured once at mount (not re-derived on every render) so it survives
  // the URL cleanup below without racing it. /api/auth/oauth/:provider/callback
  // redirects here with ?oauthError=... on any failure (cancelled, no
  // matching account, etc.) since it's a full-page redirect, not a fetch
  // call the login screen could catch a JSON error from directly.
  const [oauthError] = useState<string>(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('oauthError') || '' : ''
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).has('oauthError')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) { setUsers([]); return; }
    fetch('/api/users')
      .then(res => res.json())
      .then((data: User[]) => { if (Array.isArray(data)) setUsers(data); })
      .catch(err => console.error('[bootstrap] failed to load users:', err));
  }, [currentUser?.id]);

  // Sync Documents / Folders / Stats on user switch or action reload
  const reloadData = () => {
    if (!currentUser) return;
    
    // Header authentications passed to fetch scopes
    const headers = {
    };

    // Calculate filter type parameters based on view name
    let filterType = 'active';
    if (currentView === 'trash') filterType = 'trash';
    if (currentView === 'archive') filterType = 'archive';
    if (currentView === 'shared-with-me') filterType = 'shared';
    if (currentView === 'needs-audit') filterType = 'needs-audit';

    // Approvals queue is fetched from a dedicated endpoint
    if (currentView === 'pending-approval') {
      fetch('/api/approvals/mine', { headers })
        .then(res => res.json())
        .then(data => setPendingApprovals(Array.isArray(data) ? data : []));
    }

    // 1. Fetch Stats
    fetch('/api/stats', { headers })
      .then(res => res.json())
      .then(data => setStats(data));

    // 2. Fetch Folders
    fetch('/api/folders', { headers })
      .then(res => res.json())
      .then(data => setFolders(Array.isArray(data) ? data : []));

    // 3. Fetch Documents
    let docsUrl = `/api/documents?filterType=${filterType}`;
    if (currentFolderId && currentView === 'my-drive') {
      docsUrl += `&folderId=${currentFolderId}`;
    } else if (currentView === 'my-drive') {
      docsUrl += `&folderId=root`;
    }
    if (currentView === 'starred') {
      docsUrl += `&starred=true`;
    }
    if (currentView === 'approved-files') {
      docsUrl += `&status=Approved`;
    }
    
    // Search query trigger
    if (searchQuery) {
      docsUrl += `&query=${encodeURIComponent(searchQuery)}`;
    }
    if (categoryFilter) {
      docsUrl += `&category=${categoryFilter}`;
    }

    fetch(docsUrl, { headers })
      .then(res => res.json())
      .then(data => {
        setDocuments(Array.isArray(data) ? data : []);
      });

    // If a document detail is open, sync that too
    if (selectedDocId) {
      fetchDocDetail(selectedDocId);
    }
  };

  useEffect(() => {
    reloadData();
  }, [currentUser, currentView, currentFolderId, searchQuery, categoryFilter, selectedDocId]);

  // Collapse the File History panel whenever a different document is opened.
  useEffect(() => { setShowFileHistory(false); }, [selectedDocId]);

  // Reset selection + any open row menu when navigating between views/folders.
  useEffect(() => {
    setSelectedIds(new Set());
    setOpenMenuId(null);
  }, [currentView, currentFolderId]);

  // Load the institution profile once authenticated (drives auto-filing UI).
  useEffect(() => {
    if (!currentUser) return;
    fetch('/api/institution')
      .then(res => res.json())
      .then(data => {
        if (data && data.categoryFolders) setOrgProfile(data);
      })
      .catch(() => {});
  }, [currentUser]);

  // Compute the folder path a document would be auto-filed into.
  const autoFilePreview = (): string => {
    const unit = (upDept || currentUser?.department || 'Unassigned Unit').trim() || 'Unassigned Unit';
    const category = orgProfile?.categoryFolders?.[upCategory] || upCategory;
    const base = `${unit} / ${category}`;
    return orgProfile?.activityDimension === 'ai-activity' ? `${base} / …activity (auto)` : base;
  };

  // Fetch single doc detail
  const fetchDocDetail = (id: string) => {
    fetch(`/api/documents/${id}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          triggerToast(data.error, 'error');
          setSelectedDocId(null);
          setDocDetail(null);
        } else {
          setDocDetail(data);
        }
      });
  };

  const triggerToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setNotification({ text, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // Called by the login screen after a successful /api/auth/login.
  const handleLoginSuccess = (user: User, mustChange: boolean) => {
    setCurrentUser(user);
    setMustChangePassword(mustChange);
    setSelectedDocId(null);
    setDocDetail(null);
    setCurrentView('dashboard');
    setCurrentFolderId(null);
    setSearchQuery('');
    setCategoryFilter('');
    triggerToast(`Signed in as ${user.fullName} (${user.role})`, 'success');
  };

  const handleLogout = () => {
    fetch('/api/auth/logout', { method: 'POST' })
      .catch(() => {})
      .finally(() => {
        setCurrentUser(null);
        setMustChangePassword(false);
        setAccountMenuOpen(false);
        setSelectedDocId(null);
        setDocDetail(null);
        setDocuments([]);
        setFolders([]);
        setStats(null);
        setCurrentView('dashboard');
      });
  };

  // Create Folder action
  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    const trimmedName = folderName.trim();
    if (!trimmedName) {
      triggerToast('Folder name is required.', 'error');
      return;
    }

    fetch('/api/folders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: trimmedName,
        parentFolderId: currentFolderId,
        department: folderScopeDept.trim() || currentUser.department
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        triggerToast(data.error, 'error');
      } else {
        setFolderName('');
        setFolderScopeDept('');
        setShowFolderModal(false);
        setCurrentView('my-drive');
        setCurrentFolderId(data.id);
        triggerToast(`Cabinet "${data.name}" created successfully!`, 'success');
        reloadData();
      }
    })
    .catch(() => triggerToast('Could not create cabinet. Please try again.', 'error'));
  };

  const handleDeleteFolder = (folder: FolderType, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) return;

    const childFolderCount = folders.filter(f => f.parentFolderId === folder.id).length;
    const message = childFolderCount > 0
      ? `Delete "${folder.name}" and its subfolders? Contained files will be moved to Trash.`
      : `Delete "${folder.name}"? Contained files will be moved to Trash.`;
    if (!window.confirm(message)) return;

    fetch(`/api/folders/${folder.id}`, {
      method: 'DELETE'
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          triggerToast(
            data.trashedDocumentCount > 0
              ? `Folder deleted. ${data.trashedDocumentCount} file(s) moved to Trash.`
              : 'Folder deleted.',
            'success'
          );
          if (currentFolderId === folder.id) setCurrentFolderId(folder.parentFolderId);
          reloadData();
        } else {
          triggerToast(data.error || 'Could not delete folder.', 'error');
        }
      })
      .catch(() => triggerToast('Could not delete folder.', 'error'));
  };

  const scanUploadCandidate = async (candidate: { fileName: string; fileType: string; fileData?: string; storagePath?: string; fileSize?: number; department?: string }) => {
    if (!currentUser) return;
    setUploadScanLoading(true);
    setUploadScan(null);
    try {
      const res = await fetch('/api/documents/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: candidate.fileName,
          fileType: candidate.fileType,
          fileData: candidate.fileData,
          storagePath: candidate.storagePath,
          fileSize: candidate.fileSize,
          department: candidate.department || upDept || currentUser.department
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Could not scan selected document.');
      setUploadScan(data);
      setUpCategory(data.documentType || 'Other');
      if (data.description) setUpDesc(data.description);
    } catch (err: any) {
      setUploadScan(null);
      triggerToast(err?.message || 'Could not scan selected document.', 'error');
    } finally {
      setUploadScanLoading(false);
    }
  };

  // Upload trigger
  const handleDocUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    let filename = "";
    let filedata: string | undefined;
    let storagepath: string | undefined;
    let size = 0;
    let type = "text/plain";

    if (upCustomFile) {
      filename = upCustomFile.name;
      filedata = upCustomFile.content; // base64 (small files)
      storagepath = upCustomFile.storagePath; // direct-uploaded (large files)
      size = upCustomFile.size;
      type = upCustomFile.type;
    } else {
      triggerToast('Please choose a file to upload.', 'error');
      return;
    }

    setUploadProgress(15);
    const interval = setInterval(() => {
      setUploadProgress(p => p !== null && p < 90 ? p + 25 : p);
    }, 300);

    fetch('/api/documents/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: upTitle,
        description: upDesc,
        folderId: currentFolderId,
        documentType: uploadScan?.documentType || upCategory,
        categoryMode: 'auto',
        fileName: filename,
        fileSize: size,
        fileType: type,
        fileData: filedata,
        storagePath: storagepath,
        department: upDept || currentUser.department,
        autoFile: upAutoFile
      })
    })
    .then(async (res) => {
      clearInterval(interval);
      setUploadProgress(100);
      const data = await res.json();
      setTimeout(() => setUploadProgress(null), 500);

      if (data.error) {
        triggerToast(data.error, 'error');
      } else {
        const msg = data.filedInto
          ? `"${data.document.title}" indexed and auto-filed into ${data.filedInto}.`
          : `"${data.document.title}" indexed with AI tags.`;
        triggerToast(msg, 'success');
        setShowUploadModal(false);
        // reset fields
        setUpTitle('');
        setUpDesc('');
        setUpCustomFile(null);
        setUploadScan(null);
        setUpAutoFile(true);
        reloadData();
      }
    })
    .catch(err => {
      clearInterval(interval);
      setUploadProgress(null);
      triggerToast('Cloud storage route connection timed out.', 'error');
    });
  };

  const readFileAsBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const resultStr = reader.result as string;
      resolve(resultStr.split(',')[1] || '');
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });

  // Files above this size go straight to object storage via a signed URL
  // (no base64 JSON round-trip); small files keep the simpler inline path.
  const DIRECT_UPLOAD_THRESHOLD = 2.5 * 1024 * 1024;

  // Returns either { storagePath } (bytes already in storage) or { fileData }.
  const prepareFilePayload = async (file: File): Promise<{ fileData?: string; storagePath?: string }> => {
    if (file.size > DIRECT_UPLOAD_THRESHOLD) {
      try {
        const sign = await fetch('/api/uploads/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, fileType: detectFileType(file) })
        }).then(r => r.json());
        if (sign.enabled && sign.uploadUrl) {
          const put = await fetch(sign.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file
          });
          if (put.ok) return { storagePath: sign.objectPath };
          console.error('[upload] direct PUT failed:', put.status);
        }
      } catch (err) {
        console.error('[upload] signed upload failed; falling back to inline:', err);
      }
    }
    return { fileData: await readFileAsBase64(file) };
  };

  const detectFileType = (file: File): string => {
    if (file.type) return file.type;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const fallbackTypes: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      csv: 'text/csv',
      txt: 'text/plain',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      zip: 'application/zip'
    };
    return (ext && fallbackTypes[ext]) || 'application/octet-stream';
  };

  const setSelectedUploadFile = async (file: File) => {
    const payload = await prepareFilePayload(file);
    setUpCustomFile({
      name: file.name,
      size: file.size,
      type: detectFileType(file),
      content: payload.fileData,
      storagePath: payload.storagePath
    });
    setUpTitle(file.name.replace(/\.[^/.]+$/, ""));
    setUpDesc('');
    setUpCategory('Other');
    await scanUploadCandidate({
      fileName: file.name,
      fileType: detectFileType(file),
      fileData: payload.fileData,
      storagePath: payload.storagePath,
      fileSize: file.size,
      department: upDept || currentUser?.department
    });
  };

  // Upload file custom handler
  const handleCustomFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedUploadFile(file).catch(() => triggerToast('Could not read the selected file.', 'error'));
  };

  const handleQuickFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !currentUser) return;

    setUpDesc('');
    setUpCategory('Other');
    setUpDept(currentUser.department);
    setUpAutoFile(true);
    setSelectedUploadFile(file)
      .then(() => setShowUploadModal(true))
      .catch(() => triggerToast('Could not read the selected file.', 'error'));
  };

  const createFolderRequest = async (name: string, parentFolderId: string | null, department: string): Promise<FolderType> => {
    if (!currentUser) throw new Error('Not authenticated.');
    const res = await fetch('/api/folders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, parentFolderId, department })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Could not create folder.');
    return data;
  };

  const uploadFileRequest = async (file: File, folderId: string | null) => {
    if (!currentUser) throw new Error('Not authenticated.');
    const payload = await prepareFilePayload(file);
    const title = file.name.replace(/\.[^/.]+$/, '') || file.name;
    const res = await fetch('/api/documents/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description: `Uploaded from folder import: ${file.name}`,
        folderId,
        documentType: 'Other',
        fileName: file.name,
        fileSize: file.size,
        fileType: detectFileType(file),
        fileData: payload.fileData,
        storagePath: payload.storagePath,
        department: currentUser.department,
        autoFile: false
      })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Could not upload ${file.name}.`);
    return data;
  };

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files ?? []) as File[];
    e.target.value = '';
    if (!selectedFiles.length || !currentUser) return;

    setBulkUploading(true);
    setBulkUploadStatus({ total: selectedFiles.length, done: 0 });

    const knownFolders = new Map<string, FolderType>();
    folders.forEach(f => knownFolders.set(`${f.parentFolderId || 'root'}::${f.name.toLowerCase()}`, f));

    try {
      for (const file of selectedFiles) {
        const relativePath = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
        const pathParts = relativePath.split('/').filter(Boolean);
        const folderParts = pathParts.slice(0, -1);
        let parentId = currentFolderId;

        for (const part of folderParts) {
          const key = `${parentId || 'root'}::${part.toLowerCase()}`;
          let folder = knownFolders.get(key);
          if (!folder) {
            folder = await createFolderRequest(part, parentId, currentUser.department);
            knownFolders.set(key, folder);
          }
          parentId = folder.id;
        }

        await uploadFileRequest(file, parentId);
        setBulkUploadStatus(prev => prev ? { ...prev, done: prev.done + 1 } : prev);
      }

      triggerToast(`Uploaded ${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} with folder structure preserved.`, 'success');
      reloadData();
    } catch (err: any) {
      triggerToast(err?.message || 'Folder upload failed. Please try again.', 'error');
      reloadData();
    } finally {
      setBulkUploading(false);
      setBulkUploadStatus(null);
    }
  };

  // Versioning upload
  const handleNewVersionUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser || !selectedDocId) return;

    prepareFilePayload(file)
      .then(payload => fetch(`/api/documents/${selectedDocId}/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          fileType: detectFileType(file),
          fileData: payload.fileData,
          storagePath: payload.storagePath
        })
      }))
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          triggerToast(data.error, 'error');
        } else {
          triggerToast(`Successfully uploaded Version ${data.document.currentVersion}! OCR scanning re-indexed tags.`, 'success');
          fetchDocDetail(selectedDocId);
          reloadData();
        }
      })
      .catch(() => triggerToast('Version upload failed. Please try again.', 'error'));
  };

  // Manager/Admin/Auditor: mark the open document as formally audited.
  const handleAuditDocument = () => {
    if (!currentUser || !selectedDocId) return;
    fetch(`/api/documents/${selectedDocId}/audit`, { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          triggerToast(data.error, 'error');
        } else {
          triggerToast('Document marked as audited.', 'success');
          fetchDocDetail(selectedDocId);
          reloadData();
        }
      })
      .catch(() => triggerToast('Could not mark this document as audited.', 'error'));
  };

  // Direct comments action
  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !selectedDocId || !newCommentText.trim()) return;

    fetch('/api/comments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        documentId: selectedDocId,
        text: newCommentText
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        triggerToast(data.error, 'error');
      } else {
        setNewCommentText('');
        fetchDocDetail(selectedDocId);
      }
    });
  };

  // Toggle Starring
  const handleToggleStar = (docId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!currentUser) return;

    fetch(`/api/documents/${docId}/star`, {
      method: 'POST'
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        triggerToast(data.document.isStarred ? 'Added to important Starred records.' : 'Removed from Starred files.', 'success');
        reloadData();
      }
    });
  };

  // Move document modal triggers. Works for a single row or a bulk selection.
  const openMoveModal = (docIds: string[], e?: React.MouseEvent) => {
    e?.stopPropagation();
    setMoveIds(docIds);
    setMoveTargetFolderId('root');
    setShowMoveModal(true);
  };

  const handleMoveDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || moveIds.length === 0) return;

    const folderId = moveTargetFolderId === 'root' ? null : moveTargetFolderId;
    Promise.all(
      moveIds.map(id =>
        fetch(`/api/documents/${id}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderId })
        }).then(res => res.json())
      )
    ).then(results => {
      const firstError = results.find(r => r.error);
      if (firstError) {
        triggerToast(firstError.error, 'error');
      } else {
        triggerToast(moveIds.length > 1 ? `Moved ${moveIds.length} documents.` : 'Document layout paths updated cleanly!', 'success');
      }
      setShowMoveModal(false);
      clearSelection();
      reloadData();
    });
  };

  // ---- Google-Drive-style selection + file actions ----
  const clearSelection = () => { setSelectedIds(new Set()); setOpenMenuId(null); };

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allVisibleSelected = documents.length > 0 && documents.every(d => selectedIds.has(d.id));
  const toggleSelectAll = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(documents.map(d => d.id)));
  };

  const handleDownload = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    window.open(`/api/documents/${id}/download`, '_blank');
  };

  const handleMakeCopy = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    fetch(`/api/documents/${id}/copy`, { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.success) { triggerToast(`Created "${data.document.title}".`, 'success'); reloadData(); }
        else triggerToast(data.error || 'Could not copy document.', 'error');
      });
  };

  const handleRename = (id: string, currentTitle: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const title = window.prompt('Rename document', currentTitle);
    if (title == null) return;
    if (!title.trim() || title.trim() === currentTitle) return;
    fetch(`/api/documents/${id}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim() })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) { triggerToast('Document renamed.', 'success'); reloadData(); if (selectedDocId === id) fetchDocDetail(id); }
        else triggerToast(data.error || 'Rename failed.', 'error');
      });
  };

  // Bulk actions over the current selection.
  const runBulk = (fn: (id: string) => Promise<unknown>, doneMsg: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    Promise.all(ids.map(fn)).then(() => { triggerToast(doneMsg, 'success'); clearSelection(); reloadData(); });
  };
  const handleBulkDownload = () => { Array.from(selectedIds).forEach(id => window.open(`/api/documents/${id}/download`, '_blank')); };
  const handleBulkStar = () => runBulk(id => fetch(`/api/documents/${id}/star`, { method: 'POST' }), 'Updated starred files.');
  const handleBulkDelete = () => runBulk(id => fetch(`/api/documents/${id}/delete`, { method: 'POST' }), 'Moved selection to Trash.');
  const handleBulkRestore = () => runBulk(id => fetch(`/api/documents/${id}/restore`, { method: 'POST' }), 'Restored selection from Trash.');
  const handleBulkPurge = () => {
    if (!window.confirm(`Permanently delete ${selectedIds.size} item(s)? This cannot be undone.`)) return;
    runBulk(id => fetch(`/api/documents/${id}/permanently-delete`, { method: 'POST' }), 'Permanently purged selection.');
  };

  // ---- Dropbox-style "Get link" modal ----
  const openLinkModal = (docId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setOpenMenuId(null);
    setLinkModalDocId(docId);
    setLinkExpiry('7');
    setLinkPassword('');
    setLinkPermission('Viewer');
    setLinkMessage('');
    setLinkAllowDownload(true);
    setLinkMaxDownloads('');
    setCreatedLink(null);
  };

  const handleCreateShareLink = () => {
    if (!linkModalDocId) return;
    setLinkLoading(true);
    const pw = linkPassword.trim();
    fetch(`/api/documents/${linkModalDocId}/external-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expiresInDays: linkExpiry === 'never' ? null : Number(linkExpiry),
        password: pw || undefined,
        requiresPassword: Boolean(pw),
        permissionType: linkPermission,
        allowDownload: linkAllowDownload,
        maxDownloads: linkMaxDownloads.trim() ? Number(linkMaxDownloads) : null,
        message: linkMessage.trim() || undefined
      })
    })
      .then(res => res.json())
      .then(data => {
        setLinkLoading(false);
        if (data.success) { setCreatedLink(data.link); triggerToast('Share link ready.', 'success'); }
        else triggerToast(data.error || 'Could not create link.', 'error');
      })
      .catch(() => { setLinkLoading(false); triggerToast('Could not create link.', 'error'); });
  };

  const shortLinkUrl = (code?: string) => `${window.location.origin}/s/${code || ''}`;
  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text)
      .then(() => triggerToast('Link copied to clipboard.', 'success'))
      .catch(() => triggerToast('Copy failed — select and copy manually.', 'info'));
  };

  // Soft delete (Trash bin)
  const handleDeleteDocument = (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) return;

    fetch(`/api/documents/${docId}/delete`, {
      method: 'POST'
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        triggerToast('Document moved to trash successfully.', 'success');
        if (selectedDocId === docId) setSelectedDocId(null);
        reloadData();
      }
    });
  };

  // Restore document from trash bin
  const handleRestoreDocument = (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) return;

    fetch(`/api/documents/${docId}/restore`, {
      method: 'POST'
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        triggerToast('Document restored safely.', 'success');
        reloadData();
      }
    });
  };

  // Purge document permanently
  const handlePurgeDocument = (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) return;

    if (!confirm('Are you absolutely sure you want to permanently delete this document and all historical versions? This audit audit record removal is irreversible.')) {
      return;
    }

    fetch(`/api/documents/${docId}/permanently-delete`, {
      method: 'POST'
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        triggerToast('Document and history metadata purged.', 'success');
        reloadData();
      }
    });
  };

  // Archive document trigger
  const handleArchiveDocument = (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) return;

    fetch(`/api/documents/${docId}/archive`, {
      method: 'POST'
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        triggerToast(data.document.isArchived ? 'Moved to Archive database.' : 'Removed from Archive folder.', 'success');
        reloadData();
      }
    });
  };

  // Request Approval dispatch
  const handleRequestApproval = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !selectedDocId) return;

    fetch(`/api/documents/${selectedDocId}/request-approval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        approverId: approvalApproverId,
        comment: approvalRequestComment
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        triggerToast(data.error, 'error');
      } else {
        triggerToast('Approval workflow initialized cleanly!', 'success');
        setShowApprovalModal(false);
        setApprovalRequestComment('');
        fetchDocDetail(selectedDocId);
        reloadData();
      }
    });
  };

  // Submit decision on approval workflow. The approval id is passed explicitly
  // so the action does not depend on async state having settled.
  const handleApprovalDecision = (
    status: 'Approved' | 'Changes Requested' | 'Rejected',
    approvalId?: string
  ) => {
    const targetId = approvalId || decisionApprovalId;
    if (!currentUser || !targetId) return;

    fetch(`/api/approvals/${targetId}/decide`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status,
        comment: decisionComment
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        triggerToast(data.error, 'error');
      } else {
        triggerToast(`Document reviewed as ${status}! Status applied.`, 'success');
        setDecisionApprovalId(null);
        setDecisionComment('');
        fetchDocDetail(selectedDocId || '');
        reloadData();
      }
    });
  };

  // Open Sharing dialog
  const openShareModal = (docId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedDocId(docId);
    setShareTargetUserId('');
    setSharePermissionType('Viewer');
    setShowShareModal(true);
  };

  const handleShareDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !selectedDocId || !shareTargetUserId) return;

    fetch(`/api/documents/${selectedDocId}/share`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        targetUserId: shareTargetUserId,
        permissionType: sharePermissionType
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        triggerToast(data.error, 'error');
      } else {
        triggerToast('Permissions sharing matrices successfully adjusted!', 'success');
        setShowShareModal(false);
        fetchDocDetail(selectedDocId);
      }
    });
  };

  // Revoke secure link token
  const handleRevokeExternalLink = (token: string) => {
    if (!currentUser) return;
    fetch(`/api/external-link/${token}/revoke`, {
      method: 'POST'
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        triggerToast('External static link token revoked.', 'success');
        if (selectedDocId) fetchDocDetail(selectedDocId);
      }
    });
  };

  // Utility calculations for breadcrumb navigation
  const getBreadcrumbs = () => {
    const list = [{ id: 'root', name: 'Folder Cabinets' }];
    if (!currentFolderId) return list;

    let targetFolder = folders.find(f => f.id === currentFolderId);
    const pathList = [];
    
    while (targetFolder) {
      pathList.unshift({ id: targetFolder.id, name: targetFolder.name });
      const parentId = targetFolder.parentFolderId;
      targetFolder = parentId ? folders.find(f => f.id === parentId) : undefined;
    }

    return [...list, ...pathList];
  };

  // Count approvals awaiting current manager review
  const pendingApprovalsCount = stats?.pendingMyApprovalCount || 0;

  const selectedDocs = documents.filter(doc => selectedIds.has(doc.id));
  const singleSelectedDoc = selectedDocs.length === 1 ? selectedDocs[0] : null;
  const selectionMenuOpen = openMenuId === '__selection-toolbar';

  // ---- Auth gates (all hooks are declared above; safe to return early) ----
  const resetToken = typeof window !== 'undefined' && window.location.pathname === '/reset-password'
    ? new URLSearchParams(window.location.search).get('token') || ''
    : '';
  if (resetToken) {
    return <ResetPasswordScreen token={resetToken} onDone={() => { window.location.href = '/'; }} />;
  }
  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
      </div>
    );
  }
  if (!currentUser) {
    return <LoginScreen onLogin={handleLoginSuccess} initialError={oauthError} />;
  }

  return (
    <div className="flex h-screen bg-[#F8FAFC] font-sans text-slate-800 overflow-hidden">
      
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center space-x-2.5 px-4 py-3 bg-white/95 backdrop-blur-sm shadow-xl rounded-xl border border-slate-100 scale-100 transition-all">
          {notification.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
          {notification.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />}
          {notification.type === 'info' && <Sparkles className="w-4 h-4 text-indigo-500 shrink-0" />}
          <span className="text-xs font-semibold text-slate-700">{notification.text}</span>
        </div>
      )}

      {/* Forced (first login) or user-initiated password change */}
      {(mustChangePassword || showChangePassword) && (
        <ChangePasswordModal
          forced={mustChangePassword}
          hasPassword={true}
          onClose={() => setShowChangePassword(false)}
          onChanged={() => {
            setMustChangePassword(false);
            setShowChangePassword(false);
            triggerToast('Password updated.', 'success');
          }}
        />
      )}

      {/* Inline document preview (image / PDF / text) */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4" onClick={() => setPreviewDoc(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div className="flex items-center space-x-2 min-w-0">
                <Eye className="w-4 h-4 text-indigo-500 shrink-0" />
                <span className="text-xs font-bold text-slate-700 truncate">{previewDoc.title}</span>
              </div>
              <div className="flex items-center space-x-2">
                {currentUser?.role !== 'Viewer' && (previewDoc.fileType || '').toLowerCase().includes('pdf') && (
                  <button
                    onClick={() => setEditingPdfDoc({ id: previewDoc.id, title: previewDoc.title })}
                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 rounded-lg text-[10px] font-bold text-indigo-600 flex items-center space-x-1">
                    <PenTool className="w-3 h-3" /><span>Sign &amp; Edit</span>
                  </button>
                )}
                <a href={`/api/documents/${previewDoc.id}/download`} target="_blank" rel="noreferrer"
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-600 flex items-center space-x-1">
                  <Download className="w-3 h-3" /><span>Download</span>
                </a>
                <button onClick={() => setPreviewDoc(null)}
                  className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-500">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {isWordDoc(previewDoc.fileType, previewDoc.fileName) ? (
              <React.Suspense fallback={
                <div className="flex-1 w-full bg-slate-50 flex items-center justify-center text-slate-400 text-xs">Loading previewer…</div>
              }>
                <WordPreview documentId={previewDoc.id} fileName={previewDoc.fileName} />
              </React.Suspense>
            ) : (
              <iframe
                title={`Preview: ${previewDoc.title}`}
                src={`/api/documents/${previewDoc.id}/preview`}
                className="flex-1 w-full bg-slate-50"
              />
            )}
          </div>
        </div>
      )}

      {editingPdfDoc && (
        <React.Suspense fallback={
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 backdrop-blur-xs">
            <div className="flex flex-col items-center text-white">
              <RefreshCw className="w-6 h-6 animate-spin mb-2" />
              <span className="text-xs font-semibold">Loading editor…</span>
            </div>
          </div>
        }>
          <PdfEditor
            documentId={editingPdfDoc.id}
            title={editingPdfDoc.title}
            onClose={() => setEditingPdfDoc(null)}
            onSaved={() => {
              if (selectedDocId) fetchDocDetail(selectedDocId);
              reloadData();
              setPreviewDoc(null);
            }}
            triggerToast={triggerToast}
          />
        </React.Suspense>
      )}

      {/* Background Dim Loader for OCR tasks */}
      {uploadProgress !== null && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white p-7 rounded-2xl shadow-2xl max-w-sm w-full mx-4 text-center">
            <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-4 animate-spin text-indigo-600">
              <RefreshCw className="w-6 h-6" />
            </div>
            <h3 className="font-display font-bold text-slate-800 mb-1">Analyzing scan stream...</h3>
            <p className="text-xs text-slate-400 mb-4">Gemini 2.5 Flash is performing OCR & tag indexing.</p>
            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div className="bg-indigo-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
            </div>
            <span className="text-[10px] font-mono text-slate-400 mt-2 block">{uploadProgress}% Indexed</span>
          </div>
        </div>
      )}

      {/* Main Workspace Sidebar — static on desktop, slide-over drawer on mobile */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 md:hidden" onClick={() => setMobileNavOpen(false)} />
      )}
      <div className={`${mobileNavOpen ? 'fixed inset-y-0 left-0 z-50 shadow-2xl' : 'hidden'} md:static md:block md:z-auto md:shadow-none h-full`}>
        <Sidebar
          currentView={currentView}
          onViewChange={(view) => {
            setCurrentView(view);
            setMobileNavOpen(false);
            if (view !== 'my-drive') {
              setCurrentFolderId(null);
            }
          }}
          onOpenUpload={() => {
            setMobileNavOpen(false);
            setUpTitle('');
            setUpDesc('');
            setUpCategory('Other');
            setUpCustomFile(null);
            setUpDept(currentUser.department);
            setUpAutoFile(currentView !== 'my-drive');
            setShowUploadModal(true);
          }}
          onOpenCreateFolder={() => {
            setMobileNavOpen(false);
            setFolderName('');
            setFolderScopeDept(currentUser.department);
            setShowFolderModal(true);
          }}
          pendingWithMeCount={pendingApprovalsCount}
          needsAuditCount={stats?.needsAuditCount || 0}
          currentUser={currentUser}
        />
      </div>

      {/* Center Console Container */}
      <div className="flex-1 flex flex-col overflow-hidden">
        
        {/* Universal Space Navigation Bar */}
        <header className="h-16 bg-white border-b border-slate-150 flex items-center justify-between px-4 md:px-8 shrink-0 space-x-3">

          {/* Mobile nav toggle */}
          <button
            onClick={() => setMobileNavOpen(true)}
            className="md:hidden p-2 rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 shrink-0"
            aria-label="Open navigation"
          >
            <Menu className="w-4 h-4" />
          </button>

          {/* Universal Full text & intelligent Tag search query */}
          <div className="flex-1 max-w-xl relative">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400">
              <Search className="w-4 h-4 text-slate-400" />
            </span>
            <input 
              type="text" 
              placeholder="Search by title, owner, customized tags, or OCR indexed terms..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-100/95 border-none rounded-2xl py-2 pl-10 pr-9 text-xs focus:bg-white focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800 outline-none"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Leftside User Switcher Controls & Action Headers */}
          <div className="flex items-center space-x-4">
            
            {/* Category Quick Filter Tag */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 text-[11px] font-medium text-slate-600 outline-none transition-all"
            >
              <option value="">All Categories</option>
              <option value="Contract">Contracts</option>
              <option value="Invoice">Invoices</option>
              <option value="Memo">Memos</option>
              <option value="Report">Reports</option>
              <option value="Support">Support Files</option>
              <option value="Other">Other Docs</option>
            </select>

            <span className="text-slate-300 w-px h-5">|</span>

            {/* Account menu */}
            <div className="relative">
              <button
                onClick={() => setAccountMenuOpen(o => !o)}
                className="flex items-center space-x-2 bg-indigo-50 border border-indigo-100 rounded-xl pl-1.5 pr-3 py-1.5 hover:bg-indigo-100 transition-all"
              >
                <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
                  {currentUser.fullName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                </span>
                <span className="text-[11px] font-semibold text-indigo-700 hidden sm:block">
                  {currentUser.fullName}
                </span>
              </button>
              {accountMenuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setAccountMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 w-56 bg-white border border-slate-100 rounded-xl shadow-xl z-40 overflow-hidden text-xs">
                    <div className="px-4 py-3 border-b border-slate-50 bg-slate-50/50">
                      <p className="font-bold text-slate-800">{currentUser.fullName}</p>
                      <p className="text-[10px] text-slate-400 truncate">{currentUser.email}</p>
                      <p className="text-[9px] font-mono uppercase tracking-wider text-indigo-500 mt-1">{currentUser.role} · {currentUser.department}</p>
                    </div>
                    <button
                      onClick={() => { setAccountMenuOpen(false); setShowChangePassword(true); }}
                      className="w-full px-4 py-2.5 flex items-center space-x-2.5 hover:bg-slate-50 text-slate-600"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-slate-400" /><span>Change password</span>
                    </button>
                    <button
                      onClick={handleLogout}
                      className="w-full px-4 py-2.5 flex items-center space-x-2.5 hover:bg-rose-50 text-rose-600 border-t border-slate-50"
                    >
                      <LogOut className="w-3.5 h-3.5" /><span>Sign out</span>
                    </button>
                  </div>
                </>
              )}
            </div>

          </div>
        </header>

        {/* View Router Renderers */}
        <main className="flex-1 overflow-y-auto p-6 flex flex-col space-y-6">
          
          {/* 1. VIEW: DASHBOARD PANEL */}
          {currentView === 'dashboard' && stats && (
            <div className="space-y-6">
              
              {/* Dynamic Greeting */}
              <div className="flex justify-between items-end">
                <div>
                  <h1 className="text-2xl font-display font-extrabold text-slate-900 tracking-tight">AVDP Document Management System</h1>
                  <p className="text-xs text-slate-400 font-medium">Secure document vault with AI-OCR tagging, role-based access, versioning, and auditable reviews.</p>
                </div>
              </div>

              {/* Statistical Bento Card Layout */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                
                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm shrink-0">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Total Files Indexed</p>
                      <h3 className="text-2xl font-display font-extrabold text-slate-800 mt-2">{stats.totalFiles}</h3>
                    </div>
                    <div className="p-2.5 bg-indigo-50 rounded-xl text-indigo-600">
                      <FileText className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="flex items-center mt-3 text-[10px] text-slate-400">
                    <TrendingUp className="w-3 h-3 text-emerald-500 mr-1 shrink-0" />
                    <span className="font-semibold text-slate-500 mr-1">{stats.recentUploadsCount} uploaded</span>
                    <span>this week</span>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm shrink-0">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Secure Cloud Storage</p>
                      <h3 className="text-2xl font-display font-extrabold text-slate-800 mt-2">
                        {(stats.totalSize / 1024).toFixed(1)} KB
                      </h3>
                    </div>
                    <div className="p-2.5 bg-sky-50 rounded-xl text-sky-600">
                      <Database className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="flex items-center mt-3 text-[10px] text-slate-400">
                    <div className="w-full bg-slate-100 rounded-full h-1 mr-2">
                      <div className="bg-sky-500 h-1 rounded-full" style={{ width: '4%' }}></div>
                    </div>
                    <span className="shrink-0">4% used</span>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm shrink-0">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Approved Records</p>
                      <h3 className="text-2xl font-display font-extrabold text-emerald-600 mt-2">{stats.approvedCount}</h3>
                    </div>
                    <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="flex items-center mt-3 text-[10px] text-slate-400">
                    <span className="text-emerald-500 font-semibold mr-1">100% Locked</span>
                    <span>against tampering</span>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm shrink-0">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Approvals Pending</p>
                      <h3 className="text-2xl font-display font-extrabold text-amber-500 mt-2">{stats.pendingMyApprovalCount}</h3>
                    </div>
                    <div className="p-2.5 bg-amber-50 rounded-xl text-amber-600">
                      <CheckSquare className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="flex items-center mt-3 text-[10px] text-slate-400">
                    {pendingApprovalsCount > 0 ? (
                      <span className="text-amber-600 font-semibold">Requires immediate review</span>
                    ) : (
                      <span>Queue cleared</span>
                    )}
                  </div>
                </div>

              </div>

              {/* Main Split Area */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Recent documents table */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-5 shadow-sm flex flex-col">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-display font-bold text-slate-800 text-sm">Recently Indexed Documents</h3>
                    <button onClick={() => setCurrentView('my-drive')} className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 flex items-center">
                      <span>View All Repository</span>
                      <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                    </button>
                  </div>

                  {documents.length === 0 ? (
                    <div className="text-center py-10">
                      <p className="text-xs text-slate-400">No active documents on current filters. Try resetting search queries.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 text-slate-400 font-bold text-[10px] uppercase">
                            <th className="py-2.5 px-3">Title</th>
                            <th className="py-2.5 px-3">Category</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3">Last Modified</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 font-medium">
                          {documents.slice(0, 5).map(doc => (
                            <tr 
                              key={doc.id} 
                              onClick={() => setSelectedDocId(doc.id)}
                              className="hover:bg-slate-50 cursor-pointer transition-colors"
                            >
                              <td className="py-3 px-3">
                                <div className="flex items-center space-x-2.5">
                                  <FileFormatBadge fileType={doc.fileType} docType={doc.documentType} fileName={doc.fileName} size="sm" />
                                  <span className="font-semibold text-slate-700 truncate max-w-[200px]">{doc.title}</span>
                                </div>
                              </td>
                              <td className="py-3 px-3">
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-semibold rounded">
                                  {doc.documentType}
                                </span>
                              </td>
                              <td className="py-3 px-3">
                                <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full ${
                                  doc.status === 'Approved' ? 'bg-emerald-50 text-emerald-600' :
                                  doc.status === 'Pending Approval' ? 'bg-amber-50 text-amber-600' :
                                  doc.status === 'Changes Requested' ? 'bg-sky-50 text-sky-600' :
                                  'bg-slate-100 text-slate-500'
                                }`}>
                                  {doc.status}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-slate-400 text-[10px] font-mono">
                                {new Date(doc.updatedAt).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>


              </div>
            </div>
          )}

          {/* 2. VIEW: MY DRIVE & FILE NAVIGATOR */}
          {(currentView === 'my-drive' || currentView === 'starred' || currentView === 'approved-files' || currentView === 'archive' || currentView === 'trash' || currentView === 'shared-with-me' || currentView === 'needs-audit') && (
            <div className="space-y-4">
              
              {/* Dynamic contextual title based on route view */}
              <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                
                {/* Navigation Breadcrumbs for current folder */}
                <div className="flex items-center space-x-2 text-xs font-semibold text-slate-600">
                  {currentView === 'my-drive' ? (
                    getBreadcrumbs().map((bc, index) => (
                      <React.Fragment key={bc.id}>
                        {index > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-300" />}
                        <button 
                          onClick={() => {
                            if (bc.id === 'root') {
                              setCurrentFolderId(null);
                            } else {
                              setCurrentFolderId(bc.id);
                            }
                          }}
                          className={`${index === getBreadcrumbs().length - 1 ? 'text-indigo-600 font-bold' : 'hover:text-indigo-600'} transition-all`}
                        >
                          {bc.name}
                        </button>
                      </React.Fragment>
                    ))
                  ) : (
                    <span className="capitalize font-bold text-slate-800 text-sm flex items-center space-x-2">
                      {currentView === 'starred' && <Star className="w-4 h-4 text-amber-500" />}
                      {currentView === 'approved-files' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      {currentView === 'archive' && <Archive className="w-4 h-4 text-sky-500" />}
                      {currentView === 'trash' && <Trash2 className="w-4 h-4 text-slate-400" />}
                      {currentView === 'shared-with-me' && <Clock className="w-4 h-4 text-indigo-500" />}
                      {currentView === 'needs-audit' && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                      <span>{ { 'shared-with-me': 'Shares', 'starred': 'Starred Files', 'approved-files': 'Approved Documents', 'archive': 'Archive', 'trash': 'Trash', 'needs-audit': 'Needs Audit' }[currentView] ?? currentView.replace(/-/g, ' ') } Overview</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {currentView === 'my-drive' && currentUser.role !== 'Viewer' && (
                    <>
                      <input
                        ref={quickFileUploadInputRef}
                        type="file"
                        onChange={handleQuickFileSelect}
                        className="hidden"
                      />
                      <input
                        ref={folderUploadInputRef}
                        type="file"
                        multiple
                        onChange={handleFolderUpload}
                        className="hidden"
                        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setFolderName('');
                          setFolderScopeDept(currentUser.department);
                          setShowFolderModal(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-600 hover:border-indigo-200 hover:text-indigo-700 hover:bg-indigo-50/40 transition-all"
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                        <span>New Folder</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => quickFileUploadInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 transition-all"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload Files</span>
                      </button>
                      <button
                        type="button"
                        disabled={bulkUploading}
                        onClick={() => folderUploadInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-[11px] font-bold text-white shadow-sm shadow-indigo-100 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300 transition-all"
                      >
                        {bulkUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5" />}
                        <span>{bulkUploadStatus ? `${bulkUploadStatus.done}/${bulkUploadStatus.total} Uploading` : 'Upload Folder'}</span>
                      </button>
                    </>
                  )}
                  <span className="text-xs text-slate-400 whitespace-nowrap">{documents.length} objects found</span>
                </div>
              </div>

              {/* Subfolders Grid (only if in My Drive) */}
              {currentView === 'my-drive' && folders.filter(f => f.parentFolderId === currentFolderId).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[10px] font-mono font-extrabold tracking-wider text-slate-400 uppercase">Folders Directory</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {folders.filter(f => f.parentFolderId === currentFolderId).map(fold => (
                      <div 
                        key={fold.id}
                        onClick={() => {
                          setCurrentFolderId(fold.id);
                        }}
                        className="relative bg-white border border-slate-100 hover:border-indigo-100 hover:shadow-sm p-3.5 rounded-xl flex items-center space-x-3 cursor-pointer transition-all select-none group"
                      >
                        <div className="w-8 h-8 rounded-lg bg-indigo-50/70 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-100/70 transition-all">
                          <Folder className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 pr-6">
                          <h4 className="text-xs font-bold text-slate-700 truncate group-hover:text-indigo-600">{fold.name}</h4>
                          {fold.department && (
                            <span className="text-[8px] font-mono px-1 py-0.2 bg-slate-100 text-slate-500 rounded block mt-0.5 truncate uppercase">
                              {fold.department}
                            </span>
                          )}
                        </div>
                        {currentUser.role !== 'Viewer' && (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteFolder(fold, e)}
                            title="Delete folder"
                            className="absolute right-2 top-2 rounded-md p-1 text-slate-300 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 focus:opacity-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Master files list */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
                {selectedIds.size > 0 && (
                  <div className="sticky top-0 z-20 px-4 pt-4 pb-2 bg-white/95 backdrop-blur">
                    <div className="flex min-h-12 items-center gap-1 rounded-full bg-slate-100/90 px-3 py-2 text-slate-700 shadow-sm ring-1 ring-slate-200/70">
                      <button
                        type="button"
                        onClick={clearSelection}
                        title="Clear selection"
                        aria-label="Clear selection"
                        className="grid h-8 w-8 place-items-center rounded-full text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <span className="px-2 text-sm font-bold text-slate-800 whitespace-nowrap">{selectedIds.size} selected</span>

                      <button
                        type="button"
                        disabled
                        title="AI assistant coming soon"
                        className="ml-2 hidden items-center gap-1.5 rounded-full border border-slate-300 bg-white/40 px-3 py-1.5 text-[11px] font-bold text-slate-400 sm:inline-flex disabled:cursor-not-allowed"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Ask Gemini</span>
                      </button>

                      <span className="mx-1 hidden h-6 w-px bg-slate-300/80 sm:block" />

                      {currentView === 'trash' ? (
                        <>
                          <button
                            type="button"
                            onClick={handleBulkRestore}
                            title="Restore selection"
                            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold text-indigo-700 transition-colors hover:bg-white"
                          >
                            <X className="w-4 h-4 rotate-45" />
                            <span className="hidden sm:inline">Restore</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleBulkPurge}
                            title="Delete forever"
                            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold text-rose-600 transition-colors hover:bg-rose-50"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span className="hidden sm:inline">Delete forever</span>
                          </button>
                        </>
                      ) : (
                        <>
                          {currentUser?.role !== 'Viewer' && (
                            <button
                              type="button"
                              onClick={() => singleSelectedDoc && openShareModal(singleSelectedDoc.id)}
                              disabled={!singleSelectedDoc}
                              title={singleSelectedDoc ? 'Share with people' : 'Share is available for one item at a time'}
                              className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400"
                            >
                              <Share2 className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleBulkDownload}
                            title="Download"
                            className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          {currentUser?.role !== 'Viewer' && (
                            <button
                              type="button"
                              onClick={() => openMoveModal(Array.from(selectedIds))}
                              title="Move to folder"
                              className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white"
                            >
                              <CornerDownRight className="w-4 h-4" />
                            </button>
                          )}
                          {currentUser?.role !== 'Viewer' && (
                            <button
                              type="button"
                              onClick={handleBulkDelete}
                              title="Move to trash"
                              className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-rose-50 hover:text-rose-600"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => singleSelectedDoc && openLinkModal(singleSelectedDoc.id)}
                            disabled={!singleSelectedDoc}
                            title={singleSelectedDoc ? 'Get link' : 'Links are available for one item at a time'}
                            className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400"
                          >
                            <Link2 className="w-4 h-4" />
                          </button>
                          <div className="relative ml-auto">
                            <button
                              type="button"
                              onClick={() => setOpenMenuId(selectionMenuOpen ? null : '__selection-toolbar')}
                              title="More actions"
                              className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {selectionMenuOpen && (
                              <>
                                <div className="fixed inset-0 z-30" onClick={() => setOpenMenuId(null)} />
                                <div className="absolute right-0 top-10 z-40 w-52 rounded-xl border border-slate-100 bg-white py-1 text-left text-[11px] font-semibold text-slate-600 shadow-2xl">
                                  {singleSelectedDoc && (
                                    <>
                                      <button onClick={() => { setOpenMenuId(null); setSelectedDocId(singleSelectedDoc.id); }} className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-slate-50">
                                        <Eye className="w-3.5 h-3.5 text-slate-400" /><span>Open details</span>
                                      </button>
                                      <button onClick={(e) => { handleMakeCopy(singleSelectedDoc.id, e); setOpenMenuId(null); }} className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-slate-50">
                                        <Copy className="w-3.5 h-3.5 text-slate-400" /><span>Make a copy</span>
                                      </button>
                                      {currentUser?.role !== 'Viewer' && (
                                        <button onClick={(e) => { handleRename(singleSelectedDoc.id, singleSelectedDoc.title, e); setOpenMenuId(null); }} className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-slate-50">
                                          <Pencil className="w-3.5 h-3.5 text-slate-400" /><span>Rename</span>
                                        </button>
                                      )}
                                    </>
                                  )}
                                  <button onClick={() => { handleBulkStar(); setOpenMenuId(null); }} className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-slate-50">
                                    <Star className="w-3.5 h-3.5 text-slate-400" /><span>Star / unstar selection</span>
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {documents.length === 0 ? (
                  <div className="p-16 text-center text-slate-400 flex flex-col items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mb-3.5">
                      <File className="w-6 h-6" />
                    </div>
                    <h3 className="font-display font-bold text-slate-800 text-sm">Target folder looks empty</h3>
                    <p className="text-xs max-w-sm mt-1">Create a folder here, upload individual files, or import an entire local folder while preserving its structure.</p>
                    {currentView === 'my-drive' && currentUser.role !== 'Viewer' && (
                      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setFolderName('');
                            setFolderScopeDept(currentUser.department);
                            setShowFolderModal(true);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-600 hover:border-indigo-200 hover:text-indigo-700"
                        >
                          <FolderPlus className="w-3.5 h-3.5" />
                          New Folder
                        </button>
                        <button
                          type="button"
                          onClick={() => quickFileUploadInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          Upload Files
                        </button>
                        <button
                          type="button"
                          disabled={bulkUploading}
                          onClick={() => folderUploadInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
                        >
                          {bulkUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5" />}
                          {bulkUploadStatus ? `${bulkUploadStatus.done}/${bulkUploadStatus.total} Uploading` : 'Upload Folder'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/70 border-b border-indigo-50/50">
                        <tr className="text-[10px] font-mono font-bold uppercase text-slate-400">
                          <th className="py-3 pl-4 pr-1 w-8">
                            <input
                              type="checkbox"
                              checked={allVisibleSelected}
                              onChange={toggleSelectAll}
                              title="Select all"
                              className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 cursor-pointer accent-indigo-600"
                            />
                          </th>
                          <th className="py-3 px-2 w-8"></th>
                          <th className="py-3 px-4">Document Details</th>
                          <th className="py-3 px-4">Department Scope</th>
                          <th className="py-3 px-4">Tags & Classifications</th>
                          <th className="py-3 px-4">OCR Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50 font-medium text-slate-600">
                        {documents.map(doc => {
                          const isDocStarred = doc.isStarred;
                          return (
                            <tr
                              key={doc.id}
                              onClick={() => setSelectedDocId(doc.id)}
                              className={`hover:bg-slate-50/80 cursor-pointer transition-colors ${selectedIds.has(doc.id) ? 'bg-indigo-50/60' : selectedDocId === doc.id ? 'bg-indigo-50/20' : ''}`}
                            >
                              <td className="py-3 pl-4 pr-1" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(doc.id)}
                                  onChange={() => toggleSelect(doc.id)}
                                  className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 cursor-pointer accent-indigo-600"
                                />
                              </td>
                              <td className="py-3 px-2" onClick={(e) => e.stopPropagation()}>
                                <button onClick={(e) => handleToggleStar(doc.id, e)} className="text-slate-300 hover:text-amber-500 transition-colors">
                                  <Star className={`w-4 h-4 ${isDocStarred ? 'text-amber-500 fill-amber-400' : ''}`} />
                                </button>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center space-x-3">
                                  <FileFormatBadge fileType={doc.fileType} docType={doc.documentType} fileName={doc.fileName} size="md" />
                                  <div className="min-w-0">
                                    <p className="font-semibold text-slate-800 truncate max-w-[240px]">{doc.title}</p>
                                    <p className="text-[9px] text-slate-400 mt-0.5">Owner: {doc.ownerName} • {doc.currentVersion}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <span className="font-mono text-[9px] font-bold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md uppercase">
                                  {doc.department || 'GLOBAL'}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex flex-wrap gap-1 max-w-[280px]">
                                  {doc.tags.slice(0, 3).map(tag => (
                                    <span key={tag} className="px-1.5 py-0.2 bg-indigo-50 text-indigo-600 text-[8px] font-mono font-bold rounded-md border border-indigo-100/50">
                                      #{tag}
                                    </span>
                                  ))}
                                  {doc.tags.length > 3 && (
                                    <span className="text-[8px] font-mono text-slate-400 pl-1">+{doc.tags.length - 3} more</span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <span className="flex items-center space-x-1.5 text-[10px] text-emerald-600 font-bold">
                                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block"></span>
                                  <span>OCR Indexed</span>
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="relative flex items-center justify-end space-x-1">
                                  {currentView === 'trash' ? (
                                    <>
                                      <button 
                                        onClick={(e) => handleRestoreDocument(doc.id, e)}
                                        title="Restore file"
                                        className="p-1 px-2.5 bg-indigo-50 text-indigo-600 rounded-md hover:bg-indigo-100 text-[10px] font-bold flex items-center space-x-1"
                                      >
                                        <X className="w-3 h-3 rotate-45" />
                                        <span>Restore</span>
                                      </button>
                                      <button 
                                        onClick={(e) => handlePurgeDocument(doc.id, e)}
                                        title="Permanent deletion"
                                        className="p-1 text-rose-500 hover:bg-rose-50 rounded-md"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      {currentUser.role !== 'Viewer' && (
                                        <button 
                                          onClick={(e) => openMoveModal([doc.id], e)}
                                          title="Move folder location"
                                          className="p-1 text-slate-400 hover:text-indigo-650 rounded hover:bg-slate-100"
                                        >
                                          <CornerDownRight className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                      <button 
                                        onClick={(e) => openShareModal(doc.id, e)}
                                        title="Share properties"
                                        className="p-1 text-slate-400 hover:text-indigo-650 rounded hover:bg-slate-100"
                                      >
                                        <Share2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button 
                                        onClick={(e) => handleDeleteDocument(doc.id, e)}
                                        title="Send to Trash"
                                        className="p-1 text-slate-400 hover:text-rose-500 rounded hover:bg-rose-50"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === doc.id ? null : doc.id); }}
                                        title="More actions"
                                        className="p-1 text-slate-400 hover:text-indigo-650 rounded hover:bg-slate-100"
                                      >
                                        <MoreVertical className="w-3.5 h-3.5" />
                                      </button>
                                      {openMenuId === doc.id && (
                                        <>
                                          <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); }} />
                                          <div className="absolute right-0 top-8 z-40 w-48 bg-white rounded-xl shadow-2xl border border-slate-100 py-1 text-left text-[11px] font-semibold text-slate-600">
                                            <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); setSelectedDocId(doc.id); }} className="w-full px-3 py-2 flex items-center space-x-2.5 hover:bg-slate-50">
                                              <Eye className="w-3.5 h-3.5 text-slate-400" /><span>Open</span>
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); setPreviewDoc({ id: doc.id, title: doc.title, fileType: doc.fileType, fileName: doc.fileName }); setOpenMenuId(null); }} className="w-full px-3 py-2 flex items-center space-x-2.5 hover:bg-slate-50">
                                              <Eye className="w-3.5 h-3.5 text-slate-400" /><span>Preview</span>
                                            </button>
                                            <button onClick={(e) => { handleDownload(doc.id, e); setOpenMenuId(null); }} className="w-full px-3 py-2 flex items-center space-x-2.5 hover:bg-slate-50">
                                              <Download className="w-3.5 h-3.5 text-slate-400" /><span>Download</span>
                                            </button>
                                            <button onClick={(e) => { handleMakeCopy(doc.id, e); setOpenMenuId(null); }} className="w-full px-3 py-2 flex items-center space-x-2.5 hover:bg-slate-50">
                                              <Copy className="w-3.5 h-3.5 text-slate-400" /><span>Make a copy</span>
                                            </button>
                                            {currentUser.role !== 'Viewer' && (
                                              <button onClick={(e) => { handleRename(doc.id, doc.title, e); setOpenMenuId(null); }} className="w-full px-3 py-2 flex items-center space-x-2.5 hover:bg-slate-50">
                                                <Pencil className="w-3.5 h-3.5 text-slate-400" /><span>Rename</span>
                                              </button>
                                            )}
                                            {currentUser.role !== 'Viewer' && (
                                              <button onClick={(e) => { setOpenMenuId(null); openMoveModal([doc.id], e); }} className="w-full px-3 py-2 flex items-center space-x-2.5 hover:bg-slate-50">
                                                <CornerDownRight className="w-3.5 h-3.5 text-slate-400" /><span>Move to…</span>
                                              </button>
                                            )}
                                            <button onClick={(e) => { setOpenMenuId(null); openLinkModal(doc.id, e); }} className="w-full px-3 py-2 flex items-center space-x-2.5 hover:bg-slate-50">
                                              <Link2 className="w-3.5 h-3.5 text-slate-400" /><span>Get link</span>
                                            </button>
                                            <button onClick={(e) => { setOpenMenuId(null); openShareModal(doc.id, e); }} className="w-full px-3 py-2 flex items-center space-x-2.5 hover:bg-slate-50">
                                              <Share2 className="w-3.5 h-3.5 text-slate-400" /><span>Share with people</span>
                                            </button>
                                            <button onClick={(e) => { handleToggleStar(doc.id, e); setOpenMenuId(null); }} className="w-full px-3 py-2 flex items-center space-x-2.5 hover:bg-slate-50">
                                              <Star className={`w-3.5 h-3.5 ${isDocStarred ? 'text-amber-500 fill-amber-400' : 'text-slate-400'}`} /><span>{isDocStarred ? 'Remove star' : 'Add star'}</span>
                                            </button>
                                            {currentUser.role !== 'Viewer' && (
                                              <button onClick={(e) => { handleDeleteDocument(doc.id, e); setOpenMenuId(null); }} className="w-full px-3 py-2 flex items-center space-x-2.5 text-rose-500 hover:bg-rose-50 border-t border-slate-100 mt-1 pt-2">
                                                <Trash2 className="w-3.5 h-3.5" /><span>Move to trash</span>
                                              </button>
                                            )}
                                          </div>
                                        </>
                                      )}
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VIEW: PENDING APPROVALS QUEUE */}
          {currentView === 'pending-approval' && (
            <div className="space-y-4">
              <div className="flex flex-col">
                <h2 className="text-xl font-display font-extrabold text-slate-800 tracking-tight">Approvals Awaiting Your Review</h2>
                <p className="text-xs text-slate-400">Documents submitted to you as the assigned approver. Open one to record your verdict.</p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
                {pendingApprovals.length === 0 ? (
                  <div className="p-16 text-center text-slate-400 flex flex-col items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mb-3.5">
                      <CheckSquare className="w-6 h-6" />
                    </div>
                    <h3 className="font-display font-bold text-slate-800 text-sm">Your approval queue is clear</h3>
                    <p className="text-xs max-w-sm mt-1">No documents are currently waiting for your decision.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/70 border-b border-indigo-50/50">
                        <tr className="text-[10px] font-mono font-bold uppercase text-slate-400">
                          <th className="py-3 px-4">Document</th>
                          <th className="py-3 px-4">Requested By</th>
                          <th className="py-3 px-4">Note</th>
                          <th className="py-3 px-4">Submitted</th>
                          <th className="py-3 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50 font-medium text-slate-600">
                        {pendingApprovals.map(appr => (
                          <tr key={appr.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3 px-4">
                              <div className="flex items-center space-x-3">
                                <FileFormatBadge fileType={appr.fileType} docType={appr.documentType} fileName={appr.fileName} size="md" />
                                <div className="min-w-0">
                                  <p className="font-semibold text-slate-800 truncate max-w-[240px]">{appr.documentTitle}</p>
                                  <p className="text-[9px] text-slate-400 mt-0.5">{appr.documentType} • {appr.documentDepartment || 'GLOBAL'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-700">{appr.requestedByName}</td>
                            <td className="py-3 px-4 text-[11px] text-slate-500 truncate max-w-[220px]" title={appr.requestComment}>
                              {appr.requestComment}
                            </td>
                            <td className="py-3 px-4 text-slate-400 text-[10px] font-mono">
                              {new Date(appr.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                onClick={() => setSelectedDocId(appr.documentId)}
                                className="px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 text-[10px] font-bold rounded-lg inline-flex items-center space-x-1"
                              >
                                <span>Review</span>
                                <ArrowRight className="w-3 h-3 text-white" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. VIEW: DEPARTMENTS MAP OVERVIEW */}
          {currentView === 'departments' && (
            <div className="space-y-4">
              <div className="flex flex-col">
                <h2 className="text-xl font-display font-extrabold text-slate-800 tracking-tight">Organization Departments Map</h2>
                <p className="text-xs text-slate-400">Predefined dynamic sub-structures based on staff units. Click explore to browse scoped folder registries.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {folders.filter(f => f.parentFolderId === null).map(deptFolder => {
                  const subCount = folders.filter(f => f.parentFolderId === deptFolder.id || f.id === deptFolder.id).length;
                  return (
                    <div 
                      key={deptFolder.id}
                      className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between"
                    >
                      <div>
                        <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
                          <Building2 className="w-4.5 h-4.5" />
                        </div>
                        <h3 className="font-display font-bold text-slate-800 text-sm">{deptFolder.name} Department</h3>
                        <p className="text-[11px] text-slate-400 mt-1">Contains configured default sub-structures for internal operations guidelines.</p>
                      </div>

                      <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
                        <span className="text-[10px] font-mono text-slate-400 uppercase">{subCount} folders linked</span>
                        <button 
                          onClick={() => {
                            setCurrentFolderId(deptFolder.id);
                            setCurrentView('my-drive');
                          }}
                          className="px-2.5 py-1 bg-indigo-600 text-white hover:bg-indigo-700 text-[10px] font-semibold rounded-lg flex items-center space-x-1"
                        >
                          <span>Explore</span>
                          <ArrowRight className="w-3 h-3 text-white" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. VIEW: AUDIT TRAIL LOGS SCREEN */}
          {currentView === 'activity-log' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-display font-extrabold text-slate-800 tracking-tight">Enterprise Audit Trails</h2>
                  <p className="text-xs text-slate-400">Immutable trace events logging all user file uploads, OCR scans, managers decisions approval, and permission shares.</p>
                </div>
                <span className="text-[10px] font-mono px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg font-bold border border-indigo-100 uppercase">
                  Auditing Enabled
                </span>
              </div>

              {/* Immutable logs display table */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
                <div className="p-3.5 bg-slate-50/70 border-b border-slate-100 text-[10px] text-slate-400 font-mono font-bold uppercase tracking-wider">
                  Live Audit Output Segment
                </div>

                <div className="divide-y divide-slate-50 max-h-[500px] overflow-y-auto">
                  <ActivityLogView />
                </div>
              </div>
            </div>
          )}

          {/* VIEW: USER MANAGEMENT */}
          {currentView === 'user-management' && currentUser && (
            <UserManagementView
              users={users}
              currentUser={currentUser}
              onUsersChanged={(nextUsers, nextCurrentUser) => {
                setUsers(nextUsers);
                if (nextCurrentUser) setCurrentUser(nextCurrentUser);
                reloadData();
              }}
              onToast={triggerToast}
            />
          )}

          {/* VIEW: SETTINGS */}
          {currentView === 'settings' && currentUser && (
            <SettingsView
              currentUser={currentUser}
              stats={stats}
              orgProfile={orgProfile}
              onSaved={(inst) => {
                setOrgProfile(inst);
                triggerToast('Settings updated.', 'success');
                reloadData();
              }}
            />
          )}

        </main>
      </div>

      {/* Primary Right Detail Sidebar Layout (Dynamic interactive view details, OCR snippets, comments, approvals) */}
      {selectedDocId && docDetail && (
        <aside className="w-96 bg-white border-l border-slate-150 flex flex-col h-full shrink-0 shadow-lg relative z-20 overflow-hidden">
          
          {/* Header detail */}
          <div className="p-5 border-b border-slate-50 flex items-start justify-between bg-slate-50/50">
            <div className="flex items-center space-x-2.5">
              <FileFormatBadge fileType={docDetail.document.fileType} docType={docDetail.document.documentType} fileName={docDetail.document.fileName} size="lg" />
              <div className="min-w-0">
                <h3 className="text-xs font-bold text-slate-800 truncate max-w-[200px]">{docDetail.document.title}</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">UUID: {docDetail.document.id}</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-1.5">
              <button
                onClick={() => setPreviewDoc({ id: docDetail.document.id, title: docDetail.document.title, fileType: docDetail.document.fileType, fileName: docDetail.document.fileName })}
                className="p-1 px-2.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 text-[9px] font-bold flex items-center space-x-1"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Preview</span>
              </button>
              <button
                onClick={() => {
                  setSelectedDocId(null);
                  setDocDetail(null);
                }}
                className="p-1 px-2.5 bg-slate-200/50 text-slate-500 rounded-lg hover:bg-slate-200 text-[9px] font-bold flex items-center space-x-1"
              >
                <X className="w-3.5 h-3.5" />
                <span>Close</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            
            {/* Information specifications */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Document Information</span>
                {currentUser?.role !== 'Viewer' && (
                  <button
                    onClick={() => openLinkModal(docDetail.document.id)}
                    className="text-[9px] text-indigo-600 font-bold hover:underline flex items-center space-x-0.5"
                  >
                    <Link2 className="w-3 h-3 text-indigo-500" />
                    <span>Share Link</span>
                  </button>
                )}
              </div>

              <div className="bg-slate-50 rounded-xl p-3.5 space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Owner</span>
                  <span className="font-semibold text-slate-700">{docDetail.document.ownerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Class</span>
                  <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[9px] font-extrabold rounded">
                    {docDetail.document.documentType}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Status</span>
                  <span className={`px-2 py-0.5 text-[9px] font-bold rounded ${
                    docDetail.document.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' :
                    docDetail.document.status === 'Pending Approval' ? 'bg-amber-50 text-amber-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {docDetail.document.status}
                  </span>
                </div>
                <div className={`flex justify-between p-1.5 rounded-lg border border-indigo-150/50 mt-1 ${docDetail.document.confidentialityLevel === 'Official Record' ? 'bg-emerald-50/50' : 'bg-indigo-50/50'}`}>
                  <span className="text-slate-500 font-bold text-[10px]">Security Lock</span>
                  <span className="font-bold text-[9px] font-mono text-indigo-700 lowercase flex items-center">
                    <Lock className="w-3 h-3 mr-1" />
                    {docDetail.document.confidentialityLevel}
                  </span>
                </div>
              </div>
            </div>

            {/* Smart Automated OCR index output display */}
            {docDetail.document.ocrText && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase flex items-center">
                  <Sparkles className="w-3 h-3 text-indigo-600 mr-1" />
                  <span>AI-OCR Text Snippet Scan</span>
                </span>
                <div className="relative border border-amber-100/40 bg-amber-50/20 rounded-xl p-3 text-[10px] text-slate-600 font-mono leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                  <div className="absolute top-2 right-2 bg-indigo-50 text-indigo-700 font-bold px-1.5 py-0.2 rounded text-[7px] tracking-widest font-sans uppercase z-10">
                    GEMINI ACTIVE
                  </div>
                  {docDetail.document.ocrText}
                </div>
              </div>
            )}

            {/* Configured Tag cloud */}
            <div className="space-y-2">
              <span className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Tags Cloud Metadata</span>
              <div className="flex flex-wrap gap-1.5">
                {docDetail.document.tags.map(t => (
                  <span key={t} className="px-2 py-0.5 border border-indigo-150/70 bg-indigo-50 text-indigo-700 font-bold text-[9px] font-mono rounded-lg">
                    #{t}
                  </span>
                ))}
              </div>
            </div>

            {/* ACTIVE WORKFLOW ACTION CARD: If current user is manager they can Approve or Return for review directly */}
            {docDetail.approvals.some(a => a.approverId === currentUser?.id && a.status === 'Pending Approval') && (
              <div className="bg-amber-50/80 border border-amber-150 rounded-2xl p-4 space-y-3">
                <div className="flex items-center space-x-1.5 text-amber-700">
                  <UserCheck className="w-4 h-4 shrink-0" />
                  <h4 className="text-[11px] font-bold font-display">Awaiting Manager Approval</h4>
                </div>
                <p className="text-[10px] text-slate-600 leading-relaxed">
                  You are registered as the formal authority manager for this dossier. Choose verdict with optional comments below:
                </p>

                {/* Comment area */}
                <textarea
                  placeholder="Insert feedback comments..."
                  value={decisionComment}
                  onChange={(e) => setDecisionComment(e.target.value)}
                  className="w-full bg-white border border-amber-200 rounded-xl p-2 text-[11px] outline-none h-14 resize-none"
                />

                <div className="flex space-x-2 shrink-0">
                  <button
                    onClick={() => {
                      const appReq = docDetail.approvals.find(a => a.approverId === currentUser?.id && a.status === 'Pending Approval');
                      if (appReq) handleApprovalDecision('Approved', appReq.id);
                    }}
                    className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => {
                      const appReq = docDetail.approvals.find(a => a.approverId === currentUser?.id && a.status === 'Pending Approval');
                      if (appReq) handleApprovalDecision('Changes Requested', appReq.id);
                    }}
                    className="flex-1 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-[10px] font-bold"
                  >
                    Request Changes
                  </button>
                  <button
                    onClick={() => {
                      const appReq = docDetail.approvals.find(a => a.approverId === currentUser?.id && a.status === 'Pending Approval');
                      if (appReq) handleApprovalDecision('Rejected', appReq.id);
                    }}
                    className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-bold"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}

            {/* Submit approval button trigger if draft and not pending */}
            {currentUser?.role !== 'Viewer' && docDetail.document.status !== 'Approved' && !docDetail.approvals.some(a => a.status === 'Pending Approval') && (
              <button
                onClick={() => {
                  setApprovalApproverId('manager-1'); // David Vance
                  setApprovalRequestComment('');
                  setShowApprovalModal(true);
                }}
                className="w-full py-2 bg-gradient-to-r from-indigo-550 to-indigo-600 text-white hover:from-indigo-650 hover:to-indigo-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1 shadow-sm"
              >
                <CheckSquare className="w-4 h-4 text-white shrink-0" />
                <span>Submit Approval Dossier</span>
              </button>
            )}

            {/* ACTIVE SHARED SECURE ACCESS LINKS (WeTransfer-style) */}
            {docDetail.externalLinks && docDetail.externalLinks.length > 0 && (
              <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3.5 space-y-2">
                <span className="text-[10px] font-mono font-bold text-slate-400 uppercase block">Active Share Links</span>
                {docDetail.externalLinks.map(link => {
                  const url = `${window.location.origin}/api/external/${link.token}`;
                  const isExpired = new Date(link.expiresAt).getTime() < Date.now();
                  const isExhausted = link.maxDownloads != null && (link.downloadCount || 0) >= link.maxDownloads;
                  const formatSize = (bytes: number) => bytes > 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : bytes > 1024 ? `${(bytes/1024).toFixed(0)} KB` : `${bytes} B`;
                  return (
                    <div key={link.id} className={`text-[10px] p-2.5 bg-white rounded-lg border space-y-2 ${isExpired || isExhausted ? 'border-rose-100 opacity-60' : 'border-slate-100'}`}>
                      <div className="flex justify-between items-start">
                        <div className="space-y-0.5 min-w-0">
                          <p className="font-semibold text-slate-700 truncate max-w-[160px]" title={link.fileName}>{link.fileName || link.token}</p>
                          <p className="text-[8px] text-slate-400">{formatSize(link.fileSize || 0)} · {link.fileType?.toUpperCase()}</p>
                        </div>
                        <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                          <button
                            onClick={() => {
                              navigator.clipboard?.writeText(url);
                              triggerToast('Share link copied!', 'success');
                            }}
                            className="px-2 py-1 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 text-[8px] font-bold rounded"
                          >
                            Copy
                          </button>
                          <button
                            onClick={() => handleRevokeExternalLink(link.token)}
                            className="px-2 py-1 bg-rose-50 text-rose-600 hover:bg-rose-100 text-[8px] font-bold rounded"
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                      {link.message && (
                        <p className="text-[8px] text-slate-500 italic border-l-2 border-indigo-200 pl-1.5">"{link.message}"</p>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[8px] text-slate-400">
                        <span>{isExpired ? '⚠ Expired' : `Expires ${new Date(link.expiresAt).toLocaleDateString()}`}</span>
                        <span>{link.downloadCount || 0}{link.maxDownloads ? `/${link.maxDownloads}` : ''} download{(link.downloadCount || 0) === 1 ? '' : 's'}</span>
                        {!link.allowDownload && <span className="text-amber-500">View-only</span>}
                        {link.requiresPassword && <span className="text-indigo-500">🔒 Password</span>}
                        {isExhausted && <span className="text-rose-500">Limit reached</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Versions Management History */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Version Ledger Track</span>
                {currentUser?.role !== 'Viewer' && (
                  <label className="text-[9px] text-indigo-600 font-bold hover:underline cursor-pointer flex items-center space-x-0.5">
                    <Plus className="w-3 h-3 text-indigo-500" />
                    <span>Upload Version</span>
                    <input type="file" onChange={handleNewVersionUpload} className="hidden" />
                  </label>
                )}
              </div>

              <div className="bg-slate-50/80 rounded-xl p-3 divide-y divide-slate-150/40 text-[11px] space-y-2">
                {docDetail.versions.map((ver, idx) => (
                  <div key={ver.id} className={`flex justify-between items-center py-2 ${idx === 0 ? 'text-indigo-900 font-bold' : ''}`}>
                    <div>
                      <h5 className="font-sans font-bold flex items-center text-slate-700">
                        {idx === 0 && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mr-1.5 inline-block"></span>}
                        <span>Version {ver.versionNumber}</span>
                      </h5>
                      <p className="text-[8px] text-slate-400 mt-0.5">Uploaded by {ver.uploadedByName} • {(ver.fileSize / 1024).toFixed(1)} KB</p>
                    </div>
                    <a
                      href={`/api/documents/${docDetail.document.id}/versions/${ver.id}/download`}
                      download={ver.fileName}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 bg-white border border-slate-150 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-800 transition-colors"
                      title="Download file"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  </div>
                ))}
              </div>
            </div>

            {/* File History: full audit trail for this document. Restricted to
                Manager/Admin/Auditor -- the server already omits `activity`
                and blocks the standalone endpoint for other roles, this just
                keeps the section from rendering an always-empty shell for them. */}
            {currentUser && (currentUser.role === 'Admin' || currentUser.role === 'Manager' || currentUser.role === 'Auditor') && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setShowFileHistory(s => !s)}
                  className="flex-1 flex justify-between items-center min-w-0"
                >
                  <span className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase flex items-center space-x-1.5">
                    <History className="w-3 h-3 text-slate-400" />
                    <span>File History</span>
                    <span className="text-slate-300 normal-case font-sans">({docDetail.activity.length})</span>
                  </span>
                  <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform shrink-0 ${showFileHistory ? 'rotate-90' : ''}`} />
                </button>
              </div>

              {/* Audit status: when it was last formally audited, and by whom, with a one-click re-audit action. */}
              <div className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-[10px] ${docDetail.document.needsAudit ? 'bg-amber-50 border border-amber-100' : 'bg-emerald-50 border border-emerald-100'}`}>
                <span className={`flex items-center space-x-1.5 font-semibold ${docDetail.document.needsAudit ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {docDetail.document.needsAudit ? <AlertTriangle className="w-3 h-3 shrink-0" /> : <ShieldCheck className="w-3 h-3 shrink-0" />}
                  <span>
                    {docDetail.document.lastAuditedAt
                      ? `${docDetail.document.needsAudit ? 'Needs re-audit — ' : 'Audited '}by ${docDetail.document.lastAuditedByName} on ${new Date(docDetail.document.lastAuditedAt).toLocaleDateString()}`
                      : 'Never audited'}
                  </span>
                </span>
                <button
                  onClick={handleAuditDocument}
                  className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-[9px] font-bold text-slate-600 shrink-0"
                >
                  Mark as audited
                </button>
              </div>

              {showFileHistory && (
                <div className="bg-slate-50/80 rounded-xl p-3 divide-y divide-slate-150/40 text-[11px] max-h-64 overflow-y-auto">
                  {docDetail.activity.length === 0 && (
                    <p className="text-slate-400 text-[10px] py-1">No recorded activity yet.</p>
                  )}
                  {docDetail.activity.map(entry => {
                    const { Icon, text } = getActivityIconInfo(entry.action);
                    return (
                      <div key={entry.id} className="flex items-start space-x-2.5 py-2 first:pt-0 last:pb-0">
                        <div className={`w-6 h-6 rounded-lg bg-white border border-slate-150 flex items-center justify-center shrink-0 ${text}`}>
                          <Icon className="w-3 h-3" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-slate-700 font-semibold">
                            {entry.action}
                            <span className="text-slate-400 font-medium"> · {entry.userName} ({entry.userRole})</span>
                          </p>
                          {entry.details && <p className="text-slate-500 mt-0.5">{entry.details}</p>}
                          <p className="text-[9px] text-slate-400 mt-0.5">{new Date(entry.createdAt).toLocaleString()}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            )}

            {/* Collaborative Conversation Comments list */}
            <div className="space-y-2">
              <span className="text-[10px] font-mono font-semibold tracking-wider text-slate-400 uppercase">Document Comments</span>
              
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {docDetail.comments.length === 0 ? (
                  <p className="text-[10px] text-slate-400 py-3 text-center">No annotations added yet. Type below to seed.</p>
                ) : (
                  docDetail.comments.map(comment => (
                    <div key={comment.id} className="bg-slate-50 p-2.5 rounded-xl text-[10px] leading-relaxed">
                      <div className="flex justify-between font-bold text-slate-700 mb-1">
                        <span>{comment.userName} ({comment.userRole})</span>
                        <span className="text-[8px] font-mono text-slate-400">
                          {new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-slate-600 font-medium">{comment.text}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Add comment form input */}
              <form onSubmit={handleAddComment} className="flex space-x-1.5 mt-2">
                <input
                  type="text"
                  placeholder="Discuss this dossier..."
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  className="flex-1 bg-slate-100 border-none rounded-xl p-2 text-[10px] outline-none text-slate-800"
                />
                <button 
                  type="submit"
                  className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shrink-0"
                >
                  <Send className="w-3 h-3 text-white" />
                </button>
              </form>
            </div>

          </div>
        </aside>
      )}

      {/* ----------------- MODALS DIALOGS BACKGROULDS ----------------- */}

      {/* 1. MODAL: UPLOAD FILE SCENE */}
      {showUploadModal && currentUser && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 mx-4 transform scale-100 transition-all flex flex-col max-h-[90vh] overflow-hidden">
            
            <div className="flex justify-between items-center pb-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center space-x-2">
                <Upload className="w-5 h-5 text-indigo-600 shrink-0" />
                <h3 className="font-display font-extrabold text-slate-800">Upload Files to Cabinet</h3>
              </div>
              <button onClick={() => setShowUploadModal(false)} className="p-1 hover:bg-slate-100 rounded-lg">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleDocUpload} className="flex-1 overflow-y-auto py-4 space-y-4 pr-1 text-xs text-slate-600 font-medium">

              {/* File upload */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">
                  File (.txt, .pdf, .jpg, .png etc.)
                </label>
                <div className="border-2 border-dashed border-slate-200 hover:border-indigo-300 rounded-xl p-4 text-center cursor-pointer relative bg-slate-50/50 hover:bg-indigo-50/10">
                  <input
                    type="file"
                    onChange={handleCustomFileChange}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                  <p className="text-[10px] text-slate-400">
                    {upCustomFile ? `Selected: ${upCustomFile.name}` : `Drag and drop file or click browse`}
                  </p>
                </div>
                {/* Mobile document scan: opens the camera on phones/tablets */}
                <label className="flex items-center justify-center space-x-1.5 w-full border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 rounded-xl py-2 cursor-pointer text-[10px] font-bold text-slate-500">
                  <Camera className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Scan with camera</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleCustomFileChange}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Title Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Title</label>
                <input
                  type="text"
                  placeholder="e.g. Acme Supplier Service Level NDA"
                  value={upTitle}
                  onChange={(e) => setUpTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white"
                  required
                />
              </div>

              {/* Description Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Description</label>
                <textarea
                  placeholder="Briefly review what the document contents are..."
                  value={upDesc}
                  onChange={(e) => setUpDesc(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none h-14 resize-none focus:ring-2 focus:ring-indigo-100 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                {/* Category Type selector */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Category</label>
                  <select
                    value={upCategory}
                    onChange={(e) => setUpCategory(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none"
                  >
                    <option value="Other">Other Category</option>
                    <option value="Contract">Contract (NDA/Lease)</option>
                    <option value="Invoice">Invoice Transaction</option>
                    <option value="Memo">Internal Memo</option>
                    <option value="Report">Quant Report</option>
                    <option value="Support">Support Resource</option>
                  </select>
                </div>

                {/* Scoped Department / Unit */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Unit / Department</label>
                  <input
                    type="text"
                    placeholder={currentUser.department || "e.g. Procurement"}
                    value={upDept}
                    onChange={(e) => setUpDept(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none"
                  />
                </div>
              </div>

              {/* Pre-upload scan result */}
              <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center space-x-1 text-[11px] font-bold text-sky-800">
                    {uploadScanLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-600" /> : <Sparkles className="w-3.5 h-3.5 text-sky-600" />}
                    <span>Pre-upload smart scan</span>
                  </span>
                  {uploadScan && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-black text-sky-700 border border-sky-100">
                      {uploadScan.documentType}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  {uploadScanLoading
                    ? 'Scanning file...'
                    : uploadScan
                      ? uploadScan.description
                      : 'Choose a file and it will be scanned, classified, and routed to the matching cabinet.'}
                </p>
                {uploadScan && (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1">
                      {uploadScan.tags.slice(0, 5).map(tag => (
                        <span key={tag} className="rounded-full bg-white border border-sky-100 px-2 py-0.5 text-[9px] font-bold text-slate-500">#{tag}</span>
                      ))}
                    </div>
                    {!uploadScan.cabinetExists && uploadScan.missingCabinets.length > 0 && (
                      <p className="flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>Missing cabinet{uploadScan.missingCabinets.length === 1 ? '' : 's'} will be created automatically: {uploadScan.missingCabinets.join(' / ')}.</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Automatic Smart Filing */}
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-2">
                <label className="flex items-start space-x-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={upAutoFile}
                    onChange={(e) => setUpAutoFile(e.target.checked)}
                    className="mt-0.5 accent-indigo-600 w-3.5 h-3.5"
                  />
                  <span>
                    <span className="flex items-center space-x-1 text-[11px] font-bold text-indigo-800">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Auto-file into smart folders</span>
                    </span>
                    <span className="block text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                      Automatically place this file in the right cabinet by unit and category.
                    </span>
                  </span>
                </label>

                {upAutoFile ? (
                  <div className="flex items-center space-x-2 text-[10px] bg-white rounded-lg border border-indigo-100 px-2.5 py-1.5">
                    <CornerDownRight className="w-3 h-3 text-indigo-500 shrink-0" />
                    <span className="text-slate-400 font-mono uppercase tracking-wider text-[9px]">Destination</span>
                    <span className="font-bold text-indigo-700 truncate">{uploadScan?.filedInto || autoFilePreview()}</span>
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-500 pl-6">
                    Will be placed in the current location ({currentFolderId ? (folders.find(f => f.id === currentFolderId)?.name || 'selected folder') : 'Folder Cabinets / Root'}).
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={uploadScanLoading}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-100 mt-4 h-10 flex items-center justify-center space-x-1"
              >
                {uploadScanLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{uploadScanLoading ? 'Scanning before upload...' : 'Upload to detected cabinet'}</span>
              </button>

            </form>
          </div>
        </div>
      )}

      {/* 2. MODAL: CREATE FOLDER */}
      {showFolderModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 mx-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100 mb-4">
              <h3 className="font-display font-extrabold text-slate-800 text-sm">Create Cabinet / Folder</h3>
              <button onClick={() => setShowFolderModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleCreateFolder} className="space-y-4 text-xs font-medium text-slate-600">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Folder Name</label>
                <input
                  type="text"
                  placeholder="e.g. Supplier Invoices 2026"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Department Assignment Scope</label>
                <input
                  type="text"
                  placeholder={currentUser?.department || "Procurement"}
                  value={folderScopeDept}
                  onChange={(e) => setFolderScopeDept(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold shadow-sm shadow-indigo-100 transition-all"
              >
                Create Folder
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 3. MODAL: REQUEST APPROVAL */}
      {showApprovalModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 mx-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100 mb-4">
              <h3 className="font-display font-extrabold text-slate-800 text-sm">Request Validation Review</h3>
              <button onClick={() => setShowApprovalModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleRequestApproval} className="space-y-4 text-xs font-medium text-slate-600">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Select Manager Approver</label>
                <select
                  value={approvalApproverId}
                  onChange={(e) => setApprovalApproverId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none"
                  required
                >
                  <option value="">Choose organization manager...</option>
                  {users.filter(u => u.role === 'Manager' || u.role === 'Admin').map(m => (
                    <option key={m.id} value={m.id}>
                      {m.fullName} ({m.department} Manager)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Context note annotations</label>
                <textarea
                  placeholder="Provide details about the review requests (e.g. Standard SLA check needed)"
                  value={approvalRequestComment}
                  onChange={(e) => setApprovalRequestComment(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs h-16 resize-none outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold flex items-center justify-center space-x-1"
              >
                <Send className="w-3.5 h-3.5 text-white" />
                <span>Submit Approval Request</span>
              </button>
            </form>
          </div>
        </div>
      )}


      {/* MODAL: GET LINK (Dropbox-style shareable link with expiry + password) */}
      {linkModalDocId && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs" onClick={() => setLinkModalDocId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center pb-3 border-b border-slate-100 mb-4">
              <h3 className="font-display font-extrabold text-slate-800 text-sm flex items-center space-x-2">
                <Link2 className="w-4 h-4 text-indigo-600" /><span>Get shareable link</span>
              </h3>
              <button onClick={() => setLinkModalDocId(null)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            {!createdLink ? (
              <div className="space-y-4 text-xs font-medium text-slate-600">
                <p className="text-[11px] text-slate-500">Anyone with the link can open this document. Tune the access below.</p>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Message (optional)</label>
                  <textarea value={linkMessage} onChange={(e) => setLinkMessage(e.target.value)} placeholder="Add a note for the recipient…" className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none resize-none h-14" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Link expires</label>
                    <select value={linkExpiry} onChange={(e) => setLinkExpiry(e.target.value)} className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none">
                      <option value="1">In 24 hours</option>
                      <option value="7">In 7 days</option>
                      <option value="30">In 30 days</option>
                      <option value="never">Never</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Max downloads</label>
                    <input type="number" min="1" value={linkMaxDownloads} onChange={(e) => setLinkMaxDownloads(e.target.value)} placeholder="Unlimited" className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Permission</label>
                  <select value={linkPermission} onChange={(e) => setLinkPermission(e.target.value as 'Viewer' | 'Commenter')} className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none">
                    <option value="Viewer">Can view</option>
                    <option value="Commenter">Can comment</option>
                  </select>
                </div>

                <label className="flex items-center space-x-2.5 cursor-pointer">
                  <input type="checkbox" checked={linkAllowDownload} onChange={(e) => setLinkAllowDownload(e.target.checked)} className="w-3.5 h-3.5 accent-indigo-600" />
                  <span className="text-xs text-slate-600">Allow download <span className="text-slate-400">(uncheck for view-only)</span></span>
                </label>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase flex items-center space-x-1"><Lock className="w-3 h-3" /><span>Password (optional)</span></label>
                  <input type="text" value={linkPassword} onChange={(e) => setLinkPassword(e.target.value)} placeholder="Leave blank for no password" className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none" />
                </div>

                <button onClick={handleCreateShareLink} disabled={linkLoading} className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold flex items-center justify-center space-x-2">
                  {linkLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                  <span>{linkLoading ? 'Creating…' : 'Create link'}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4 text-xs font-medium text-slate-600">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Your short link</label>
                  <div className="flex items-center space-x-2">
                    <input readOnly value={shortLinkUrl(createdLink.shortCode)} className="flex-1 bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none font-mono" onFocus={(e) => e.target.select()} />
                    <button onClick={() => copyToClipboard(shortLinkUrl(createdLink.shortCode))} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5">
                      <Copy className="w-3.5 h-3.5" /><span>Copy</span>
                    </button>
                  </div>
                </div>
                {createdLink.message && <p className="text-[11px] text-slate-500 italic">“{createdLink.message}”</p>}
                <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                  <span className="px-2 py-1 bg-slate-100 rounded-md text-slate-600">{createdLink.permissionType === 'Commenter' ? 'CAN COMMENT' : 'VIEW ONLY'}</span>
                  <span className="px-2 py-1 bg-slate-100 rounded-md text-slate-600">{createdLink.allowDownload === false ? 'NO DOWNLOAD' : 'DOWNLOADABLE'}</span>
                  {createdLink.hasPassword && <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-md flex items-center space-x-1"><Lock className="w-3 h-3" /><span>PASSWORD</span></span>}
                  <span className="px-2 py-1 bg-slate-100 rounded-md text-slate-600">{new Date(createdLink.expiresAt).getFullYear() > 2900 ? 'NO EXPIRY' : `EXPIRES ${new Date(createdLink.expiresAt).toLocaleDateString()}`}</span>
                  <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-md flex items-center space-x-1"><Eye className="w-3 h-3" /><span>VIEWED {createdLink.accessCount}×</span></span>
                  <span className="px-2 py-1 bg-sky-50 text-sky-700 rounded-md flex items-center space-x-1"><Download className="w-3 h-3" /><span>{createdLink.downloadCount || 0}{createdLink.maxDownloads ? `/${createdLink.maxDownloads}` : ''} DL</span></span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <button onClick={() => setCreatedLink(null)} className="text-[11px] font-bold text-indigo-600 hover:underline">Create another</button>
                  <button onClick={() => setLinkModalDocId(null)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[11px] font-bold">Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. MODAL: SHARE OPTIONS */}
      {showShareModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 mx-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100 mb-4">
              <h3 className="font-display font-extrabold text-slate-800 text-sm">Configure Permission Shared Matrices</h3>
              <button onClick={() => setShowShareModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleShareDocument} className="space-y-4 text-xs font-medium text-slate-600">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Target Shared Recipient User</label>
                <select
                  value={shareTargetUserId}
                  onChange={(e) => setShareTargetUserId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none"
                  required
                >
                  <option value="">Select organizational staff...</option>
                  {users.filter(u => u.id !== currentUser?.id).map(u => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} ({u.role} - {u.department})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Permission Access Level</label>
                <select
                  value={sharePermissionType}
                  onChange={(e) => setSharePermissionType(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none"
                >
                  <option value="Viewer">Viewer (Can View Only)</option>
                  <option value="Commenter">Commenter (Can View and Comment)</option>
                  <option value="Editor">Editor (Can Upload & Edit Metadata)</option>
                </select>
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold flex items-center justify-center space-x-1"
              >
                <Users className="w-3.5 h-3.5 text-white" />
                <span>Adjust Scoped Permissions</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 5. MODAL: MOVE LOCATION */}
      {showMoveModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 mx-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100 mb-4">
              <h3 className="font-display font-extrabold text-slate-800 text-sm">Move Folder Destination</h3>
              <button onClick={() => setShowMoveModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleMoveDocument} className="space-y-4 text-xs font-medium text-slate-600">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Target Directory Destination</label>
                <select
                  value={moveTargetFolderId}
                  onChange={(e) => setMoveTargetFolderId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none"
                >
                  <option value="root">Folder Cabinets / Root</option>
                  {folders.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.department || 'GLOBAL'})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold shadow-sm shadow-indigo-100 transition-all"
              >
                Move Document
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

// Inline Activity Log table renderer pulling securely from state context API
function ActivityLogView() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = () => {
    fetch('/api/activity')
      .then(res => res.json())
      .then(data => {
        setLogs(Array.isArray(data) ? data : []);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchLogs();
    // poll for log updates subtly
    const interval = setInterval(fetchLogs, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <p className="text-[11px] text-slate-400 p-4 shrink-0 font-medium">Reading audit database registers...</p>;
  }

  if (logs.length === 0) {
    return <p className="text-[11px] text-slate-400 p-4 shrink-0 font-medium">No actions registered in the immutable ledger.</p>;
  }

  return (
    <table className="w-full text-left text-xs text-slate-600 font-medium">
      <thead className="bg-slate-50 text-[9px] text-slate-400 font-mono font-bold uppercase tracking-wider">
        <tr>
          <th className="py-2 px-4">Action</th>
          <th className="py-2 px-4">User Initiator</th>
          <th className="py-2 px-4">Target dossier info</th>
          <th className="py-2 px-4">Trace Details</th>
          <th className="py-2 px-4">Ledger Timing</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {logs.map(log => (
          <tr key={log.id} className="hover:bg-slate-50/50">
            <td className="py-2.5 px-4">
              <span className={`px-2 py-0.5 text-[9px] font-extrabold rounded-full ${
                log.action === 'Login' ? 'bg-indigo-50 text-indigo-700' :
                log.action === 'Upload' || log.action === 'Upload Version' ? 'bg-sky-50 text-sky-700' :
                log.action === 'Approved' ? 'bg-emerald-50 text-emerald-700' :
                log.action === 'Delete' || log.action === 'Purge Document' ? 'bg-rose-50 text-rose-700' :
                'bg-slate-100 text-slate-600'
              }`}>
                {log.action}
              </span>
            </td>
            <td className="py-2.5 px-4 font-bold text-slate-700">
              {log.userName} ({log.userRole})
            </td>
            <td className="py-2.5 px-4 truncate max-w-[150px]" title={log.documentTitle || ''}>
              {log.documentTitle || 'GLOBAL SYSTEM'}
            </td>
            <td className="py-2.5 px-4 text-[11px] text-slate-500">
              {log.details}
            </td>
            <td className="py-2.5 px-4 font-mono text-[9px] text-slate-400">
              {new Date(log.createdAt).toLocaleTimeString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}


const USER_ROLE_OPTIONS: User['role'][] = ['Admin', 'Manager', 'Staff', 'Viewer', 'Auditor'];

type UserFormState = Pick<User, 'fullName' | 'email' | 'role' | 'department' | 'isActive'>;

const emptyUserForm: UserFormState = {
  fullName: '',
  email: '',
  role: 'Staff',
  department: '',
  isActive: true
};

function UserManagementView({
  users,
  currentUser,
  onUsersChanged,
  onToast
}: {
  users: User[];
  currentUser: User;
  onUsersChanged: (users: User[], currentUser?: User) => void;
  onToast: (text: string, type?: 'success' | 'info' | 'error') => void;
}) {
  const [form, setForm] = useState<UserFormState>({ ...emptyUserForm, department: currentUser.department });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Freshly issued temporary credentials, shown once after create/reset.
  const [issuedCreds, setIssuedCreds] = useState<{ name: string; email: string; tempPassword: string; emailSent: boolean } | null>(null);
  const canManage = currentUser.role === 'Admin';
  const activeUsers = users.filter(u => u.isActive).length;
  const adminUsers = users.filter(u => u.role === 'Admin' && u.isActive).length;

  const reset = () => {
    setEditingId(null);
    setForm({ ...emptyUserForm, department: currentUser.department });
    setError('');
  };

  const refreshUsers = (updated?: User) => {
    fetch('/api/users')
      .then(res => res.json())
      .then((data: User[]) => {
        const nextCurrent = updated?.id === currentUser.id ? updated : data.find(u => u.id === currentUser.id);
        onUsersChanged(data, nextCurrent);
      });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError('');
    fetch(editingId ? `/api/users/${editingId}` : '/api/users', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    })
      .then(res => res.json())
      .then((data) => {
        setSaving(false);
        if (data.error) {
          setError(data.error);
          onToast(data.error, 'error');
          return;
        }
        onToast(editingId ? 'User profile updated.' : 'User profile created.', 'success');
        if (!editingId && data.tempPassword) {
          setIssuedCreds({ name: data.fullName, email: data.email, tempPassword: data.tempPassword, emailSent: Boolean(data.emailSent) });
        }
        reset();
        refreshUsers(data);
      })
      .catch(() => {
        setSaving(false);
        setError('Could not save user profile.');
        onToast('Could not save user profile.', 'error');
      });
  };

  const edit = (user: User) => {
    setEditingId(user.id);
    setForm({
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      department: user.department,
      isActive: user.isActive
    });
    setError('');
  };

  const resetPassword = (user: User) => {
    if (!canManage) return;
    if (!window.confirm(`Reset the password for ${user.fullName}? Their current password stops working immediately.`)) return;
    fetch(`/api/users/${user.id}/reset-password`, { method: 'POST' })
      .then(res => res.json())
      .then((data) => {
        if (data.error) return onToast(data.error, 'error');
        setIssuedCreds({ name: user.fullName, email: user.email, tempPassword: data.tempPassword, emailSent: Boolean(data.emailSent) });
        onToast(`Password reset for ${user.fullName}.`, 'success');
      })
      .catch(() => onToast('Could not reset the password.', 'error'));
  };

  const toggleActive = (user: User) => {
    if (!canManage) return;
    fetch(`/api/users/${user.id}/toggle-active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !user.isActive })
    })
      .then(res => res.json())
      .then((data) => {
        if (data.error) {
          onToast(data.error, 'error');
          return;
        }
        onToast(data.isActive ? 'User activated.' : 'User deactivated.', 'success');
        refreshUsers(data);
      })
      .catch(() => onToast('Could not update user status.', 'error'));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-display font-extrabold text-slate-800 tracking-tight">User Management</h2>
          <p className="text-xs text-slate-400">Create staff profiles, assign roles and departments, and deactivate unused accounts.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right">
          <div className="bg-white border border-slate-100 rounded-2xl px-4 py-2 shadow-sm">
            <p className="text-[9px] font-mono font-bold text-slate-400 uppercase">Active Users</p>
            <p className="font-display text-lg font-extrabold text-slate-800">{activeUsers}</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl px-4 py-2 shadow-sm">
            <p className="text-[9px] font-mono font-bold text-slate-400 uppercase">Admins</p>
            <p className="font-display text-lg font-extrabold text-indigo-600">{adminUsers}</p>
          </div>
        </div>
      </div>

      {!canManage && (
        <div className="bg-amber-50 border border-amber-100 text-amber-700 rounded-2xl px-4 py-3 text-xs font-semibold">
          User records are read-only for your role. Only an Admin can create or edit users.
        </div>
      )}

      {issuedCreds && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-4 py-3 text-xs flex items-start justify-between gap-3">
          <div>
            <p className="font-bold text-indigo-800">Temporary password for {issuedCreds.name}</p>
            <p className="text-indigo-600 mt-1">
              <code className="bg-white border border-indigo-100 rounded-md px-2 py-0.5 font-mono text-[11px] select-all">{issuedCreds.tempPassword}</code>
              <span className="ml-2 text-[10px] text-indigo-400">
                {issuedCreds.emailSent ? `Also emailed to ${issuedCreds.email}.` : 'Share it securely — it is shown only once.'}
              </span>
            </p>
            <p className="text-[10px] text-indigo-400 mt-1">They'll be asked to choose their own password at first sign-in.</p>
          </div>
          <button onClick={() => setIssuedCreds(null)} className="p-1 text-indigo-300 hover:text-indigo-500"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">Workspace People</span>
            <span className="text-[10px] text-slate-400 font-semibold">{users.length} total profiles</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white border-b border-slate-50 text-[10px] font-mono font-bold uppercase text-slate-400">
                <tr>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 font-medium text-slate-600">
                {users.map(user => (
                  <tr key={user.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-mono font-bold text-[11px] uppercase">
                          {user.fullName.split(' ').map(n => n[0]).join('').slice(0, 3)}
                        </div>
                        <div>
                          <p className="font-bold text-slate-800">{user.fullName}</p>
                          <p className="text-[10px] text-slate-400">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4"><span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-mono font-bold">{user.role}</span></td>
                    <td className="py-3 px-4 text-slate-500">{user.department}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-bold ${user.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center space-x-1">
                        <button onClick={() => edit(user)} disabled={!canManage} className="p-2 rounded-lg hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 disabled:opacity-40" title="Edit user">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => resetPassword(user)} disabled={!canManage} className="p-2 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-600 disabled:opacity-40" title="Reset password">
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => toggleActive(user)} disabled={!canManage || user.id === currentUser.id} className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-[10px] font-bold text-slate-500 disabled:opacity-40">
                          {user.isActive ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <form onSubmit={submit} className="w-full max-w-md mx-auto lg:max-w-none bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <UserPlus className="w-3.5 h-3.5" />
              </div>
              <h3 className="font-display font-extrabold text-slate-800 text-sm">{editingId ? 'Edit User' : 'Create User'}</h3>
            </div>
            {editingId && <button type="button" onClick={reset} className="text-[10px] font-bold text-slate-400 hover:text-slate-600">Cancel</button>}
          </div>
          {error && <div className="bg-rose-50 border border-rose-100 text-rose-600 text-[11px] font-semibold rounded-xl p-2.5">{error}</div>}
          <div className="space-y-1.5">
            <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Full Name</label>
            <input value={form.fullName} disabled={!canManage} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white disabled:opacity-60" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Email</label>
            <input type="email" value={form.email} disabled={!canManage} onChange={(e) => setForm({ ...form, email: e.target.value })} required className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white disabled:opacity-60" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Role</label>
              <select value={form.role} disabled={!canManage} onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })} className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white disabled:opacity-60">
                {USER_ROLE_OPTIONS.map(role => <option key={role} value={role}>{role}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Status</label>
              <select value={form.isActive ? 'active' : 'inactive'} disabled={!canManage} onChange={(e) => setForm({ ...form, isActive: e.target.value === 'active' })} className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white disabled:opacity-60">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Department</label>
            <input value={form.department} disabled={!canManage} onChange={(e) => setForm({ ...form, department: e.target.value })} required className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white disabled:opacity-60" />
          </div>
          <button type="submit" disabled={!canManage || saving} className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold disabled:opacity-50">
            {saving ? 'Saving…' : editingId ? 'Save User' : 'Create User'}
          </button>
        </form>
      </div>
    </div>
  );
}

function SettingsView({
  currentUser,
  stats,
  orgProfile,
  onSaved
}: {
  currentUser: User;
  stats: DashboardStats | null;
  orgProfile: Institution | null;
  onSaved: (inst: Institution) => void;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'institution'>('overview');

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: Database },
    { id: 'institution' as const, label: 'Institution Profile', icon: Building2 }
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-display font-extrabold text-slate-800 tracking-tight">Settings</h2>
        <p className="text-xs text-slate-400">Configure workspace defaults, filing taxonomy, and account access controls.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-slate-100 bg-slate-50/60 p-1" role="tablist" aria-label="Settings sections">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-white text-indigo-700 shadow-sm border border-slate-100'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-white/70'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="p-4">
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4" role="tabpanel">
              <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                <p className="text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">Current Workspace</p>
                <h3 className="font-display font-bold text-slate-800">{orgProfile?.name || 'Workspace'}</h3>
                <p className="text-[11px] text-slate-400 mt-1">{orgProfile?.units?.length || 0} department units configured.</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                <p className="text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">Document Scope</p>
                <h3 className="font-display font-bold text-slate-800">{stats?.totalFiles ?? 0} visible files</h3>
                <p className="text-[11px] text-slate-400 mt-1">Archive, trash, and approval counts remain role-aware.</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                <p className="text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">Signed In Role</p>
                <h3 className="font-display font-bold text-slate-800">{currentUser.role}</h3>
                <p className="text-[11px] text-slate-400 mt-1">{currentUser.department} department access.</p>
              </div>
            </div>
          )}

          {activeTab === 'institution' && (
            <div role="tabpanel">
              <InstitutionProfileView currentUser={currentUser} onSaved={onSaved} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Institution profile editor. Admins configure the auto-filing taxonomy here:
// the institution name, units, per-category folder names, and whether an
// AI-extracted activity sub-level is added. Non-admins see a read-only view.
const DOC_CATEGORIES: { key: Document['documentType']; label: string }[] = [
  { key: 'Contract', label: 'Contracts' },
  { key: 'Invoice', label: 'Invoices' },
  { key: 'Memo', label: 'Memos' },
  { key: 'Report', label: 'Reports' },
  { key: 'Support', label: 'Support' },
  { key: 'Other', label: 'Other' }
];

function InstitutionProfileView({
  currentUser,
  onSaved
}: {
  currentUser: User;
  onSaved: (inst: Institution) => void;
}) {
  const [inst, setInst] = useState<Institution | null>(null);
  const [unitsText, setUnitsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canEdit = currentUser.role === 'Admin';

  useEffect(() => {
    fetch('/api/institution')
      .then(res => res.json())
      .then((d: Institution) => {
        setInst(d);
        setUnitsText((d.units || []).join(', '));
      });
  }, []);

  if (!inst) {
    return <p className="text-xs text-slate-400 p-4">Loading institution profile…</p>;
  }

  const updateCat = (cat: Document['documentType'], val: string) =>
    setInst({ ...inst, categoryFolders: { ...inst.categoryFolders, [cat]: val } });

  const save = () => {
    setSaving(true);
    setError('');
    fetch('/api/institution', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: inst.name,
        units: unitsText.split(/[,\n]/).map(s => s.trim()).filter(Boolean),
        categoryFolders: inst.categoryFolders,
        activityDimension: inst.activityDimension
      })
    })
      .then(res => res.json())
      .then((d) => {
        setSaving(false);
        if (d.error) {
          setError(d.error);
        } else {
          setInst(d);
          setUnitsText((d.units || []).join(', '));
          onSaved(d);
        }
      })
      .catch(() => {
        setSaving(false);
        setError('Failed to save institution profile.');
      });
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex flex-col">
        <h2 className="text-xl font-display font-extrabold text-slate-800 tracking-tight">Institution Profile</h2>
        <p className="text-xs text-slate-400">
          Defines how documents are automatically organized. Uploads are filed under
          <span className="font-mono font-bold text-slate-500"> Unit / Category{inst.activityDimension === 'ai-activity' ? ' / Activity' : ''}</span>.
          {!canEdit && ' (Read-only — Admin access required to edit.)'}
        </p>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 text-[11px] font-semibold rounded-xl p-2.5">{error}</div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-5">
        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Institution Name</label>
          <input
            type="text"
            value={inst.name}
            disabled={!canEdit}
            onChange={(e) => setInst({ ...inst, name: e.target.value })}
            className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white disabled:opacity-60"
          />
        </div>

        {/* Units */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Units / Departments (comma-separated)</label>
          <textarea
            value={unitsText}
            disabled={!canEdit}
            onChange={(e) => setUnitsText(e.target.value)}
            className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none h-16 resize-none focus:ring-2 focus:ring-indigo-100 focus:bg-white disabled:opacity-60"
          />
        </div>

        {/* Category folder names */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Category Folder Names</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {DOC_CATEGORIES.map(({ key, label }) => (
              <div key={key} className="flex items-center space-x-2">
                <span className="text-[10px] font-mono font-bold text-slate-400 w-16 shrink-0">{label}</span>
                <input
                  type="text"
                  value={inst.categoryFolders[key] || ''}
                  disabled={!canEdit}
                  onChange={(e) => updateCat(key, e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-150 rounded-xl p-2 px-3 text-xs outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white disabled:opacity-60"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Activity dimension */}
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
          <label className="flex items-start space-x-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={inst.activityDimension === 'ai-activity'}
              disabled={!canEdit}
              onChange={(e) => setInst({ ...inst, activityDimension: e.target.checked ? 'ai-activity' : 'none' })}
              className="mt-0.5 accent-indigo-600 w-3.5 h-3.5"
            />
            <span>
              <span className="flex items-center space-x-1 text-[11px] font-bold text-indigo-800">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                <span>Add AI-extracted activity sub-level</span>
              </span>
              <span className="block text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                When enabled, the AI infers a short activity/project label per document and nests it as a third folder level (e.g. <span className="font-mono">Finance / Invoices / Vendor Onboarding</span>).
              </span>
            </span>
          </label>
        </div>

        {canEdit && (
          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold disabled:opacity-60 flex items-center space-x-1.5"
            >
              <Check className="w-3.5 h-3.5 text-white" />
              <span>{saving ? 'Saving…' : 'Save Profile'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
