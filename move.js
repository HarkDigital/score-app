// The apps' move from harkdigital.github.io to scores.phade.app (sign-in
// only works there). localStorage belongs to one origin, so the first launch
// on the new address finds nothing saved: the followed teams, their alerts,
// the delay and every other setting are still under github.io. That launch
// goes to github.io's move.html once, which hands everything saved there back
// in the address (?moved=), and the app keeps it here. Without this a person
// would lose their teams, and the empty list sent at launch would turn their
// alerts off.

export const MOVE_URL = 'https://harkdigital.github.io/score-app/move.html';
export const MOVE_HOST = 'scores.phade.app';
export const MOVED_KEY = 'scores.moved';     // localStorage: done (or nothing to bring)
export const MOVING_KEY = 'scores.moving';   // sessionStorage: this launch went to fetch it

// Never copied: this device's sign-in mark is the new origin's own business,
// and the self-update mark is per session.
const SKIP = new Set([MOVED_KEY, 'scores.account', 'scores.reloadedFor']);
const MAX_VALUE = 20_000;

const get = (store, key) => {
  try { return store?.getItem(key) ?? null; } catch { return null; }
};
const set = (store, key, value) => {
  try { store?.setItem(key, value); return true; } catch { return false; }
};

// What this launch does: 'fetch' (go to github.io for the saved settings),
// 'keep' (they came back in the address), or 'none'.
export function movePlan({ inApp, hostname, search, storage, session }) {
  if (!inApp || hostname !== MOVE_HOST || get(storage, MOVED_KEY)) return 'none';
  if (!get(session, MOVING_KEY)) return 'fetch';
  // Back from github.io. No ?moved= means it didn't load (offline): carry on
  // with what's here, and try again on the next launch.
  return new URLSearchParams(search).has('moved') ? 'keep' : 'none';
}

// github.io's side: every "scores." setting, as one JSON string.
export function savedSettings(storage) {
  const out = {};
  let n = 0;
  try { n = storage?.length ?? 0; } catch { /* blocked */ }
  for (let i = 0; i < n; i += 1) {
    let key = null;
    try { key = storage.key(i); } catch { /* blocked */ }
    if (!key?.startsWith('scores.') || SKIP.has(key)) continue;
    const value = get(storage, key);
    if (typeof value === 'string' && value.length <= MAX_VALUE) out[key] = value;
  }
  return JSON.stringify(out);
}

// The new origin's side: keeps each setting that isn't already set here,
// then marks the move done. Returns the keys it kept.
export function keepSettings(storage, json) {
  let data = null;
  try { data = JSON.parse(json); } catch { /* garbled */ }
  const kept = [];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith('scores.') || SKIP.has(key) || typeof value !== 'string' || value.length > MAX_VALUE) continue;
      if (get(storage, key) !== null) continue;
      if (set(storage, key, value)) kept.push(key);
    }
  }
  set(storage, MOVED_KEY, '1');
  return kept;
}

// The address to come back to: the app's page with the settings, and the
// route it was opened on (a tapped alert's).
export function returnUrl(origin, settings, hash) {
  return `${origin}/?moved=${encodeURIComponent(settings)}${hash ?? ''}`;
}
