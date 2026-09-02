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

import { createRemoteJWKSet, jwtVerify } from 'jose';

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

export function buildAuthorizeUrl(provider: OAuthProvider, redirectUri: string, state: string, nonce: string, codeChallenge: string): string {
  const c = providerConfig(provider);
  const params = new URLSearchParams({
    client_id: c.clientId || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: c.scope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  return `${c.authUrl}?${params.toString()}`;
}

const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const microsoftJwks = createRemoteJWKSet(new URL('https://login.microsoftonline.com/common/discovery/v2.0/keys'));

export async function exchangeCodeForProfile(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
  expectedNonce: string,
  codeVerifier: string
): Promise<{ email: string; name: string } | null> {
  const c = providerConfig(provider);
  if (!c.clientId || !c.clientSecret) return null;

  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier
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
    const verified = await jwtVerify(data.id_token, provider === 'google' ? googleJwks : microsoftJwks, {
      audience: c.clientId,
      algorithms: ['RS256']
    });
    claims = verified.payload;
  } catch (err) {
    console.error(`[oauth] ${provider} id_token verification failed:`, (err as Error).message);
    return null;
  }

  const issuer = String(claims.iss || '');
  const validIssuer = provider === 'google'
    ? issuer === 'https://accounts.google.com' || issuer === 'accounts.google.com'
    : /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]+\/v2\.0$/i.test(issuer);
  if (!validIssuer || claims.nonce !== expectedNonce) {
    console.error(`[oauth] ${provider} issuer/nonce validation failed.`);
    return null;
  }

  if (provider === 'google' && claims.email_verified !== true) return null;
  const email = String(claims.email || claims.preferred_username || claims.upn || '').trim().toLowerCase();
  if (!email) return null;
  const name = String(claims.name || email.split('@')[0]);
  return { email, name };
}
