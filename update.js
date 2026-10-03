// The iPhone app keeps this page loaded for days, so a merge to main used to
// reach it only once the app was force-quit. GitHub Pages stamps every file
// of a deploy with the same Last-Modified. When the page comes back to the
// front (and once at launch, in case it came from the cache) it asks for the
// site's stamp; if that's newer than the page it's running, it fetches its
// files afresh, so the reload can't get the old ones from the cache, and
// reloads, keeping the route.

const EVERY = 5 * 60_000;        // at most one check per 5 minutes
const KEY = 'scores.reloadedFor'; // the stamp last reloaded for, so never a loop

export function initAutoUpdate({ canReload = () => true } = {}) {
  const running = Date.parse(document.lastModified);
  if (!Number.isFinite(running)) return;
  let lastCheck = 0;

  async function check() {
    if (document.hidden || Date.now() - lastCheck < EVERY) return;
    lastCheck = Date.now();
    let stamp;
    try {
      const res = await fetch(location.pathname, { method: 'HEAD', cache: 'no-store' });
      stamp = Date.parse(res.headers.get('last-modified'));
    } catch {
      return;
    }
    // Seconds on both sides; a deploy is minutes apart.
    if (!(stamp - running > 1000) || !canReload() || reloadedFor() === String(stamp)) return;
    remember(String(stamp));
    const own = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => url.startsWith(location.origin) && /\.(js|css)(\?|$)/.test(url));
    await Promise.all([location.pathname, ...own].map((url) => fetch(url, { cache: 'reload' }).catch(() => {})));
    location.reload();
  }

  document.addEventListener('visibilitychange', check);
  setTimeout(check, 3000);
}

function reloadedFor() {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

function remember(stamp) {
  try { sessionStorage.setItem(KEY, stamp); } catch { /* private mode etc. */ }
}
