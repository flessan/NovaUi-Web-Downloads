/* ═══════════════════════════════════════════════════════════════
   NOVA UI · PACK BROWSER
   Search, filter, sort, paginate and download the texture packs.

   Notable implementation details:
     • cards are built with real DOM nodes instead of interpolated
       HTML strings, so catalogue content cannot inject markup;
     • the download dialog is a proper focus-trapped bottom sheet;
     • search is debounced and rendering is batched into a fragment;
     • skeleton cards are shown while the catalogue loads;
     • the dedicated Refresh button asynchronously refreshes GitHub
       UI releases and Spreadsheet Background Anime releases.
   ═══════════════════════════════════════════════════════════════ */

import { packs as sourcePacks, providerStatus, perPage, jalankanJawa, refreshCatalogue } from './jawa.js';
import { animateNumber, initScrollReveal, prefersReducedMotion } from './gerak.js';
import { showToast, openSheet, closeSheet, hideLoader, tap } from './aplikasi.js';
import { getReleases, formatBytes } from './github-releases.js';
import { consumeHardRefreshFlag } from './cache.js';

/* ── State ───────────────────────────────────────────────────── */

const state = {
  page: 1,
  filter: 'all',
  query: '',
  sort: 'featured',
  data: [],
};

/* ── Formatting helpers ──────────────────────────────────────── */

export function fmtD(n) {
  const value = Number(n) || 0;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
}

export function relativeDate(input) {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return 'Unknown date';
  const days = Math.floor((Date.now() - parsed.getTime()) / 864e5);
  if (days <= 0) return 'Just now';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export function releaseDate(input) {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

export function categoryLabel(category) {
  return category === 'ui' ? 'UI' : 'Background Anime';
}

function isRecent(input, days = 30) {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return false;
  return Date.now() - parsed.getTime() < days * 864e5;
}

/** Builds an element with attributes and children in one call. */
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

const icon = (name, extra = '') => el('i', { class: `fas fa-${name}${extra ? ` ${extra}` : ''}`, 'aria-hidden': 'true' });

/* ── Filtering & sorting ─────────────────────────────────────── */

export function getFilteredSorted() {
  let list = [...state.data];

  if (state.filter === 'featured') list = list.filter((p) => p.featured);
  else if (state.filter !== 'all') list = list.filter((p) => p.category === state.filter);

  const query = state.query.trim().toLowerCase();
  if (query) {
    const terms = query.split(/\s+/);
    list = list.filter((pack) => {
      const haystack = `${pack.name} ${pack.creator} ${pack.description}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }

  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name),
    updated: (a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated),
    downloads: (a, b) => b.downloads - a.downloads,
    featured: (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.downloads - a.downloads,
  };
  return list.sort(sorters[state.sort] || sorters.featured);
}

/* ── Skeletons ───────────────────────────────────────────────── */

function renderSkeletons(count = 6) {
  const container = document.getElementById('packs');
  if (!container) return;
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    fragment.appendChild(
      el('div', { class: 'pack-skeleton pack-card-dynamic', 'aria-hidden': 'true' },
        el('div', { class: 'sk-line sk-circle' }),
        el('div', { class: 'sk-line sk-title' }),
        el('div', { class: 'sk-line sk-sub' }),
        el('div', { class: 'sk-line sk-text' }),
        el('div', { class: 'sk-line sk-text' }),
        el('div', { class: 'sk-line sk-btn' }))
    );
  }
  const oldDynamics = container.querySelectorAll('.pack-card-dynamic, .empty-state');
  oldDynamics.forEach(card => card.remove());
  container.appendChild(fragment);
}

/* ── Card ────────────────────────────────────────────────────── */

function buildCard(pack, index) {
  const card = el('article', {
    class: `pack-card pack-card-dynamic${pack.featured ? ' featured' : ''}${prefersReducedMotion() ? '' : ' card-in'}`,
    style: `--i:${index};max-width:100%;box-sizing:border-box;overflow-wrap:break-word;word-break:break-word`,
  });

  /* Thumbnail with a graceful fallback if the image 404s. */
  const thumb = el('div', { class: 'pack-img', style: 'max-width:100%;box-sizing:border-box' });
  const placeholder = el('div', { class: 'placeholder', style: 'display:none' }, icon('image'));
  if (pack.icon) {
    const img = el('img', {
      src: pack.icon,
      alt: `${pack.name} icon`,
      loading: 'lazy',
      decoding: 'async',
      style: 'max-width:100%;height:auto;display:block;object-fit:cover',
    });
    img.addEventListener('error', () => {
      img.remove();
      placeholder.style.display = 'flex';
    }, { once: true });
    thumb.append(img);
  } else {
    placeholder.style.display = 'flex';
  }
  thumb.append(placeholder);

  const badges = el('div', { class: 'pack-badges', style: 'display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-width:100%;box-sizing:border-box' },
    el('span', { class: 'pack-badge badge-cat', text: categoryLabel(pack.category) }),
    pack.featured ? el('span', { class: 'pack-badge badge-featured', text: 'Featured' }) : null,
    isRecent(pack.lastUpdated) ? el('span', { class: 'pack-badge badge-new', text: 'New' }) : null,
  );

  const metadata = [
    { label: 'File Size', icon: 'hard-drive', value: pack.size || '-' },
    pack.category === 'ui'
      ? { label: 'Download Count', icon: 'download', value: fmtD(pack.downloads) }
      : null,
    { label: 'Version', icon: 'code-branch', value: pack.version === '-' ? '-' : `v${pack.version}` },
  ].filter(Boolean);

  const meta = el('div', {
    class: 'pack-meta',
    'aria-label': `${pack.name} release metadata`,
    style: 'width:100%;max-width:100%;box-sizing:border-box;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:auto 0 12px;text-align:left'
  },
    metadata.map((item) => el('div', {
      class: 'pack-meta-item',
      style: 'min-width:0;display:grid;grid-template-columns:18px minmax(0,1fr);align-items:center;gap:6px;padding:8px;border:1px solid var(--border-soft);border-radius:10px;background:var(--glass-softer);box-sizing:border-box;overflow:hidden;overflow-wrap:break-word'
    },
      icon(item.icon),
      el('div', { style: 'min-width:0;overflow:hidden' },
        el('span', { class: 'pack-meta-label', text: item.label }),
        el('span', { class: 'pack-meta-value', text: item.value }),
      ),
    )),
  );

  /* Standalone release date section between the metadata grid and actions */
  const releaseDateEl = el('div', {
    class: 'pack-release-date',
    style: 'width:100%;max-width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 14px;margin-bottom:14px;border-radius:10px;background:linear-gradient(135deg, rgba(124,92,252,.08), rgba(247,187,58,.08));border:1px solid var(--border-soft);text-align:center;box-sizing:border-box;overflow-wrap:break-word;word-break:break-word'
  },
    icon('calendar-days'),
    el('span', { class: 'pack-release-date-label', text: 'Latest Update' }),
    el('span', { class: 'pack-release-date-value', text: releaseDate(pack.lastUpdated) }),
  );

  // ── Responsive installation actions (replaces rigid table) ──
  // Mobile-first: buttons stack vertically, full-width, proper spacing for touch
  // Desktop: buttons align horizontally with wrap
  // Uses inline CSS for max compatibility + external classes for polish

  const actionsWrapper = el('div', {
    class: 'pack-actions-wrapper',
    style: 'display:flex;flex-direction:column;gap:12px;width:100%;max-width:100%;margin-top:auto;box-sizing:border-box'
  });

  const updaterDesc = el('div', {
    class: 'pack-updater-desc',
    style: 'display:flex;gap:8px;align-items:flex-start;font-size:0.72rem;line-height:1.6;color:var(--text-muted);margin:0;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid var(--border-soft);width:100%;max-width:100%;box-sizing:border-box;overflow-wrap:break-word;word-break:break-word;text-align:left'
  },
    icon('circle-info'),
    el('span', { text: 'After initial manual installation, use the Nova UI Extension updater - it automatically checks for and installs future updates directly from GitHub.' })
  );

  if (pack.category === 'ui') {
    // UI pack: show both Stable and Extension in responsive cards, not a <table>
    const responsiveBox = el('div', {
      class: 'pack-download-table-box',
      style: 'width:100%;max-width:100%;margin-top:4px;border-radius:12px;background:var(--glass-softer);border:1px solid var(--border-soft);overflow:hidden;box-sizing:border-box'
    });
    const responsiveList = el('div', {
      class: 'pack-download-responsive',
      style: 'display:flex;flex-direction:column;gap:10px;width:100%;max-width:100%;box-sizing:border-box;padding:12px'
    });

    // Stable row
    if (pack.download_pc) {
      const stableRow = el('div', {
        class: 'pack-download-row',
        style: 'display:flex;flex-direction:column;gap:10px;padding:14px 14px;border:1px solid var(--border-soft);border-radius:12px;background:rgba(255,255,255,.02);width:100%;max-width:100%;box-sizing:border-box;overflow:hidden'
      });
      const stableHead = el('div', {
        class: 'pack-download-row-head',
        style: 'display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;font-size:0.72rem;font-weight:700;color:var(--text);overflow-wrap:break-word;word-break:break-word'
      },
        el('span', {}, icon('circle-check'), ' Stable Pack'),
        el('span', { class: 'pack-download-badge', text: pack.version && pack.version !== '-' ? `v${pack.version}` : 'Stable' })
      );

      const stableActions = el('div', {
        class: 'pack-actions-responsive',
        style: 'display:flex;flex-direction:column;gap:10px;width:100%;max-width:100%;box-sizing:border-box'
      });

      const installManualStable = el('a', {
        class: 'cta-btn cta-primary pack-dl-btn',
        href: pack.download_pc,
        target: '_blank',
        rel: 'noopener',
        'aria-label': `Install ${pack.name} stable manually`,
        style: 'display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 18px;border-radius:9999px;background:var(--accent);color:#1a1206;font-size:0.85rem;font-weight:700;width:100%;box-sizing:border-box;text-decoration:none;overflow-wrap:break-word;word-break:break-word;text-align:center'
      }, icon('download'), 'Install Manually');
      installManualStable.addEventListener('click', () => {
        tap();
        showToast(`Downloading ${pack.name} Stable`, 'success');
      });

      const guideLink = el('a', {
        class: 'cta-btn cta-secondary',
        href: './guide.html#tab-pack',
        'aria-label': `View manual installation instructions for ${pack.name}`,
        style: 'display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 18px;border-radius:9999px;background:var(--glass-soft);border:1px solid var(--border);color:var(--text);font-size:0.85rem;font-weight:600;width:100%;box-sizing:border-box;text-decoration:none;overflow-wrap:break-word;word-break:break-word;text-align:center'
      }, icon('book-open'), 'Guide');

      stableActions.append(installManualStable, guideLink);
      stableRow.append(stableHead, stableActions);
      responsiveList.append(stableRow);
    }

    // Extension / Updater row
    const extRow = el('div', {
      class: 'pack-download-row',
      style: 'display:flex;flex-direction:column;gap:10px;padding:14px 14px;border:1px solid var(--border-soft);border-radius:12px;background:linear-gradient(135deg, rgba(124,92,252,.06), rgba(247,187,58,.06));width:100%;max-width:100%;box-sizing:border-box;overflow:hidden'
    });
    const extHead = el('div', {
      class: 'pack-download-row-head',
      style: 'display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;font-size:0.72rem;font-weight:700;color:var(--text);overflow-wrap:break-word;word-break:break-word'
    },
      el('span', {}, icon('puzzle-piece'), ' Extension Updater'),
      el('span', { class: 'pack-download-badge', style: 'background:rgba(247,187,58,.16);color:var(--accent)', text: 'Auto Updates' })
    );

    const extActions = el('div', {
      class: 'pack-actions-responsive',
      style: 'display:flex;flex-direction:column;gap:10px;width:100%;max-width:100%;box-sizing:border-box'
    });

    const updaterBtn = pack.download_mobile
      ? el('a', {
        class: 'cta-btn cta-secondary',
        href: pack.download_mobile,
        target: '_blank',
        rel: 'noopener',
        'aria-label': `Get Nova UI Extension updater for ${pack.name}`,
        style: 'display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 18px;border-radius:9999px;background:rgba(247,187,58,.16);color:var(--accent);border:1px solid rgba(247,187,58,.28);font-size:0.85rem;font-weight:700;width:100%;box-sizing:border-box;text-decoration:none;overflow-wrap:break-word;word-break:break-word;text-align:center'
      }, icon('sync'), 'Updater for Nova UI')
      : el('a', {
        class: 'cta-btn cta-secondary',
        href: '#novaExtUpdater',
        'aria-label': 'Go to Nova UI Extension updater section',
        style: 'display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 18px;border-radius:9999px;background:rgba(247,187,58,.16);color:var(--accent);border:1px solid rgba(247,187,58,.28);font-size:0.85rem;font-weight:700;width:100%;box-sizing:border-box;text-decoration:none;overflow-wrap:break-word;word-break:break-word;text-align:center'
      }, icon('sync'), 'Updater for Nova UI');

    if (pack.download_mobile) {
      updaterBtn.addEventListener('click', () => {
        tap();
        showToast(`Downloading ${pack.name} Extension updater`, 'success');
      });
    } else {
      updaterBtn.addEventListener('click', (e) => {
        // smooth scroll to updater
        e.preventDefault();
        tap();
        document.getElementById('novaExtUpdater')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      });
    }

    const extViewBtn = el('a', {
      class: 'cta-btn cta-secondary',
      href: '#novaExtUpdater',
      'aria-label': 'Learn more about Nova UI auto updater',
      style: 'display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 18px;border-radius:9999px;background:var(--glass-soft);border:1px solid var(--border);color:var(--text-sec);font-size:0.85rem;font-weight:600;width:100%;box-sizing:border-box;text-decoration:none;text-align:center'
    }, icon('circle-info'), 'How it works');

    extViewBtn.addEventListener('click', (e) => {
      e.preventDefault();
      tap();
      document.getElementById('novaExtUpdater')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });

    extActions.append(updaterBtn, extViewBtn);

    const extDesc = el('div', {
      class: 'pack-updater-desc',
      style: 'display:flex;gap:8px;align-items:flex-start;font-size:0.72rem;line-height:1.6;color:var(--text-muted);padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid var(--border-soft);width:100%;max-width:100%;box-sizing:border-box;overflow-wrap:break-word;word-break:break-word;text-align:left'
    },
      icon('bolt'),
      el('span', { text: 'Recommended: after first manual install, the Extension automatically checks GitHub for updates and installs them. No need to revisit the site.' })
    );

    extRow.append(extHead, extActions, extDesc);
    responsiveList.append(extRow);

    responsiveBox.append(responsiveList);

    // Also add generic two-button wrapper for consistency + description
    const genericActions = el('div', {
      class: 'pack-actions-responsive',
      style: 'display:flex;flex-direction:column;gap:10px;width:100%;max-width:100%;box-sizing:border-box;margin-top:10px'
    });

    card.append(
      thumb, badges,
      el('h3', { text: pack.name, style: 'font-size:1.05rem;color:#fff;margin-bottom:3px;font-weight:700;line-height:1.3;overflow-wrap:break-word;word-break:break-word;max-width:100%' }),
      el('div', { class: 'pack-creator', text: `by ${pack.creator}`, style: 'font-size:0.7rem;color:var(--secondary);margin-bottom:10px;font-weight:600;overflow-wrap:break-word;word-break:break-word;max-width:100%' }),
      pack.description ? el('p', { class: 'pack-desc', text: pack.description, style: 'font-size:0.8rem;color:var(--text-sec);margin-bottom:16px;line-height:1.65;display:-webkit-box;-webkit-line-clamp:3;line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word;word-break:break-word;max-width:100%' }) : null,
      meta, releaseDateEl, responsiveBox, updaterDesc);

    // Semantic structure for accessibility
    card.setAttribute('role', 'article');
    card.setAttribute('aria-label', `${pack.name} by ${pack.creator}`);
    return card;
  }

  // Background Anime and other packs: two clear actions
  const bgActions = el('div', {
    class: 'pack-actions-responsive',
    role: 'group',
    'aria-label': `${pack.name} installation actions`,
    style: 'display:flex;flex-direction:column;gap:10px;width:100%;max-width:100%;box-sizing:border-box;margin-top:auto'
  });

  const installManuallyBtn = el('button', {
    class: 'cta-btn cta-primary pack-dl-btn',
    type: 'button',
    'aria-label': `Install ${pack.name} manually`,
    style: 'display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 18px;border-radius:9999px;background:var(--accent);color:#1a1206;font-size:0.85rem;font-weight:700;width:100%;box-sizing:border-box;overflow-wrap:break-word;word-break:break-word;text-align:center;white-space:normal;line-height:1.25'
  }, icon('download'), 'Install Manually');
  installManuallyBtn.addEventListener('click', () => {
    tap();
    openDownload(pack);
  });

  const updaterForBtn = el('a', {
    class: 'cta-btn cta-secondary',
    href: '#novaExtUpdater',
    'aria-label': `Use Nova UI Extension updater for ${pack.name}`,
    style: 'display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 18px;border-radius:9999px;background:var(--glass-soft);border:1px solid var(--border);color:var(--text);font-size:0.85rem;font-weight:600;width:100%;box-sizing:border-box;text-decoration:none;overflow-wrap:break-word;word-break:break-word;text-align:center;white-space:normal;line-height:1.25'
  }, icon('sync'), 'Updater for Nova UI');

  updaterForBtn.addEventListener('click', (e) => {
    e.preventDefault();
    tap();
    const target = document.getElementById('novaExtUpdater');
    if (target) {
      target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      // focus for keyboard users
      setTimeout(() => target.querySelector('a, button')?.focus({ preventScroll: true }), 400);
    }
    showToast('Check the Extension Updater for automatic updates', 'info');
  });

  bgActions.append(installManuallyBtn, updaterForBtn);

  card.append(
    thumb,
    badges,
    el('h3', { text: pack.name, style: 'font-size:1.05rem;color:#fff;margin-bottom:3px;font-weight:700;line-height:1.3;overflow-wrap:break-word;word-break:break-word;max-width:100%' }),
    el('div', { class: 'pack-creator', text: `by ${pack.creator}`, style: 'font-size:0.7rem;color:var(--secondary);margin-bottom:10px;font-weight:600;overflow-wrap:break-word;word-break:break-word;max-width:100%' }),
    pack.description ? el('p', { class: 'pack-desc', text: pack.description, style: 'font-size:0.8rem;color:var(--text-sec);margin-bottom:16px;line-height:1.65;display:-webkit-box;-webkit-line-clamp:3;line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word;word-break:break-word;max-width:100%' }) : null,
    meta,
    releaseDateEl,
    bgActions,
    updaterDesc,
  );

  card.setAttribute('role', 'article');
  card.setAttribute('aria-label', `${pack.name} by ${pack.creator}`);

  return card;
}

/* ── Render ──────────────────────────────────────────────────── */

export function render(list = getFilteredSorted()) {
  const container = document.getElementById('packs');
  if (!container) return;

  // When the featured Nova UI hero is rendered, dedupe the Nova UI pack
  // from the grid in the default/"All"/"Featured" view so the same
  // content isn't shown twice. When the user explicitly picks the "UI"
  // filter or searches for "nova", include the regular card so the
  // result set is never confusingly empty.
  const featuredPresent = Boolean(document.getElementById('novaFeatured'));
  const filterIsAll = state.filter === 'all' || state.filter === 'featured';
  const queryMatch = state.query.trim().toLowerCase();
  const novaQueried = queryMatch && ('nova ui'.includes(queryMatch) || 'nova'.includes(queryMatch));
  const hideNovaInGrid = featuredPresent && filterIsAll && !novaQueried;
  const visible = hideNovaInGrid
    ? list.filter((p) => !(p.category === 'ui' && p.source === 'github'))
    : list;

  const countEl = document.getElementById('searchCount');
  if (countEl) {
    const total = visible.length;
    countEl.textContent = `${total} pack${total === 1 ? '' : 's'}`;
  }

  const totalPages = Math.max(1, Math.ceil(visible.length / perPage));
  state.page = Math.min(state.page, totalPages);
  const items = visible.slice((state.page - 1) * perPage, state.page * perPage);

  if (!items.length) {
    const oldDynamics = container.querySelectorAll('.pack-card-dynamic, .empty-state');
    oldDynamics.forEach(card => card.remove());
    container.appendChild(
      el('div', { class: 'empty-state pack-card-dynamic' },
        icon('magnifying-glass'),
        el('p', { text: 'No packs found' }),
        el('p', { class: 'sub', text: 'Try a different keyword or clear the filters' }))
    );
    renderPagination(visible);
    return;
  }

  // Build off-document, then swap in one go: a single layout pass.
  const fragment = document.createDocumentFragment();
  items.forEach((pack, i) => fragment.appendChild(buildCard(pack, i)));

  const oldDynamics = container.querySelectorAll('.pack-card-dynamic, .empty-state');
  oldDynamics.forEach(card => card.remove());
  container.appendChild(fragment);

  renderPagination(visible);
}

/** Renders the highlights / announcements section with real content. */
export function renderHighlightsSection() {
  const container = document.querySelector('.highlights-grid');
  if (!container) return;

  const highlights = [
    {
      icon: 'rocket',
      title: 'Always up to date',
      date: 'Live from GitHub',
      desc: 'Every Nova UI download links straight to the latest GitHub release – no manual updates needed.',
    },
    {
      icon: 'wand-magic-sparkles',
      title: 'Animated shader background',
      date: 'Toggle with B',
      desc: 'Press B or use the sparkle button in the corner to enable or disable the WebGL background.',
    },
    {
      icon: 'mobile-screen',
      title: 'Works on mobile',
      date: 'Android 8.0+',
      desc: 'Geode on Android is fully supported – grab the mobile-resolution pack and follow the guide.',
    },
    {
      icon: 'shield-halved',
      title: '100% safe & free',
      date: 'No paywalls',
      desc: 'Every pack is free, installs without touching original game files, and works offline once cached.',
    },
  ];

  const fragment = document.createDocumentFragment();
  highlights.forEach((item) => {
    const card = el('article', { class: 'highlight-card reveal' },
      el('div', { class: 'highlight-icon' }, icon(item.icon)),
      el('h3', { text: item.title }),
      el('span', { class: 'highlight-date', text: item.date }),
      el('p', { text: item.desc }),
    );
    fragment.appendChild(card);
  });
  container.replaceChildren(fragment);

  // Reveal newly added cards.
  initScrollReveal(container);
}

/* ── Featured Nova UI hero (packs page) ────────────────────── */

let featuredRendered = false;
let featuredDownloadsTo = -1;

function renderFeaturedNova(pack) {
  const section = document.getElementById('novaFeatured');
  if (!section) return;

  const versionEl = document.getElementById('nfVersion');
  const downloadsEl = document.getElementById('nfDownloads');
  const updatedEl = document.getElementById('nfUpdated');
  const sizeEl = document.getElementById('nfSize');
  const stableBtn = document.getElementById('nfDlStable');
  const extBtn = document.getElementById('nfDlExtension');

  if (versionEl && pack.version) {
    versionEl.textContent = pack.version === '-' ? '—' : `v${pack.version}`;
  }
  if (updatedEl) updatedEl.textContent = releaseDate(pack.lastUpdated);
  if (sizeEl) sizeEl.textContent = pack.size || '—';

  // Downloads counter animates in just like the hero on the home page.
  if (downloadsEl && typeof pack.downloads === 'number') {
    animateNumber(downloadsEl, pack.downloads, {
      duration: 1200,
      from: featuredDownloadsTo < 0 ? 0 : featuredDownloadsTo,
      format: fmtD,
    });
    featuredDownloadsTo = pack.downloads;
  }

  if (stableBtn) {
    if (pack.download_pc) {
      stableBtn.href = pack.download_pc;
      stableBtn.setAttribute('target', '_blank');
      stableBtn.setAttribute('rel', 'noopener');
      stableBtn.classList.remove('is-disabled');
      stableBtn.removeAttribute('aria-disabled');
      if (!stableBtn.dataset.bound) {
        stableBtn.dataset.bound = '1';
        stableBtn.addEventListener('click', (e) => {
          if (stableBtn.classList.contains('is-disabled')) { e.preventDefault(); return; }
          tap();
          showToast('Downloading Nova UI (Stable)', 'success');
        });
      }
    } else {
      stableBtn.classList.add('is-disabled');
      stableBtn.setAttribute('aria-disabled', 'true');
      stableBtn.removeAttribute('href');
    }
  }
  if (extBtn) {
    if (pack.download_mobile) {
      extBtn.href = pack.download_mobile;
      extBtn.setAttribute('target', '_blank');
      extBtn.setAttribute('rel', 'noopener');
      extBtn.classList.remove('is-disabled');
      extBtn.removeAttribute('aria-disabled');
      if (!extBtn.dataset.bound) {
        extBtn.dataset.bound = '1';
        extBtn.addEventListener('click', (e) => {
          if (extBtn.classList.contains('is-disabled')) { e.preventDefault(); return; }
          tap();
          showToast('Downloading Nova UI Extension', 'success');
        });
      }
    } else {
      extBtn.classList.add('is-disabled');
      extBtn.setAttribute('aria-disabled', 'true');
      extBtn.removeAttribute('href');
    }
  }

  if (!featuredRendered) {
    featuredRendered = true;
    // Reveal animation on first paint only.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      section.classList.add('revealed', 'visible');
      initScrollReveal(section);
    }));
  }
}

/**
 * Populates the featured Nova UI hero from catalogue data. Falls back
 * to direct GitHub data if the catalogue hasn't mapped UI yet. */
function populateFeatured() {
  const section = document.getElementById('novaFeatured');
  if (!section) return;

  const fromCatalogue = state.data.find((p) => p.category === 'ui' && p.source === 'github');
  if (fromCatalogue) {
    renderFeaturedNova(fromCatalogue);
    return;
  }

  // Loading placeholders until GitHub responds.
  getReleases()
    .then((releases) => {
      const release = releases.find((r) => !r.prerelease) || releases[0];
      if (!release) return;
      const assets = release.assets || [];
      const isExtension = (a) => /extension/i.test(a?.name || '');
      const isZip = (a) => /\.zip$/i.test(a?.name || '');
      const stable = assets.find((a) => isZip(a) && !isExtension(a)) || assets.find(isZip);
      const ext = assets.find((a) => a !== stable && isZip(a) && isExtension(a)) || null;
      const totalSize = assets.reduce((s, a) => s + (a.size || 0), 0);
      const totalDownloads = assets.reduce((s, a) => s + (a.download_count || 0), 0);
      const tag = (release.tag_name || '').replace(/^v/i, '');

      renderFeaturedNova({
        name: 'Nova UI',
        version: tag || '-',
        size: stable?.size ? formatBytes(stable.size) : (totalSize ? formatBytes(totalSize) : '—'),
        downloads: totalDownloads,
        lastUpdated: release.published_at,
        download_pc: stable?.browser_download_url || '',
        download_mobile: ext?.browser_download_url || '',
      });
    })
    .catch(() => {
      // Leave placeholders as "—" - the card will populate on next refresh.
    });
}

export function renderPagination(list) {
  const nav = document.getElementById('pagination');
  if (!nav) return;
  const totalPages = Math.ceil(list.length / perPage);
  nav.replaceChildren();
  if (totalPages <= 1) return;

  const goTo = (page) => {
    state.page = page;
    render();
    document.getElementById('packs-section')?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  if (state.page > 1) {
    nav.appendChild(el('button', {
      type: 'button',
      'aria-label': 'Previous page',
      onclick: () => goTo(state.page - 1),
    }, icon('chevron-left'), 'Prev'));
  }

  nav.appendChild(el('span', {
    class: 'page-ind',
    'aria-live': 'polite',
    text: `${state.page} / ${totalPages}`,
  }));

  if (state.page < totalPages) {
    nav.appendChild(el('button', {
      type: 'button',
      'aria-label': 'Next page',
      onclick: () => goTo(state.page + 1),
    }, 'Next', icon('chevron-right')));
  }
}

/* ── Controls ────────────────────────────────────────────────── */

export function setFilter(filter, btn) {
  state.filter = filter;
  state.page = 1;
  document.querySelectorAll('.filter-tag').forEach((tag) => {
    const isActive = tag === btn || tag.dataset.filter === filter;
    tag.classList.toggle('active', isActive);
    tag.setAttribute('aria-pressed', String(isActive));
  });
  tap();
  render();
}

export function applySort() {
  state.sort = document.getElementById('sortSelect')?.value || 'featured';
  state.page = 1;
  render();
}

export function applyFilters() {
  render();
}

function initSearch() {
  const input = document.getElementById('search');
  if (!input) return;
  input.setAttribute('type', 'search');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-label', 'Search texture packs');

  let timer = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    // Debounced so a fast typist never queues a render per keystroke.
    timer = setTimeout(() => {
      state.query = input.value;
      state.page = 1;
      render();
    }, 160);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && input.value) {
      input.value = '';
      state.query = '';
      state.page = 1;
      render();
    }
  });

  // "/" focuses search, the way developer tools and GitHub behave.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    event.preventDefault();
    input.focus();
  });
}

/* ── Download sheet ──────────────────────────────────────────── */

const INSTALL_PATH = 'geode/config/geode.texture-loader/packs';

export function openDownload(pack) {
  const isUI = pack.category === 'ui';
  const panel = document.createDocumentFragment();

  const avatar = el('div', { class: 'popup-avatar' });
  const fallback = el('div', { class: 'placeholder', style: 'display:none' }, icon('image'));
  if (pack.icon) {
    const img = el('img', { src: pack.icon, alt: '' });
    img.addEventListener('error', () => { img.remove(); fallback.style.display = 'flex'; }, { once: true });
    avatar.append(img);
  } else fallback.style.display = 'flex';
  avatar.append(fallback);

  const buttons = el('div', { class: 'popup-btns' });

  const dlButton = (label, iconName, url, variant, extraStyle) => {
    const button = el('button', {
      class: `popup-dl${variant ? ` ${variant}` : ''}`,
      type: 'button',
      style: extraStyle,
    }, icon(iconName), label);
    button.addEventListener('click', () => dl(url, pack.name, label));
    if (!url) { button.disabled = true; button.style.opacity = '.45'; }
    return button;
  };

  if (isUI) {
    buttons.append(
      dlButton('Download Stable', 'file-zipper', pack.download_pc),
      dlButton('Download Extension', 'puzzle-piece', pack.download_mobile, '',
        'background:rgba(247,187,58,.16);color:var(--accent);box-shadow:none'),
    );
    const copyBtn = el('button', {
      class: 'popup-dl ghost',
      type: 'button',
    }, icon('copy'), 'Copy install path');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(INSTALL_PATH);
        showToast('Install path copied', 'success');
      } catch { showToast('Could not copy the path', 'error'); }
    });
    buttons.append(copyBtn);
  } else {
    buttons.append(
      dlButton('Download PC resolution', 'desktop', pack.download_pc),
      dlButton('Download mobile resolution', 'mobile-screen', pack.download_mobile),
    );
  }

  const cancel = el('button', { class: 'popup-cancel', type: 'button' }, icon('xmark'), 'Cancel');
  cancel.addEventListener('click', () => closeSheet());
  buttons.append(cancel);

  const note = el('div', { class: 'popup-note' });
  if (isUI) {
    note.append(
      'Make sure ',
      el('strong', { text: 'Texture Loader' }),
      ' is installed, then extract the UI pack and extension into the folder above.'
    );
  } else {
    note.append('Place the downloaded file in ', el('code', { text: INSTALL_PATH }), ' and restart the game.');
  }

  const popupMetadata = [
    `File Size: ${pack.size || '-'}`,
    isUI ? `Download Count: ${fmtD(pack.downloads)}` : null,
    `Version: ${pack.version === '-' ? '-' : `v${pack.version}`}`,
    `Release Date: ${releaseDate(pack.lastUpdated)}`,
  ].filter(Boolean);

  panel.append(
    avatar,
    el('h2', { text: pack.name, style: isUI ? 'color:var(--primary-light)' : '' }),
    el('div', { class: 'popup-creator', text: `by ${pack.creator}` }),
    el('div', { class: 'popup-meta' },
      popupMetadata.map((item) => el('span', { text: item })),
    ),
    buttons,
    note,
  );

  tap();
  openSheet(panel);
}

export function dl(url, name, variant) {
  if (!url) { showToast('That download is not available yet', 'warn'); return; }
  window.open(url, '_blank', 'noopener');
  showToast(`Downloading ${name} (${variant})`, 'success');
  closeSheet();
}

/* ── FAQ ─────────────────────────────────────────────────────── */

export function toggleFaq(trigger) {
  const item = trigger?.closest('.faq-item');
  if (!item) return;
  const willOpen = !item.classList.contains('open');

  // Accordion: close siblings so only one answer is open at a time.
  item.parentElement?.querySelectorAll('.faq-item.open').forEach((other) => {
    if (other === item) return;
    other.classList.remove('open');
    other.querySelector('.faq-q')?.setAttribute('aria-expanded', 'false');
  });

  item.classList.toggle('open', willOpen);
  trigger.setAttribute('aria-expanded', String(willOpen));
  tap();
}

function initFaq() {
  document.querySelectorAll('.faq-item').forEach((item, index) => {
    const trigger = item.querySelector('.faq-q');
    const answer = item.querySelector('.faq-a');
    if (!trigger || !answer) return;

    // Upgrade the div to a real button for keyboard and screen readers.
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('aria-expanded', 'false');
    const id = answer.id || `faq-answer-${index}`;
    answer.id = id;
    trigger.setAttribute('aria-controls', id);
    answer.setAttribute('role', 'region');

    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleFaq(trigger);
      }
    });
  });
}

/* ── Tabs ────────────────────────────────────────────────────── */

export function switchTab(id, btn) {
  const target = document.getElementById(id);
  if (!target) return;

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    const active = panel === target;
    panel.classList.toggle('active', active);
    panel.setAttribute('aria-hidden', String(!active));
  });
  document.querySelectorAll('.guide-tab').forEach((tab) => {
    const active = tab === btn;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.setAttribute('tabindex', active ? '0' : '-1');
  });
  tap();
  btn?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
}

function initTabs() {
  const tabs = [...document.querySelectorAll('.guide-tab')];
  if (!tabs.length) return;
  const list = tabs[0].parentElement;
  list?.setAttribute('role', 'tablist');

  tabs.forEach((tab, index) => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(tab.classList.contains('active')));
    tab.setAttribute('tabindex', tab.classList.contains('active') ? '0' : '-1');

    // Arrow-key navigation is expected of a tablist.
    tab.addEventListener('keydown', (event) => {
      const dir = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return;
      event.preventDefault();
      const next = tabs[(index + dir + tabs.length) % tabs.length];
      next.focus();
      next.click();
    });
  });

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-hidden', String(!panel.classList.contains('active')));
  });
}

/* ── Copy to clipboard ───────────────────────────────────────── */

export async function copyPath(id) {
  const source = document.getElementById(id);
  if (!source) return;
  const button = source.parentElement?.querySelector('.copy-btn');
  try {
    await navigator.clipboard.writeText(source.textContent.trim());
    showToast('Copied to clipboard', 'success');
    if (button) {
      button.classList.add('copied');
      button.replaceChildren(icon('check'));
      setTimeout(() => {
        button.classList.remove('copied');
        button.replaceChildren(icon('copy'));
      }, 2000);
    }
  } catch {
    showToast('Could not copy - select the text manually', 'error');
  }
}

/* ── Stats ───────────────────────────────────────────────────── */

let packsAnimatedTo = -1;
let downloadsAnimatedTo = -1;

function animateStats() {
  const total = document.getElementById('totalPacks');
  if (total && state.data.length && state.data.length !== packsAnimatedTo) {
    animateNumber(total, state.data.length, {
      duration: 1100,
      from: packsAnimatedTo < 0 ? 0 : packsAnimatedTo,
    });
    packsAnimatedTo = state.data.length;
  }

  const downloads = document.getElementById('totalDownloads');
  if (downloads && downloadsAnimatedTo < 0) {
    // Sum every asset download_count across ALL GitHub releases
    // (the same data the changelog page renders).
    getReleases().then((releases) => {
      const sum = releases.reduce((acc, release) =>
        acc + (release.assets || []).reduce((s, a) => s + (a.download_count || 0), 0),
        0);
      if (sum !== downloadsAnimatedTo) {
        animateNumber(downloads, sum, { duration: 1400, from: 0, format: fmtD });
        downloadsAnimatedTo = sum;
      }
    }).catch(() => {
      // Fallback: use catalogue pack downloads if GitHub API fails.
      const sum = state.data.reduce((acc, pack) => acc + (pack.downloads || 0), 0);
      if (sum !== downloadsAnimatedTo) {
        animateNumber(downloads, sum, { duration: 1400, from: 0, format: fmtD });
        downloadsAnimatedTo = sum;
      }
    });
  }
}

/* ── Catalogue boot ──────────────────────────────────────────── */

async function loadCatalogue({ force = false, hardPurge = false } = {}) {
  const grid = document.getElementById('packs');
  const refreshButton = document.getElementById('refreshPacks');
  const hasGrid = Boolean(grid);
  if (hasGrid && !state.data.length) renderSkeletons();
  grid?.setAttribute('aria-busy', 'true');
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.setAttribute('aria-busy', 'true');
  }

  try {
    const loader = hardPurge ? refreshCatalogue : jalankanJawa;
    await loader({
      force,
      onCache: (cached) => {
        state.data = cached;
        populateFeatured();
        if (hasGrid) render();
        animateStats();
      },
    });
    state.data = sourcePacks.length ? sourcePacks : state.data;
    populateFeatured();
    if (hasGrid) render();
    animateStats();
    if (force || hardPurge) {
      const unavailable = [
        providerStatus.github === 'rejected' ? 'GitHub Releases' : null,
        providerStatus.spreadsheet === 'rejected' ? 'Background Spreadsheet' : null,
      ].filter(Boolean);
      if (unavailable.length) {
        showToast(`Could not refresh ${unavailable.join(' and ')}`, 'warn');
      } else {
        showToast(hardPurge ? 'Cache purged - fresh data loaded' : 'Latest download data fetched', 'success');
      }
    }
    return true;
  } catch {
    if (hasGrid && !state.data.length) {
      grid.replaceChildren(
        el('div', { class: 'empty-state' },
          icon('cloud-arrow-down'),
          el('p', { text: 'Could not load the pack list' }),
          el('p', { class: 'sub', text: 'Check your connection and use Refresh' }))
      );
    }
    if (force || hardPurge) showToast('Could not refresh the download data', 'error');
    return false;
  } finally {
    grid?.setAttribute('aria-busy', 'false');
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.setAttribute('aria-busy', 'false');
    }
  }
}

function initRefreshButton() {
  const button = document.getElementById('refreshPacks');
  if (!button || button.dataset.ready) return;
  button.dataset.ready = '1';

  button.setAttribute('title', 'Click to refresh · Shift-click for a hard refresh (purges cache)');

  button.addEventListener('click', async (event) => {
    if (button.disabled) return;
    tap();
    const hard = event.shiftKey || event.altKey;
    await loadCatalogue({ force: true, hardPurge: hard });
  });

  // Long-press triggers a hard refresh on touch devices.
  let pressTimer = 0;
  const startPress = () => {
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressTimer = 0;
      if (!button.disabled) {
        tap();
        showToast('Hard refresh - purging all cache', 'info');
        loadCatalogue({ force: true, hardPurge: true });
      }
    }, 650);
  };
  const cancelPress = () => clearTimeout(pressTimer);
  button.addEventListener('pointerdown', startPress);
  button.addEventListener('pointerup', cancelPress);
  button.addEventListener('pointerleave', cancelPress);
  button.addEventListener('pointercancel', cancelPress);
}

/* ── Init ────────────────────────────────────────────────────── */

let started = false;

export function jalankanApp() {
  if (started) return;
  started = true;

  initSearch();
  initFaq();
  initTabs();
  initRefreshButton();

  // Highlights don't need remote data - paint them immediately.
  renderHighlightsSection();

  // Featured hero can start loading GitHub data immediately even before
  // the full catalogue settles, so the marquee pack never appears empty.
  populateFeatured();

  // The loader hides as soon as the document is usable - it must never
  // wait on either remote provider.
  hideLoader();

  // If this page load followed a hard refresh, tell the user it worked.
  if (consumeHardRefreshFlag()) {
    setTimeout(() => showToast('Cache cleared - fresh data loaded', 'success'), 300);
  }

  // The catalogue is only needed where it is actually shown: the pack
  // grid, or the home page's "texture packs" counter. Without this guard
  // the changelog, support, credits and guide pages would fetch GitHub
  // and the Google Sheet for nothing on every visit.
  const needsCatalogue =
    document.getElementById('packs') || document.getElementById('totalPacks');
  if (needsCatalogue) {
    loadCatalogue().then(() => initScrollReveal());
  } else {
    initScrollReveal();
  }
}

/* ── Global bridge for inline handlers in the HTML ───────────── */

Object.assign(window, {
  setFilter,
  applySort,
  applyFilters,
  openDownload,
  closePopup: closeSheet,
  closeSheet,
  dl,
  switchTab,
  toggleFaq,
  copyPath,
  showToast,
  render,
  renderPagination,
  renderHighlightsSection,
});

export default { jalankanApp, render, setFilter, applySort, openDownload, toggleFaq, switchTab, copyPath, renderHighlightsSection };
