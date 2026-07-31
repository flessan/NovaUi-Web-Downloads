/** ═══════════════════════════════════════════════════════════════
 *  NOVA UI · EXTENSION UPDATER RELEASES
 *  Fetches releases from DANZGAME-GD/NovaUI-exten and renders the
 *  updater card on the packs page.
 *
 *  - Mobile-first, no horizontal scroll
 *  - Cached responses to avoid rate-limit hits
 *  - Graceful loading / error states with retry
 *  - Full keyboard & screen reader accessibility
 *  ═══════════════════════════════════════════════════════════════ */

import { cacheRead, cacheWrite, cacheRemove, KEYS, purgeAllCaches } from './cache.js';

const EXT_OWNER = 'DANZGAME-GD';
const EXT_REPO = 'NovaUI-exten';
const API_URL = `https://api.github.com/repos/${encodeURIComponent(EXT_OWNER)}/${encodeURIComponent(EXT_REPO)}/releases?per_page=20`;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const TIMEOUT = 12000;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exp).toFixed(exp ? 1 : 0)} ${units[exp]}`;
}

function formatDate(value) {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Unknown date';
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
  } catch {
    return 'Unknown date';
  }
}

function relativeDate(input) {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return '';
  const days = Math.floor((Date.now() - parsed.getTime()) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function escaped(value = '') {
  const node = document.createElement('span');
  node.textContent = value;
  return node.innerHTML;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const extCacheKey = KEYS.githubExt(EXT_OWNER, EXT_REPO);

export async function getExtReleases({ force = false, hardPurge = false } = {}) {
  if (hardPurge) await purgeAllCaches();

  if (!force && !hardPurge) {
    const cached = cacheRead(extCacheKey, { ttl: CACHE_TTL, persistent: false });
    if (cached) return cached.data;
    const persisted = cacheRead(extCacheKey, { ttl: CACHE_TTL, persistent: true });
    if (persisted) return persisted.data;
  } else {
    cacheRemove(extCacheKey);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  let response;
  try {
    response = await fetch(API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
      cache: force || hardPurge ? 'no-store' : 'default',
    });
  } catch (cause) {
    // Try stale cache on network failure so UI doesn't collapse
    const stale = cacheRead(extCacheKey, { persistent: false }) || cacheRead(extCacheKey, { persistent: true });
    if (stale) return stale.data;
    throw Object.assign(
      new Error(cause.name === 'AbortError' ? 'GitHub took too long to respond. Please try again.' : 'Unable to reach GitHub. Check your connection and try again.'),
      { kind: 'network', cause }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const stale = cacheRead(extCacheKey, { persistent: false }) || cacheRead(extCacheKey, { persistent: true });
    if (stale) return stale.data;
    const messages = {
      403: 'GitHub API rate limit reached. Please try again shortly.',
      404: 'Extension repository could not be found.',
    };
    const kinds = { 403: 'rate-limit', 404: 'not-found' };
    throw Object.assign(
      new Error(messages[response.status] || `GitHub could not load extension releases (${response.status}).`),
      { kind: kinds[response.status] || 'api', status: response.status }
    );
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw Object.assign(new Error('GitHub returned an unexpected release response.'), { kind: 'unexpected' });
  }

  const releases = data.filter((r) => !r.draft);
  cacheWrite(extCacheKey, releases, { persistent: false });
  cacheWrite(extCacheKey, releases, { persistent: true });
  return releases;
}

function pickBestAsset(release) {
  const assets = release?.assets || [];
  if (!assets.length) return null;
  const zip = assets.find((a) => /\.zip$/i.test(a.name || ''));
  if (zip) return zip;
  const geode = assets.find((a) => /\.geode$/i.test(a.name || ''));
  if (geode) return geode;
  return assets[0];
}

function stateNode(kind, message, { retry = false } = {}) {
  const icons = { loading: 'circle-notch fa-spin', error: 'circle-exclamation', empty: 'box-open', 'rate-limit': 'hourglass-half' };
  const icon = icons[kind] || 'circle-info';
  const wrapper = el('div', {
    class: `ext-state ext-state-${kind}`,
    role: 'status',
    style: 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;text-align:center;border:1px dashed var(--border);border-radius:12px;background:var(--glass-softer);width:100%;box-sizing:border-box;overflow-wrap:break-word;word-break:break-word'
  });
  const i = el('i', { class: `fas fa-${icon}`, 'aria-hidden': 'true', style: kind === 'error' ? 'font-size:1.6rem;color:var(--accent)' : 'font-size:1.6rem;color:var(--primary-light)' });
  const p = el('p', { style: 'margin:0;font-size:0.85rem;color:var(--text-sec);line-height:1.6;max-width:100%;overflow-wrap:break-word', text: message });
  wrapper.append(i, p);
  if (retry) {
    const btn = el('button', {
      type: 'button',
      class: 'cta-btn cta-secondary',
      style: 'min-height:40px;padding:9px 18px;font-size:0.8rem',
      'aria-label': 'Retry loading extension releases'
    }, el('i', { class: 'fas fa-rotate-right', 'aria-hidden': 'true' }), ' Try again');
    btn.addEventListener('click', () => {
      const content = document.getElementById('extUpdaterContent');
      if (content) renderExtUpdater(content, { force: true });
    });
    wrapper.append(btn);
  }
  return wrapper;
}

export async function renderExtUpdater(container, { force = false } = {}) {
  if (!container) return;
  container.setAttribute('aria-busy', 'true');
  container.replaceChildren(stateNode('loading', 'Loading latest updater release…'));

  try {
    const releases = await getExtReleases({ force });
    const latest = releases.find((r) => !r.prerelease) || releases[0];
    if (!latest) {
      container.replaceChildren(stateNode('empty', 'No extension releases published yet. Check back soon.', { retry: true }));
      container.setAttribute('aria-busy', 'false');
      return;
    }

    const asset = pickBestAsset(latest);
    const totalDownloads = (latest.assets || []).reduce((s, a) => s + (a.download_count || 0), 0);
    const tag = (latest.tag_name || '').replace(/^v/i, '');
    const versionDisplay = tag ? `v${tag}` : latest.tag_name || 'Latest';
    const published = latest.published_at || latest.created_at;

    // Build responsive card
    const fragment = document.createDocumentFragment();

    // Meta grid: version, date, size, downloads – mobile stacked, desktop grid
    const metaGrid = el('div', {
      class: 'ext-meta-grid',
      style: 'display:grid;grid-template-columns:1fr;gap:10px;width:100%;max-width:100%;box-sizing:border-box'
    });

    const metaItem = (label, iconName, value, sub) => {
      return el('div', {
        style: 'display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--border-soft);border-radius:12px;background:var(--glass-softer);min-width:0;box-sizing:border-box;overflow:hidden'
      },
        el('div', {
          style: 'width:36px;height:36px;display:grid;place-items:center;border-radius:10px;background:var(--primary-dim);color:var(--primary-light);flex-shrink:0'
        }, el('i', { class: `fas fa-${iconName}`, 'aria-hidden': 'true' })),
        el('div', { style: 'display:flex;flex-direction:column;gap:2px;min-width:0;flex:1' },
          el('span', { style: 'font-size:0.62rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-faint)', text: label }),
          el('span', { style: 'font-size:0.9rem;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: value }),
          sub ? el('span', { style: 'font-size:0.70rem;color:var(--text-muted)', text: sub }) : null
        )
      );
    };

    metaGrid.append(
      metaItem('Version', 'code-branch', versionDisplay, totalDownloads ? `${totalDownloads.toLocaleString()} downloads` : ''),
      metaItem('Released', 'calendar-days', formatDate(published), relativeDate(published)),
      metaItem('Size', 'hard-drive', asset?.size ? formatBytes(asset.size) : '-', asset?.name ? asset.name.slice(0, 30) : '')
    );

    // Actions: responsive stacking vertical on mobile, horizontal on desktop – inline CSS base + external overrides
    const actions = el('div', {
      class: 'ext-actions',
      role: 'group',
      'aria-label': 'Extension updater actions',
      style: 'display:flex;flex-direction:column;gap:10px;width:100%;max-width:100%;box-sizing:border-box'
    });

    if (asset?.browser_download_url) {
      const dlBtn = el('a', {
        class: 'cta-btn cta-primary',
        href: asset.browser_download_url,
        target: '_blank',
        rel: 'noopener',
        'aria-label': `Download ${asset.name} version ${versionDisplay}`,
        style: 'display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 20px;border-radius:9999px;width:100%;box-sizing:border-box;text-decoration:none;overflow-wrap:break-word;word-break:break-word'
      },
        el('i', { class: 'fas fa-download', 'aria-hidden': 'true' }),
        `Download ${versionDisplay}`
      );
      dlBtn.addEventListener('click', () => {
        try { window.showToast?.(`Downloading Nova UI Updater ${versionDisplay}`, 'success'); } catch {}
      });
      actions.append(dlBtn);
    }

    const guideBtn = el('a', {
      class: 'cta-btn cta-secondary',
      href: './guide.html#tab-pack',
      'aria-label': 'View manual installation guide',
      style: 'display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 20px;border-radius:9999px;border:1px solid var(--border);background:var(--glass-soft);color:var(--text);width:100%;box-sizing:border-box;text-decoration:none'
    }, el('i', { class: 'fas fa-book-open', 'aria-hidden': 'true' }), 'Install Manually');

    const viewBtn = el('a', {
      class: 'cta-btn cta-secondary',
      href: latest.html_url || `https://github.com/${EXT_OWNER}/${EXT_REPO}/releases`,
      target: '_blank',
      rel: 'noopener',
      'aria-label': 'View all extension releases on GitHub',
      style: 'display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 20px;border-radius:9999px;border:1px solid var(--border);background:var(--glass-soft);color:var(--text-sec);width:100%;box-sizing:border-box;text-decoration:none'
    }, el('i', { class: 'fab fa-github', 'aria-hidden': 'true' }), 'View on GitHub');

    actions.append(guideBtn, viewBtn);

    // Release notes preview
    const previewText = (latest.body || 'No release notes provided.').replace(/\s+/g, ' ').trim().slice(0, 220);
    const notes = el('div', {
      style: 'padding:12px 14px;border-radius:10px;background:var(--glass-softer);border:1px solid var(--border-soft);width:100%;max-width:100%;box-sizing:border-box;overflow:hidden'
    },
      el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px;color:var(--text-muted);font-size:0.75rem;font-weight:600' },
        el('i', { class: 'fas fa-file-lines', 'aria-hidden': 'true' }),
        'Release notes'
      ),
      el('p', { style: 'margin:0;font-size:0.8rem;color:var(--text-sec);line-height:1.6;overflow-wrap:break-word;word-break:break-word', text: previewText + (previewText.length >= 220 ? '…' : '') })
    );

    // Refresh button
    const refreshRow = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;width:100%' },
      el('button', {
        type: 'button',
        class: 'cta-btn cta-secondary',
        style: 'min-height:40px;padding:8px 14px;font-size:0.78rem',
        'aria-label': 'Refresh extension release data'
      }, el('i', { class: 'fas fa-rotate-right', 'aria-hidden': 'true' }), ' Refresh')
    );
    refreshRow.querySelector('button')?.addEventListener('click', () => renderExtUpdater(container, { force: true }));

    fragment.append(metaGrid, actions, notes, refreshRow);
    container.replaceChildren(fragment);
  } catch (error) {
    const isRate = error?.kind === 'rate-limit';
    const msg = error?.message || 'Unable to load extension releases.';
    container.replaceChildren(stateNode(isRate ? 'rate-limit' : 'error', msg, { retry: true }));
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

export default { getExtReleases, renderExtUpdater };
