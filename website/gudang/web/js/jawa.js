/* ═══════════════════════════════════════════════════════════════
   NOVA UI · DOWNLOAD CATALOGUE DATA

   The catalogue has two independent sources:
     • Nova UI metadata and downloads come from GitHub Releases;
     • Background Anime metadata and downloads live in Google Sheets.

   A short-lived combined cache makes repeat visits instant and keeps
   the last successful catalogue available when either provider is
   temporarily unreachable. The Refresh button bypasses every cache
   (session + persistent + service worker) and re-fetches both
   providers without navigating or reloading the page.
   ═══════════════════════════════════════════════════════════════ */

import { formatBytes, getReleases } from './github-releases.js';
import { cacheRead, cacheWrite, cacheRemove, KEYS, purgeAllCaches } from './cache.js';

export const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSIWy57PZw5eV1PjxjYC7gX6Haqg9aRgIlATvOCCzns8mcyIRhQkpl1vz40-GK_j4Sxlk4oOBevxBea/pub?output=csv';

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const TIMEOUT = 12000;
const NOVA_ICON = '/gudang/icon_logo/nova.png';

export let packs = [];
export let providerStatus = { github: 'idle', spreadsheet: 'idle' };
export const perPage = 9;

/* ── CSV ─────────────────────────────────────────────────────
   A minimal RFC-4180 parser: handles quoted fields, escaped double
   quotes, and newlines inside quotes - everything a Sheets export
   can emit.                                                        */

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += char;
      continue;
    }

    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'y'].includes(String(value ?? '').trim().toLowerCase());
}

function toNumber(value) {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normalizeIcon(path) {
  if (!path) return '';
  const trimmed = String(path).trim();
  if (!trimmed) return '';
  // Absolute or full URLs pass through.
  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed;
  // Legacy "asset/x.png" paths → /gudang/icon_pack/x.png
  if (trimmed.startsWith('asset/')) return `/gudang/icon_pack/${trimmed.slice('asset/'.length)}`;
  // Bare filenames (e.g. "frieren.png") that match the icon_pack folder.
  if (!trimmed.includes('/')) return `/gudang/icon_pack/${trimmed}`;
  return trimmed;
}

/** Guarantees a consistent shape for a Background Anime sheet row. */
function normaliseBackground(raw) {
  return {
    name: String(raw.name ?? 'Untitled pack').trim(),
    creator: String(raw.creator ?? 'Unknown').trim(),
    description: String(raw.description ?? '').trim(),
    icon: normalizeIcon(raw.icon),
    version: String(raw.version ?? '1.0.0').trim(),
    size: String(raw.size ?? '-').trim(),
    category: 'background',
    source: 'spreadsheet',
    featured: toBool(raw.featured),
    downloads: toNumber(raw.downloads),
    lastUpdated: String(raw.lastUpdated ?? raw.last_updated ?? '').trim(),
    download_pc: String(raw.download_pc ?? '').trim(),
    download_mobile: String(raw.download_mobile ?? '').trim(),
  };
}

function rowsToBackgrounds(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());

  return rows.slice(1).flatMap((cells) => {
    const raw = {};
    headers.forEach((key, index) => { raw[key] = (cells[index] ?? '').trim(); });

    if (String(raw.category ?? '').trim().toLowerCase() !== 'background') return [];
    const pack = normaliseBackground(raw);
    return pack.name && pack.name !== 'Untitled pack' ? [pack] : [];
  });
}

/* ── GitHub UI release mapping ───────────────────────────────── */

const isExtension = (asset) => /extension/i.test(asset?.name || '');
const isZip = (asset) => /\.zip$/i.test(asset?.name || '');

function tagToVersion(tag) {
  if (!tag) return '-';
  return String(tag).replace(/^v/i, '').trim() || '-';
}

function pickPrimaryAsset(assets) {
  return assets.find((a) => isZip(a) && !isExtension(a))
      || assets.find(isZip)
      || assets[0]
      || null;
}

function pickExtensionAsset(assets, primary) {
  return assets.find((a) => a !== primary && isZip(a) && isExtension(a))
      || assets.find((a) => a !== primary && isExtension(a))
      || null;
}

/** Maps the latest GitHub release into the Nova UI card shape. */
export function releaseToUiPack(release) {
  if (!release) return null;
  const assets = Array.isArray(release.assets) ? release.assets.filter(Boolean) : [];
  const stable = pickPrimaryAsset(assets);
  const extension = pickExtensionAsset(assets, stable);
  const totalDownloads = assets.reduce((sum, a) => sum + (a.download_count || 0), 0);
  const totalSize = assets.reduce((sum, a) => sum + (a.size || 0), 0);

  return {
    id: 'nova-ui',
    name: release.name && release.name !== release.tag_name ? release.name : 'Nova UI',
    creator: 'DANZGAME-GD',
    description:
      'A complete Geometry Dash menu UI overhaul with a modern design language, ' +
      'powered by the Geode mod loader. Installs safely without touching original game files.',
    icon: NOVA_ICON,
    version: tagToVersion(release.tag_name),
    size: stable?.size ? formatBytes(stable.size) : (totalSize ? formatBytes(totalSize) : '-'),
    category: 'ui',
    source: 'github',
    featured: true,
    downloads: totalDownloads,
    lastUpdated: release.published_at || release.created_at || '',
    html_url: release.html_url || '',
    download_pc: stable?.browser_download_url || '',
    download_mobile: extension?.browser_download_url || '',
    prerelease: !!release.prerelease,
  };
}

async function fetchUiPack({ force = false } = {}) {
  const releases = await getReleases({ force });
  // The latest non-prerelease, falling back to the first entry if all
  // available releases are prereleases (e.g. during a beta window).
  const latest = releases.find((r) => !r.prerelease) || releases[0];
  const pack = releaseToUiPack(latest);
  return pack ? [pack] : [];
}

/* ── Cache ───────────────────────────────────────────────────── */

function readCache() {
  // Session cache is preferred (lives only for this tab and is always
  // fresh), then persistent (survives tab closes and is fresh while
  // inside the TTL).
  const session = cacheRead(KEYS.catalogue, { ttl: CACHE_TTL, persistent: false });
  if (session) return { data: session.data, stale: false };
  const local = cacheRead(KEYS.catalogue, { ttl: CACHE_TTL, persistent: true });
  if (local) return { data: local.data, stale: false };
  return null;
}

function writeCache(data, { stale = false } = {}) {
  if (stale) {
    // A partial response is useful now but must be replaced next visit,
    // so persist it but do NOT keep it in the fast session cache.
    cacheWrite(KEYS.catalogue, data, { persistent: true });
    cacheRemove(KEYS.catalogue, { persistent: false });
  } else {
    cacheWrite(KEYS.catalogue, data, { persistent: false });
    cacheWrite(KEYS.catalogue, data, { persistent: true });
  }
}

/* ── Spreadsheet fetch ───────────────────────────────────────── */

async function fetchBackgrounds({ force = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(SHEET_URL, {
      signal: controller.signal,
      cache: force ? 'no-store' : 'default',
    });
    if (!response.ok) throw new Error(`Sheet responded ${response.status}`);
    const csv = await response.text();
    const backgrounds = rowsToBackgrounds(parseCsv(csv));
    if (!backgrounds.length) throw new Error('The sheet returned no Background Anime releases.');
    return backgrounds;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Combined catalogue ──────────────────────────────────────── */

/**
 * Loads UI and Background Anime releases from their correct providers.
 * Provider failures are isolated: if one is unavailable, its last known
 * rows stay visible while fresh data from the other provider is applied.
 *
 * @param {object} options
 * @param {boolean} options.force       bypass caches and re-fetch
 * @param {boolean} options.hardPurge   wipe every Nova UI cache, then fetch
 * @param {function} options.onCache    paints cached rows before the network settles
 */
export async function jalankanJawa({ force = false, hardPurge = false, onCache } = {}) {
  if (hardPurge) {
    await purgeAllCaches();
    force = true;
  }

  const cached = force ? null : readCache();

  if (cached) {
    packs = cached.data;
    onCache?.(packs);
    if (!cached.stale) return packs;
  }

  const previous = packs;
  const [uiResult, backgroundsResult] = await Promise.allSettled([
    fetchUiPack({ force }),
    fetchBackgrounds({ force }),
  ]);

  providerStatus = {
    github: uiResult.status,
    spreadsheet: backgroundsResult.status,
  };

  const previousUi = previous.filter((pack) => pack.category === 'ui' && pack.source === 'github');
  const previousBackgrounds = previous.filter((pack) => pack.category === 'background');
  const ui = uiResult.status === 'fulfilled' ? uiResult.value : previousUi;
  const backgrounds = backgroundsResult.status === 'fulfilled'
    ? backgroundsResult.value
    : previousBackgrounds;

  if (uiResult.status === 'rejected') {
    console.warn('[jawa] GitHub UI releases unavailable:', uiResult.reason?.message || uiResult.reason);
  }
  if (backgroundsResult.status === 'rejected') {
    console.warn('[jawa] Background Anime sheet unavailable:', backgroundsResult.reason?.message || backgroundsResult.reason);
  }

  const failures = [uiResult, backgroundsResult].filter((result) => result.status === 'rejected');
  if (failures.length === 2 || (!ui.length && !backgrounds.length)) {
    packs = previous;
    throw new AggregateError(
      failures.map((result) => result.reason).filter(Boolean),
      'No download providers are currently available.'
    );
  }

  packs = [...ui, ...backgrounds];
  // A partial response is useful, but must stay stale so the failed
  // provider is retried on the next visit instead of waiting 30 minutes.
  writeCache(packs, { stale: failures.length > 0 });
  return packs;
}

/** Hard-refresh entry point used by UI buttons. Purges everything and
 *  returns a fresh catalogue. */
export async function refreshCatalogue({ onCache } = {}) {
  return jalankanJawa({ hardPurge: true, onCache });
}

export default {
  jalankanJawa,
  refreshCatalogue,
  get packs() { return packs; },
  get providerStatus() { return providerStatus; },
  perPage,
  parseCsv,
  releaseToUiPack,
  SHEET_URL,
};
