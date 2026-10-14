// Clerk session tokens. The web app sends the signed-in person's token as
// "Authorization: Bearer ..."; it's an RS256 JWT, good for about a minute,
// signed with the Clerk instance's key. Verified here with no network call
// when CLERK_JWT_KEY (the PEM public key) is set, else with the instance's
// JWKS (fetched from CLERK_ISSUER and cached). Returns the Clerk user id
// (the token's sub, "user_...") or null.

import crypto from 'node:crypto';

const SKEW = 5; // seconds of clock difference allowed either way
const JWKS_TTL = 3600_000;
const JWKS_RETRY = 60_000; // an unknown kid refetches at most this often

const b64json = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

export function createClerkAuth({ issuer, jwtKey = null, parties = [], fetchJson, now = () => Date.now(), log = () => {} }) {
  const iss = String(issuer ?? '').replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(iss)) throw new Error('CLERK_ISSUER must be the instance\'s https Frontend API URL');
  let pem = null;
  if (jwtKey) {
    try {
      pem = crypto.createPublicKey(jwtKey.replace(/\\n/g, '\n'));
    } catch {
      throw new Error('CLERK_JWT_KEY isn\'t a PEM public key');
    }
  }
  let keys = new Map();
  let fetchedAt = 0;

  async function keyFor(kid) {
    if (pem) return pem;
    const stale = now() - fetchedAt > JWKS_TTL;
    if (!keys.has(kid) && (stale || now() - fetchedAt > JWKS_RETRY)) {
      try {
        const jwks = await fetchJson(`${iss}/.well-known/jwks.json`);
        keys = new Map((jwks?.keys ?? []).filter((k) => k.kty === 'RSA').map((k) => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })]));
        fetchedAt = now();
      } catch (err) {
        // Keep the keys we had.
        log(`Clerk keys not fetched: ${err.cause?.code ?? err.message}`);
      }
    }
    return keys.get(kid) ?? null;
  }

  return async function verify(authorization) {
    const token = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(String(authorization ?? ''))?.[1];
    if (!token) return null;
    const [head, body, sig] = token.split('.');
    let header;
    let claims;
    try {
      header = b64json(head);
      claims = b64json(body);
    } catch {
      return null;
    }
    if (header?.alg !== 'RS256') return null;
    const key = await keyFor(header.kid);
    if (!key) return null;
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${head}.${body}`), key, Buffer.from(sig, 'base64url'));
    if (!ok) return null;
    const seconds = now() / 1000;
    if (typeof claims.exp !== 'number' || claims.exp < seconds - SKEW) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > seconds + SKEW) return null;
    if (claims.iss !== iss) return null;
    // azp is the origin the token was made for; Clerk recommends checking it.
    if (parties.length && claims.azp && !parties.includes(claims.azp)) return null;
    return typeof claims.sub === 'string' && /^user_\w+$/.test(claims.sub) ? claims.sub : null;
  };
}
