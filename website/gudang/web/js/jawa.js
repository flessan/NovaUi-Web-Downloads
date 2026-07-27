/* ═══════════════════════════════════════════════════════════════
   NOVA UI · DOWNLOAD CATALOGUE DATA

   The catalogue deliberately has two independent sources:
     • Nova UI metadata and downloads come from GitHub Releases;
     • Background Anime metadata and downloads stay in Google Sheets.

   A short-lived combined cache makes repeat visits instant and keeps
   the last successful catalogue available when either provider is
   temporarily unreachable. The Refresh button bypasses every cache and
   re-fetches both providers without navigating or reloading the page.
   ═══════════════════════════════════════════════════════════════ */

import { formatBytes, getReleases } from './github-releases.js';

export const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSIWy57PZw5eV1PjxjYC7gX6Haqg9aRgIlATvOCCzns8mcyIRhQkpl1vz40-GK_j4Sxlk4oOBevxBea/pub?output=csv';

const CACHE_KEY = 'nova-download-catalogue-v2';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const TIMEOUT = 12000;

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

/** Turns "TRUE"/"1"/"yes" and friends into a real boolean. */
function toBool(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'y'].includes(String(value ?? '').trim().toLowerCase());
}

function toNumber(value) {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Guarantees a consistent shape for a Background Anime sheet row. */
function normaliseBackground(raw) {
  return {
    name: String(raw.name ?? 'Untitled pack').trim(),
    creator: String(raw.creator ?? 'Unknown').trim(),
    description: String(raw.description ?? '').trim(),
    icon: String(raw.icon ?? '').trim(),
    version: String(raw.version ?? '1.0.0').trim(),
    size: String(raw.size ?? '-').trim(),
    category: 'background',
    source: 'spreadsheet',
    featured: toBool(raw.featured),
    downloads: 0,
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

    // The sheet still contains a legacy Nova UI row. It must never be
    // used: every UI field, including its URLs, now comes from GitHub.
    if (String(raw.category ?? '').trim().toLowerCase() !== 'background') return [];
    const pack = normaliseBackground(raw);
    return pack.name && pack.name !== 'Untitled pack' ? [pack] : [];
  });
}

/* ── GitHub UI release mapping ───────────────────────────────── */

const isExtension = (asset) => /extension/i.test(asset?.name || '');

/** Maps the latest downloadable GitHub release to the Nova UI card. */
export function releaseToUiPack(release) {
  if (!release) return null;

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const stable = assets.find((asset) => !isExtension(asset)) || assets[0];
  const extension = assets.find(isExtension)
    || assets.find((asset) => asset !== stable)
    || null;
  const orderedAssets = [stable, extension].filter(
    (asset, index, list) => asset && list.indexOf(asset) === index
  );

  return {
    name: 'Nova UI',
    creator: 'DANZGAME-GD',
    description: 'A complete Geometry Dash UI overhaul with a modern design language, distributed through GitHub Releases.',
    icon: '../gudang/icon_logo/nova.png',
    version: String(release.tag_name || release.name || '-').replace(/^v/i, ''),
    size: orderedAssets.length
      ? orderedAssets.map((asset) => formatBytes(Number(asset.size))).join(' / ')
      : '-',
    category: 'ui',
    source: 'github',
    featured: true,
    // Display-only metadata supplied by GitHub. The site does not
    // increment, persist, or send its own download analytics.
    downloads: assets.reduce((sum, asset) => sum + toNumber(asset.download_count), 0),
    lastUpdated: String(release.published_at || release.created_at || '').trim(),
    download_pc: String(stable?.browser_download_url || '').trim(),
    download_mobile: String(extension?.browser_download_url || '').trim(),
    releaseUrl: String(release.html_url || '').trim(),
    assets: orderedAssets.map((asset) => ({
      name: String(asset.name || 'Download'),
      size: formatBytes(Number(asset.size)),
      downloads: toNumber(asset.download_count),
      url: String(asset.browser_download_url || ''),
    })),
  };
}

async function fetchUiPack({ force = false } = {}) {
  const releases = await getReleases({ force });
  // Prefer the latest non-prerelease that actually contains a download.
  const release = releases.find((item) => !item.prerelease && item.assets?.length)
    || releases.find((item) => item.assets?.length)
    || releases[0];
  const ui = releaseToUiPack(release);
  if (!ui) throw new Error('No published Nova UI release is available.');
  return [ui];
}

/* ── Cache ───────────────────────────────────────────────────── */

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (!cached?.data?.length) return null;
    return { data: cached.data, stale: Date.now() - cached.at > CACHE_TTL };
  } catch { return null; }
}

function writeCache(data, { stale = false } = {}) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: stale ? 0 : Date.now(), data })); }
  catch { /* quota or private mode */ }
}

/* ── Spreadsheet fetch ───────────────────────────────────────── */

async function fetchBackgrounds() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(SHEET_URL, { signal: controller.signal, cache: 'no-cache' });
    if (!response.ok) throw new Error(`Sheet responded ${response.status}`);
    const backgrounds = rowsToBackgrounds(parseCsv(await response.text()));
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
 * @param {boolean} options.force bypass both the catalogue and provider caches
 * @param {function} options.onCache paints cached rows before the network settles
 */
export async function jalankanJawa({ force = false, onCache } = {}) {
  const cached = force ? null : readCache();

  if (cached) {
    packs = cached.data;
    onCache?.(packs);
    if (!cached.stale) return packs;
  }

  const previous = packs;
  const [uiResult, backgroundsResult] = await Promise.allSettled([
    fetchUiPack({ force }),
    fetchBackgrounds(),
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

export default {
  jalankanJawa,
  get packs() { return packs; },
  get providerStatus() { return providerStatus; },
  perPage,
  parseCsv,
  releaseToUiPack,
  SHEET_URL,
};
