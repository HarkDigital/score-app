// Sign-in with Clerk, and keeping this device's followed teams, alerts,
// spoiler delay, league order and game page layouts in step with the account
// on the push server (/v1/me). The feed-free logic (merging, checking, the
// device's mark) is account.js.
//
// Clerk's browser bundle loads only when it's needed: at launch if this
// device was signed in before, else when the account sheet opens. Signed
// out, nothing changes: the teams stay on the device as they always have.
//
// - First sign-in on a device (the mark names no one, or someone else):
//   the account's teams plus this device's (mergeAccounts), saved to both.
// - After that the account wins: each launch, and each return to the front,
//   reads it and replaces the device's copy.
// - A change on the device marks it dirty and is PUT shortly after; a
//   failed PUT stays dirty, so the next sync sends the device's copy.

import {
  CLERK_PUBLISHABLE_KEY, ACCOUNT_API, clerkScriptUrl, signInAllowed, parseAccount, mergeAccounts, sameAccount, keepDeviceSettings,
  loadAccountMark, saveAccountMark,
} from './account.js';

const KEY = CLERK_PUBLISHABLE_KEY;
export const accountsOn = () => signInAllowed(KEY, location.hostname);

// Phade's colors for Clerk's own sign-in form.
const APPEARANCE = {
  variables: {
    colorPrimary: '#46bb93',
    colorBackground: '#111111',
    colorText: '#ededed',
    colorTextSecondary: '#9ca3af',
    colorInputBackground: '#030712',
    colorInputText: '#ededed',
    colorNeutral: '#ededed',
    colorDanger: '#ef6b6b',
    fontFamily: 'Poppins, system-ui, sans-serif',
    borderRadius: '10px',
  },
  elements: {
    rootBox: { width: '100%' },
    cardBox: { width: '100%', boxShadow: 'none', border: '0' },
    card: { boxShadow: 'none', background: 'transparent' },
  },
};

const state = {
  clerk: null,
  loading: null,
  failed: false,   // Clerk itself didn't load
  error: false,    // the last sync failed
  syncedAt: 0,
  mountedIn: null, // the element showing Clerk's sign-in form
  signUp: false,
};
let hooks = null;
let pushTimer = null;
let edits = 0; // changes made on this device while signed in

// storage: localStorage (or null). local(): {teams, alertDelay, leagueOrder, gameCards} on this
// device. apply(account): replace them. changed(): sign-in state or sync
// status changed (redraw the sheet and the header button).
export function initAccount(options) {
  hooks = options;
  if (!accountsOn()) return;
  if (loadAccountMark(hooks.storage)) loadClerk().catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.syncedAt > 30_000) sync();
  });
}

export function loadClerk() {
  if (!accountsOn()) return Promise.reject(new Error('accounts off'));
  if (state.loading) return state.loading;
  state.failed = false;
  state.loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = clerkScriptUrl(KEY);
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.clerkPublishableKey = KEY;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Clerk did not load'));
    document.head.append(script);
  }).then(async () => {
    const clerk = window.Clerk;
    // Clerk navigates after signing in and between sign-in and sign-up; the
    // app has its own hash routes, so those navigations go nowhere (Clerk's
    // default would reload the site at "/") and the form switches in place.
    const here = `${location.pathname}?`;
    await clerk.load({
      appearance: APPEARANCE,
      signInUrl: `${here}sign-in`,
      signUpUrl: `${here}sign-up`,
      routerPush: navigated,
      routerReplace: navigated,
    });
    state.clerk = clerk;
    let last = clerk.user?.id ?? null;
    clerk.addListener(({ user }) => {
      const id = user?.id ?? null;
      if (id === last) return;
      last = id;
      if (id) sync();
      else signedOut();
      hooks.changed();
    });
    if (last) sync();
    else if (loadAccountMark(hooks.storage)) signedOut();
    hooks.changed();
    return clerk;
  });
  state.loading.catch(() => {
    state.loading = null;
    state.failed = true;
    hooks.changed();
  });
  return state.loading;
}

function navigated(to) {
  const signUp = /sign-up/.test(String(to));
  if (signUp === state.signUp || !state.mountedIn) return;
  const el = state.mountedIn;
  hideSignIn();
  state.signUp = signUp;
  showSignIn(el);
}

// 'off' | 'loading' | 'failed' | 'signedOut' | 'signedIn'
export function accountState() {
  if (!accountsOn()) return { status: 'off' };
  if (state.failed) return { status: 'failed' };
  if (!state.clerk) return { status: 'loading' };
  const user = state.clerk.user;
  if (!user) return { status: 'signedOut' };
  return {
    status: 'signedIn',
    email: user.primaryEmailAddress?.emailAddress ?? user.username ?? '',
    error: state.error,
    syncedAt: state.syncedAt,
  };
}

export function showSignIn(el) {
  if (!state.clerk || state.mountedIn === el) return;
  hideSignIn();
  state.mountedIn = el;
  const props = { appearance: APPEARANCE, routing: 'virtual' };
  if (state.signUp) state.clerk.mountSignUp(el, props);
  else state.clerk.mountSignIn(el, { ...props, withSignUp: true });
}

export function hideSignIn() {
  if (!state.mountedIn) return;
  if (state.signUp) state.clerk.unmountSignUp(state.mountedIn);
  else state.clerk.unmountSignIn(state.mountedIn);
  state.mountedIn = null;
  state.signUp = false;
}

async function api(method, body) {
  const token = await state.clerk?.session?.getToken();
  if (!token) throw new Error('no session');
  const res = await fetch(`${ACCOUNT_API}/v1/me`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let running = null;
let again = false;

// One sync at a time; a request during one runs another after it.
export function sync() {
  if (!state.clerk?.user) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncOnce();
    } while (again);
  })().finally(() => { running = null; });
  return running;
}

async function syncOnce() {
  const user = state.clerk?.user?.id;
  if (!user) return;
  const { storage } = hooks;
  const mark = loadAccountMark(storage);
  const mine = mark?.user === user;
  const seen = edits;
  try {
    let account;
    let remote = null;
    if (mine && mark.dirty) {
      // A change made here hasn't reached the account yet: it wins.
      account = parseAccount(hooks.local());
    } else {
      remote = parseAccount(await api('GET'));
      if (!remote) throw new Error('bad account');
      account = mine ? keepDeviceSettings(remote, hooks.local()) : mergeAccounts(remote, hooks.local());
    }
    if (!remote || !sameAccount(account, remote)) await api('PUT', account);
    // Changed here while that was in flight: keep it, and send it next.
    if (edits !== seen) {
      again = true;
      return;
    }
    saveAccountMark(storage, { user, dirty: false });
    if (!sameAccount(account, hooks.local())) hooks.apply(account);
    state.error = false;
    state.syncedAt = Date.now();
  } catch {
    state.error = true;
  }
  hooks.changed();
}

// After any change to the followed teams (or their order), their alerts,
// the delay or the league order.
export function accountChanged() {
  const user = state.clerk?.user?.id;
  if (!user || loadAccountMark(hooks.storage)?.user !== user) return; // the first sync merges
  edits += 1;
  saveAccountMark(hooks.storage, { user, dirty: true });
  clearTimeout(pushTimer);
  pushTimer = setTimeout(sync, 800);
}

function signedOut() {
  clearTimeout(pushTimer);
  saveAccountMark(hooks.storage, null);
  state.error = false;
  state.syncedAt = 0;
}

// The device keeps its teams and alerts, now just on this device.
export async function signOut() {
  await state.clerk?.signOut();
}

// Forgets the teams on the server, then the Clerk user (Clerk's "Allow users
// to delete their accounts" must be on). Throws if either fails.
export async function deleteAccount() {
  await api('DELETE');
  await state.clerk.user.delete();
  signedOut();
  hooks.changed();
}
