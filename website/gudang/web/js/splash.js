/** ═══════════════════════════════════════════════════════════════
 *  NOVA UI · SIMPLE FAST SPLASH (React-inspired, longer)
 *  - Minimal, beautiful, fast
 *  - Longer duration like React/Next bundling splash
 *  - GPU scaleX progress, simple task rotation
 *  - Tiny particle field or none for speed
 *  ═══════════════════════════════════════════════════════════════ */

import { prefersReducedMotion } from './gerak.js';

const TASKS = [
  'Initializing…',
  'Loading interface…',
  'Checking for updates…',
  'Syncing packs…',
  'Preparing assets…',
  'Optimizing experience…',
  'Almost ready…',
];

const VERSION_FALLBACK = 'v2.1.0 • Stable';

let state = {
  progress: 0,
  taskIndex: 0,
  taskTimer: 0,
  raf: 0,
  particleRaf: 0,
  startedAt: 0,
  particles: [],
  canvas: null,
  ctx: null,
  running: false,
  reduced: false,
};

function $(sel, root = document) { return root.querySelector(sel); }

function formatPercent(v) {
  return `${Math.max(0, Math.min(100, Math.round(v)))}%`;
}

function updateProgressDOM(percent) {
  const bar = $('.nova-splash-progress-bar');
  const glow = $('.nova-splash-progress-glow');
  const pct = $('.nova-splash-percent');
  const track = $('.nova-splash-progress-track');
  if (!bar) return;
  const scale = Math.max(0, Math.min(1, percent / 100));
  bar.style.transform = `scaleX(${scale})`;
  if (glow) {
    glow.style.transform = `scaleX(${scale})`;
    glow.style.opacity = scale > 0.04 ? String(Math.min(1, scale * 0.7 + 0.1)) : '0';
  }
  if (pct) pct.textContent = formatPercent(percent);
  if (track) {
    track.setAttribute('aria-valuenow', String(Math.round(percent)));
    track.setAttribute('aria-valuetext', `${Math.round(percent)} percent`);
  }
}

function rotateTask() {
  const taskEl = $('.nova-splash-task');
  if (!taskEl) return;
  state.taskIndex = (state.taskIndex + 1) % TASKS.length;
  taskEl.classList.remove('is-changing');
  void taskEl.offsetWidth;
  taskEl.classList.add('is-changing');
  setTimeout(() => {
    taskEl.textContent = TASKS[state.taskIndex];
  }, 140);
}

function loop(now) {
  if (!state.running) return;
  if (!state.startedAt) state.startedAt = now;

  const elapsed = now - state.startedAt;

  // Longer curve: React-like bundling – slow, deliberate, stays longer
  // 0-6500ms to ~92%, then gentle hold at 92-96
  let target;
  if (elapsed < 6500) {
    const t = elapsed / 6500;
    // easeOutQuart for long smooth feel
    const eased = 1 - Math.pow(1 - t, 3.2);
    target = eased * 92;
  } else if (elapsed < 9800) {
    const t = (elapsed - 6500) / 3300;
    target = 92 + t * 4;
  } else {
    target = 96;
  }

  state.progress += (target - state.progress) * 0.06;
  if (state.progress > 96) state.progress = 96;

  updateProgressDOM(state.progress);

  // Slower task rotation – 1150ms feels like React phases
  if (now - state.taskTimer > 1150) {
    state.taskTimer = now;
    rotateTask();
  }

  state.raf = requestAnimationFrame(loop);
}

function initParticles() {
  const canvas = $('.nova-splash-particles');
  if (!canvas || state.reduced) return;
  // Keep it super light for fast – only ~18 particles
  state.canvas = canvas;
  state.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!state.ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  const count = Math.min(20, Math.floor((window.innerWidth * window.innerHeight) / 28000));
  state.particles = Array.from({ length: count }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    r: Math.random() * 1.2 + 0.3,
    vx: (Math.random() - 0.5) * 0.12,
    vy: (Math.random() - 0.5) * 0.12,
    a: Math.random() * 0.28 + 0.06,
  }));

  let last = performance.now();
  const tick = (now) => {
    if (!state.running) return;
    const dt = Math.min(32, now - last);
    last = now;
    const ctx = state.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (const p of state.particles) {
      p.x += p.vx * (dt * 0.06);
      p.y += p.vy * (dt * 0.06);
      if (p.x < -8) p.x = window.innerWidth + 8;
      if (p.x > window.innerWidth + 8) p.x = -8;
      if (p.y < -8) p.y = window.innerHeight + 8;
      if (p.y > window.innerHeight + 8) p.y = -8;

      ctx.beginPath();
      ctx.fillStyle = `rgba(180, 176, 255, ${p.a})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    state.particleRaf = requestAnimationFrame(tick);
  };

  state.particleRaf = requestAnimationFrame(tick);
  state._resize = resize;
}

function stopParticles() {
  if (state.particleRaf) cancelAnimationFrame(state.particleRaf);
  if (state._resize) window.removeEventListener('resize', state._resize);
  state.particleRaf = 0;
  state.particles = [];
}

function getVersion() {
  try {
    const meta = document.querySelector('meta[name="app-version"]')?.content;
    if (meta) return meta.trim();
    const stored = sessionStorage.getItem('nova-ui:v3:github:DANZGAME-GD/NovaUI');
    if (stored) {
      const parsed = JSON.parse(stored);
      const tag = parsed?.data?.[0]?.tag_name;
      if (tag) return `${tag.startsWith('v') ? tag : `v${tag}`} • Stable`;
    }
  } catch {}
  return VERSION_FALLBACK;
}

export function jalankanSplash() {
  const splash = document.getElementById('loader');
  if (!splash) return;
  if (splash.dataset.splashReady === '1') return;
  splash.dataset.splashReady = '1';

  state.reduced = prefersReducedMotion();

  splash.setAttribute('role', 'status');
  splash.setAttribute('aria-live', 'polite');
  splash.setAttribute('aria-label', 'Loading Nova UI');

  const verEl = splash.querySelector('.nova-splash-version');
  if (verEl) verEl.textContent = getVersion();

  updateProgressDOM(0);

  const taskEl = splash.querySelector('.nova-splash-task');
  if (taskEl) taskEl.textContent = TASKS[0];

  state.running = true;
  state.startedAt = 0;
  state.taskTimer = performance.now();
  state.raf = requestAnimationFrame(loop);

  if (!state.reduced) initParticles();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.raf) cancelAnimationFrame(state.raf);
      if (state.particleRaf) cancelAnimationFrame(state.particleRaf);
    } else if (state.running) {
      state.raf = requestAnimationFrame(loop);
      if (!state.reduced && !state.particleRaf) initParticles();
    }
  }, { passive: true });
}

export function completeSplash() {
  const splash = document.getElementById('loader');
  if (!splash) return Promise.resolve();

  state.running = false;
  if (state.raf) cancelAnimationFrame(state.raf);
  stopParticles();

  updateProgressDOM(100);
  const task = splash.querySelector('.nova-splash-task');
  if (task) {
    task.textContent = 'Ready!';
    task.classList.add('is-changing');
  }

  return new Promise((resolve) => {
    setTimeout(() => {
      splash.classList.add('hidden');
      splash.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        splash.style.display = 'none';
        resolve();
      }, 720);
    }, 420);
  });
}

export function hideSplash() {
  return completeSplash();
}

export default { jalankanSplash, completeSplash, hideSplash };
