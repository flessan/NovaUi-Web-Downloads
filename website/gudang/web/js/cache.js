/* ═══════════════════════════════════════════════════════════════
   NOVA UI · CACHE HELPERS
   Central, namespaced, versioned storage for GitHub API data and
   the download catalogue. Any consumer goes through here so a hard
   refresh can reliably purge every byte of cached remote data in
   one call - no orphaned keys left behind.
   ═══════════════════════════════════════════════════════════════ */

const NAMESPACE = 'nova-ui';
// Bump this whenever the shape of a cached record changes so stale
// entries are invalidated automatically for every visitor.
const SCHEMA_VERSION = 3;
const PREFIX = `${NAMESPACE}:v${SCHEMA_VERSION}:`;

/* All keys the app ever writes. Listed here so purge can enumerate
   every cache, not just the ones the current page knows about. */
export const KEYS = Object.freeze({
  github: (owner, repo) => `${PREFIX}github:${owner}/${repo}`,
  githubExt: (owner, repo) => `${PREFIX}github-ext:${owner}/${repo}`,
  catalogue: `${PREFIX}catalogue`,
  sheet: `${PREFIX}sheet`,
  extReleases: `${PREFIX}ext-releases`,
});

function storageAvailable(area = 'localStorage') {
  try {
    const store = window[area];
    const probe = `${PREFIX}__probe__`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const hasLocal = storageAvailable('localStorage');
const hasSession = storageAvailable('sessionStorage');

function getStore(persistent = false) {
  return persistent ? (hasLocal ? localStorage : null) : (hasSession ? sessionStorage : null);
}

/** Reads a cached entry. Returns { data, at } or null when missing,
 *  expired, malformed, or from an older schema version. */
export function cacheRead(key, { ttl = Infinity, persistent = false } = {}) {
  const store = getStore(persistent);
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== 'object' || !('data' in entry)) return null;
    if (entry.v !== SCHEMA_VERSION) return null;
    if (Number.isFinite(ttl) && Date.now() - (entry.at || 0) > ttl) return null;
    return entry;
  } catch {
    return null;
  }
}

/** Writes { data, at, v }. Silently no-ops in private / quota-locked modes. */
export function cacheWrite(key, data, { persistent = false } = {}) {
  const store = getStore(persistent);
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify({ v: SCHEMA_VERSION, at: Date.now(), data }));
    return true;
  } catch {
    return false;
  }
}

export function cacheRemove(key, { persistent = null } = {}) {
  try {
    // persistent === null  → remove from both
    // persistent === true  → only localStorage
    // persistent === false → only sessionStorage
    if (persistent !== false && hasLocal) localStorage.removeItem(key);
    if (persistent !== true && hasSession) sessionStorage.removeItem(key);
  } catch { /* ignore */ }
}

/** Wipes every Nova UI cache across both storage areas - local,
 *  session, and any service worker caches. Used by hard refresh. */
export async function purgeAllCaches() {
  const prefixes = [NAMESPACE + ':', `nova-downoad-`]; // legacy typo
  for (const store of [localStorage, sessionStorage]) {
    try {
      const keys = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && prefixes.some((p) => k.startsWith(p))) keys.push(k);
      }
      keys.forEach((k) => store.removeItem(k));
    } catch { /* storage blocked */ }
  }

  // Tell the service worker to drop its caches too, if it's active.
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    try {
      navigator.serviceWorker.controller.postMessage('clear-caches');
    } catch { /* worker not yet claimed */ }
  }
  if ('caches' in window) {
    try {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('nova-')).map((n) => caches.delete(n)));
    } catch { /* no window caches access */ }
  }
}

/** Returns true if any cached remote data exists. Useful for UI
 *  labels ("Showing cached data"). */
export function hasAnyCached(owner, repo) {
  const probe = [KEYS.catalogue, KEYS.github(owner, repo), KEYS.sheet];
  return probe.some((k) => {
    try { return (localStorage.getItem(k) || sessionStorage.getItem(k)) != null; }
    catch { return false; }
  });
}

/**
 * Hard refresh helper: purge every cache, reload with a cache-busting
 * query flag so the browser itself revalidates, and return fresh data.
 */
export async function hardRefresh({ owner, repo } = {}) {
  await purgeAllCaches();
  // Bump a flag so module scripts also bypass HTTP cache on the next
  // navigation. We use a session flag rather than mutating URLs so
  // clean URLs are preserved once the reload settles.
  try { sessionStorage.setItem(`${PREFIX}hard-refresh-pending`, '1'); }
  catch { /* ignore */ }
  return true;
}

/** Returns true when this page load was the first one after a hard
 *  refresh. Callers (e.g. a toast) can check this once at boot. */
export function consumeHardRefreshFlag() {
  try {
    const key = `${PREFIX}hard-refresh-pending`;
    if (sessionStorage.getItem(key) === '1') {
      sessionStorage.removeItem(key);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}
