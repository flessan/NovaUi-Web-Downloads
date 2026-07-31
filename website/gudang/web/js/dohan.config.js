/* ═══════════════════════════════════════════════════════════════
   NOVA UI · ENTRY POINT
   Single module every page loads. Boot order matters:

     1. gerak      motion engine - sets perf mode and owns the scroll
                   loop, so everything after it can rely on those.
     2. aplikasi   app shell - drawer, tab bar, shader toggle, network.
     3. app        page content - pack browser, FAQ, tabs.
     4. webgl      background shader - started last, when idle, so it
                   can never delay interactive chrome.
   ═══════════════════════════════════════════════════════════════ */

import { jalankanGerak } from './gerak.js';
import { jalankanAplikasi, showToast, shaderDisabled } from './aplikasi.js';
import { jalankanApp } from './app.js';
import { jalankanWebGL } from './webgl.js';
import { purgeAllCaches, consumeHardRefreshFlag } from './cache.js';
import { jalankanSplash, completeSplash } from './splash.js';

// Expose helpers globally for inline scripts and power users.
window.showToast = showToast;
window.novaPurgeCache = async () => {
  await purgeAllCaches();
  showToast('All cached data cleared', 'success');
  location.reload();
};

function boot() {
  // URL flags: ?nocache / ?hard=1 force a full purge before any data load.
  const params = new URLSearchParams(location.search);
  const urlHardRefresh = params.has('nocache') || params.has('hard') || params.has('purge');
  if (urlHardRefresh) {
    purgeAllCaches();
    // Strip the flag from the URL so reloads/share links stay clean.
    const clean = new URL(location.href);
    ['nocache', 'hard', 'purge'].forEach((k) => clean.searchParams.delete(k));
    history.replaceState(null, '', clean.pathname + (clean.search || '') + clean.hash);
  }

  // Premium splash is first – GPU accelerated, particles, progress
  try { jalankanSplash(); } catch {}
  // Expose globally so hideLoader can complete elegantly even before module is fully ready
  window.__novaSplash = { complete: completeSplash };

  jalankanGerak();
  jalankanAplikasi();
  jalankanApp();

  /* The shader is purely decorative, so it is deferred until the
     browser is idle. It is skipped entirely when the user has turned
     it off or asked for reduced motion - the CSS gradient on #glcanvas
     stands in for it, so there is nothing to fall back to. */
  /* Boots the shader on demand and caches the controller.
     Exposed globally so the toggle can start it later: if the shader is
     off at load we never call jalankanWebGL(), so without this the
     toggle had nothing to restart and the background stayed dead until
     a manual reload. */
  window.__novaStartShader = (force = false) => {
    const explicitOn = localStorage.getItem('shader-off') === '0';
    if (!force && !explicitOn && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
    if (!window.__novaShader) {
      // jalankanWebGL returns { mulai, berhenti } so the toggle can stop
      // the loop rather than just hiding the canvas with CSS.
      window.__novaShader = jalankanWebGL() || null;
    } else {
      window.__novaShader.mulai?.();
    }
    return window.__novaShader;
  };

  const startShader = () => {
    if (shaderDisabled()) return;
    window.__novaStartShader();
  };

  if ('requestIdleCallback' in window) requestIdleCallback(startShader, { timeout: 1500 });
  else setTimeout(startShader, 320);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
