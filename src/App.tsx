/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
  AlertTriangle
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
  DashboardStats 
} from './types';
import Sidebar from './components/Sidebar';

// Pre-packaged document content presets for OCR & tagging testing options
const SAMPLE_PRESETS = [
  {
    title: "Supplier Equipment Lease 2026",
    fileName: "lease_agreement_draft.txt",
    fileType: "text/plain",
    textValue: "LEASE AGREEMENT\nLESSOR: SmartOffice Assets LLC\nLESSEE: DocuHub Enterprise Inc\nSUBJECT: High-speed server cluster rack\nMONTHLY CHARGE: $450.00\nDURATION: 24 Months commencing June 1 2026.\nTERMS: Guaranteed up-time of hardware segments, replacement within 12 hours in case of redundancy failure.",
    category: "Contract"
  },
  {
    title: "AWS Cloud Infrastructure Billing",
    fileName: "aws_invoice_may_2026.txt",
    fileType: "text/plain",
    textValue: "INVOICE - Amazon Web Services Inc.\nINVOICE NUMBER: AWS-99231-A\nDATE: May 30, 2026\nCHARGES:\n1. EC2 Compute Instances: $1,420.50\n2. S3 Persistent storage: $840.10\n3. RDS Database backups: $320.00\nTOTAL SECURE CHARGE: $2,580.60\nPAYMENT DUE: June 15, 2026\nACCOUNT STATUS: Active",
    category: "Invoice"
  },
  {
    title: "Compliance Risk Assessment Draft",
    fileName: "compliance_audit_memo.txt",
    fileType: "text/plain",
    textValue: "INTERNAL MEMORANDUM\nTO: Procurement officers, Finance departments\nFROM: Lead auditor Robert Sterling\nDATE: June 1, 2026\nSUBJECT: External regulatory auditing constraints for 2026.\nPlease make sure all vendor agreements of tier-1 supply lines are registered inside the centralized Document Management System for official status validation or security audits. Failure with retention guidelines will trigger default penalties.",
    category: "Memo"
  },
  {
    title: "Scanned Payment Voucher Receipt",
    fileName: "payment_voucher_773.txt",
    fileType: "text/plain",
    textValue: "PAYMENT VOUCHER - OFFICIAL RECEIPT\nVoucher ID: PV-77382\nDepartment allocation: procurement-logistics\nAmount authorized: $3,200.00\nPAID TO: Global Supply Networks\nREASON: Standard container shipment customs clearing costs.\nAUTHORIZED BY: David Vance (Finance Unit Manager)",
    category: "Support"
  }
];

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

export default function App() {
  // Global Workspace state
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [folders, setFolders] = useState<FolderType[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<(ApprovalRequest & {
    documentTitle: string;
    documentOwner: string;
    documentType: string;
    documentDepartment?: string;
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
  } | null>(null);

  // Modals visibility triggers
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showExternalLinkModal, setShowExternalLinkModal] = useState(false);

  // Active inputs / fields state
  const [newCommentText, setNewCommentText] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [notification, setNotification] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);
  
  // Upload wizard inputs
  const [upTitle, setUpTitle] = useState('');
  const [upDesc, setUpDesc] = useState('');
  const [upCategory, setUpCategory] = useState<Document['documentType']>('Other');
  const [upPresetIndex, setUpPresetIndex] = useState<number>(-1);
  const [upCustomFile, setUpCustomFile] = useState<{ name: string; content: string; size: number } | null>(null);
  const [upDept, setUpDept] = useState('');
  const [upAutoFile, setUpAutoFile] = useState(true);

  // Institution profile that drives automatic folder filing (Unit -> Category).
  const [orgProfile, setOrgProfile] = useState<{
    name: string;
    units: string[];
    categoryFolders: Record<string, string>;
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

  // Fetch Users & Initialize. We establish a server-side session for the
  // default profile so identity is carried by an HttpOnly cookie rather than
  // spoofable request headers.
  useEffect(() => {
    fetch('/api/users')
      .then(res => res.json())
      .then((data: User[]) => {
        setUsers(data);
        const staff = data.find((u: User) => u.id === 'staff-1') || data[0];
        if (!staff) return;
        fetch('/api/users/switch-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: staff.id })
        })
          .then(res => res.json())
          .then(d => {
            if (d.user) setCurrentUser(d.user);
          });
      });
  }, []);

  // Sync Documents / Folders / Stats on user switch or action reload
  const reloadData = () => {
    if (!currentUser) return;
    
    // Header authentications passed to fetch scopes
    const headers = {
      'x-user-id': currentUser.id,
      'x-user-role': currentUser.role,
      'x-user-department': currentUser.department
    };

    // Calculate filter type parameters based on view name
    let filterType = 'active';
    if (currentView === 'trash') filterType = 'trash';
    if (currentView === 'archive') filterType = 'archive';
    if (currentView === 'shared-with-me') filterType = 'shared';

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

  // Load the institution profile once authenticated (drives auto-filing UI).
  useEffect(() => {
    if (!currentUser) return;
    fetch('/api/org-profile')
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
    return `${unit} / ${category}`;
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

  // Switch evaluated Profile user
  const handleUserChange = (userId: string) => {
    fetch('/api/users/switch-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        setCurrentUser(data.user);
        setSelectedDocId(null);
        setDocDetail(null);
        // Default to dashboard when switching profile
        setCurrentView('dashboard');
        setCurrentFolderId(null);
        setSearchQuery('');
        setCategoryFilter('');
        triggerToast(`Signed in as ${data.user.fullName} (${data.user.role})`, 'success');
      }
    });
  };

  // Create Folder action
  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    fetch('/api/folders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUser.id
      },
      body: JSON.stringify({
        name: folderName,
        parentFolderId: currentFolderId,
        department: folderScopeDept || currentUser.department
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        triggerToast(data.error, 'error');
      } else {
        setFolderName('');
        setShowFolderModal(false);
        triggerToast(`Folder "${data.name}" completed successfully!`, 'success');
        reloadData();
      }
    });
  };

  // Load Preset Details helper
  const handlePresetSelect = (idx: number) => {
    setUpPresetIndex(idx);
    if (idx >= 0) {
      const preset = SAMPLE_PRESETS[idx];
      setUpTitle(preset.title);
      setUpDesc(`OCR Scanning target from preset: ${preset.fileName}`);
      setUpCategory(preset.category as any);
      setUpCustomFile(null);
    } else {
      setUpTitle('');
      setUpDesc('');
      setUpCategory('Other');
    }
  };

  // Upload trigger
  const handleDocUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    let filename = "";
    let filedata = "";
    let size = 0;
    let type = "text/plain";

    if (upPresetIndex >= 0) {
      const preset = SAMPLE_PRESETS[upPresetIndex];
      filename = preset.fileName;
      filedata = btoa(preset.textValue);
      size = preset.textValue.length;
    } else if (upCustomFile) {
      filename = upCustomFile.name;
      filedata = upCustomFile.content; // text base64 or raw string
      size = upCustomFile.size;
      type = upCustomFile.name.endsWith('.png') || upCustomFile.name.endsWith('.jpg') ? 'image/png' : 'text/plain';
    } else {
      triggerToast('Please choose a preset template or upload a custom file configuration.', 'error');
      return;
    }

    setUploadProgress(15);
    const interval = setInterval(() => {
      setUploadProgress(p => p !== null && p < 90 ? p + 25 : p);
    }, 300);

    fetch('/api/documents/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUser.id,
        'x-user-role': currentUser.role,
        'x-user-department': currentUser.department
      },
      body: JSON.stringify({
        title: upTitle,
        description: upDesc,
        folderId: currentFolderId,
        documentType: upCategory,
        fileName: filename,
        fileSize: size,
        fileType: type,
        fileData: filedata,
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
        setUpPresetIndex(-1);
        setUpTitle('');
        setUpDesc('');
        setUpCustomFile(null);
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

  // Upload file custom handler
  const handleCustomFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const resultStr = reader.result as string;
      const base64Content = resultStr.split(',')[1] || btoa(resultStr);
      setUpCustomFile({
        name: file.name,
        size: file.size,
        content: base64Content
      });
      setUpTitle(file.name.replace(/\.[^/.]+$/, ""));
      setUpPresetIndex(-1);
    };
    
    // Read images as data URL base64, otherwise text readable
    if (file.type.startsWith('image/')) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  };

  // Versioning upload
  const handleNewVersionUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser || !selectedDocId) return;

    const reader = new FileReader();
    reader.onload = () => {
      const resultStr = reader.result as string;
      const base64Content = resultStr.split(',')[1] || btoa(resultStr);

      fetch(`/api/documents/${selectedDocId}/version`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id
        },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || 'text/plain',
          fileData: base64Content
        })
      })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          triggerToast(data.error, 'error');
        } else {
          triggerToast(`Successfully uploaded Version ${data.document.currentVersion}! OCR scanning re-indexed tags.`, 'success');
          fetchDocDetail(selectedDocId);
          reloadData();
        }
      });
    };

    if (file.type.startsWith('image/')) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  };

  // Direct comments action
  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !selectedDocId || !newCommentText.trim()) return;

    fetch('/api/comments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUser.id,
        'x-user-role': currentUser.role
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
      method: 'POST',
      headers: { 'x-user-id': currentUser.id }
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        triggerToast(data.document.isStarred ? 'Added to important Starred records.' : 'Removed from Starred files.', 'success');
        reloadData();
      }
    });
  };

  // Move document modal triggers
  const openMoveModal = (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedDocId(docId);
    setMoveTargetFolderId('root');
    setShowMoveModal(true);
  };

  const handleMoveDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !selectedDocId) return;

    fetch(`/api/documents/${selectedDocId}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUser.id
      },
      body: JSON.stringify({
        folderId: moveTargetFolderId === 'root' ? null : moveTargetFolderId
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        triggerToast(data.error, 'error');
      } else {
        triggerToast('Document layout paths updated cleanly!', 'success');
        setShowMoveModal(false);
        reloadData();
      }
    });
  };

  // Soft delete (Trash bin)
  const handleDeleteDocument = (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) return;

    fetch(`/api/documents/${docId}/delete`, {
      method: 'POST',
      headers: { 'x-user-id': currentUser.id }
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
      method: 'POST',
      headers: { 'x-user-id': currentUser.id }
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
      method: 'POST',
      headers: { 'x-user-id': currentUser.id }
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
      method: 'POST',
      headers: { 'x-user-id': currentUser.id }
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
        'Content-Type': 'application/json',
        'x-user-id': currentUser.id
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
        'Content-Type': 'application/json',
        'x-user-id': currentUser.id,
        'x-user-role': currentUser.role
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
  const openShareModal = (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
        'Content-Type': 'application/json',
        'x-user-id': currentUser.id
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

  // Generate External secure view-only link token
  const handleCreateExternalLink = (docId: string) => {
    if (!currentUser) return;

    fetch(`/api/documents/${docId}/external-link`, {
      method: 'POST',
      headers: { 'x-user-id': currentUser.id }
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        triggerToast(data.error, 'error');
      } else {
        triggerToast('External temporary token link created!', 'success');
        fetchDocDetail(docId);
      }
    });
  };

  // Revoke secure link token
  const handleRevokeExternalLink = (token: string) => {
    if (!currentUser) return;
    fetch(`/api/external-link/${token}/revoke`, {
      method: 'POST',
      headers: { 'x-user-id': currentUser.id }
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
    const list = [{ id: 'root', name: 'My Drive' }];
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

      {/* Main Workspace Sidebar */}
      {currentUser && (
        <Sidebar 
          currentView={currentView}
          onViewChange={(view) => {
            setCurrentView(view);
            if (view !== 'my-drive') {
              setCurrentFolderId(null);
            }
          }}
          onOpenUpload={() => {
            setUpPresetIndex(-1);
            setUpTitle('');
            setUpDesc('');
            setUpCategory('Other');
            setUpCustomFile(null);
            setUpDept(currentUser.department);
            setUpAutoFile(true);
            setShowUploadModal(true);
          }}
          onOpenCreateFolder={() => {
            setFolderName('');
            setFolderScopeDept(currentUser.department);
            setShowFolderModal(true);
          }}
          pendingWithMeCount={pendingApprovalsCount}
          currentUser={currentUser}
        />
      )}

      {/* Center Console Container */}
      <div className="flex-1 flex flex-col overflow-hidden">
        
        {/* Universal Space Navigation Bar */}
        <header className="h-16 bg-white border-b border-slate-150 flex items-center justify-between px-8 shrink-0">
          
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

            {/* Profile switch trigger */}
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono tracking-wider font-semibold text-slate-400 uppercase">Test profile:</span>
              <select
                value={currentUser?.id || ''}
                onChange={(e) => handleUserChange(e.target.value)}
                className="bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-1.5 text-[11px] font-semibold text-indigo-700 outline-none transition-all hover:bg-indigo-100"
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} ({u.role})
                  </option>
                ))}
              </select>
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
                  <h1 className="text-2xl font-display font-extrabold text-slate-900 tracking-tight">Enterprise Document Repository</h1>
                  <p className="text-xs text-slate-400 font-medium">Automatic OCR document tagging, strict role authorization structures, and automated auditable reviews.</p>
                </div>
                <div className="text-right text-[11px] font-mono font-bold text-slate-400">
                  <span>SYSTEM SERVER ACCESS: SECURE STORAGE OK</span>
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
                                  {doc.documentType === 'Invoice' ? <FileSpreadsheet className="w-4 h-4 text-sky-500" /> : <FileText className="w-4 h-4 text-indigo-500" />}
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

                {/* Interactive system notifications and OCR highlights */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm flex flex-col">
                  <h3 className="font-display font-bold text-slate-800 text-sm mb-3.5 flex items-center">
                    <Sparkles className="w-4 h-4 text-indigo-500 mr-1.5" />
                    <span>Intelligent Tag Tracker</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mb-4 font-medium leading-relaxed">
                    DocuHub uses Gemini 2.5 Flash to read documents and configure smart category metadata. Browse automated tags across active collections:
                  </p>
                  
                  <div className="flex flex-wrap gap-2">
                    {Array.from(new Set(documents.flatMap(d => d.tags))).slice(0, 15).map(tag => (
                      <button 
                        key={tag}
                        onClick={() => setSearchQuery(tag)} 
                        className="px-2.5 py-1 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-600 font-semibold rounded-lg text-[10px] border border-indigo-100/50 transition-all font-mono"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>

                  <div className="p-4 bg-slate-50 rounded-xl mt-5">
                    <p className="text-[10px] font-mono font-bold text-slate-400 uppercase mb-2">Sandbox Quick Instructions</p>
                    <ul className="text-[10px] text-slate-500 space-y-1.5 list-disc pl-3">
                      <li>Use the **Upload Document** wizard. Select a **preset template** to test how the OCR indexing automatically assigns categories!</li>
                      <li>Switch profiles to **Manager (David Vance)** in the header to approve files submitted by other users.</li>
                    </ul>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* 2. VIEW: MY DRIVE & FILE NAVIGATOR */}
          {(currentView === 'my-drive' || currentView === 'starred' || currentView === 'approved-files' || currentView === 'archive' || currentView === 'trash' || currentView === 'shared-with-me') && (
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
                      <span>{currentView.replace(/-/g, ' ')} Overview</span>
                    </span>
                  )}
                </div>

                <div className="text-xs text-slate-400">
                  <span>{documents.length} objects found</span>
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
                        className="bg-white border border-slate-100 hover:border-indigo-100 hover:shadow-sm p-3.5 rounded-xl flex items-center space-x-3 cursor-pointer transition-all select-none group"
                      >
                        <div className="w-8 h-8 rounded-lg bg-indigo-50/70 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-100/70 transition-all">
                          <Folder className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-slate-700 truncate group-hover:text-indigo-600">{fold.name}</h4>
                          {fold.department && (
                            <span className="text-[8px] font-mono px-1 py-0.2 bg-slate-100 text-slate-500 rounded block mt-0.5 truncate uppercase">
                              {fold.department}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Master files list */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
                {documents.length === 0 ? (
                  <div className="p-16 text-center text-slate-400 flex flex-col items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mb-3.5">
                      <File className="w-6 h-6" />
                    </div>
                    <h3 className="font-display font-bold text-slate-800 text-sm">Target folder looks empty</h3>
                    <p className="text-xs max-w-sm mt-1">There are no files registered in this specific directory mapping. Click 'Upload Document' to submit OCR items.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/70 border-b border-indigo-50/50">
                        <tr className="text-[10px] font-mono font-bold uppercase text-slate-400">
                          <th className="py-3 px-4 w-10"></th>
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
                              className={`hover:bg-slate-50/80 cursor-pointer transition-colors ${selectedDocId === doc.id ? 'bg-indigo-50/20' : ''}`}
                            >
                              <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                                <button onClick={(e) => handleToggleStar(doc.id, e)} className="text-slate-300 hover:text-amber-500 transition-colors">
                                  <Star className={`w-4 h-4 ${isDocStarred ? 'text-amber-500 fill-amber-400' : ''}`} />
                                </button>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center space-x-3">
                                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg shrink-0">
                                    {doc.documentType === 'Invoice' ? <FileSpreadsheet className="w-4.5 h-4.5 text-sky-600" /> : <FileText className="w-4.5 h-4.5" />}
                                  </div>
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
                                <div className="flex items-center justify-end space-x-1">
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
                                          onClick={(e) => openMoveModal(doc.id, e)}
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
                                <div className="p-2 bg-amber-50 text-amber-600 rounded-lg shrink-0">
                                  <FileText className="w-4 h-4" />
                                </div>
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

        </main>
      </div>

      {/* Primary Right Detail Sidebar Layout (Dynamic interactive view details, OCR snippets, comments, approvals) */}
      {selectedDocId && docDetail && (
        <aside className="w-96 bg-white border-l border-slate-150 flex flex-col h-full shrink-0 shadow-lg relative z-20 overflow-hidden">
          
          {/* Header detail */}
          <div className="p-5 border-b border-slate-50 flex items-start justify-between bg-slate-50/50">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs font-bold text-slate-800 truncate max-w-[200px]">{docDetail.document.title}</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">UUID: {docDetail.document.id}</p>
              </div>
            </div>
            
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

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            
            {/* Information specifications */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Document Information</span>
                {currentUser?.role !== 'Viewer' && (
                  <button 
                    onClick={() => handleCreateExternalLink(docDetail.document.id)}
                    className="text-[9px] text-indigo-600 font-bold hover:underline flex items-center space-x-0.5"
                  >
                    <Link2 className="w-3 h-3 text-indigo-500" />
                    <span>Generate Secure Link</span>
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

            {/* ACTIVE SHARED SECURE ACCESS LINK */}
            {docDetail.externalLinks && docDetail.externalLinks.length > 0 && (
              <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3.5 space-y-2">
                <span className="text-[10px] font-mono font-bold text-slate-400 uppercase block">Active Secure Remote Access Token Keys</span>
                {docDetail.externalLinks.map(link => {
                  const url = `${window.location.origin}/api/external/${link.token}`;
                  return (
                    <div key={link.id} className="text-[10px] p-2 bg-white rounded-lg border border-slate-100 space-y-1.5">
                      <div className="flex justify-between items-center">
                        <p className="font-mono text-slate-500 font-bold truncate max-w-[150px]" title={url}>{link.token}</p>
                        <div className="flex items-center space-x-1.5 shrink-0">
                          <button
                            onClick={() => {
                              navigator.clipboard?.writeText(url);
                              triggerToast('Secure link copied to clipboard.', 'success');
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
                      <p className="text-[8px] text-slate-400">
                        Expires {new Date(link.expiresAt).toLocaleDateString()} • {link.accessCount} view{link.accessCount === 1 ? '' : 's'}
                      </p>
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
                      href={downloadHref(ver.fileData, ver.fileType)}
                      download={ver.fileName}
                      className="p-1.5 bg-white border border-slate-150 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-800 transition-colors"
                      title="Download file"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  </div>
                ))}
              </div>
            </div>

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
                <h3 className="font-display font-extrabold text-slate-800">Upload and Process Scan</h3>
              </div>
              <button onClick={() => setShowUploadModal(false)} className="p-1 hover:bg-slate-100 rounded-lg">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleDocUpload} className="flex-1 overflow-y-auto py-4 space-y-4 pr-1 text-xs text-slate-600 font-medium">
              
              {/* Preset template selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">
                  Option A: Quick AI Document Presets (No local file required)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {SAMPLE_PRESETS.map((preset, idx) => (
                    <button
                      key={preset.title}
                      type="button"
                      onClick={() => handlePresetSelect(idx)}
                      className={`p-2.5 rounded-xl text-left border transition-all ${
                        upPresetIndex === idx 
                          ? 'border-indigo-600 bg-indigo-50/50 text-indigo-800 font-extrabold' 
                          : 'border-slate-100 bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <h5 className="font-bold truncate text-[11px]">{preset.title}</h5>
                      <p className="text-[8px] text-slate-400 mt-0.5 truncate">{preset.category} Template File</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Manual file upload */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">
                  Option B: Custom File Uploader (.txt, .pdf, .jpg, .png etc.)
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
              </div>

              {/* Title Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Document Domain Title</label>
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
                <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Brief Description Summary</label>
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
                  <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">Verification Category</label>
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
                      The system organizes this document by unit and category based on the institution profile{orgProfile?.name ? ` (${orgProfile.name})` : ''}.
                    </span>
                  </span>
                </label>

                {upAutoFile ? (
                  <div className="flex items-center space-x-2 text-[10px] bg-white rounded-lg border border-indigo-100 px-2.5 py-1.5">
                    <CornerDownRight className="w-3 h-3 text-indigo-500 shrink-0" />
                    <span className="text-slate-400 font-mono uppercase tracking-wider text-[9px]">Destination</span>
                    <span className="font-bold text-indigo-700 truncate">{autoFilePreview()}</span>
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-500 pl-6">
                    Will be placed in the current location ({currentFolderId ? (folders.find(f => f.id === currentFolderId)?.name || 'selected folder') : 'My Drive / Root'}).
                  </p>
                )}
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-100 mt-4 h-10 flex items-center justify-center space-x-1"
              >
                <span>Initialize Cloud Storage Upload (AI-OCR Indexing)</span>
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
              <h3 className="font-display font-extrabold text-slate-800 text-sm">Create Folder Directory</h3>
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
                className="w-full py-2 bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold"
              >
                Create Directory Folder
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
                className="w-full py-2 bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold flex items-center justify-center space-x-1"
              >
                <Send className="w-3.5 h-3.5 text-white" />
                <span>Submit Approval Request</span>
              </button>
            </form>
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
                className="w-full py-2 bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold flex items-center justify-center space-x-1"
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
                  <option value="root">My Drive / Root Directory Area</option>
                  {folders.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.department || 'GLOBAL'})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold"
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
