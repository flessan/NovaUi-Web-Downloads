/* ═══════════════════════════════════════════════════════════════
   NOVA UI · MOTION ENGINE
   Central owner of every scroll listener, animation frame and
   observer on the site.

   WHY THIS FILE EXISTS - the stutter bug
   ─────────────────────────────────────────────────────────────
   The previous build registered several independent `scroll`
   handlers (progress bar, scroll-to-top, header state). Each one
   read layout (`scrollHeight`, `scrollY`) and then wrote style in
   the same tick, so every scroll event produced a forced synchronous
   reflow - the browser had to recalculate layout mid-scroll, which
   is exactly what a user perceives as stutter. The progress bar also
   animated `width`, which repaints and re-lays-out on every frame.

   The fix, implemented below:
     • ONE passive scroll listener for the whole page.
     • It only records `window.scrollY` - never reads layout.
     • All DOM writes are batched into a single rAF callback, so
       reads and writes never interleave.
     • The progress bar animates `transform:scaleX()` (compositor
       only) instead of `width` (layout + paint).
     • `will-change` is added immediately before a tween and removed
       on `transitionend`, so we never accumulate composited layers.
     • Page-wide cached metrics are refreshed by ResizeObserver
       rather than being measured during scroll.
   ═══════════════════════════════════════════════════════════════ */

/* ── Environment probes ─────────────────────────────────────── */

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Decides whether the device should run in "perf-lite" mode: same
 * layout, but no blur, no ambient loops, no decorative shader.
 */
function shouldRunLite() {
  const nav = navigator;

  // Explicit user intent - always honour it.
  if (nav.connection?.saveData) return true;

  /* Everything else must be genuinely low-end. The earlier thresholds
     (<=4 cores, <=4 GB, '3g') matched most ordinary mid-range Android
     phones, which then lost all blur and ambient motion and looked
     flat - the opposite of the intent. Chrome also clamps deviceMemory
     to a coarse ladder (0.25/0.5/1/2/4/8), so 4 is common on capable
     hardware and is a poor signal on its own.

     A device now has to look weak on BOTH cpu and memory, and only a
     genuinely slow radio (2g) counts. */
  const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 8;
  const memory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 8;
  if (cores <= 4 && memory <= 2) return true;
  if (cores <= 2) return true;

  if (['slow-2g', '2g'].includes(nav.connection?.effectiveType)) return true;
  return false;
}

export const perfLite = () => document.documentElement.classList.contains('perf-lite');

/* ── Scroll scheduler ────────────────────────────────────────
   Subscribers receive a snapshot object. They must only WRITE to
   the DOM - any read would reintroduce the reflow this solves.   */

const subscribers = new Set();
let ticking = false;
let lastY = 0;

/** Cached page metrics. Refreshed off the scroll path. */
const metrics = { maxScroll: 1, viewport: 0 };

function measure() {
  metrics.viewport = window.innerHeight;
  metrics.maxScroll = Math.max(
    1,
    document.documentElement.scrollHeight - metrics.viewport
  );
}

function flush() {
  ticking = false;
  const y = window.scrollY;
  const snapshot = {
    y,
    delta: y - lastY,
    progress: Math.min(1, Math.max(0, y / metrics.maxScroll)),
    atTop: y < 8,
  };
  lastY = y;
  for (const fn of subscribers) {
    try { fn(snapshot); } catch (err) { console.error('[gerak] subscriber failed', err); }
  }
}

function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(flush);
}

/** Subscribe to the shared scroll loop. Returns an unsubscribe fn. */
export function onScrollFrame(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/* ── will-change lifecycle ───────────────────────────────────
   Promoting a layer is cheap; *keeping* it promoted is not. These
   helpers make sure a hint never outlives its animation.          */

export function promote(el, props = 'transform, opacity') {
  if (!el) return;
  el.style.willChange = props;
}

export function demote(el) {
  if (!el) return;
  el.style.willChange = '';
}

/** Promotes, runs the tween, then releases the layer. */
export function withLayer(el, run, fallbackMs = 700) {
  if (!el) return;
  promote(el);
  let done = false;
  const release = () => {
    if (done) return;
    done = true;
    el.removeEventListener('transitionend', release);
    el.removeEventListener('animationend', release);
    demote(el);
  };
  el.addEventListener('transitionend', release, { once: true });
  el.addEventListener('animationend', release, { once: true });
  setTimeout(release, fallbackMs);
  run?.();
}

/* ── Scroll progress bar ─────────────────────────────────────── */

function initScrollProgress() {
  const bar = document.getElementById('scrollProgress');
  if (!bar) return;
  bar.style.willChange = 'transform';
  onScrollFrame(({ progress }) => {
    // scaleX is composited: no layout, no paint, no stutter.
    bar.style.transform = `scaleX(${progress})`;
  });
}

/* ── Header elevation ────────────────────────────────────────── */

function initHeaderState() {
  const header = document.querySelector('header');
  if (!header) return;
  let stuck = false;
  onScrollFrame(({ atTop }) => {
    const next = !atTop;
    if (next === stuck) return;      // only touch the DOM on change
    stuck = next;
    header.classList.toggle('is-stuck', next);
  });
}

/* ── Scroll-to-top button ────────────────────────────────────── */

function initScrollTop() {
  const btn = document.getElementById('scrollTop');
  if (!btn) return;
  let shown = false;
  onScrollFrame(({ y }) => {
    const next = y > 420;
    if (next === shown) return;
    shown = next;
    btn.classList.toggle('visible', next);
  });
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });
}

/* ── Auto-hiding bottom tab bar ──────────────────────────────── */

function initTabbarAutoHide() {
  const bar = document.querySelector('.app-tabbar');
  if (!bar) return;
  let hidden = false;
  let accum = 0;
  onScrollFrame(({ delta, y, atTop }) => {
    // Accumulate small movements so a jittery finger cannot flicker
    // the bar; only a deliberate 24px gesture flips it.
    if ((delta > 0) !== (accum > 0)) accum = 0;
    accum += delta;
    if (atTop || y + metrics.viewport >= metrics.maxScroll - 4) {
      if (hidden) { hidden = false; bar.classList.remove('hidden'); }
      return;
    }
    if (accum > 24 && !hidden) { hidden = true; bar.classList.add('hidden'); accum = 0; }
    else if (accum < -24 && hidden) { hidden = false; bar.classList.remove('hidden'); accum = 0; }
  });
}

/* ── Scroll reveal ───────────────────────────────────────────── */

let revealObserver = null;

export function initScrollReveal(root = document) {
  const targets = root.querySelectorAll('.reveal:not([data-revealed]), .reveal-stagger:not([data-revealed])');
  if (!targets.length) return;

  if (prefersReducedMotion()) {
    targets.forEach((el) => {
      el.classList.add('revealed', 'visible');
      el.dataset.revealed = '1';
    });
    return;
  }

  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        revealObserver.unobserve(el);
        el.dataset.revealed = '1';
        // Promote just before the tween, release when it ends.
        withLayer(el, () => el.classList.add('revealed', 'visible'), 900);
      }
    }, { threshold: 0.06, rootMargin: '0px 0px -8% 0px' });
  }

  targets.forEach((el) => {
    // Index drives the CSS stagger delay without a timer per child.
    if (el.classList.contains('reveal-stagger')) {
      [...el.children].forEach((child, i) => child.style.setProperty('--i', i));
    }
    revealObserver.observe(el);
  });
}

/* ── Section-aware navigation highlight ──────────────────────── */

export function initActiveNav() {
  const links = [...document.querySelectorAll('[data-section]')];
  if (!links.length) return;

  const byId = new Map();
  links.forEach((link) => {
    const id = link.dataset.section;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(link);
  });

  const sections = [...byId.keys()]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (!sections.length) return;

  let current = null;
  const observer = new IntersectionObserver((entries) => {
    // Pick the entry closest to the top of the viewport that is visible.
    const visible = entries.filter((e) => e.isIntersecting);
    if (!visible.length) return;
    const best = visible.reduce((a, b) =>
      a.boundingClientRect.top <= b.boundingClientRect.top ? a : b
    );
    if (best.target.id === current) return;
    current = best.target.id;
    links.forEach((l) => l.classList.remove('active'));
    byId.get(current)?.forEach((l) => l.classList.add('active'));
  }, { rootMargin: '-25% 0px -60% 0px', threshold: 0 });

  sections.forEach((s) => observer.observe(s));
}

/* ── Ripple feedback ─────────────────────────────────────────── */

function initRipples() {
  if (prefersReducedMotion()) return;
  const SELECTOR = '.cta-btn, .pack-dl-btn, .filter-tag, .guide-tab, .app-tabbar a, .popup-btns button, .nova-mod-item';

  document.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return;
    const host = event.target.closest?.(SELECTOR);
    if (!host || host.dataset.noRipple) return;

    const rect = host.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.cssText =
      `width:${size}px;height:${size}px;` +
      `left:${event.clientX - rect.left - size / 2}px;` +
      `top:${event.clientY - rect.top - size / 2}px`;

    host.classList.add('ripple-host');
    host.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  }, { passive: true });
}

/* ── Page transitions ────────────────────────────────────────── */

/* Entry fade only.

   An earlier version also intercepted every internal link, delaying
   navigation by 180ms to play an exit animation. On mobile that made
   every tap feel dead - the browser had not even begun fetching the
   next page - and it broke middle-click and bfcache heuristics. Links
   are now left completely alone; where the browser supports the View
   Transition API it gives us a real cross-document transition for
   free, at zero latency cost. */
function initPageTransitions() {
  if (prefersReducedMotion()) return;
  const root = document.documentElement;

  root.classList.add('page-enter');
  setTimeout(() => root.classList.remove('page-enter'), 600);

  window.addEventListener('pageshow', (event) => {
    root.classList.remove('page-leaving');
    if (event.persisted) root.classList.remove('page-enter');
  });
}

/* ── Anchor offset for the sticky header ─────────────────────── */

function initAnchorOffsets() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href').slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const header = document.querySelector('header');
    const offset = (header?.offsetHeight || 0) + 12;
    const top = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    history.replaceState(null, '', `#${id}`);
  });
}

/* ── Number counter ──────────────────────────────────────────── */

/** Eases a number into place on the compositor-friendly rAF clock. */
export function animateNumber(el, to, { from = 0, duration = 1000, format } = {}) {
  if (!el) return;
  const target = Number(to) || 0;
  if (prefersReducedMotion()) {
    el.textContent = format ? format(target) : String(target);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    const value = Math.round(from + (target - from) * eased);
    el.textContent = format ? format(value) : String(value);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ── Boot ────────────────────────────────────────────────────── */

let started = false;

export function jalankanGerak() {
  if (started) return;
  started = true;

  const root = document.documentElement;
  if (shouldRunLite()) root.classList.add('perf-lite');

  // Battery-aware: drop to lite mode when the device is running low.
  /* Battery-aware, but reversible: plugging in or charging past the
     threshold restores the full experience instead of leaving the site
     permanently degraded for the rest of the session. Only applies when
     the device was not already in lite mode for hardware reasons. */
  const hardwareLite = root.classList.contains('perf-lite');
  navigator.getBattery?.().then((battery) => {
    const check = () => {
      if (hardwareLite) return;
      const critical = !battery.charging && battery.level < 0.15;
      root.classList.toggle('perf-lite', critical);
    };
    check();
    battery.addEventListener('levelchange', check);
    battery.addEventListener('chargingchange', check);
  }).catch(() => { /* unsupported, ignore */ });

  measure();

  // Metrics are refreshed off the scroll path so scrolling never
  // triggers a layout read.
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => measure());
    ro.observe(document.documentElement);
    if (document.body) ro.observe(document.body);
  }
  window.addEventListener('resize', measure, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(measure, 120), { passive: true });

  window.addEventListener('scroll', onScroll, { passive: true });

  initScrollProgress();
  initHeaderState();
  initScrollTop();
  initTabbarAutoHide();
  initScrollReveal();
  initActiveNav();
  initRipples();
  initAnchorOffsets();
  initPageTransitions();

  // Enable transitions only after the first paint has settled, so the
  // initial layout burst never animates.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.add('motion-ready'));
  });

  flush();
}

export default { jalankanGerak, onScrollFrame, initScrollReveal, initActiveNav, animateNumber, promote, demote, withLayer };
