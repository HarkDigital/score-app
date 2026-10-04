// The apps' native features: the lock-screen card (a Live Activity on
// iPhone, a live notification on Android), team alerts and haptics. No
// Capacitor JS involved; each app installs its own line to the page:
// - iPhone: ViewController's message handler,
//   window.webkit.messageHandlers.phadeScores, whose postMessage returns a
//   promise of the reply.
// - Android: MainActivity's web message listener, window.phadeScoresAndroid
//   (only on the app's own site). Messages are JSON strings with an id; the
//   reply comes back on onmessage with the same id.
// On the website neither exists, every call resolves to null, and the pages
// show none of these controls.

const iosHandler = () => window.webkit?.messageHandlers?.phadeScores ?? null;
const androidBridge = () => window.phadeScoresAndroid ?? null;

// 'ios', 'android' or null (the website, or an Android build before the bridge).
export const appPlatform = () => (iosHandler() ? 'ios' : androidBridge() ? 'android' : null);
export const inApp = () => appPlatform() !== null;

// The Android app also adds "PhadeScoresAndroid" to its user agent
// (capacitor.config.json), so even its first builds, which had no bridge,
// are recognised for haptics.
export const inAndroidApp = () => /PhadeScoresAndroid/.test(navigator.userAgent);

const pending = new Map();
let nextId = 0;

function callAndroid(bridge, action, args) {
  if (!bridge.onmessage) {
    bridge.onmessage = (event) => {
      let reply = null;
      try { reply = JSON.parse(event.data); } catch { return; }
      const resolve = pending.get(reply?.id);
      pending.delete(reply?.id);
      resolve?.(reply.result ?? null);
    };
  }
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    bridge.postMessage(JSON.stringify({ id, action, ...args }));
    // Asking for notification permission waits on the person, hence the long wait.
    setTimeout(() => {
      if (pending.delete(id)) resolve(null);
    }, 120_000);
  });
}

async function call(action, args = {}) {
  try {
    const ios = iosHandler();
    if (ios) return await ios.postMessage({ action, ...args });
    const android = androidBridge();
    if (android) return await callAndroid(android, action, args);
  } catch {
    // An app build that doesn't know the action.
  }
  return null;
}

// { platform ('android'; the iPhone app doesn't say), liveActivities,
//   canSchedule (iOS 17.2+, Android with Firebase), teamLockScreen (a team's
//   every game on the Lock Screen: iPhone build 12, Android build 5 on),
//   active: [{league, eventId}], scheduled: [{league, eventId}],
//   alerts: 'authorized' | 'denied' | ... }
export const nativeInfo = () => call('info');

// card: details.js lockScreenCard(). Each resolves to {ok: bool} or null.
// Show now: a game that's on or starts within 15 minutes.
export const showOnLockScreen = (card) => call('showGame', { card });
// Later games: the push server puts the card up 15 minutes before the start.
export const scheduleOnLockScreen = (card) => call('scheduleGame', { card });
// Takes one game off the Lock Screen, or cancels it if it's scheduled.
export const removeFromLockScreen = (league, eventId) => call('removeGame', { league, eventId });

// Asks for notification permission if it hasn't been asked yet. Resolves to
// the permission status.
export const enableAlerts = () => call('enableAlerts');

// The followed teams that want alerts, as [{league, id, start, score, end}]. The app hands them
// to the push server with its device token.
export const setAlertTeams = (teams) => call('setAlertTeams', { teams });

// The first Android builds' haptics: a short buzz (ms) per style.
const BUZZ = { selection: 6, light: 10, medium: 18 };

// A tap of the haptic engine: 'selection' (tabs, pickers, switches), 'light'
// (buttons) or 'medium' (pull to refresh arming). Fire and forget; silent on
// the website and in iPhone builds before 7, which don't know the action.
export function haptic(style = 'light') {
  if (inApp()) call('haptic', { style });
  else if (inAndroidApp()) navigator.vibrate?.(BUZZ[style] ?? BUZZ.light);
}
