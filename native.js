// The iPhone app's native features: the lock-screen card (a Live Activity)
// and team alerts. The app's ViewController installs a message handler,
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

// { liveActivities: bool, current: {league, eventId} | null, alerts: 'authorized' | 'denied' | 'notDetermined' | ... }
export const nativeInfo = () => call('info');

// card: details.js lockScreenCard(). Resolves to {ok: true} or null.
export const showOnLockScreen = (card) => call('showGame', { card });
export const removeFromLockScreen = () => call('removeGame');

// Asks for notification permission if it hasn't been asked yet. Resolves to
// the permission status.
export const enableAlerts = () => call('enableAlerts');

// The followed teams that want alerts, as [{league, id}]. The app hands them
// to the push server with its device token.
export const setAlertTeams = (teams) => call('setAlertTeams', { teams });
