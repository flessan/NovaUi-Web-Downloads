<p align="center">
    <img src="website/gudang/icon_logo/nova_logo.png" alt="Nova Ui Logo" width="180" height="180">
</p>

<h3 align="center"><b>Nova UI</b> is a name derived from the word innovation, which means developing ideas in a field</h3>

## What is Nova UI?
<b>Nova Ui</b> is a <a href="https://store.steampowered.com/app/322170/Geometry_Dash/">Geometry Dash</a> texture pack that can change the appearance of the menu to make it more attractive, <b>Nova Ui</b> uses a <a href="https://store.steampowered.com/app/322170/Geometry_Dash/">Geometry Dash</a> launcher called <a href="https://geode-sdk.org/">Geode</a>

## Must Download Mods
* [Node IDs](https://geode-sdk.org/mods/geode.node-ids)
* [Pages Api](https://geode-sdk.org/mods/raydeeux.pages_api)
* [ImagePlus](https://geode-sdk.org/mods/prevter.imageplus)
* [Menu Shader](https://geode-sdk.org/mods/cgytrus.menu-shaders)
* [Texture Loader](https://geode-sdk.org/mods/geode.texture-loader)
* [Happy Texture :3](https://geode-sdk.org/mods/alphalaneous.happy_textures)
* [Alpha's Geode Utils](https://geode-sdk.org/mods/alphalaneous.alphas_geode_utils)
* [Animate This Sprite!](https://geode-sdk.org/mods/user95401.animate-this-sprite)

If you have any other questions or need help, be sure to join my [Discord Server!](https://discord.gg/WJgFhSpTz5)

## Credits Asset
* Shaders > [Mellow Voronoi](https://www.shadertoy.com/view/wlXcDS)
* Background > [Slr - Graphite Background](https://www.youtube.com/watch?v=ag13IgTauU8)
* Background Player > [The Deli Background](https://www.youtube.com/watch?v=SU0CCJbHYYk&list=PLBP4wY8Toya-QvSwVIRpALhO_qiYqE0fh)
* Editor Asset > [Alkatreize](https://www.youtube.com/channel/UCKGhzag0So06pzIqwAeTP-Q)

---

## Website

The `website/` folder is the static site published at
[novaui-id.pages.dev](https://nova-ai-dev.pages.dev). It is a plain
HTML/CSS/ES-module project - no build step, no bundler. Open
`website/app/index.html` through any static server and it runs.

### Structure

```
website/
├── app/                      pages (index, pack, guide, changelog, support, credit)
├── manifest.webmanifest      PWA manifest
├── sw.js                     service worker (offline + instant repeat loads)
├── offline.html              offline fallback page
└── gudang/web/
    ├── css/
    │   ├── dohan.config.css      manifest - imports everything in order
    │   ├── lainnya/warna.css     design tokens (colour, type, spacing, motion)
    │   ├── gaya.css              base + shared components
    │   ├── sperpart/gerak.css    all animation + performance modes
    │   ├── sperpart/aplikasi.css app shell: drawer, tab bar, sheets, loader
    │   ├── lainnya/responsif.css breakpoints + platform tweaks
    │   ├── releases.css          GitHub release/changelog/support pages
    │   └── kredit.css            credits page
    └── js/
        ├── cangkang.js     shared app shell - one source of truth for the
        │                     header/nav, footer, tab bar, loader, floating
        │                     controls, PWA <head> meta and the shader-off
        │                     first-paint class. Render-blocking, no flash.
        ├── dohan.config.js   entry point, boots the modules in order
        ├── gerak.js          motion engine - owns the single scroll loop
        ├── aplikasi.js       app shell behaviour - drawer, sheets, toasts, PWA
        ├── app.js            pack browser - search, filter, async refresh, download
        ├── jawa.js           split catalogue (GitHub UI + Sheets backgrounds + cache)
        ├── webgl.js          background shader (GLSL compiled inside the module)
        └── github-releases.js  GitHub releases API client
```

### Shared app shell (`cangkang.js`)

Every page shares the same chrome - the skip link, loader, floating
controls (scroll-to-top, shader toggle), the background canvas, the
primary `<header>` navigation, the `<footer>` and the bottom tab bar.
That chrome is **defined once** in `gudang/web/js/cangkang.js` and
injected into each page at parse time, so editing the nav, footer or
tab bar is a single change instead of six.

`cangkang.js` is a plain (non-module) script loaded with an ordinary
`<script src>` in `<head>`, which makes it render-blocking. That lets it
do two things before first paint with no flash:

- apply the saved `shader-off` class to `<html>` so a disabled background
  never flashes on, and
- inject the common PWA `<head>` meta (theme-color, manifest, icons,
  apple-mobile-web-app-*, preconnects).

It then exposes `window.NOVA`, and each page body renders its shell with
two synchronous calls:

```html
<script>document.write(window.NOVA ? NOVA.shellBefore({ skip:'#main', loader:'Loading' }) : '')</script>
<main> ... unique page content ... </main>
<script>document.write(window.NOVA ? NOVA.shellAfter() : '')</script>
```

Because the writes happen during parse (before the module graph boots),
the header and canvas are laid out immediately - no layout shift. The
`window.NOVA ?` guard means a missing script degrades to an empty write
rather than throwing. The active nav/tab item is detected automatically
from `location.pathname`, so no page has to mark itself active.

### Download data sources

The pack catalogue intentionally combines two providers in `jawa.js`:

- **Nova UI** uses the latest downloadable release from
  `DANZGAME-GD/NovaUI` on GitHub. Version, publication date, asset sizes,
  display-only download totals, and both download URLs are mapped from the
  GitHub Releases API.
- **Background Anime** continues to use the published Google Sheets CSV.
  UI rows in that sheet are ignored so stale Spreadsheet URLs can never
  override GitHub release assets.

The Packs page's **Refresh** button bypasses both short-lived caches and
updates the existing cards asynchronously. It does not reload or navigate
away from the page.

### Performance rules

The site targets a smooth 60 fps on low-end Android. Three rules keep it
there - please preserve them when editing:

1. **One scroll listener.** `gerak.js` owns it. It records `scrollY` and
   nothing else, then batches every DOM write into a single
   `requestAnimationFrame`. Adding a listener that reads layout
   (`scrollHeight`, `getBoundingClientRect`, `offsetTop`…) during scroll
   causes a forced synchronous reflow on every event - the exact cause of
   the stutter this architecture fixed. Subscribe via `onScrollFrame()`.
2. **Animate only `transform` and `opacity`.** Never `width`, `height`,
   `top` or `left`. The scroll progress bar uses `transform: scaleX()`,
   the drawer uses `translate3d`, the FAQ uses `grid-template-rows`.
3. **`will-change` is temporary.** Apply it immediately before a tween and
   remove it when the tween ends - `withLayer()` in `gerak.js` does both.
   A permanent hint creates a composited layer per element and exhausts
   GPU memory.

`html.perf-lite` (set automatically on weak devices, Data Saver or a low
battery) drops blur and ambient animation while keeping the layout
identical. `prefers-reduced-motion` is honoured throughout.

### Background shader

`webgl.js` is kept close to the original. Its vertex and fragment
shaders are compiled from GLSL **hardcoded inside the module**, so pages
do not need to ship any inline shader source. (An earlier build carried
`<script id="vs">` / `<script id="fs">` blocks on every page, but
nothing read them - they were dead weight and have been removed.)

Two mobile-specific guards were added on top of the original:

- **Resize is debounced (120ms), and height-only changes are ignored.**
  Every resize reallocates the GPU drawing buffer. On phones the URL bar
  collapsing fires a resize storm mid-scroll, and reallocating per event
  is what made scrolling feel rough. A height-only change with an
  unchanged width is treated as the URL bar and skipped; rotation, which
  changes width, still resizes normally.
- **The render loop pauses on `visibilitychange`.** No reason to drive
  the GPU for a tab nobody is looking at.

`jalankanWebGL()` returns `{ mulai, berhenti }` so the on-screen toggle
can genuinely stop the loop rather than just hiding the canvas in CSS
while it keeps drawing underneath.

It is started from `dohan.config.js` on an idle callback, and is skipped
entirely when the user has toggled the background off or has
`prefers-reduced-motion` set. When it does not run, the CSS gradient on
`#glcanvas` is what you see, so the background is never blank. The
on-screen toggle lives in `aplikasi.js` (`initShaderToggle`) rather than
in `webgl.js`, purely so that file stays untouched.
