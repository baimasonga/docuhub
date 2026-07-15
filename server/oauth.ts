/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Sign in with Google/Microsoft" -- an alternative login method for
 * accounts an Admin has already created (matched by email). There is no
 * self-registration path here: server.ts's callback handler rejects any
 * email that doesn't already have a dms_users row, same as the rest of
 * this app's admin-invite-only account model.
 */

export type OAuthProvider = 'google' | 'microsoft';

interface ProviderConfig {
  authUrl: string;
  tokenUrl: string;
  scope: string;
  clientId?: string;
  clientSecret?: string;
}

function googleConfig(): ProviderConfig {
  return {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET
  };
}

function microsoftConfig(): ProviderConfig {
  // "common" accepts both work/school and personal Microsoft accounts.
  // Set MICROSOFT_TENANT_ID to restrict sign-in to a single Azure AD tenant.
  const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
  return {
    authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scope: 'openid email profile',
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET
  };
}

function providerConfig(provider: OAuthProvider): ProviderConfig {
  return provider === 'google' ? googleConfig() : microsoftConfig();
}

export function isProviderConfigured(provider: OAuthProvider): boolean {
  const c = providerConfig(provider);
  return Boolean(c.clientId && c.clientSecret);
}

export function buildAuthorizeUrl(provider: OAuthProvider, redirectUri: string, state: string): string {
  const c = providerConfig(provider);
  const params = new URLSearchParams({
    client_id: c.clientId || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: c.scope,
    state
  });
  return `${c.authUrl}?${params.toString()}`;
}

// Decode (not verify-by-signature) a JWT payload. Safe here specifically
// because this token is never handled by the browser or any untrusted
// party -- it comes back directly from the provider's token endpoint, over
// TLS, in response to a request WE authenticated with our client_secret.
// The things a signature check would guard against (a forged/tampered
// token) require an attacker who could intercept or forge a TLS response
// from Google/Microsoft's own servers, which is out of scope for a stolen
// authorization code (those are single-use and redirect_uri-bound, checked
// by the provider itself). We do still check `aud` and `exp` below.
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Malformed id_token.');
  const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json);
}

export async function exchangeCodeForProfile(
  provider: OAuthProvider,
  code: string,
  redirectUri: string
): Promise<{ email: string; name: string } | null> {
  const c = providerConfig(provider);
  if (!c.clientId || !c.clientSecret) return null;

  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  let res: Response;
  try {
    res = await fetch(c.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
  } catch (err) {
    console.error(`[oauth] ${provider} token request failed:`, (err as Error).message);
    return null;
  }
  if (!res.ok) {
    console.error(`[oauth] ${provider} token exchange rejected (${res.status}):`, (await res.text()).slice(0, 300));
    return null;
  }

  const data = await res.json() as { id_token?: string };
  if (!data.id_token) return null;

  let claims: Record<string, unknown>;
  try {
    claims = decodeJwtPayload(data.id_token);
  } catch (err) {
    console.error(`[oauth] ${provider} id_token decode failed:`, (err as Error).message);
    return null;
  }

  if (typeof claims.exp === 'number' && Date.now() >= claims.exp * 1000) {
    console.error(`[oauth] ${provider} id_token already expired.`);
    return null;
  }
  if (typeof claims.aud === 'string' && claims.aud !== c.clientId) {
    console.error(`[oauth] ${provider} id_token audience mismatch.`);
    return null;
  }

  const email = String(claims.email || '').trim().toLowerCase();
  if (!email) return null;
  const name = String(claims.name || email.split('@')[0]);
  return { email, name };
}
