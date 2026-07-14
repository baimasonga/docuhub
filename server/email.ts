/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Transactional email via Resend (https://resend.com). Configure with:
 *   RESEND_API_KEY  — API key; without it, emails are logged and skipped.
 *   EMAIL_FROM      — sender, e.g. 'DocuHub <docs@yourdomain.com>'
 *                     (defaults to Resend's shared onboarding sender).
 *   APP_URL         — base URL used in links (falls back to the request host).
 *
 * All sends are best-effort: failures are logged, never thrown, and each call
 * is capped by a timeout so a slow provider can't stall an API response.
 */

const SEND_TIMEOUT_MS = 8000;

export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email] (disabled — set RESEND_API_KEY) Would send to ${opts.to}: "${opts.subject}"`);
    return false;
  }
  const from = process.env.EMAIL_FROM || 'Chore Box DMS <onboarding@resend.dev>';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`[email] send failed (${res.status}):`, (await res.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] send error:', (err as Error).message);
    return false;
  }
}

// ---- Templates -------------------------------------------------------------

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif">
  <div style="max-width:520px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:#1e293b;color:#ffffff;padding:18px 24px;font-weight:700;font-size:16px">📁 Chore Box DMS</div>
    <div style="padding:24px;color:#334155;font-size:14px;line-height:1.6">
      <h2 style="margin:0 0 12px;font-size:17px;color:#0f172a">${title}</h2>
      ${bodyHtml}
    </div>
    <div style="padding:14px 24px;background:#f8fafc;color:#94a3b8;font-size:11px">
      This is an automated message from your document management system.
    </div>
  </div></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${href}" style="background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:600;display:inline-block">${label}</a></p>`;
}

export function inviteEmail(opts: { fullName: string; email: string; tempPassword: string; baseUrl: string }) {
  return {
    subject: 'Your Chore Box DMS account is ready',
    html: layout('Welcome aboard', `
      <p>Hi ${opts.fullName},</p>
      <p>An account has been created for you. Sign in with:</p>
      <p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px">
        <strong>Email:</strong> ${opts.email}<br>
        <strong>Temporary password:</strong> <code style="font-size:15px">${opts.tempPassword}</code>
      </p>
      <p>You'll be asked to choose your own password on first login.</p>
      ${button(opts.baseUrl, 'Open Chore Box DMS')}`)
  };
}

export function passwordResetEmail(opts: { fullName: string; resetUrl: string }) {
  return {
    subject: 'Reset your Chore Box DMS password',
    html: layout('Password reset', `
      <p>Hi ${opts.fullName},</p>
      <p>We received a request to reset your password. This link is valid for 1 hour:</p>
      ${button(opts.resetUrl, 'Choose a new password')}
      <p>If you didn't request this, you can safely ignore this email.</p>`)
  };
}

export function tempPasswordEmail(opts: { fullName: string; tempPassword: string; baseUrl: string }) {
  return {
    subject: 'Your Chore Box DMS password was reset',
    html: layout('Password reset by an administrator', `
      <p>Hi ${opts.fullName},</p>
      <p>An administrator reset your password. Sign in with this temporary password (you'll be asked to choose a new one):</p>
      <p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px">
        <code style="font-size:15px">${opts.tempPassword}</code>
      </p>
      ${button(opts.baseUrl, 'Sign in')}`)
  };
}

export function approvalRequestedEmail(opts: {
  approverName: string; requesterName: string; documentTitle: string; comment: string; baseUrl: string;
}) {
  return {
    subject: `Approval requested: ${opts.documentTitle}`,
    html: layout('A document needs your review', `
      <p>Hi ${opts.approverName},</p>
      <p><strong>${opts.requesterName}</strong> requested your approval on
        <strong>"${opts.documentTitle}"</strong>.</p>
      ${opts.comment ? `<p style="border-left:3px solid #e2e8f0;padding-left:12px;color:#64748b">${opts.comment}</p>` : ''}
      ${button(opts.baseUrl, 'Review in Chore Box DMS')}`)
  };
}

export function approvalDecidedEmail(opts: {
  requesterName: string; deciderName: string; documentTitle: string; decision: string; comment: string; baseUrl: string;
}) {
  const color = opts.decision === 'Approved' ? '#059669' : '#e11d48';
  return {
    subject: `${opts.decision}: ${opts.documentTitle}`,
    html: layout('Approval decision', `
      <p>Hi ${opts.requesterName},</p>
      <p><strong>${opts.deciderName}</strong> reviewed <strong>"${opts.documentTitle}"</strong>:</p>
      <p style="font-size:16px;font-weight:700;color:${color}">${opts.decision}</p>
      ${opts.comment ? `<p style="border-left:3px solid #e2e8f0;padding-left:12px;color:#64748b">${opts.comment}</p>` : ''}
      ${button(opts.baseUrl, 'Open document')}`)
  };
}

export function documentSharedEmail(opts: {
  recipientName: string; sharerName: string; documentTitle: string; permissionType: string; baseUrl: string;
}) {
  return {
    subject: `${opts.sharerName} shared "${opts.documentTitle}" with you`,
    html: layout('A document was shared with you', `
      <p>Hi ${opts.recipientName},</p>
      <p><strong>${opts.sharerName}</strong> gave you <strong>${opts.permissionType}</strong> access to
        <strong>"${opts.documentTitle}"</strong>.</p>
      ${button(opts.baseUrl, 'Open in Chore Box DMS')}`)
  };
}
