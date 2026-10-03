// Apple Push Notification service over HTTP/2, with token (.p8 key) auth.
// No dependencies: node:http2 and node:crypto. One connection per APNs host,
// reopened when Apple closes it.

import http2 from 'node:http2';
import crypto from 'node:crypto';

const HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

// Apple wants the token refreshed between 20 and 60 minutes old.
const TOKEN_MAX_AGE = 40 * 60_000;

const b64url = (data) => Buffer.from(data).toString('base64url');

// The provider token: an ES256 JWT naming the key and the team.
export function providerToken(privateKey, keyId, teamId, issuedAtSec) {
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: issuedAtSec }));
  const signature = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363', // JWS wants raw r||s, not DER
  });
  return `${head}.${claims}.${b64url(signature)}`;
}

// Responses that mean the token will never work again: forget it.
export function tokenIsDead(status, reason) {
  return status === 410 || ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken'].includes(reason);
}

export function createApns({ keyPem, keyId, teamId, bundleId, log = console.log }) {
  const privateKey = crypto.createPrivateKey(keyPem);
  let jwt = null;
  let jwtAt = 0;
  const sessions = new Map();

  function bearer() {
    if (!jwt || Date.now() - jwtAt > TOKEN_MAX_AGE) {
      jwtAt = Date.now();
      jwt = providerToken(privateKey, keyId, teamId, Math.floor(jwtAt / 1000));
    }
    return jwt;
  }

  function session(env) {
    const existing = sessions.get(env);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const s = http2.connect(HOSTS[env]);
    s.on('error', (err) => log(`apns ${env} connection error: ${err.message}`));
    s.on('close', () => sessions.delete(env));
    s.on('goaway', () => sessions.delete(env));
    sessions.set(env, s);
    return s;
  }

  // Resolves to { status, reason, dead }. Never rejects.
  function send(token, env, { pushType, topic, priority, payload, expiration = 0 }) {
    return new Promise((resolve) => {
      let req;
      try {
        req = session(env).request({
          ':method': 'POST',
          ':path': `/3/device/${token}`,
          authorization: `bearer ${bearer()}`,
          'apns-push-type': pushType,
          'apns-topic': topic,
          'apns-priority': String(priority),
          'apns-expiration': String(expiration),
          'content-type': 'application/json',
        });
      } catch (err) {
        resolve({ status: 0, reason: err.message, dead: false });
        return;
      }
      let status = 0;
      let body = '';
      req.setEncoding('utf8');
      req.setTimeout(15_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
      req.on('response', (headers) => { status = headers[':status']; });
      req.on('data', (chunk) => { body += chunk; });
      req.on('error', (err) => resolve({ status: 0, reason: err.message, dead: false }));
      req.on('close', () => {
        let reason = '';
        try { reason = body ? JSON.parse(body).reason ?? '' : ''; } catch { reason = body; }
        resolve({ status, reason, dead: tokenIsDead(status, reason) });
      });
      req.end(JSON.stringify(payload));
    });
  }

  return {
    // A Live Activity update or end, to the activity's own push token.
    activity: (token, env, payload, priority) => send(token, env, {
      pushType: 'liveactivity',
      topic: `${bundleId}.push-type.liveactivity`,
      priority,
      payload,
    }),
    // An ordinary banner, to the device token.
    alert: (token, env, payload) => send(token, env, {
      pushType: 'alert',
      topic: bundleId,
      priority: 10,
      payload,
      // Worth delivering for an hour; after that the news is old.
      expiration: Math.floor(Date.now() / 1000) + 3600,
    }),
  };
}
