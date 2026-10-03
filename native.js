// The iPhone app's native features: the lock-screen card (a Live Activity),
// team alerts and haptics (the Android app only has haptics). The app's ViewController installs a message handler,
// window.webkit.messageHandlers.phadeScores, whose postMessage returns a
// promise. On the website it doesn't exist, every call here resolves to null,
// and the pages show none of these controls. No Capacitor JS involved.

const handler = () => window.webkit?.messageHandlers?.phadeScores ?? null;

export const inApp = () => Boolean(handler());

async function call(action, args = {}) {
  const h = handler();
  if (!h) return null;
  try {
    return await h.postMessage({ action, ...args });
  } catch {
    return null;
  }
}

// { liveActivities, canSchedule (iOS 17.2+), active: [{league, eventId}],
//   scheduled: [{league, eventId}], alerts: 'authorized' | 'denied' | ... }
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

// The Android app is the same site in a WebView with no bridge; it adds
// "PhadeScoresAndroid" to its user agent (capacitor.config.json).
export const inAndroidApp = () => /PhadeScoresAndroid/.test(navigator.userAgent);

// Android's haptics: a short buzz (ms) per style.
const BUZZ = { selection: 6, light: 10, medium: 18 };

// A tap of the haptic engine: 'selection' (tabs, pickers, switches), 'light'
// (buttons) or 'medium' (pull to refresh arming). Fire and forget; silent on
// the website and in iPhone builds before 7, which don't know the action.
export function haptic(style = 'light') {
  if (inAndroidApp()) {
    navigator.vibrate?.(BUZZ[style] ?? BUZZ.light);
    return;
  }
  call('haptic', { style });
}
