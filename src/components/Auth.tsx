/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authentication screens: login (with forgot-password), emailed-link password
 * reset, and the change-password modal (also used for forced first-login
 * password changes).
 */

import React, { useState, useEffect } from 'react';
import { Vault, Lock, Mail, KeyRound, ArrowLeft, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { User } from '../types';

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4"
      style={{ backgroundImage: 'radial-gradient(ellipse at top, #1e293b 0%, #0f172a 60%)' }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center space-x-2.5 mb-6">
          <div className="p-2.5 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-900/40">
            <Vault className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-white font-display font-extrabold text-lg leading-tight">AVDP Document Management System</h1>
            <p className="text-slate-400 text-[10px] font-mono tracking-wider uppercase">Secure Workspace</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-6">{children}</div>
        <p className="text-center text-slate-500 text-[10px] mt-4">
          Documents encrypted in transit · Role-based access · Full audit trail
        </p>
      </div>
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 text-xs rounded-lg px-3 py-2.5">
      <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
      <span>{text}</span>
    </div>
  );
}

const inputCls = 'w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all';
const buttonCls = 'w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold text-sm rounded-xl py-2.5 transition-all flex items-center justify-center space-x-2';
const oauthButtonCls = 'w-full border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-sm rounded-xl py-2.5 transition-all flex items-center justify-center space-x-2.5';

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.4 5.1 29.5 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.8 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.4 5.1 29.5 3 24 3 16 3 9.1 7.6 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 45c5.4 0 10.2-2 13.9-5.4l-6.4-5.4C29.4 35.9 26.8 37 24 37c-5.2 0-9.7-3.3-11.3-8l-6.6 5.1C9 40.5 15.9 45 24 45z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.4l6.4 5.4C39.9 37 44 31.4 44 24c0-1.2-.1-2.4-.4-3.5z"/>
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 23 23" aria-hidden="true">
      <path fill="#f25022" d="M1 1h10v10H1z"/>
      <path fill="#00a4ef" d="M1 12h10v10H1z"/>
      <path fill="#7fba00" d="M12 1h10v10H12z"/>
      <path fill="#ffb900" d="M12 12h10v10H12z"/>
    </svg>
  );
}

export function LoginScreen({ onLogin, initialError }: {
  onLogin: (user: User, mustChangePassword: boolean) => void;
  initialError?: string;
}) {
  const [mode, setMode] = useState<'login' | 'forgot' | 'forgot-sent'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError || '');
  const [busy, setBusy] = useState(false);
  // Which OAuth providers this deployment has client credentials for -- an
  // alternative login method for accounts an Admin already created, not a
  // way to self-register (the callback rejects any email with no matching
  // account). Both start false so no button flashes before this resolves.
  const [oauthProviders, setOauthProviders] = useState({ google: false, microsoft: false });
  useEffect(() => {
    fetch('/api/auth/oauth/config')
      .then(res => res.json())
      .then(data => setOauthProviders({ google: Boolean(data.google), microsoft: Boolean(data.microsoft) }))
      .catch(() => {});
  }, []);
  const hasOAuth = oauthProviders.google || oauthProviders.microsoft;

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await postJson('/api/auth/login', { email, password });
      onLogin(data.user, Boolean(data.mustChangePassword));
    } catch (err: any) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await postJson('/api/auth/forgot-password', { email });
      setMode('forgot-sent');
    } catch (err: any) {
      setError(err.message || 'Could not request a reset link.');
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'forgot' || mode === 'forgot-sent') {
    return (
      <AuthShell>
        <button onClick={() => { setMode('login'); setError(''); }}
          className="flex items-center space-x-1 text-xs text-slate-400 hover:text-slate-600 mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /><span>Back to sign in</span>
        </button>
        {mode === 'forgot-sent' ? (
          <div className="text-center py-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
            <h2 className="font-bold text-slate-800 text-sm mb-1">Check your inbox</h2>
            <p className="text-xs text-slate-500">
              If <strong>{email}</strong> belongs to an account, a password reset link is on its way.
            </p>
          </div>
        ) : (
          <form onSubmit={submitForgot} className="space-y-3.5">
            <h2 className="font-bold text-slate-800 text-sm">Reset your password</h2>
            <p className="text-xs text-slate-500">Enter your account email and we'll send a reset link.</p>
            {error && <ErrorNote text={error} />}
            <input type="email" required placeholder="you@company.com" value={email}
              onChange={e => setEmail(e.target.value)} className={inputCls} autoFocus />
            <button type="submit" disabled={busy} className={buttonCls}>
              <Mail className="w-4 h-4" /><span>{busy ? 'Sending…' : 'Send reset link'}</span>
            </button>
          </form>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={submitLogin} className="space-y-3.5">
        <h2 className="font-bold text-slate-800 text-sm">Sign in to your workspace</h2>
        {error && <ErrorNote text={error} />}
        <div>
          <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase block mb-1">Email</label>
          <input type="email" required placeholder="you@company.com" value={email}
            onChange={e => setEmail(e.target.value)} className={inputCls} autoFocus autoComplete="email" />
        </div>
        <div>
          <label className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase block mb-1">Password</label>
          <input type="password" required placeholder="••••••••" value={password}
            onChange={e => setPassword(e.target.value)} className={inputCls} autoComplete="current-password" />
        </div>
        <button type="submit" disabled={busy} className={buttonCls}>
          <Lock className="w-4 h-4" /><span>{busy ? 'Signing in…' : 'Sign in'}</span>
        </button>
        <button type="button" onClick={() => { setMode('forgot'); setError(''); }}
          className="w-full text-center text-xs text-indigo-600 hover:underline pt-1">
          Forgot your password?
        </button>
      </form>

      {hasOAuth && (
        <div className="mt-4 space-y-2.5">
          <div className="flex items-center space-x-2.5">
            <div className="flex-1 h-px bg-slate-100" />
            <span className="text-[10px] font-mono text-slate-400 uppercase">or</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>
          {oauthProviders.google && (
            <a href="/api/auth/oauth/google/start" className={oauthButtonCls}>
              <GoogleIcon /><span>Sign in with Google</span>
            </a>
          )}
          {oauthProviders.microsoft && (
            <a href="/api/auth/oauth/microsoft/start" className={oauthButtonCls}>
              <MicrosoftIcon /><span>Sign in with Microsoft</span>
            </a>
          )}
          <p className="text-center text-[10px] text-slate-400">
            Only works for accounts an Admin has already created.
          </p>
        </div>
      )}
    </AuthShell>
  );
}

// Landing page for /reset-password?token=… links from the reset email.
export function ResetPasswordScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await postJson('/api/auth/reset-password', { token, newPassword: password });
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      {done ? (
        <div className="text-center py-4">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
          <h2 className="font-bold text-slate-800 text-sm mb-1">Password updated</h2>
          <p className="text-xs text-slate-500 mb-4">You can now sign in with your new password.</p>
          <button onClick={onDone} className={buttonCls}><span>Go to sign in</span></button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3.5">
          <h2 className="font-bold text-slate-800 text-sm">Choose a new password</h2>
          <p className="text-xs text-slate-500">At least 8 characters, with a letter and a number.</p>
          {error && <ErrorNote text={error} />}
          <input type="password" required placeholder="New password" value={password}
            onChange={e => setPassword(e.target.value)} className={inputCls} autoFocus autoComplete="new-password" />
          <input type="password" required placeholder="Confirm new password" value={confirm}
            onChange={e => setConfirm(e.target.value)} className={inputCls} autoComplete="new-password" />
          <button type="submit" disabled={busy} className={buttonCls}>
            <KeyRound className="w-4 h-4" /><span>{busy ? 'Saving…' : 'Set new password'}</span>
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export function ChangePasswordModal({ forced, hasPassword, onClose, onChanged }: {
  forced: boolean;              // first login with a temp password: no dismissing
  hasPassword: boolean;         // legacy-imported accounts may not have one yet
  onClose: () => void;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await postJson('/api/auth/change-password', { currentPassword: current, newPassword: password });
      onChanged();
    } catch (err: any) {
      setError(err.message || 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-slate-800 text-sm flex items-center space-x-2">
            <KeyRound className="w-4 h-4 text-indigo-500" />
            <span>{forced ? 'Set your own password' : 'Change password'}</span>
          </h2>
          {!forced && (
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          )}
        </div>
        {forced && (
          <p className="text-xs text-slate-500 mb-3">
            You're using a temporary password. Choose your own to continue.
          </p>
        )}
        <form onSubmit={submit} className="space-y-3">
          {error && <ErrorNote text={error} />}
          {hasPassword && (
            <input type="password" required placeholder={forced ? 'Temporary password' : 'Current password'}
              value={current} onChange={e => setCurrent(e.target.value)} className={inputCls} autoFocus autoComplete="current-password" />
          )}
          <input type="password" required placeholder="New password (8+ chars, letter + number)"
            value={password} onChange={e => setPassword(e.target.value)} className={inputCls} autoComplete="new-password" />
          <input type="password" required placeholder="Confirm new password"
            value={confirm} onChange={e => setConfirm(e.target.value)} className={inputCls} autoComplete="new-password" />
          <button type="submit" disabled={busy} className={buttonCls}>
            <span>{busy ? 'Saving…' : 'Save password'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
