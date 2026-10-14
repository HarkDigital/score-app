// The page's entry: moves the apps' saved settings over from github.io on
// their first launch on scores.phade.app (move.js), then starts the app.
// app.js reads the followed teams and sends them to the app at once, so it
// mustn't run before they're here.

import { MOVE_URL, MOVING_KEY, movePlan, keepSettings } from './move.js';

const inApp = Boolean(window.webkit?.messageHandlers?.phadeScores || window.phadeScoresAndroid);
let storage = null;
let session = null;
try { storage = window.localStorage; } catch { /* blocked */ }
try { session = window.sessionStorage; } catch { /* blocked */ }

const plan = movePlan({ inApp, hostname: location.hostname, search: location.search, storage, session });
if (plan === 'fetch') {
  try { session.setItem(MOVING_KEY, '1'); } catch { /* then it can't come back marked */ }
  if (session?.getItem(MOVING_KEY)) location.replace(MOVE_URL + location.hash);
  else import('./app.js');
} else {
  if (plan === 'keep') {
    keepSettings(storage, new URLSearchParams(location.search).get('moved'));
  }
  if (location.search && new URLSearchParams(location.search).has('moved')) {
    history.replaceState(history.state, '', location.pathname + location.hash);
  }
  import('./app.js');
}
