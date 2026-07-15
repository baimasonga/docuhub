/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// eslint-disable-next-line import/no-unresolved
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { X, PenTool, Type as TypeIcon, Save, ChevronLeft, ChevronRight, Trash2, Loader2 } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

interface TextRun {
  itemIndex: number;
  text: string;
  left: number;   // PDF page units (unscaled), top-left origin
  top: number;
  width: number;
  height: number;
  fontSize: number;
}

interface TextEdit {
  pageIndex: number;
  itemIndex: number;
  originalText: string;
  newText: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
}

interface SignaturePlacement {
  id: string;
  pageIndex: number;
  dataUrl: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

type Tool = 'select' | 'signature';

const RENDER_SCALE = 1.4;

interface PdfEditorProps {
  documentId: string;
  title: string;
  onClose: () => void;
  onSaved: () => void;
  triggerToast: (msg: string, type: 'success' | 'error') => void;
}

export default function PdfEditor({ documentId, title, onClose, onSaved, triggerToast }: PdfEditorProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [textRuns, setTextRuns] = useState<TextRun[]>([]);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<Tool>('select');
  const [editingRun, setEditingRun] = useState<{ itemIndex: number; value: string } | null>(null);
  const [textEdits, setTextEdits] = useState<TextEdit[]>([]);
  const [signatures, setSignatures] = useState<SignaturePlacement[]>([]);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [pendingSignature, setPendingSignature] = useState<string | null>(null);

  const originalBytesRef = useRef<ArrayBuffer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageWrapRef = useRef<HTMLDivElement | null>(null);

  // Load the source PDF once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/preview`);
        if (!res.ok) throw new Error('Could not load PDF.');
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        originalBytesRef.current = buf;
        const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError('This file could not be opened for editing. It may not be a valid PDF.');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [documentId]);

  const renderPage = useCallback(async () => {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    await page.render({ canvasContext: ctx, viewport }).promise;
    setPageSize({ width: viewport.width / RENDER_SCALE, height: viewport.height / RENDER_SCALE });

    const content = await page.getTextContent();
    const unscaledViewport = page.getViewport({ scale: 1 });
    const runs: TextRun[] = [];
    content.items.forEach((item: any, itemIndex: number) => {
      if (!item.str || !item.str.trim()) return;
      const tx = pdfjsLib.Util.transform(unscaledViewport.transform, item.transform);
      const fontSize = Math.hypot(tx[2], tx[3]);
      const left = tx[4];
      const top = tx[5] - fontSize;
      const width = item.width || fontSize * item.str.length * 0.5;
      const height = fontSize * 1.15;
      runs.push({ itemIndex, text: item.str, left, top, width, height, fontSize });
    });
    setTextRuns(runs);
  }, [pdfDoc, pageIndex]);

  useEffect(() => { renderPage(); }, [renderPage]);

  const editForRun = (itemIndex: number) => textEdits.find(e => e.pageIndex === pageIndex && e.itemIndex === itemIndex);

  const startEditingRun = (run: TextRun) => {
    if (tool !== 'select') return;
    const existing = editForRun(run.itemIndex);
    setEditingRun({ itemIndex: run.itemIndex, value: existing ? existing.newText : run.text });
  };

  const commitEdit = (run: TextRun) => {
    if (!editingRun) return;
    const value = editingRun.value;
    setEditingRun(null);
    if (value === run.text) {
      setTextEdits(prev => prev.filter(e => !(e.pageIndex === pageIndex && e.itemIndex === run.itemIndex)));
      return;
    }
    setTextEdits(prev => {
      const next = prev.filter(e => !(e.pageIndex === pageIndex && e.itemIndex === run.itemIndex));
      next.push({
        pageIndex, itemIndex: run.itemIndex, originalText: run.text, newText: value,
        left: run.left, top: run.top, width: run.width, height: run.height, fontSize: run.fontSize
      });
      return next;
    });
  };

  const placeSignatureAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== 'signature' || !pendingSignature) return;
    const rect = pageWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickLeft = (e.clientX - rect.left) / RENDER_SCALE;
    const clickTop = (e.clientY - rect.top) / RENDER_SCALE;
    const width = 140;
    const height = 50;
    setSignatures(prev => [...prev, {
      id: `sig-${Date.now()}`,
      pageIndex,
      dataUrl: pendingSignature,
      left: clickLeft - width / 2,
      top: clickTop - height / 2,
      width, height
    }]);
    setTool('select');
    setPendingSignature(null);
    triggerToast('Signature placed. Drag it to reposition, or Save to apply.', 'success');
  };

  const removeSignature = (id: string) => setSignatures(prev => prev.filter(s => s.id !== id));

  const dragSignature = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const sig = signatures.find(s => s.id === id);
    if (!sig) return;
    const startLeft = sig.left;
    const startTop = sig.top;
    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / RENDER_SCALE;
      const dy = (ev.clientY - startY) / RENDER_SCALE;
      setSignatures(prev => prev.map(s => s.id === id ? { ...s, left: startLeft + dx, top: startTop + dy } : s));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const hasChanges = textEdits.length > 0 || signatures.length > 0;

  const dataUrlToBytes = (dataUrl: string): Uint8Array => {
    const base64 = dataUrl.split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  const handleSave = async () => {
    if (!originalBytesRef.current || !hasChanges) return;
    setSaving(true);
    try {
      const doc = await PDFDocument.load(originalBytesRef.current);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const pages = doc.getPages();

      for (const edit of textEdits) {
        const page = pages[edit.pageIndex];
        if (!page) continue;
        const { height: pageHeight } = page.getSize();
        const y = pageHeight - edit.top - edit.height;
        page.drawRectangle({ x: edit.left - 1, y: y - 1, width: edit.width + 2, height: edit.height + 2, color: rgb(1, 1, 1) });
        page.drawText(edit.newText, {
          x: edit.left,
          y: y + edit.height * 0.18,
          size: edit.fontSize,
          font,
          color: rgb(0, 0, 0)
        });
      }

      for (const sig of signatures) {
        const page = pages[sig.pageIndex];
        if (!page) continue;
        const { height: pageHeight } = page.getSize();
        const png = await doc.embedPng(dataUrlToBytes(sig.dataUrl));
        page.drawImage(png, {
          x: sig.left,
          y: pageHeight - sig.top - sig.height,
          width: sig.width,
          height: sig.height
        });
      }

      const bytes = await doc.save();
      const fileName = title.toLowerCase().endsWith('.pdf') ? title : `${title}.pdf`;
      const file = new File([bytes], fileName, { type: 'application/pdf' });

      const reader = new FileReader();
      const base64: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      const res = await fetch(`/api/documents/${documentId}/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, fileSize: file.size, fileType: 'application/pdf', fileData: base64 })
      });
      const data = await res.json();
      if (data.error) {
        triggerToast(data.error, 'error');
      } else {
        triggerToast('Signed/edited PDF saved as a new version.', 'success');
        onSaved();
        onClose();
      }
    } catch (err) {
      console.error('[pdf-editor] save failed:', err);
      triggerToast('Could not save the edited PDF.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center space-x-2 min-w-0">
            <PenTool className="w-4 h-4 text-indigo-500 shrink-0" />
            <span className="text-xs font-bold text-slate-700 truncate">Sign &amp; Edit: {title}</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-[11px] font-bold flex items-center space-x-1.5"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>{saving ? 'Saving…' : 'Save as new version'}</span>
            </button>
            <button onClick={onClose} className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-500">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50/70 shrink-0">
          <div className="flex items-center space-x-1.5">
            <button
              onClick={() => setTool('select')}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center space-x-1.5 ${tool === 'select' ? 'bg-indigo-100 text-indigo-700' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-100'}`}
            >
              <TypeIcon className="w-3.5 h-3.5" /><span>Edit text</span>
            </button>
            <button
              onClick={() => setShowSignaturePad(true)}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center space-x-1.5 ${tool === 'signature' ? 'bg-indigo-100 text-indigo-700' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-100'}`}
            >
              <PenTool className="w-3.5 h-3.5" /><span>Add signature</span>
            </button>
            {tool === 'signature' && pendingSignature && (
              <span className="text-[10px] text-indigo-600 font-semibold ml-2">Click on the page to place your signature</span>
            )}
          </div>
          {numPages > 1 && (
            <div className="flex items-center space-x-2">
              <button onClick={() => setPageIndex(p => Math.max(0, p - 1))} disabled={pageIndex === 0} className="p-1 rounded-lg hover:bg-slate-200 disabled:opacity-30 text-slate-500">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[10px] font-mono text-slate-500">Page {pageIndex + 1} / {numPages}</span>
              <button onClick={() => setPageIndex(p => Math.min(numPages - 1, p + 1))} disabled={pageIndex === numPages - 1} className="p-1 rounded-lg hover:bg-slate-200 disabled:opacity-30 text-slate-500">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Canvas area */}
        <div className="flex-1 overflow-auto bg-slate-200/60 flex items-start justify-center p-6">
          {loading && (
            <div className="flex flex-col items-center justify-center text-slate-400 mt-20">
              <Loader2 className="w-6 h-6 animate-spin mb-2" />
              <span className="text-xs">Loading PDF…</span>
            </div>
          )}
          {error && <div className="text-xs text-rose-600 font-semibold mt-20">{error}</div>}
          {!loading && !error && (
            <div
              ref={pageWrapRef}
              className="relative bg-white shadow-lg"
              style={{ width: pageSize.width * RENDER_SCALE, height: pageSize.height * RENDER_SCALE, cursor: tool === 'signature' && pendingSignature ? 'crosshair' : 'default' }}
              onClick={placeSignatureAt}
            >
              <canvas ref={canvasRef} className="absolute inset-0" />

              {/* Text-run click targets */}
              {textRuns.map(run => {
                const edit = editForRun(run.itemIndex);
                const isEditing = editingRun?.itemIndex === run.itemIndex;
                return (
                  <div
                    key={run.itemIndex}
                    onClick={(e) => { e.stopPropagation(); startEditingRun(run); }}
                    style={{
                      position: 'absolute',
                      left: run.left * RENDER_SCALE,
                      top: run.top * RENDER_SCALE,
                      width: run.width * RENDER_SCALE,
                      height: run.height * RENDER_SCALE,
                      pointerEvents: tool === 'select' ? 'auto' : 'none'
                    }}
                    className={`group ${tool === 'select' ? 'cursor-text hover:bg-indigo-100/40' : ''} ${edit ? 'bg-amber-100/50 ring-1 ring-amber-300' : ''}`}
                    title={edit ? `Edited: "${edit.newText}"` : 'Click to edit this text'}
                  >
                    {isEditing && (
                      <input
                        autoFocus
                        value={editingRun.value}
                        onChange={(e) => setEditingRun({ itemIndex: run.itemIndex, value: e.target.value })}
                        onBlur={() => commitEdit(run)}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingRun(null); }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: run.fontSize * RENDER_SCALE * 0.92, width: Math.max(run.width * RENDER_SCALE, 40) }}
                        className="absolute inset-0 bg-white border border-indigo-400 rounded px-0.5 outline-none"
                      />
                    )}
                  </div>
                );
              })}

              {/* Signature placements for this page */}
              {signatures.filter(s => s.pageIndex === pageIndex).map(sig => (
                <div
                  key={sig.id}
                  onMouseDown={(e) => dragSignature(sig.id, e)}
                  style={{
                    position: 'absolute',
                    left: sig.left * RENDER_SCALE,
                    top: sig.top * RENDER_SCALE,
                    width: sig.width * RENDER_SCALE,
                    height: sig.height * RENDER_SCALE
                  }}
                  className="group border border-dashed border-indigo-400 cursor-move"
                >
                  <img src={sig.dataUrl} alt="Signature" className="w-full h-full object-contain pointer-events-none" />
                  <button
                    onClick={(e) => { e.stopPropagation(); removeSignature(sig.id); }}
                    className="absolute -top-2.5 -right-2.5 p-0.5 bg-rose-500 text-white rounded-full opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showSignaturePad && (
        <SignaturePad
          onClose={() => setShowSignaturePad(false)}
          onConfirm={(dataUrl) => {
            setPendingSignature(dataUrl);
            setTool('signature');
            setShowSignaturePad(false);
          }}
        />
      )}
    </div>
  );
}

function SignaturePad({ onClose, onConfirm }: { onClose: () => void; onConfirm: (dataUrl: string) => void }) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typedName, setTypedName] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasStrokes = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const pos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.MouseEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    hasStrokes.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const end = () => { drawing.current = false; };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    hasStrokes.current = false;
  };

  const confirmDraw = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes.current) return;
    onConfirm(canvas.toDataURL('image/png'));
  };

  const confirmTyped = () => {
    if (!typedName.trim()) return;
    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e293b';
    ctx.font = "64px 'Segoe Script', 'Brush Script MT', cursive";
    ctx.textBaseline = 'middle';
    ctx.fillText(typedName.trim(), 20, canvas.height / 2);
    onConfirm(canvas.toDataURL('image/png'));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-3.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display font-extrabold text-slate-800 text-sm">Add your signature</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4 text-slate-400" /></button>
        </div>

        <div className="flex space-x-1.5">
          <button onClick={() => setMode('draw')} className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold ${mode === 'draw' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-50 text-slate-500'}`}>Draw</button>
          <button onClick={() => setMode('type')} className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold ${mode === 'type' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-50 text-slate-500'}`}>Type</button>
        </div>

        {mode === 'draw' ? (
          <>
            <canvas
              ref={canvasRef}
              width={440}
              height={160}
              className="w-full border border-slate-200 rounded-xl touch-none"
              onMouseDown={start}
              onMouseMove={move}
              onMouseUp={end}
              onMouseLeave={end}
            />
            <div className="flex justify-between items-center">
              <button onClick={clear} className="text-[10px] font-bold text-slate-400 hover:text-slate-600">Clear</button>
              <button onClick={confirmDraw} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold">Use this signature</button>
            </div>
          </>
        ) : (
          <>
            <input
              autoFocus
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Your full name"
              className="w-full bg-slate-50 border border-slate-150 rounded-xl p-2.5 px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white"
              style={{ fontFamily: "'Segoe Script', 'Brush Script MT', cursive", fontSize: '22px' }}
            />
            <div className="flex justify-end">
              <button onClick={confirmTyped} disabled={!typedName.trim()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl text-xs font-bold">Use this signature</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
