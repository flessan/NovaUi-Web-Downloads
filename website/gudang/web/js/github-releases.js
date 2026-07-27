/** ═══════════════════════════════════════════════════════════════
 *  NOVA UI · GITHUB RELEASES
 *  Reads release data straight from the public GitHub API.
 *  Cached in sessionStorage so navigating between pages does not
 *  burn through the unauthenticated rate limit.
 *  ═══════════════════════════════════════════════════════════════ */

const DEFAULT_REPOSITORY = Object.freeze({ owner: 'DANZGAME-GD', repo: 'NovaUI' });
const CACHE_TTL = 5 * 60 * 1000;
const TIMEOUT = 12000;

function repository() {
  const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content?.trim();
  return {
    owner: meta('github-owner') || DEFAULT_REPOSITORY.owner,
    repo: meta('github-repo') || DEFAULT_REPOSITORY.repo,
  };
}

const cacheKey = ({ owner, repo }) => `nova-releases:${owner}/${repo}`;

/** Escapes a value for safe interpolation into an HTML string. */
function escaped(value = '') {
  const node = document.createElement('span');
  node.textContent = value;
  return node.innerHTML;
}

export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

export async function getReleases({ force = false } = {}) {
  const target = repository();
  const key = cacheKey(target);

  if (!force) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(key));
      if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;
    } catch { /* storage unavailable */ }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  let response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/releases?per_page=100`,
      {
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal,
        cache: force ? 'no-store' : 'default',
      }
    );
  } catch (cause) {
    throw Object.assign(
      new Error(cause.name === 'AbortError'
        ? 'GitHub took too long to respond. Please try again.'
        : 'Unable to reach GitHub. Check your connection and try again.'),
      { kind: 'network', cause }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const messages = {
      403: 'GitHub API rate limit reached. Please try again shortly.',
      404: 'This releases repository could not be found.',
    };
    const kinds = { 403: 'rate-limit', 404: 'not-found' };
    throw Object.assign(
      new Error(messages[response.status] || `GitHub could not load releases (${response.status}).`),
      { kind: kinds[response.status] || 'api', status: response.status }
    );
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw Object.assign(new Error('GitHub returned an unexpected release response.'), { kind: 'unexpected' });
  }

  const releases = data.filter((release) => !release.draft);
  try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data: releases })); }
  catch { /* cache is optional */ }
  return releases;
}

const STATE_ICONS = {
  loading: 'circle-notch',
  empty: 'box-open',
};

function state(kind, message, { retry = false } = {}) {
  const iconName = STATE_ICONS[kind] || 'circle-exclamation';
  return `<div class="release-state release-state-${kind}" role="status">
    <i class="fas fa-${iconName}" aria-hidden="true"></i>
    <p>${escaped(message)}</p>
    ${retry ? '<button type="button" data-release-retry><i class="fas fa-rotate-right"></i> Try again</button>' : ''}
  </div>`;
}

export function releaseError(error) {
  return state(error.kind || 'error', error.message || 'Unable to load releases.', { retry: true });
}

/** Wires up the retry button inside an error state. */
function bindRetry(container, rerender) {
  container.querySelector('[data-release-retry]')?.addEventListener('click', () => {
    rerender(container, { force: true });
  }, { once: true });
}

/* ── Latest release ──────────────────────────────────────────── */

export async function renderLatestRelease(container, { force = false } = {}) {
  if (!container) return;
  container.innerHTML = state('loading', 'Loading the latest release…');

  try {
    const releases = await getReleases({ force });
    const release = releases[0];
    if (!release) {
      container.innerHTML = state('empty', 'No published releases are available yet.');
      return;
    }

    const asset = release.assets?.[0];
    const totalDownloads = (release.assets || []).reduce((sum, a) => sum + (a.download_count || 0), 0);
    const preview = (release.body || 'No release notes provided.').replace(/\s+/g, ' ').slice(0, 260);

    container.innerHTML = `<article class="latest-release-card">
      <div class="release-kicker"><i class="fas fa-bolt" aria-hidden="true"></i> Latest GitHub release</div>
      <div class="release-heading">
        <div>
          <h3>${escaped(release.name || release.tag_name)}</h3>
          <p><strong>${escaped(release.tag_name)}</strong> · Published ${formatDate(release.published_at)}${totalDownloads ? ` · ${totalDownloads.toLocaleString()} downloads` : ''
      }</p>
        </div>
        <span class="release-version">${escaped(release.tag_name)}</span>
      </div>
      <p class="release-preview">${escaped(preview)}${preview.length >= 260 ? '…' : ''}</p>
      <div class="release-actions">
        ${asset
        ? `<a class="cta-btn cta-primary" href="${escaped(asset.browser_download_url)}" rel="noopener"><i class="fas fa-download" aria-hidden="true"></i> Download ${escaped(asset.name)}</a>`
        : '<span class="release-no-assets">No downloadable assets</span>'}
        <a class="cta-btn cta-secondary" href="${escaped(release.html_url)}" target="_blank" rel="noopener"><i class="fas fa-code-branch" aria-hidden="true"></i> View full changelog</a>
      </div>
    </article>`;
  } catch (error) {
    container.innerHTML = releaseError(error);
    bindRetry(container, renderLatestRelease);
  }
}

/* ── Markdown ────────────────────────────────────────────────── */

export function markdownToHtml(source = '') {
  let text = escaped(source);
  text = text.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="language-${lang}">${code}</code></pre>`);
  text = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" decoding="async">');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  text = text.replace(/^### (.+)$/gm, '<h4>$1</h4>').replace(/^## (.+)$/gm, '<h3>$1</h3>').replace(/^# (.+)$/gm, '<h2>$1</h2>');
  text = text.replace(/^[-*] (.+)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)(?:\n(?!<li>))/g, '$1');
  text = text.replace(/(^|\n)(?!<[hlupri])([^\n]+)(?=\n|$)/g, '$1<p>$2</p>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  return text.replace(/(<li>[\s\S]*?<\/li>)+/g, (list) => `<ul style="list-style: none; padding-left: 0;">${list}</ul>`);
}

/* ── Changelog ───────────────────────────────────────────────── */

/** "3 days ago" style label to sit alongside the absolute date. */
export function relativeTime(value) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

export async function renderChangelog(container, { force = false } = {}) {
  if (!container) return;
  container.innerHTML = state('loading', 'Loading release history…');

  try {
    const releases = await getReleases({ force });
    if (!releases.length) {
      container.innerHTML = state('empty', 'No published releases are available yet.');
      return;
    }

    const cards = releases.map((release, index) => {
      const downloads = (release.assets || [])
        .reduce((sum, asset) => sum + (asset.download_count || 0), 0);
      const title = release.name || release.tag_name;
      // Avoid printing the tag twice when the release has no distinct name.
      const showTag = title !== release.tag_name;
      const latest = index === 0;
      const assets = release.assets || [];

      return `<article class="m3-release${latest ? ' is-latest' : ''} reveal">
      <div class="m3-rail" aria-hidden="true"><span class="m3-node"></span></div>

      <div class="m3-card">
        <div class="m3-card-head">
          <div class="m3-headline">
            <div class="m3-badges">
              ${latest ? '<span class="m3-chip m3-chip-latest"><i class="fas fa-bolt" aria-hidden="true"></i> Latest</span>' : ''}
              ${showTag ? `<span class="m3-chip m3-chip-tag">${escaped(release.tag_name)}</span>` : ''}
            </div>
            <h2>${escaped(title)}</h2>
            <div class="m3-support">
              <time datetime="${escaped(release.published_at || '')}">${formatDate(release.published_at)}</time>
              <span class="m3-dot" aria-hidden="true"></span>
              <span>${relativeTime(release.published_at)}</span>
              ${downloads ? `<span class="m3-dot" aria-hidden="true"></span><span>${downloads.toLocaleString()} downloads</span>` : ''}
            </div>
          </div>
          <a class="m3-icon-btn" href="${escaped(release.html_url)}" target="_blank" rel="noopener"
             aria-label="Open ${escaped(release.tag_name)} on GitHub">
            <i class="fab fa-github" aria-hidden="true"></i>
          </a>
        </div>

        <div class="release-notes m3-notes">${markdownToHtml(release.body || 'No release notes provided.')}</div>

        ${assets.length ? `
        <section class="m3-assets" aria-label="Downloads for ${escaped(release.tag_name)}">
          <h3><i class="fas fa-box-open" aria-hidden="true"></i> Downloads</h3>
          <div class="m3-asset-list">
            ${assets.map((asset) => `<a href="${escaped(asset.browser_download_url)}" class="m3-asset" rel="noopener">
              <span class="m3-asset-icon"><i class="fas fa-file-arrow-down" aria-hidden="true"></i></span>
              <span class="m3-asset-text">
                <span class="m3-asset-name">${escaped(asset.name)}</span>
                <span class="m3-asset-meta">${formatBytes(asset.size)}${asset.download_count ? ` · ${asset.download_count.toLocaleString()} downloads` : ''}</span>
              </span>
              <i class="fas fa-arrow-down m3-asset-cue" aria-hidden="true"></i>
            </a>`).join('')}
          </div>
        </section>` : `
        <p class="m3-no-assets"><i class="fas fa-circle-info" aria-hidden="true"></i> No downloadable assets in this release.</p>`}
      </div>
    </article>`;
    }).join('');

    container.innerHTML = `<div class="m3-timeline">${cards}</div>`;

    // Newly injected cards need to join the reveal observer.
    const { initScrollReveal } = await import('./gerak.js');
    initScrollReveal(container);
  } catch (error) {
    container.innerHTML = releaseError(error);
    bindRetry(container, renderChangelog);
  }
}
