// Apple Push Notification service over HTTP/2, with token (.p8 key) auth.
// No dependencies: node:http2 and node:crypto. One connection per APNs host,
// reopened when Apple closes it.
//
// A connection left idle for hours goes stale without the server hearing of
// it: the next request fails with ECONNRESET (Oct 2026: the evening's first
// push, usually a Lock Screen start, failed this way most days). So an idle
// connection is closed after IDLE_CLOSE, and a request that fails before
// Apple answers is sent once more on a fresh connection.

import http2 from 'node:http2';
import crypto from 'node:crypto';

const HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

// Apple wants the token refreshed between 20 and 60 minutes old.
const TOKEN_MAX_AGE = 40 * 60_000;

// Under the usual NAT and firewall idle timeouts (AWS's NAT drops at 350s).
// A live game pushes every few seconds, so it keeps its connection.
const IDLE_CLOSE = 4 * 60_000;

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

// hosts and idleClose are for the tests.
export function createApns({ keyPem, keyId, teamId, bundleId, log = console.log, hosts = HOSTS, idleClose = IDLE_CLOSE }) {
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

  function forget(env, s) {
    if (sessions.get(env) === s) sessions.delete(env);
  }

  function session(env) {
    const existing = sessions.get(env);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const s = http2.connect(hosts[env]);
    s.on('error', (err) => log(`apns ${env} connection error: ${err.message}`));
    s.on('close', () => forget(env, s));
    s.on('goaway', () => forget(env, s));
    s.setTimeout(idleClose, () => {
      forget(env, s);
      s.close();
    });
    sessions.set(env, s);
    return s;
  }

  // Resolves to { status, reason, dead }; status 0 when Apple never answered
  // (twice: once more on a fresh connection). Never rejects.
  async function send(token, env, options) {
    const first = await sendOnce(token, env, options);
    if (first.status !== 0) return first;
    return sendOnce(token, env, options);
  }

  function sendOnce(token, env, { pushType, topic, priority, payload, expiration = 0 }) {
    return new Promise((resolve) => {
      let s;
      let req;
      // No answer from Apple: this connection is no good, the next request
      // opens another.
      const failed = (reason) => {
        if (s) {
          forget(env, s);
          s.destroy();
        }
        resolve({ status: 0, reason, dead: false });
      };
      try {
        s = session(env);
        req = s.request({
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
        failed(err.message);
        return;
      }
      let status = 0;
      let body = '';
      req.setEncoding('utf8');
      req.setTimeout(15_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
      req.on('response', (headers) => { status = headers[':status']; });
      req.on('data', (chunk) => { body += chunk; });
      req.on('error', (err) => failed(err.message));
      req.on('close', () => {
        if (!status) {
          failed('no answer');
          return;
        }
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
