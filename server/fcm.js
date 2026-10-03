// Firebase Cloud Messaging (HTTP v1) for the Android app, with a service
// account's key. No dependencies, like apns.js: an RS256 JWT signed with
// node:crypto is swapped for an OAuth access token, kept until shortly
// before it expires, and messages go out with fetch.

import crypto from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

// The signed JWT that asks Google for an access token.
export function assertion(account, nowSec) {
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: account.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  })}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key);
  return `${unsigned}.${signature.toString('base64url')}`;
}

// A message for one phone. Data values must be strings; the Android app's
// FirebaseMessagingService reads them. collapse_key keeps only the latest of
// a game's updates for a phone that was offline.
export function fcmMessage(token, { data, priority = 'HIGH', collapseKey, ttl }) {
  return {
    message: {
      token,
      data,
      android: { priority, ...(collapseKey ? { collapse_key: collapseKey } : {}), ...(ttl ? { ttl } : {}) },
    },
  };
}

// Responses that mean the token will never work again: forget it.
export function fcmTokenIsDead(status, body) {
  const codes = [body?.error?.status, ...(body?.error?.details ?? []).map((d) => d?.errorCode)];
  if (codes.includes('UNREGISTERED') || codes.includes('SENDER_ID_MISMATCH')) return true;
  return status === 404 || (status === 400 && /registration token/i.test(body?.error?.message ?? ''));
}

export function createFcm({ account, log = console.log, fetch: request = fetch, now = () => Date.now() }) {
  let access = null;
  let accessUntil = 0;

  async function bearer() {
    if (access && now() < accessUntil) return access;
    const res = await request(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: assertion(account, Math.floor(now() / 1000)),
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw new Error(`token ${res.status} ${body.error ?? ''}`.trim());
    access = body.access_token;
    // Refresh five minutes early.
    accessUntil = now() + Math.max(60, (Number(body.expires_in) || 3600) - 300) * 1000;
    return access;
  }

  // Resolves to { ok, dead, status }. Never rejects.
  async function send(token, message) {
    try {
      const res = await request(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await bearer()}`, 'content-type': 'application/json' },
        body: JSON.stringify(fcmMessage(token, message)),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { ok: true, dead: false, status: res.status };
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) access = null;
      log(`fcm ${token.slice(0, 8)}… ${res.status} ${body?.error?.status ?? ''}`.trim());
      return { ok: false, dead: fcmTokenIsDead(res.status, body), status: res.status };
    } catch (err) {
      log(`fcm ${token.slice(0, 8)}… ${err.message}`);
      return { ok: false, dead: false, status: 0 };
    }
  }

  return { send };
}

// The service account file (Firebase console: Project settings > Service
// accounts > Generate new private key), or null if it's missing or wrong.
export function readAccount(json) {
  try {
    const account = JSON.parse(json);
    return account.project_id && account.client_email && account.private_key ? account : null;
  } catch {
    return null;
  }
}
