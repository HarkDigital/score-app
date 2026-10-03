// Pull to refresh: at the top of the page, drag down until the arrow turns
// mint and let go. Touch only; the header's refresh button covers the rest.
// The content slides down under the header and a Phade-style puck turns with
// the pull, then spins until the refresh is done.

import { ICONS } from './ui.js';

const ARM = 64;        // pull (px) that triggers a refresh on release
const REST = 52;       // where the content waits while it refreshes
const GIVE = 150;      // resistance: the pull approaches this, never reaches it
const EDGE = 24;       // touches this close to a side belong to the back/forward swipe
const MIN_SPIN = 500;  // ms, so a quick refresh still reads as one
const SETTLE = 260;    // ms, matches the .ptr-settling transitions

export function initPullToRefresh({ refresh, enabled }) {
  const puck = document.createElement('div');
  puck.className = 'ptr';
  puck.setAttribute('aria-hidden', 'true');
  puck.innerHTML = ICONS.refresh;
  document.body.append(puck);

  const rootStyle = document.documentElement.style;
  const body = document.body;
  let touch = null;    // the finger being tracked: { x, y, pull, pulling }
  let busy = false;    // a refresh is running or the content is settling
  let settleTimer = null;

  function show(pull) {
    rootStyle.setProperty('--pull', `${pull}px`);
    rootStyle.setProperty('--pull-turn', `${(pull / ARM) * 300}deg`);
    rootStyle.setProperty('--pull-show', String(Math.min(1, pull / 36)));
    puck.classList.toggle('armed', pull >= ARM);
  }

  // Ease to a resting pull, then run `then`.
  function settle(pull, then) {
    clearTimeout(settleTimer);
    body.classList.add('ptr-settling');
    show(pull);
    settleTimer = setTimeout(() => {
      body.classList.remove('ptr-settling');
      then?.();
    }, SETTLE);
  }

  function finish() {
    settle(0, () => {
      body.classList.remove('ptr-active');
      puck.classList.remove('refreshing');
      busy = false;
    });
  }

  async function run() {
    busy = true;
    puck.classList.add('refreshing');
    settle(REST);
    const wait = new Promise((resolve) => setTimeout(resolve, MIN_SPIN));
    await Promise.all([Promise.resolve().then(refresh).catch(() => {}), wait]);
    finish();
  }

  document.addEventListener('touchstart', (event) => {
    touch = null;
    if (busy || event.touches.length !== 1 || window.scrollY > 0 || !enabled()) return;
    const { clientX: x, clientY: y } = event.touches[0];
    if (x < EDGE || x > window.innerWidth - EDGE || inSideScroller(event.target)) return;
    touch = { x, y, pull: 0, pulling: false };
  }, { passive: true });

  // The first move decides: straight down claims the gesture (and stops the
  // page from scrolling), anything else lets it go.
  document.addEventListener('touchmove', (event) => {
    if (!touch) return;
    const { clientX, clientY } = event.touches[0];
    const dx = clientX - touch.x;
    const dy = clientY - touch.y;
    if (!touch.pulling) {
      if (!dx && !dy) return;
      if (dy <= Math.abs(dx) || !event.cancelable || window.scrollY > 0) {
        touch = null;
        return;
      }
      touch.pulling = true;
      // The puck comes out from under the header, wherever it ends.
      const header = document.querySelector('.top');
      rootStyle.setProperty('--ptr-top', `${header ? header.getBoundingClientRect().bottom : 0}px`);
      body.classList.add('ptr-active');
    }
    if (event.cancelable) event.preventDefault();
    const down = Math.max(0, dy);
    touch.pull = (GIVE * down) / (down + GIVE);
    show(touch.pull);
  }, { passive: false });

  const release = (cancelled) => {
    if (!touch?.pulling) {
      touch = null;
      return;
    }
    const armed = !cancelled && touch.pull >= ARM;
    touch = null;
    if (armed) run();
    else {
      busy = true;
      finish();
    }
  };
  document.addEventListener('touchend', () => release(false));
  document.addEventListener('touchcancel', () => release(true));
}

// League pills and wide tables scroll sideways; a drag that starts on one is
// theirs, even if it wobbles downward first (swipe.js uses this too).
export function inSideScroller(node) {
  for (let el = node instanceof Element ? node : node?.parentElement; el && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}
