/* ═══════════════════════════════════════════════════════════════
   NOVA UI · APP SHELL
   Navigation drawer, bottom sheets, toasts, pull-to-refresh, the
   install prompt and offline handling - the behaviours that make a
   website feel like an installed app.

   Touch gestures here follow one rule: while a finger is down, the
   element is driven by `transform` written inside a rAF callback,
   and transitions are switched off. When the finger lifts, the
   transition is switched back on and the element settles. Mixing the
   two is what makes drag interactions feel sticky.
   ═══════════════════════════════════════════════════════════════ */

import { prefersReducedMotion } from './gerak.js';

/* ── Scroll locking ──────────────────────────────────────────
   `position:fixed` on <body> is the only approach that reliably
   stops background scroll on iOS, but it loses the scroll offset,
   so we save and restore it.                                     */

let lockedAt = 0;
let lockCount = 0;

export function lockScroll() {
  if (lockCount++ > 0) return;
  lockedAt = window.scrollY;
  const body = document.body;
  body.style.position = 'fixed';
  body.style.top = `-${lockedAt}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  body.classList.add('scroll-locked');
}

export function unlockScroll() {
  if (lockCount === 0) return;
  if (--lockCount > 0) return;
  const body = document.body;
  body.style.position = '';
  body.style.top = '';
  body.style.left = '';
  body.style.right = '';
  body.style.width = '';
  body.classList.remove('scroll-locked');
  window.scrollTo(0, lockedAt);
}

/* ── Focus trap ──────────────────────────────────────────────── */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(container, event) {
  const items = [...container.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ── Toasts ──────────────────────────────────────────────────── */

const TOAST_ICONS = {
  success: 'circle-check',
  error: 'circle-exclamation',
  info: 'circle-info',
  warn: 'triangle-exclamation',
};

export function showToast(message, type = 'info', duration = 3200) {
  let wrap = document.getElementById('toastWrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    wrap.id = 'toastWrap';
    document.body.appendChild(wrap);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const icon = document.createElement('i');
  icon.className = `fas fa-${TOAST_ICONS[type] || TOAST_ICONS.info}`;
  const text = document.createElement('span');
  text.textContent = message;               // textContent, never innerHTML
  toast.append(icon, text);
  wrap.appendChild(toast);

  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));

  const dismiss = () => {
    toast.classList.remove('show');
    toast.classList.add('hide');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 600);
  };
  const timer = setTimeout(dismiss, duration);
  toast.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
  return dismiss;
}

/* ── Haptics ─────────────────────────────────────────────────── */

export function tap(pattern = 8) {
  if (navigator.vibrate && matchMedia('(hover:none)').matches) {
    try { navigator.vibrate(pattern); } catch { /* blocked by policy */ }
  }
}

/* ── Navigation drawer ───────────────────────────────────────── */

export function initDrawer() {
  const toggle = document.getElementById('menuToggle');
  const panel = document.getElementById('navLinks');
  if (!toggle || !panel || toggle.dataset.ready) return;
  toggle.dataset.ready = '1';

  // Keep track of original DOM positioning for desktop view
  const originalParent = panel.parentNode;
  const originalSibling = panel.nextSibling;

  // The scrim is created here so no page markup has to include it.
  let scrim = document.querySelector('.nav-scrim');
  if (!scrim) {
    scrim = document.createElement('div');
    scrim.className = 'nav-scrim';
    document.body.appendChild(scrim);
  }

  const icon = toggle.querySelector('i');
  const isOpen = () => panel.classList.contains('active');

  const open = () => {
    if (isOpen()) return;

    // Move to body to bypass the sticky header's containing block on mobile
    document.body.appendChild(panel);
    // Force layout recalculation so opening transition animates correctly
    panel.getBoundingClientRect();

    panel.classList.add('active');
    document.body.classList.add('menu-open');
    toggle.setAttribute('aria-expanded', 'true');
    icon?.classList.replace('fa-bars', 'fa-xmark');
    lockScroll();
    tap();
    panel.querySelector(FOCUSABLE)?.focus({ preventScroll: true });
  };

  const close = ({ restoreFocus = false } = {}) => {
    if (!isOpen()) return;
    panel.classList.remove('active');
    document.body.classList.remove('menu-open');
    toggle.setAttribute('aria-expanded', 'false');
    icon?.classList.replace('fa-xmark', 'fa-bars');
    unlockScroll();

    // Restore original position in header after closing transition completes
    const putBack = () => {
      if (!panel.classList.contains('active') && panel.parentNode === document.body) {
        originalParent.insertBefore(panel, originalSibling);
      }
    };
    if (prefersReducedMotion()) {
      putBack();
    } else {
      panel.addEventListener('transitionend', putBack, { once: true });
      setTimeout(putBack, 500); // fallback
    }

    if (restoreFocus) toggle.focus({ preventScroll: true });
  };

  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'navLinks');
  toggle.addEventListener('click', () => (isOpen() ? close() : open()));
  scrim.addEventListener('click', () => close());
  panel.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => close()));

  document.addEventListener('keydown', (event) => {
    if (!isOpen()) return;
    if (event.key === 'Escape') { event.preventDefault(); close({ restoreFocus: true }); }
    else if (event.key === 'Tab') trapFocus(panel, event);
  });

  // Close when the viewport grows past the drawer breakpoint.
  matchMedia('(min-width: 861px)').addEventListener('change', (e) => {
    if (e.matches) close();
  });

  /* Swipe-to-close: the panel follows the finger 1:1, then settles. */
  if (!prefersReducedMotion()) {
    let startX = 0;
    let dx = 0;
    let dragging = false;
    let frame = 0;

    panel.addEventListener('touchstart', (event) => {
      if (!isOpen() || event.touches.length !== 1) return;
      startX = event.touches[0].clientX;
      dx = 0;
      dragging = true;
      panel.style.transition = 'none';       // hand control to the finger
    }, { passive: true });

    panel.addEventListener('touchmove', (event) => {
      if (!dragging) return;
      dx = Math.max(0, event.touches[0].clientX - startX);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        panel.style.transform = `translate3d(${dx}px,0,0)`;
      });
    }, { passive: true });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      panel.style.transition = '';            // hand control back to CSS
      panel.style.transform = '';
      if (dx > panel.offsetWidth * 0.35) close();
    };
    panel.addEventListener('touchend', end, { passive: true });
    panel.addEventListener('touchcancel', end, { passive: true });
  }

  return { open, close };
}

/* ── Bottom sheet / modal ────────────────────────────────────── */

let activeSheet = null;

export function openSheet(node, { onClose } = {}) {
  closeSheet();

  const sheet = document.createElement('div');
  sheet.className = 'sheet popup';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');

  const panel = document.createElement('div');
  panel.className = 'sheet-panel popup-box';
  if (typeof node === 'string') panel.innerHTML = node;
  else panel.appendChild(node);
  sheet.appendChild(panel);
  document.body.appendChild(sheet);

  lockScroll();
  const previouslyFocused = document.activeElement;
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
  panel.querySelector(FOCUSABLE)?.focus({ preventScroll: true });

  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) closeSheet();
  });

  const onKey = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeSheet(); }
    else if (event.key === 'Tab') trapFocus(panel, event);
  };
  document.addEventListener('keydown', onKey);

  /* Drag the sheet down to dismiss, the way native sheets behave. */
  if (!prefersReducedMotion() && matchMedia('(max-width: 640px)').matches) {
    let startY = 0;
    let dy = 0;
    let dragging = false;
    let frame = 0;

    panel.addEventListener('touchstart', (event) => {
      // Only start a drag from the top of the sheet's own scroll area,
      // otherwise we would hijack the panel's internal scrolling.
      if (panel.scrollTop > 0 || event.touches.length !== 1) return;
      startY = event.touches[0].clientY;
      dy = 0;
      dragging = true;
      panel.style.transition = 'none';
    }, { passive: true });

    panel.addEventListener('touchmove', (event) => {
      if (!dragging) return;
      dy = Math.max(0, event.touches[0].clientY - startY);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        panel.style.transform = `translate3d(0,${dy}px,0)`;
        sheet.style.opacity = String(Math.max(0.35, 1 - dy / 420));
      });
    }, { passive: true });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      panel.style.transition = '';
      panel.style.transform = '';
      sheet.style.opacity = '';
      if (dy > 110) closeSheet();
    };
    panel.addEventListener('touchend', end, { passive: true });
    panel.addEventListener('touchcancel', end, { passive: true });
  }

  activeSheet = {
    el: sheet,
    close() {
      document.removeEventListener('keydown', onKey);
      sheet.classList.remove('open');
      unlockScroll();
      const remove = () => sheet.remove();
      sheet.addEventListener('transitionend', remove, { once: true });
      setTimeout(remove, 500);
      previouslyFocused?.focus?.({ preventScroll: true });
      onClose?.();
    },
  };
  return activeSheet;
}

export function closeSheet() {
  if (!activeSheet) return;
  const sheet = activeSheet;
  activeSheet = null;
  sheet.close();
}

/* ── Pull to refresh ─────────────────────────────────────────── */

export function initPullToRefresh(onRefresh) {
  if (typeof onRefresh !== 'function') return;
  if (!matchMedia('(hover: none)').matches || prefersReducedMotion()) return;

  const indicator = document.createElement('div');
  indicator.className = 'ptr-indicator';
  indicator.innerHTML = '<i class="fas fa-arrow-down"></i>';
  document.body.appendChild(indicator);

  const THRESHOLD = 76;
  let startY = 0;
  let pull = 0;
  let active = false;
  let busy = false;
  let frame = 0;

  const paint = () => {
    frame = 0;
    // Resistance curve: the further you pull, the slower it moves.
    const eased = Math.min(THRESHOLD * 1.5, pull * 0.5);
    indicator.style.transform =
      `translate3d(-50%, ${eased - 20}px, 0) scale(${Math.min(1, 0.7 + eased / 140)}) rotate(${eased * 2.4}deg)`;
    indicator.style.opacity = String(Math.min(1, eased / 46));
  };

  const reset = () => {
    indicator.classList.add('settling');
    indicator.classList.remove('spinning');
    indicator.style.transform = 'translate3d(-50%,-64px,0) scale(.7)';
    indicator.style.opacity = '0';
    setTimeout(() => indicator.classList.remove('settling'), 320);
  };

  document.addEventListener('touchstart', (event) => {
    if (busy || window.scrollY > 0 || event.touches.length !== 1) return;
    if (document.body.classList.contains('menu-open')) return;
    startY = event.touches[0].clientY;
    pull = 0;
    active = true;
    indicator.classList.remove('settling');
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!active) return;
    pull = event.touches[0].clientY - startY;
    if (pull <= 0) { active = false; reset(); return; }
    if (frame) return;
    frame = requestAnimationFrame(paint);
  }, { passive: true });

  const finish = async () => {
    if (!active) return;
    active = false;
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (pull * 0.5 < THRESHOLD * 0.55) { reset(); return; }

    busy = true;
    indicator.classList.add('settling', 'spinning');
    indicator.innerHTML = '<i class="fas fa-arrows-rotate"></i>';
    indicator.style.transform = 'translate3d(-50%,10px,0) scale(1)';
    indicator.style.opacity = '1';
    tap([10, 40, 10]);
    try { await onRefresh(); }
    catch (err) { console.error('[aplikasi] refresh failed', err); }
    finally {
      busy = false;
      indicator.innerHTML = '<i class="fas fa-arrow-down"></i>';
      reset();
    }
  };
  document.addEventListener('touchend', finish, { passive: true });
  document.addEventListener('touchcancel', () => { active = false; reset(); }, { passive: true });
}

/* ── Bottom tab bar active state ─────────────────────────────── */

function initTabbar() {
  const bar = document.querySelector('.app-tabbar');
  if (!bar) return;
  const here = location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/app';
  bar.querySelectorAll('a').forEach((link) => {
    const path = new URL(link.href, location.href).pathname
      .replace(/\/index\.html$/, '/')
      .replace(/\/$/, '') || '/app';
    if (path === here) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
    link.addEventListener('click', () => tap());
  });
}

/* ── Install prompt ──────────────────────────────────────────── */

function initInstallPrompt() {
  const DISMISS_KEY = 'nova-install-dismissed';
  let deferred = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    if (sessionStorage.getItem(DISMISS_KEY) === '1') return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    setTimeout(show, 4000);
  });

  function show() {
    if (!deferred || document.querySelector('.install-prompt')) return;
    const el = document.createElement('div');
    el.className = 'install-prompt';
    el.innerHTML = `
      <img src="${location.pathname.includes('/app/') ? '..' : '.'}/gudang/icon_logo/nova_logo.png" alt="">
      <div class="ip-text">
        <div class="ip-title">Install Nova UI</div>
        <div class="ip-sub">Add to your home screen for offline access</div>
      </div>
      <button class="ip-install" type="button">Install</button>
      <button class="ip-close" type="button" aria-label="Dismiss"><i class="fas fa-xmark"></i></button>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));

    const hide = () => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 500);
    };
    el.querySelector('.ip-install').addEventListener('click', async () => {
      hide();
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') showToast('Installing Nova UI…', 'success');
      deferred = null;
    });
    el.querySelector('.ip-close').addEventListener('click', () => {
      hide();
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
    });
  }

  window.addEventListener('appinstalled', () => {
    showToast('Nova UI installed', 'success');
    document.querySelector('.install-prompt')?.remove();
  });
}

/* ── Offline awareness ───────────────────────────────────────── */

function initNetworkStatus() {
  /* The banner is created lazily, the first time the browser actually
     reports going offline. Injecting it up front meant every online
     visitor carried a hidden red bar tucked behind the translucent
     header, where it bled through the glass. */
  const ensureBanner = () => {
    let banner = document.querySelector('.offline-banner');
    if (banner) return banner;
    banner = document.createElement('div');
    banner.className = 'offline-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = '<i class="fas fa-wifi" aria-hidden="true"></i><span>You are offline - showing cached content</span>';
    document.body.appendChild(banner);
    return banner;
  };

  const sync = () => {
    // navigator.onLine only guarantees "no network interface"; it can
    // report true behind a captive portal. It is good enough to hide
    // the banner, which is all we use it for.
    const offline = !navigator.onLine;
    if (offline) ensureBanner();
    document.body.classList.toggle('is-offline', offline);
  };

  window.addEventListener('online', () => {
    sync();
    showToast('Back online', 'success');
  });
  window.addEventListener('offline', sync);
  sync();
}

/* ── Background shader toggle ────────────────────────────────
   Lives here rather than in webgl.js so that module stays exactly as
   authored. Hiding is purely a CSS concern (html.shader-disabled), so
   the toggle never needs to reach into the render loop. */

const SHADER_KEY = 'shader-off';

export function shaderDisabled() {
  try { return localStorage.getItem(SHADER_KEY) === '1'; }
  catch { return false; }
}

export function initShaderToggle() {
  const btn = document.getElementById('shaderToggle');
  if (!btn || btn.dataset.ready) return;
  btn.dataset.ready = '1';

  const root = document.documentElement;
  const icon = btn.querySelector('i');
  const isOff = () => root.classList.contains('shader-disabled');

  const sync = () => {
    const off = isOff();
    btn.classList.toggle('off', off);
    btn.setAttribute('aria-pressed', String(!off));
    btn.dataset.label = off ? 'Background: off' : 'Background: on';
    if (icon) icon.className = off ? 'fas fa-eye-slash' : 'fas fa-wand-magic-sparkles';
  };

  btn.addEventListener('click', () => {
    const next = !isOff();
    root.classList.toggle('shader-disabled', next);
    try { localStorage.setItem(SHADER_KEY, next ? '1' : '0'); } catch { /* private mode */ }

    /* Actually stop the render loop, don't just hide the canvas - the
       point of the toggle is to stop burning GPU and battery. Turning
       it back on may need a cold boot, because a shader that was off at
       page load was never started in the first place. */
    if (next) window.__novaShader?.berhenti?.();
    else window.__novaStartShader?.(true);

    sync();
    tap();
    showToast(next ? 'Background shader disabled' : 'Background shader enabled', 'info');
  });

  // Keyboard shortcut, ignored while typing.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'b' || event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    btn.click();
  });

  sync();
}

/* ── Service worker ──────────────────────────────────────────── */

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('[aplikasi] service worker registration failed', err));
  });
}

/* ── Loader ──────────────────────────────────────────────────── */

export function hideLoader() {
  const loader = document.getElementById('loader');
  if (!loader) return;
  loader.classList.add('hidden');
  setTimeout(() => loader.remove(), 700);
}

/* ── Boot ────────────────────────────────────────────────────── */

let started = false;

export function jalankanAplikasi() {
  if (started) return;
  started = true;
  initDrawer();
  initTabbar();
  initShaderToggle();
  initNetworkStatus();
  initInstallPrompt();
  initServiceWorker();
}

export default {
  jalankanAplikasi, showToast, openSheet, closeSheet,
  initPullToRefresh, hideLoader, tap, initShaderToggle, shaderDisabled,
};
