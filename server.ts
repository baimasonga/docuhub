/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
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
  DashboardStats 
} from './src/types';

dotenv.config();

const app = express();
const PORT = 3000;

// Body parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// DB File Path
const DB_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

// Ensure db directory and file exist
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Initial Mock Data
const DEFAULT_USERS: User[] = [
  { id: 'admin-1', fullName: 'Sarah Jenkins', email: 'sarah.j@smartsdocs.org', role: 'Admin', department: 'IT', isActive: true },
  { id: 'manager-1', fullName: 'David Vance', email: 'david.v@smartsdocs.org', role: 'Manager', department: 'Finance', isActive: true },
  { id: 'staff-1', fullName: 'Mohamed Bangura', email: 'mohamedamadubangura@gmail.com', role: 'Staff', department: 'Procurement', isActive: true },
  { id: 'viewer-1', fullName: 'Alice Cooper', email: 'alice.c@smartsdocs.org', role: 'Viewer', department: 'Marketing', isActive: true },
  { id: 'auditor-1', fullName: 'Robert Sterling', email: 'robert.s@smartsdocs.org', role: 'Auditor', department: 'Compliance', isActive: true }
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
  externalLinks: DEFAULT_EXTERNAL_LINKS
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
}

function writeDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving database.', err);
  }
}

// Load seed on start
readDb();

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
  
  if (ai) {
    try {
      console.log(`Running smart Gemini OCR & Automated Tagging for: ${fileName}`);
      
      let contents: any;
      if (mimeType.startsWith('image/')) {
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

Format the output strictly as a JSON object with this shape:
{
  "ocrText": "Extracted OCR text here...",
  "tags": ["tag1", "tag2", "tag3"],
  "documentType": "Contract" | "Invoice" | "Memo" | "Report" | "Support" | "Other",
  "description": "Short description here..."
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
"${fileDataB64OrText}"

Analyze this text and perform these tasks:
1. Summarize and index this content cleanly for our full-text database indexer.
2. Provide a list of 3 to 5 tag keywords. Keep tags lowercase with no '#' sign.
3. Classify document type into exactly one of: 'Contract', 'Invoice', 'Memo', 'Report', 'Support', 'Other'.
4. Write a brief 1-sentence description summarizes the document contents.

Format the output strictly as JSON matching this shape:
{
  "ocrText": "Cleaned full indexed text contents...",
  "tags": ["tag1", "tag2", "tag3"],
  "documentType": "Contract" | "Invoice" | "Memo" | "Report" | "Support" | "Other",
  "description": "Short description here..."
}`
            }
          ]
        };
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              ocrText: { type: Type.STRING },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } },
              documentType: { type: Type.STRING },
              description: { type: Type.STRING }
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
          description: result.description || 'AI analyzed upload.'
        };
      }
    } catch (err) {
      console.error('Gemini OCR analysis failed, falling back to local simulation heuristically', err);
    }
  }

  // Local premium simulated indexer and tagging engine
  console.log('Using simulated intelligence indexer.');
  const testText = fileDataB64OrText.substring(0, 1000);
  
  let detectedType: Document['documentType'] = 'Other';
  let desc = 'Standard document upload.';
  let tagsObj = ['uploaded', 'indexed'];

  if (lowerName.includes('invoice') || lowerName.includes('bill') || lowerName.includes('payment') || testText.toLowerCase().includes('total') || testText.toLowerCase().includes('amount') || testText.toLowerCase().includes('invoice')) {
    detectedType = 'Invoice';
    desc = 'Simulated OCR recognized: Invoice transaction details matching smart templates.';
    tagsObj = ['invoice', 'finance', 'payment', 'ocr-simulated'];
  } else if (lowerName.includes('agree') || lowerName.includes('contract') || lowerName.includes('lease') || testText.toLowerCase().includes('agreement') || testText.toLowerCase().includes('terms')) {
    detectedType = 'Contract';
    desc = 'Simulated OCR recognized: Commercial legal agreement and vendor service terms.';
    tagsObj = ['contract', 'legal', 'agreement', 'ocr-simulated'];
  } else if (lowerName.includes('memo') || lowerName.includes('letter') || lowerName.includes('internal')) {
    detectedType = 'Memo';
    desc = 'Simulated OCR recognized: Internal communications and organizational memo.';
    tagsObj = ['memo', 'admin', 'internal', 'ocr-simulated'];
  } else if (lowerName.includes('report') || lowerName.includes('audit') || lowerName.includes('metric') || lowerName.includes('q1') || lowerName.includes('q2')) {
    detectedType = 'Report';
    desc = 'Simulated OCR recognized: Quantitative progress report and department metrics sheet.';
    tagsObj = ['report', 'analytics', 'audit', 'ocr-simulated'];
  } else if (lowerName.includes('it') || lowerName.includes('sys') || lowerName.includes('tech') || lowerName.includes('api')) {
    detectedType = 'Support';
    desc = 'Simulated OCR recognized: Technical schema documentation with storage parameters.';
    tagsObj = ['tech', 'support', 'it-infra', 'ocr-simulated'];
  }

  return {
    ocrText: `[HEURISTIC OCR ANALYSIS] Document: ${fileName}\nDetected text patterns. Indexed at ${new Date().toLocaleString()}.\nPreview snippet:\n${testText.substring(0, 250) || 'Generic asset binary stream'}\nIndex complete.`,
    tags: tagsObj,
    documentType: detectedType,
    description: desc
  };
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// Users List
app.get('/api/users', (req, res) => {
  res.json(db.users);
});

// Update default test user details or active profile configs
app.post('/api/users/switch-profile', (req, res) => {
  const { userId } = req.body;
  const user = db.users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User does not exist.' });
  }
  // Audit switched
  addAuditLog(userId, 'Login', undefined, undefined, `User switched profile to ${user.fullName} (${user.role}).`);
  res.json({ success: true, user });
});

// Get Database Info & Stats
app.get('/api/stats', (req, res) => {
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const role = req.headers['x-user-role'] as string || 'Staff';
  const dept = req.headers['x-user-department'] as string || 'Procurement';
  
  // Calculate counts based on access permission
  let visibleDocs = db.documents.filter(d => !d.isDeleted);
  
  if (role === 'Staff') {
    // Staff see owned docs, shared docs, or department docs
    visibleDocs = db.documents.filter(d => 
      !d.isDeleted && 
      (d.ownerId === userId || 
       d.department === dept || 
       db.permissions.some(p => p.documentId === d.id && p.sharedWithUserId === userId))
    );
  } else if (role === 'Viewer') {
    // Viewers only see elements directly shared, or in their department that are approved
    visibleDocs = db.documents.filter(d => 
      !d.isDeleted && 
      (d.department === dept || db.permissions.some(p => p.documentId === d.id && p.sharedWithUserId === userId)) &&
      (d.status === 'Approved' || d.ownerId === userId)
    );
  }

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
  const userId = req.headers['x-user-id'] as string || 'staff-1';
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
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const role = req.headers['x-user-role'] as string || 'Staff';
  const dept = req.headers['x-user-department'] as string || 'Procurement';
  
  const { folderId, status, category, archive, query, starred, filterType } = req.query;

  // Let's filter base visibility
  let docs = db.documents;

  // Role permissions filtering
  // Admin, Manager, Auditor see everything by default (Auditor tracks overall)
  // Staff see owned docs, shared docs, or department docs
  // Viewer see department-only approved docs or explicitly shared docs
  if (role === 'Staff') {
    docs = docs.filter(d => 
      d.ownerId === userId || 
      d.department === dept || 
      db.permissions.some(p => p.documentId === d.id && p.sharedWithUserId === userId)
    );
  } else if (role === 'Viewer') {
    docs = docs.filter(d => 
      d.ownerId === userId ||
      ((d.department === dept || db.permissions.some(p => p.documentId === d.id && p.sharedWithUserId === userId)) && d.status === 'Approved')
    );
  }

  // Filter out Trash vs Standard Active docs
  if (filterType === 'trash') {
    docs = docs.filter(d => d.isDeleted);
  } else {
    docs = docs.filter(d => !d.isDeleted);
    
    // Archive filtering
    if (filterType === 'archive') {
      docs = docs.filter(d => d.isArchived || d.confidentialityLevel === 'Archive');
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
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
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
    externalLinks: links
  });
});

// Upload File (with OCR & Tagging base64 payload)
app.post('/api/documents/upload', async (req, res) => {
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const role = req.headers['x-user-role'] as string || 'Staff';
  const dept = req.headers['x-user-department'] as string || 'Procurement';
  
  const { title, description, folderId, documentType, fileName, fileSize, fileType, fileData, department } = req.body;

  if (!title || !fileName || !fileData) {
    return res.status(400).json({ error: 'Title, file name, and file data stream are required.' });
  }

  const u = db.users.find(usr => usr.id === userId) || { fullName: 'Mohamed Bangura', department: 'Procurement' };

  try {
    // 1. Run OCR and tags extraction
    const aiResult = await runAiOcrAndTagging(
      fileName, 
      fileType || 'text/plain', 
      fileData
    );

    // 2. Insert Document
    const docId = `doc-${Date.now()}`;
    const newDoc: Document = {
      id: docId,
      title,
      description: description || aiResult.description,
      ownerId: userId,
      ownerName: u.fullName,
      department: department || u.department || dept,
      folderId: folderId || null,
      documentType: (documentType as any) || aiResult.documentType || 'Other',
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
      uploadedByName: u.fullName,
      fileData, // base64 payload stored securely in our simulated cloud DB
      createdAt: new Date().toISOString()
    };

    db.documents.push(newDoc);
    db.versions.push(newVersion);
    writeDb();

    addAuditLog(userId, 'Upload', docId, title, `Uploaded first version "${fileName}" representing "${title}". AI-OCR detected type: ${newDoc.documentType}`);

    res.status(201).json({
      success: true,
      document: newDoc,
      version: newVersion
    });

  } catch (err: any) {
    console.error('File upload logic failure:', err);
    res.status(500).json({ error: 'Failed to process document upload.', details: err.message });
  }
});

// Upload New Version of Existing File
app.post('/api/documents/:id/version', async (req, res) => {
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const { fileName, fileSize, fileType, fileData } = req.body;
  const docId = req.params.id;

  const doc = db.documents.find(d => d.id === docId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  if (!fileName || !fileData) {
    return res.status(400).json({ error: 'File name and data are required.' });
  }

  const user = db.users.find(usr => usr.id === userId) || { fullName: 'Mohamed Bangura' };

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
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  doc.isStarred = !doc.isStarred;
  writeDb();

  const actionName = doc.isStarred ? 'Star' : 'Unstar';
  addAuditLog(userId, actionName, doc.id, doc.title, `${actionName}red document.`);
  res.json({ success: true, document: doc });
});

// Move Document to Trash (Soft Delete)
app.post('/api/documents/:id/delete', (req, res) => {
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  doc.isDeleted = true;
  writeDb();

  addAuditLog(userId, 'Delete', doc.id, doc.title, 'Soft-deleted the file and moved to Trash directory.');
  res.json({ success: true, document: doc });
});

// Restore from Trash
app.post('/api/documents/:id/restore', (req, res) => {
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  doc.isDeleted = false;
  writeDb();

  addAuditLog(userId, 'Restore', doc.id, doc.title, 'Restored file from trash folder back into original directory.');
  res.json({ success: true, document: doc });
});

// Permanently Delete Document
app.post('/api/documents/:id/permanently-delete', (req, res) => {
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const index = db.documents.findIndex(d => d.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Document not found.' });
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
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  doc.isArchived = !doc.isArchived;
  if (doc.isArchived) {
    doc.confidentialityLevel = 'Archive';
  } else {
    doc.confidentialityLevel = 'Normal File';
  }
  writeDb();

  const detailsStr = doc.isArchived ? 'Moved document and marked as official Archived file.' : 'Restored document from Archive database.';
  addAuditLog(userId, 'Archive', doc.id, doc.title, detailsStr);
  res.json({ success: true, document: doc });
});

// Rename Document
app.post('/api/documents/:id/rename', (req, res) => {
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const { title } = req.body;
  
  if (!title || title.trim() === '') {
    return res.status(400).json({ error: 'Title is required for rename.' });
  }

  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
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
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const { folderId } = req.body;

  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
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
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const { approverId, comment } = req.body;
  const docId = req.params.id;

  const doc = db.documents.find(d => d.id === docId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  const requester = db.users.find(u => u.id === userId) || { fullName: 'Mohamed Bangura' };
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
  const userId = req.headers['x-user-id'] as string || 'manager-1';
  const { status, comment } = req.body; // status: 'Approved' | 'Changes Requested' | 'Rejected'
  
  const approval = db.approvals.find(a => a.id === req.params.id);
  if (!approval) {
    return res.status(404).json({ error: 'Approval request registry trace not found.' });
  }

  const doc = db.documents.find(d => d.id === approval.documentId);
  if (!doc) {
    return res.status(404).json({ error: 'Target document was not found.' });
  }

  const user = db.users.find(u => u.id === userId) || { id: 'manager-1', fullName: 'David Vance', email: 'david.v@smartdocs.org', role: 'Manager' as const, department: 'Finance', isActive: true };

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
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const { targetUserId, permissionType } = req.body;
  const docId = req.params.id;

  const doc = db.documents.find(d => d.id === docId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
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
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const docId = req.params.id;

  const doc = db.documents.find(d => d.id === docId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  // Token creation
  const token = `ext-${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;
  
  const extLink: ExternalShareLink = {
    id: `ext-link-${Date.now()}`,
    documentId: docId,
    token,
    createdBy: userId,
    permissionType: 'Viewer',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    isActive: true,
    accessCount: 0,
    createdAt: new Date().toISOString()
  };

  db.externalLinks.push(extLink);
  writeDb();

  addAuditLog(userId, 'Create Secure Link', docId, doc.title, `Generated secure cloud external sharing key token for view authorization: ${token}`);
  res.json({ success: true, link: extLink });
});

// Revoke external sharing link
app.post('/api/external-link/:token/revoke', (req, res) => {
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const link = db.externalLinks.find(l => l.token === req.params.token);
  if (!link) {
    return res.status(404).json({ error: 'External token not found.' });
  }

  link.isActive = false;
  writeDb();

  const doc = db.documents.find(d => d.id === link.documentId);
  addAuditLog(userId, 'Revoke Link', link.documentId, doc?.title, `Revoked static view capabilities of remote external link key token.`);
  res.json({ success: true });
});

// Add inline Comment
app.post('/api/comments', (req, res) => {
  const userId = req.headers['x-user-id'] as string || 'staff-1';
  const role = req.headers['x-user-role'] as string || 'Staff';
  const { documentId, text } = req.body;

  if (!documentId || !text || text.trim() === '') {
    return res.status(400).json({ error: 'Document target reference and text content are required.' });
  }

  const doc = db.documents.find(d => d.id === documentId);
  if (!doc) {
    return res.status(404).json({ error: 'Target document was not found.' });
  }

  const user = db.users.find(u => u.id === userId) || { id: 'staff-1', fullName: 'Mohamed Bangura', email: 'mohamedamadubangura@gmail.com', role: 'Staff' as const, department: 'Procurement', isActive: true };

  const newComment: Comment = {
    id: `c-${Date.now()}`,
    documentId,
    userId,
    userName: user.fullName,
    userRole: role as any,
    text,
    createdAt: new Date().toISOString()
  };

  db.comments.push(newComment);
  writeDb();

  addAuditLog(userId, 'Comment', documentId, doc.title, `Added comment: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
  res.json(newComment);
});

// Get Audit Logs (Admin or auditor scopes)
app.get('/api/activity', (req, res) => {
  // Let's return sliced total log registries
  res.json(db.logs);
});

// Fetch active document logs
app.get('/api/documents/:id/activity', (req, res) => {
  const fileLogs = db.logs.filter(l => l.documentId === req.params.id);
  res.json(fileLogs);
});

// Initialize Vite and setup HTML serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files from compiled dist folder in production
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SmartDocs DMS Full-Stack Engine booting on port: ${PORT}`);
    console.log(`Active workspace location: ${process.cwd()}`);
  });
}

// Spark up
startServer();
