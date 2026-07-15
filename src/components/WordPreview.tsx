/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import mammoth from 'mammoth';
import { Download, FileWarning, Loader2 } from 'lucide-react';

interface WordPreviewProps {
  documentId: string;
  fileName?: string;
}

// Legacy .doc is a binary format with no reliable pure-JS converter; mammoth
// only understands .docx (Office Open XML).
function isLegacyDoc(fileName?: string, fileType?: string): boolean {
  const name = (fileName || '').toLowerCase();
  const type = (fileType || '').toLowerCase();
  if (name.endsWith('.docx') || type.includes('officedocument.wordprocessingml')) return false;
  return name.endsWith('.doc') || type === 'application/msword' || type === 'doc';
}

export default function WordPreview({ documentId, fileName }: WordPreviewProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setHtml(null);

    if (isLegacyDoc(fileName)) {
      setLoading(false);
      setError('legacy');
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/preview`);
        if (!res.ok) throw new Error('Could not load document.');
        const buf = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
        if (cancelled) return;
        setHtml(result.value);
        setWarnings(result.messages.filter(m => m.type === 'warning').map(m => m.message));
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError('convert');
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [documentId, fileName]);

  if (loading) {
    return (
      <div className="flex-1 w-full bg-slate-50 flex flex-col items-center justify-center text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mb-2" />
        <span className="text-xs">Converting document for preview…</span>
      </div>
    );
  }

  if (error === 'legacy') {
    return (
      <div className="flex-1 w-full bg-slate-50 flex flex-col items-center justify-center text-center px-8">
        <FileWarning className="w-8 h-8 text-amber-500 mb-3" />
        <p className="text-sm font-bold text-slate-700">Preview isn't available for legacy .doc files</p>
        <p className="text-xs text-slate-500 mt-1.5 max-w-sm">
          This is the older binary Word format. Only .docx documents can be previewed inline — download this file to open it in Word.
        </p>
        <a
          href={`/api/documents/${documentId}/download`}
          target="_blank"
          rel="noreferrer"
          className="mt-4 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold flex items-center space-x-1.5"
        >
          <Download className="w-3.5 h-3.5" /><span>Download to view</span>
        </a>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 w-full bg-slate-50 flex flex-col items-center justify-center text-center px-8">
        <FileWarning className="w-8 h-8 text-rose-500 mb-3" />
        <p className="text-sm font-bold text-slate-700">Couldn't render this document</p>
        <p className="text-xs text-slate-500 mt-1.5 max-w-sm">Download it to view the original file instead.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full overflow-y-auto bg-slate-100 p-6">
      <div className="max-w-3xl mx-auto bg-white shadow-sm rounded-lg p-10">
        <div
          className="text-sm text-slate-800 leading-relaxed [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-5 [&_h2]:mb-2.5 [&_h3]:text-base [&_h3]:font-bold [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_li]:mb-1 [&_table]:border-collapse [&_table]:w-full [&_table]:mb-4 [&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_th]:border [&_th]:border-slate-200 [&_th]:p-2 [&_th]:bg-slate-50 [&_img]:max-w-full [&_a]:text-indigo-600 [&_a]:underline [&_strong]:font-bold [&_em]:italic"
          dangerouslySetInnerHTML={{ __html: html || '<p class="text-slate-400">This document has no readable content.</p>' }}
        />
        {warnings.length > 0 && (
          <p className="mt-6 pt-4 border-t border-slate-100 text-[10px] text-slate-400">
            Some formatting may differ from the original ({warnings.length} minor conversion note{warnings.length === 1 ? '' : 's'}).
          </p>
        )}
      </div>
    </div>
  );
}
