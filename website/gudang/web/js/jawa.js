/* ═══════════════════════════════════════════════════════════════
   NOVA UI · PACK DATA
   Loads the texture-pack catalogue from a published Google Sheet.

   Improvements over the previous version:
     • no PapaParse dependency - a small RFC-4180 parser handles the
       quoting rules the sheet actually produces, removing a render
       blocking 45 KB script from the critical path;
     • results are cached in localStorage so a repeat visit paints
       instantly and still works offline;
     • the request has a timeout, so a hanging network cannot leave
       the page stuck on skeletons forever;
     • every row is normalised, so downstream code can trust the
       shape of a pack object.
   ═══════════════════════════════════════════════════════════════ */

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSIWy57PZw5eV1PjxjYC7gX6Haqg9aRgIlATvOCCzns8mcyIRhQkpl1vz40-GK_j4Sxlk4oOBevxBea/pub?output=csv';

const CACHE_KEY = 'nova-packs-cache-v1';
const CACHE_TTL = 30 * 60 * 1000;   // 30 minutes
const TIMEOUT = 12000;

export let packs = [];
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

/** Guarantees a consistent shape regardless of sheet column drift. */
function normalise(raw) {
  const category = String(raw.category ?? '').trim().toLowerCase();
  return {
    name: String(raw.name ?? 'Untitled pack').trim(),
    creator: String(raw.creator ?? 'Unknown').trim(),
    description: String(raw.description ?? '').trim(),
    icon: String(raw.icon ?? '').trim(),
    version: String(raw.version ?? '1.0.0').trim(),
    size: String(raw.size ?? '-').trim(),
    category: category === 'ui' ? 'ui' : 'background',
    featured: toBool(raw.featured),
    downloads: toNumber(raw.downloads),
    lastUpdated: String(raw.lastUpdated ?? raw.last_updated ?? '').trim(),
    download_pc: String(raw.download_pc ?? '').trim(),
    download_mobile: String(raw.download_mobile ?? '').trim(),
  };
}

function rowsToObjects(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const raw = {};
    headers.forEach((key, i) => { raw[key] = (cells[i] ?? '').trim(); });
    return normalise(raw);
  }).filter((pack) => pack.name && pack.name !== 'Untitled pack');
}

/* ── Cache ───────────────────────────────────────────────────── */

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (!cached?.data?.length) return null;
    return { data: cached.data, stale: Date.now() - cached.at > CACHE_TTL };
  } catch { return null; }
}

function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); }
  catch { /* quota or private mode */ }
}

/* ── Fetch ───────────────────────────────────────────────────── */

async function fetchSheet() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(SHEET_URL, { signal: controller.signal, cache: 'no-cache' });
    if (!response.ok) throw new Error(`Sheet responded ${response.status}`);
    return rowsToObjects(parseCsv(await response.text()));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Loads the catalogue.
 * @param {object}  options
 * @param {boolean} options.force   bypass the cache entirely
 * @param {function} options.onCache called immediately with cached
 *        rows so the UI can paint before the network settles
 */
export async function jalankanJawa({ force = false, onCache } = {}) {
  const cached = force ? null : readCache();

  if (cached) {
    packs = cached.data;
    onCache?.(packs);
    // Fresh enough - skip the network entirely.
    if (!cached.stale) return packs;
  }

  try {
    const fresh = await fetchSheet();
    if (fresh.length) {
      packs = fresh;
      writeCache(fresh);
    }
    return packs;
  } catch (error) {
    console.warn('[jawa] pack data unavailable:', error.message);
    if (packs.length) return packs;          // serve whatever we have
    throw error;
  }
}

export default { jalankanJawa, packs, perPage, parseCsv };
