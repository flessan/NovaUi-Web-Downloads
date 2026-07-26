/* ═══════════════════════════════════════════════════════════════
   NOVA UI · PACK BROWSER
   Search, filter, sort, paginate and download the texture packs.

   Notable changes from the previous version:
     • cards are built with real DOM nodes instead of interpolated
       HTML strings, so a pack name containing a quote or a tag can
       no longer break the markup or inject script;
     • the download dialog is a proper focus-trapped bottom sheet;
     • search is debounced and rendering is batched into a fragment,
       so typing never causes a long frame;
     • skeleton cards are shown while the catalogue loads;
     • pull-to-refresh re-fetches the catalogue on touch devices.
   ═══════════════════════════════════════════════════════════════ */

import { packs as sourcePacks, perPage, jalankanJawa } from './jawa.js';
import { animateNumber, initScrollReveal, prefersReducedMotion } from './gerak.js';
import { showToast, openSheet, closeSheet, initPullToRefresh, hideLoader, tap } from './aplikasi.js';

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

export function categoryLabel(category) {
  return category === 'ui' ? 'UI' : 'Background';
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
      el('div', { class: 'pack-skeleton', 'aria-hidden': 'true' },
        el('div', { class: 'sk-line sk-circle' }),
        el('div', { class: 'sk-line sk-title' }),
        el('div', { class: 'sk-line sk-sub' }),
        el('div', { class: 'sk-line sk-text' }),
        el('div', { class: 'sk-line sk-text' }),
        el('div', { class: 'sk-line sk-btn' }))
    );
  }
  container.replaceChildren(fragment);
}

/* ── Card ────────────────────────────────────────────────────── */

function buildCard(pack, index) {
  const card = el('article', {
    class: `pack-card${pack.featured ? ' featured' : ''}${prefersReducedMotion() ? '' : ' card-in'}`,
    style: `--i:${index}`,
  });

  /* Thumbnail with a graceful fallback if the image 404s. */
  const thumb = el('div', { class: 'pack-img' });
  const placeholder = el('div', { class: 'placeholder', style: 'display:none' }, icon('image'));
  if (pack.icon) {
    const img = el('img', {
      src: pack.icon,
      alt: `${pack.name} icon`,
      loading: 'lazy',
      decoding: 'async',
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

  const badges = el('div', { class: 'pack-badges' },
    el('span', { class: 'pack-badge badge-cat', text: categoryLabel(pack.category) }),
    pack.featured ? el('span', { class: 'pack-badge badge-featured', text: 'Featured' }) : null,
    isRecent(pack.lastUpdated) ? el('span', { class: 'pack-badge badge-new', text: 'New' }) : null,
  );

  const meta = el('div', { class: 'pack-meta' },
    el('span', {}, icon('download'), ` ${fmtD(pack.downloads)}`),
    el('span', {}, icon('code-branch'), ` v${pack.version}`),
    pack.lastUpdated ? el('span', {}, icon('clock'), ` ${relativeDate(pack.lastUpdated)}`) : null,
  );

  const button = el('button', {
    class: 'pack-dl-btn',
    type: 'button',
    'aria-label': `Download ${pack.name}`,
  }, icon('download'), 'Download');
  button.addEventListener('click', () => openDownload(pack));

  card.append(
    thumb,
    badges,
    el('h3', { text: pack.name }),
    el('div', { class: 'pack-creator', text: `by ${pack.creator}` }),
    pack.description ? el('p', { class: 'pack-desc', text: pack.description }) : null,
    meta,
    button,
  );
  return card;
}

/* ── Render ──────────────────────────────────────────────────── */

export function render(list = getFilteredSorted()) {
  const container = document.getElementById('packs');
  if (!container) return;

  const countEl = document.getElementById('searchCount');
  if (countEl) countEl.textContent = `${list.length} pack${list.length === 1 ? '' : 's'}`;

  const totalPages = Math.max(1, Math.ceil(list.length / perPage));
  state.page = Math.min(state.page, totalPages);
  const items = list.slice((state.page - 1) * perPage, state.page * perPage);

  if (!items.length) {
    container.replaceChildren(
      el('div', { class: 'empty-state' },
        icon('magnifying-glass'),
        el('p', { text: 'No packs found' }),
        el('p', { class: 'sub', text: 'Try a different keyword or clear the filters' }))
    );
    renderPagination(list);
    return;
  }

  // Build off-document, then swap in one go: a single layout pass.
  const fragment = document.createDocumentFragment();
  items.forEach((pack, i) => fragment.appendChild(buildCard(pack, i)));
  container.replaceChildren(fragment);

  renderPagination(list);
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

  panel.append(
    avatar,
    el('h2', { text: pack.name, style: isUI ? 'color:var(--primary-light)' : '' }),
    el('div', { class: 'popup-meta', text: `v${pack.version} · by ${pack.creator} · ${pack.size}` }),
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

function animateStats() {
  const total = document.getElementById('totalPacks');
  if (total && state.data.length) animateNumber(total, state.data.length, { duration: 1100 });

  const downloads = document.getElementById('totalDownloads');
  if (downloads) {
    const sum = state.data.reduce((acc, pack) => acc + (pack.downloads || 0), 0);
    animateNumber(downloads, sum, { duration: 1400, format: fmtD });
  }
}

/* ── Catalogue boot ──────────────────────────────────────────── */

async function loadCatalogue({ force = false } = {}) {
  const hasGrid = Boolean(document.getElementById('packs'));
  if (hasGrid && !state.data.length) renderSkeletons();

  try {
    await jalankanJawa({
      force,
      // Paint cached rows the moment they are available.
      onCache: (cached) => {
        state.data = cached;
        if (hasGrid) render();
        animateStats();
      },
    });
    state.data = sourcePacks.length ? sourcePacks : state.data;
    if (hasGrid) render();
    animateStats();
    if (force) showToast('Pack list updated', 'success');
  } catch {
    if (hasGrid && !state.data.length) {
      document.getElementById('packs')?.replaceChildren(
        el('div', { class: 'empty-state' },
          icon('cloud-arrow-down'),
          el('p', { text: 'Could not load the pack list' }),
          el('p', { class: 'sub', text: 'Check your connection and try again' }))
      );
    }
    if (force) showToast('Could not refresh the pack list', 'error');
  }
}

/* ── Init ────────────────────────────────────────────────────── */

let started = false;

export function jalankanApp() {
  if (started) return;
  started = true;

  initSearch();
  initFaq();
  initTabs();

  // The loader hides as soon as the document is usable - it must never
  // wait on the network, or a slow sheet blocks the whole page.
  hideLoader();

  loadCatalogue().then(() => initScrollReveal());
  initPullToRefresh(() => loadCatalogue({ force: true }));
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
});

export default { jalankanApp, render, setFilter, applySort, openDownload, toggleFaq, switchTab, copyPath };
