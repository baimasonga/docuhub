import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Check, Copy, FileText, Lock, RefreshCw, Send, ShieldCheck, X } from 'lucide-react';
import { Document, SecureTransfer, User } from '../types';

interface Props {
  documents: Document[];
  currentUser: User;
  notify: (text: string, type: 'success' | 'info' | 'error') => void;
}

const formatBytes = (bytes: number) => bytes < 1024 * 1024
  ? (bytes / 1024).toFixed(1) + ' KB'
  : (bytes / 1024 / 1024).toFixed(1) + ' MB';

export default function TransfersView({ documents, currentUser, notify }: Props) {
  const [transfers, setTransfers] = useState<SecureTransfer[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [emails, setEmails] = useState('');
  const [password, setPassword] = useState('');
  const [expiry, setExpiry] = useState('7');
  const [maxDownloads, setMaxDownloads] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdUrl, setCreatedUrl] = useState('');

  const available = useMemo(() => documents.filter(doc => !doc.isDeleted && !doc.isArchived), [documents]);
  const load = () => fetch('/api/transfers')
    .then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load transfers.');
      setTransfers(Array.isArray(data) ? data : []);
    })
    .catch(error => notify(error.message, 'error'));

  useEffect(load, []);

  const toggle = (id: string) => setSelected(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const createTransfer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected.size) return notify('Select at least one document.', 'error');
    setLoading(true);
    setCreatedUrl('');
    try {
      const response = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentIds: [...selected],
          title,
          message: message.trim() || undefined,
          recipientEmails: emails.split(',').map(email => email.trim()).filter(Boolean),
          password: password.trim() || undefined,
          expiresInDays: Number(expiry),
          maxDownloads: maxDownloads ? Number(maxDownloads) : null
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create transfer.');
      setCreatedUrl(data.url);
      setSelected(new Set());
      setTitle('');
      setMessage('');
      setEmails('');
      setPassword('');
      setMaxDownloads('');
      notify(data.emailsSent?.length ? 'Transfer created and emailed.' : 'Transfer created.', 'success');
      load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not create transfer.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const revoke = async (id: string) => {
    const response = await fetch('/api/transfers/' + id + '/revoke', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) return notify(data.error || 'Could not revoke transfer.', 'error');
    notify('Transfer revoked.', 'success');
    load();
  };

  const extend = async (id: string) => {
    const response = await fetch('/api/transfers/' + id + '/extend', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 7 })
    });
    const data = await response.json();
    if (!response.ok) return notify(data.error || 'Could not extend transfer.', 'error');
    notify('Transfer extended by seven days.', 'success');
    load();
  };

  const copy = (code: string) => {
    const url = window.location.origin + '/t/' + code;
    navigator.clipboard.writeText(url)
      .then(() => notify('Transfer link copied.', 'success'))
      .catch(() => notify(url, 'info'));
  };

  const mayCreate = currentUser.role !== 'Viewer' && currentUser.role !== 'Auditor';

  return <div className="space-y-5">
    <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-mono font-bold tracking-wider text-indigo-500 uppercase">Secure delivery</p>
          <h2 className="text-xl font-display font-extrabold text-slate-800">Transfers</h2>
          <p className="text-xs text-slate-500 mt-1">Send immutable document versions in one protected package.</p>
        </div>
        <ShieldCheck className="w-8 h-8 text-indigo-500" />
      </div>
    </div>

    {mayCreate && <form onSubmit={createTransfer} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
      <h3 className="font-bold text-slate-800 text-sm">Create a transfer</h3>
      <div className="grid md:grid-cols-2 gap-3">
        <input required maxLength={160} value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Transfer title" className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none" />
        <input value={emails} onChange={e => setEmails(e.target.value)}
          placeholder="Recipient emails, separated by commas" className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none" />
      </div>
      <textarea maxLength={2000} value={message} onChange={e => setMessage(e.target.value)}
        placeholder="Message for recipients (optional)" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none h-16 resize-none" />
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400"><span>Expires</span>
          <select value={expiry} onChange={e => setExpiry(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700">
            <option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option>
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400"><span>Download limit</span>
          <input type="number" min="1" max="10000" value={maxDownloads} onChange={e => setMaxDownloads(e.target.value)}
            placeholder="Unlimited" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700" />
        </label>
        <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400"><span>Password</span>
          <input type="password" minLength={10} maxLength={128} value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Optional, 10+ characters" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700" />
        </label>
      </div>
      <div className="border border-slate-200 rounded-xl max-h-56 overflow-y-auto divide-y divide-slate-100">
        {available.map(doc => <label key={doc.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
          <input type="checkbox" checked={selected.has(doc.id)} onChange={() => toggle(doc.id)} className="accent-indigo-600" />
          <FileText className="w-4 h-4 text-slate-400" />
          <span className="flex-1 text-xs font-semibold text-slate-700">{doc.title}</span>
          <span className="text-[9px] font-bold uppercase text-slate-400">{doc.confidentialityLevel}</span>
        </label>)}
        {!available.length && <p className="p-4 text-xs text-slate-400">No available documents.</p>}
      </div>
      {createdUrl && <div className="flex gap-2 bg-emerald-50 border border-emerald-100 rounded-xl p-2">
        <input readOnly value={createdUrl} className="flex-1 bg-transparent text-xs text-emerald-800 outline-none" />
        <button type="button" onClick={() => navigator.clipboard.writeText(createdUrl)} className="text-emerald-700"><Copy className="w-4 h-4" /></button>
      </div>}
      <button disabled={loading || !selected.size} className="w-full bg-indigo-600 text-white rounded-xl py-2.5 text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        Create secure transfer ({selected.size} file{selected.size === 1 ? '' : 's'})
      </button>
    </form>}

    <div className="grid lg:grid-cols-2 gap-4">
      {transfers.map(transfer => {
        const expired = new Date(transfer.expiresAt).getTime() <= Date.now();
        const exhausted = transfer.maxDownloads != null && transfer.downloadCount >= transfer.maxDownloads;
        const active = transfer.isActive && !expired && !exhausted;
        return <article key={transfer.id} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <div className="flex justify-between gap-3">
            <div><h3 className="font-bold text-slate-800 text-sm">{transfer.title}</h3>
              <p className="text-[10px] text-slate-400 mt-1">{transfer.items.length} files · {transfer.recipients.length} recipients</p></div>
            <span className={'text-[9px] font-black uppercase px-2 py-1 rounded-full h-fit ' + (active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
              {active ? 'Active' : expired ? 'Expired' : exhausted ? 'Exhausted' : 'Revoked'}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-3 text-[10px] text-slate-500">
            <span className="flex gap-1"><Calendar className="w-3 h-3" />{new Date(transfer.expiresAt).toLocaleDateString()}</span>
            {transfer.requiresPassword && <span className="flex gap-1"><Lock className="w-3 h-3" />Protected</span>}
            <span>{transfer.downloadCount}{transfer.maxDownloads == null ? '' : '/' + transfer.maxDownloads} downloads</span>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => copy(transfer.shortCode)} className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-bold flex gap-1"><Copy className="w-3 h-3" />Copy link</button>
            {active && (transfer.createdBy === currentUser.id || currentUser.role === 'Admin') &&
              <button onClick={() => extend(transfer.id)} className="px-3 py-1.5 rounded-lg bg-slate-50 text-slate-600 text-[10px] font-bold">+7 days</button>}
            {active && (transfer.createdBy === currentUser.id || currentUser.role === 'Admin') &&
              <button onClick={() => revoke(transfer.id)} className="ml-auto px-3 py-1.5 rounded-lg bg-rose-50 text-rose-600 text-[10px] font-bold flex gap-1"><X className="w-3 h-3" />Revoke</button>}
          </div>
        </article>;
      })}
      {!transfers.length && <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-8 text-center text-xs text-slate-400">No transfers created yet.</div>}
    </div>
  </div>;
}
