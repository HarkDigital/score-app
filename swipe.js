// Swipe anywhere to go back or forward, in the apps. On iPhone, WebKit's own
// swipes (turned on in the app's ViewController) only start at the screen's
// edge, with a live preview of the page underneath; on Android the edges are
// the system's Back gesture. This covers the rest of the screen, as iOS's
// own apps now do. The page follows the finger, and letting go a third of the
// way across, or flicking, goes back (right) or forward (left). The edges
// stay the system's, and anything that scrolls sideways (league pills, box
// score tables) keeps its own swipes.

import { inSideScroller } from './pull.js';

const EDGE = 24;      // px from a side: WebKit's edge swipes start there
const SLOP = 10;      // px of movement before deciding what the finger means
const COMMIT = 0.3;   // share of the width that commits on release
const FLICK = 0.45;   // px/ms in the swipe's direction also commits
const OUT = 180;      // ms, the page sliding away
const IN = 240;       // ms, the next one settling in

export function initSwipeNav({ enabled, content, canBack, canForward, back, forward }) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let touch = null;   // { x, y, dx, held, claimed, scrolling, lastY, el, samples: [[ms, x]] }

  document.addEventListener('touchstart', (event) => {
    touch = null;
    if (event.touches.length !== 1 || !enabled()) return;
    const { clientX: x, clientY: y } = event.touches[0];
    if (x < EDGE || x > window.innerWidth - EDGE || inSideScroller(event.target)) return;
    touch = { x, y, dx: 0, claimed: false, el: null, samples: [[performance.now(), x]] };
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!touch) return;
    const { clientX: x, clientY: y } = event.touches[0];
    const dx = x - touch.x;
    const dy = y - touch.y;
    if (!touch.held) {
      // WebKit lets only the first move stop the page from scrolling (after
      // that the moves can't be cancelled), so the first move decides:
      // sideways holds the gesture, anything else is the page's scroll.
      if (!dx && !dy) return;
      if (Math.abs(dx) <= Math.abs(dy) || !event.cancelable) {
        touch = null;
        return;
      }
      touch.held = true;
      touch.lastY = y;
    }
    event.preventDefault();
    if (touch.scrolling) {
      // It turned into a scroll after all, which the page can no longer do
      // itself for this touch: scroll it by hand.
      window.scrollBy(0, touch.lastY - y);
      touch.lastY = y;
      return;
    }
    if (!touch.claimed) {
      touch.lastY = y;
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) {
        touch.scrolling = true;
        return;
      }
      touch.claimed = true;
      touch.el = content();
      touch.el.style.transition = 'none';
      touch.el.style.willChange = 'transform';
    }
    touch.dx = dx;
    touch.samples.push([performance.now(), x]);
    if (touch.samples.length > 5) touch.samples.shift();
    // Nowhere to go that way: a little give, then it stops.
    const able = dx > 0 ? canBack() : canForward();
    const shift = able ? dx : Math.sign(dx) * Math.min(48, Math.abs(dx) / 4);
    touch.el.style.transform = `translateX(${shift}px)`;
  }, { passive: false });

  document.addEventListener('touchend', () => release(false));
  document.addEventListener('touchcancel', () => release(true));

  function reset(el) {
    el.style.transition = '';
    el.style.transform = '';
    el.style.willChange = '';
  }

  function release(cancelled) {
    const t = touch;
    touch = null;
    if (!t?.claimed) return;
    const { el, dx } = t;
    const dir = dx > 0 ? 1 : -1;
    const [t0, x0] = t.samples[0];
    const [t1, x1] = t.samples[t.samples.length - 1];
    const speed = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;
    const able = dir > 0 ? canBack() : canForward();
    const go = !cancelled && able
      && (Math.abs(dx) > window.innerWidth * COMMIT || (Math.abs(speed) > FLICK && Math.sign(speed) === dir));

    if (!go) {
      el.style.transition = `transform ${OUT}ms ease-out`;
      el.style.transform = '';
      setTimeout(() => reset(el), OUT);
      return;
    }
    const move = dir > 0 ? back : forward;
    if (reduceMotion.matches) {
      reset(el);
      move();
      return;
    }
    el.style.transition = `transform ${OUT}ms ease-in`;
    el.style.transform = `translateX(${dir * window.innerWidth}px)`;
    setTimeout(() => {
      // Hidden until the next page is in, so the old one never flashes back.
      el.style.visibility = 'hidden';
      reset(el);
      arrive(dir, el);
      move();
    }, OUT);
  }

  // The next page slides in from the side it came from. history.back() and
  // forward() land on popstate; going back to the scoreboard from a page
  // opened by link happens at once, so there's a short fallback too.
  function arrive(dir, oldEl) {
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      window.removeEventListener('popstate', onPop);
      oldEl.style.visibility = '';
      content().animate?.(
        [{ transform: `translateX(${-dir * 30}%)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }],
        { duration: IN, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    };
    // After the app's own popstate handler has drawn the page.
    const onPop = () => setTimeout(show, 0);
    window.addEventListener('popstate', onPop);
    setTimeout(show, 300);
  }
}
