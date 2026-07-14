/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authentication primitives: PBKDF2 password hashing, stateless HMAC session
 * cookies, and a small in-memory login rate limiter.
 */

import crypto from 'crypto';
import express from 'express';

// ---- Password hashing ----------------------------------------------------
// PBKDF2-SHA256. Iterations are a balance between OWASP guidance and the CPU
// budget of a Cloudflare Workers request (login is the only hot path).
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, 'sha256');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored?: string): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 5_000_000) return false;
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const actual = crypto.pbkdf2Sync(password, salt, iterations, expected.length, 'sha256');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}

// Human-friendly generated temp password, e.g. "Rk7-mzqv-Xw2p".
export function generateTempPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = (n: number) => Array.from(crypto.randomBytes(n)).map(b => alphabet[b % alphabet.length]).join('');
  return `${pick(4)}-${pick(4)}-${pick(4)}`;
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// ---- Stateless HMAC session cookies ---------------------------------------
// The signing secret defaults to the Supabase service-role key (already a
// stable server-side secret) so it works with zero extra config; set
// SESSION_SECRET to rotate/override. Resolved lazily: on Workers, env vars
// are only populated inside a request context.
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SESSION_COOKIE = 'sid';

let cachedSessionSecret: string | null = null;
function getSessionSecret(): string {
  if (cachedSessionSecret) return cachedSessionSecret;
  cachedSessionSecret =
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    crypto.randomBytes(32).toString('hex');
  if (!process.env.SESSION_SECRET && !process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_KEY) {
    console.warn('[auth] No SESSION_SECRET set; using an ephemeral secret — logins will reset on restart.');
  }
  return cachedSessionSecret;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signSession(userId: string, expMs: number): string {
  const payload = b64url(Buffer.from(`${userId}.${expMs}`, 'utf8'));
  const sig = b64url(crypto.createHmac('sha256', getSessionSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifySession(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(crypto.createHmac('sha256', getSessionSecret()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const sep = decoded.lastIndexOf('.');
  if (sep < 0) return null;
  const userId = decoded.slice(0, sep);
  const expMs = Number(decoded.slice(sep + 1));
  if (!userId || !Number.isFinite(expMs) || Date.now() > expMs) return null;
  return userId;
}

export function parseCookies(req: express.Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx > -1) acc[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    return acc;
  }, {} as Record<string, string>);
}

export function sessionTokenFromRequest(req: express.Request): string | null {
  return parseCookies(req)[SESSION_COOKIE] || null;
}

function isSecureRequest(req: express.Request): boolean {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
}

export function setSessionCookie(req: express.Request, res: express.Response, userId: string): void {
  const token = signSession(userId, Date.now() + SESSION_TTL_MS);
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

export function clearSessionCookie(req: express.Request, res: express.Response): void {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
}

// ---- Login rate limiting ---------------------------------------------------
// Per-process sliding window. On Workers each isolate tracks its own window —
// imperfect but still slows credential stuffing; a durable limiter can come
// with the SaaS version.
const attempts = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function loginRateLimited(email: string): boolean {
  const key = email.toLowerCase();
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

export function clearLoginAttempts(email: string): void {
  attempts.delete(email.toLowerCase());
}
