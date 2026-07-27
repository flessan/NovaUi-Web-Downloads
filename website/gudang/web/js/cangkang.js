/* ═══════════════════════════════════════════════════════════════
   NOVA UI · APP SHELL ("cangkang" = shell)
   ───────────────────────────────────────────────────────────────
   The single source of truth for everything every page shares:
   the PWA <head> meta, the loader, the floating controls, the
   background canvas, the primary navigation, the footer and the
   bottom tab bar.

   WHY THIS FILE EXISTS
   Before this module the same ~120 lines of chrome (header, nav,
   footer, tab bar, FABs, canvas, GLSL) were hand-copied into all
   six pages. The copies drifted apart - different logos, different
   nav links per page, three pages missing the loader - so a single
   edit had to be repeated six times and was easy to get wrong.

   This is a plain (non-module) script loaded with a normal
   <script src> in <head>. That makes it render-blocking, so:

     • it runs before the <body> is parsed, which lets it apply the
       saved "background shader off" class before first paint and
       inject the PWA meta tags with no flash;
     • window.NOVA exists by the time the inline document.write()
       calls in the body run, so the shared chrome is laid out
       synchronously during parse - again, no flash and no layout
       shift.

   The body of every page now reads:

       <script>document.write(NOVA.shellBefore({...}))</script>
       <main>... unique page content ...</main>
       <script>document.write(NOVA.shellAfter({...}))</script>

   Edit the nav, footer or tab bar here once and every page updates.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 1. First-paint shader preference ──────────────────────────
     Apply the saved "off" state before the body exists so the
     animated background never flashes on for users who disabled it. */
  try {
    if (localStorage.getItem('shader-off') === '1') {
      document.documentElement.classList.add('shader-disabled');
    }
  } catch (e) { /* private mode / storage blocked */ }

  /* ── 2. Common <head> meta + resource hints ────────────────────
     Injected once instead of being copied into every page. Absolute
     URLs are used because they are resolved against the document
     root, not this script's location. */
  var head = document.head;
  var FRAG = document.createDocumentFragment();

  function meta(name, content) {
    var m = document.createElement('meta');
    m.name = name;
    m.content = content;
    FRAG.appendChild(m);
  }

  function link(rel, href, attrs) {
    var l = document.createElement('link');
    l.rel = rel;
    l.href = href;
    if (attrs) for (var k in attrs) l.setAttribute(k, attrs[k]);
    FRAG.appendChild(l);
  }

  meta('theme-color', '#070a12');
  meta('color-scheme', 'dark');
  meta('apple-mobile-web-app-capable', 'yes');
  meta('apple-mobile-web-app-status-bar-style', 'black-translucent');
  meta('apple-mobile-web-app-title', 'Nova UI');
  meta('mobile-web-app-capable', 'yes');

  link('manifest', '/manifest.webmanifest');
  link('apple-touch-icon', '/gudang/icon_app/apple-touch-icon.png');
  link('icon', '/gudang/icon_logo/nova_logo.png', { type: 'image/png' });

  /* Warm the third-party origins the stylesheet will soon request.
     The catalogue also reaches the published Google Sheet, so its host
     is hinted too - dns-prefetch only (no connection) so it is cheap. */
  link('preconnect', 'https://fonts.googleapis.com');
  link('preconnect', 'https://fonts.gstatic.com', { crossorigin: '' });
  link('preconnect', 'https://cdnjs.cloudflare.com', { crossorigin: '' });
  link('dns-prefetch', 'https://api.github.com');
  link('dns-prefetch', 'https://docs.google.com');

  head.appendChild(FRAG);

  /* ═══════════════════════════════════════════════════════════════
     3. Site chrome data - the one place to edit navigation.
     ═══════════════════════════════════════════════════════════════ */

  var LOGO = {
    img: '../gudang/icon_logo/nova_logo.png',
    /* Trusted constant markup - intentionally not escaped. */
    text: 'NOVA <span class="logo-dot">UI</span>',
  };

  /* `match` lists pathname suffixes that mark this link active. */
  var NAV = [
    { href: './index.html', icon: 'house', label: 'Home', match: ['index.html', ''] },
    { href: './pack.html', icon: 'th-large', label: 'Packs', match: ['pack.html'] },
    { href: './guide.html', icon: 'book-open', label: 'Guide', match: ['guide.html'] },
    { href: './index.html#faq-section', icon: 'question-circle', label: 'FAQ', section: 'faq-section' },
    { href: './changelog.html', icon: 'clock-rotate-left', label: 'Changelog', match: ['changelog.html'] },
    { href: './support.html', icon: 'life-ring', label: 'Support', match: ['support.html'] },
    { href: './credit.html', icon: 'heart', label: 'Credits', match: ['credit.html'] },
    { href: 'https://github.com/DANZGAME-GD/NovaUI', icon: 'github', label: 'GitHub', external: true, brand: true },
  ];

  var TABBAR = [
    { href: './index.html', icon: 'house', label: 'Home', match: ['index.html', ''] },
    { href: './pack.html', icon: 'th-large', label: 'Packs', match: ['pack.html'] },
    { href: './guide.html', icon: 'book-open', label: 'Guide', match: ['guide.html'] },
    { href: './changelog.html', icon: 'clock-rotate-left', label: 'Updates', match: ['changelog.html'] },
    { href: './support.html', icon: 'life-ring', label: 'Support', match: ['support.html'] },
  ];

  var FOOTER_LINKS = [
    { href: 'https://geode-sdk.org', icon: 'globe', label: 'Geode website', external: true },
    { href: 'https://discord.gg/WJgFhSpTz5', icon: 'discord', label: 'Nova UI Discord', external: true, brand: true },
    { href: 'https://github.com/DANZGAME-GD/NovaUI', icon: 'github', label: 'GitHub', external: true, brand: true },
    { href: 'https://docs.geode-sdk.org', icon: 'book', label: 'Documentation', external: true },
  ];

  var FOOTER_COPY =
    'Made with <span class="heart"><i class="fas fa-heart" aria-hidden="true"></i></span> ' +
    'by DANZGAME — not affiliated with RobTop Games — ' +
    '<a href="./index.html">GD texture packs 2026</a>';

  /* ── Active-link detection ──────────────────────────────────── */
  var PATH = (function () {
    var p = location.pathname.replace(/\/+$/, '');
    /* /app and the site root both mean the home page. */
    if (p === '/app' || p === '') return '/app/index.html';
    return p;
  })();

  function isActive(item) {
    if (!item.match) return false;
    return item.match.some(function (m) {
      return m === '' ? /(^|\/)index\.html?$/.test(PATH) || PATH === '/app/index.html'
        : PATH.indexOf(m) !== -1;
    });
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function iconTag(prefix, name) {
    return '<i class="' + prefix + ' fa-' + name + '" aria-hidden="true"></i> ';
  }

  /* ── Builders ───────────────────────────────────────────────── */

  function navList() {
    return NAV.map(function (item) {
      var on = isActive(item);
      var cls = on ? ' class="active"' : '';
      var current = on ? ' aria-current="page"' : '';
      var ext = item.external ? ' target="_blank" rel="noopener"' : '';
      var sec = item.section ? ' data-section="' + item.section + '"' : '';
      var prefix = item.brand ? 'fab' : 'fas';
      return '<li><a href="' + esc(item.href) + '"' + cls + current + ext + sec + '>' +
        iconTag(prefix, item.icon) + esc(item.label) + '</a></li>';
    }).join('');
  }

  function header() {
    return '<header>' +
      '<nav aria-label="Primary">' +
      '<a class="logo" href="./index.html">' +
      '<img src="' + LOGO.img + '" alt="" width="34" height="34">' +
      '<span>' + LOGO.text + '</span>' +
      '</a>' +
      '<button class="menu-toggle" id="menuToggle" type="button" ' +
      'aria-label="Open navigation menu" aria-expanded="false" aria-controls="navLinks">' +
      '<i class="fas fa-bars" aria-hidden="true"></i></button>' +
      '<ul class="nav-links" id="navLinks">' + navList() + '</ul>' +
      '</nav>' +
      '</header>';
  }

  function tabbar() {
    var items = TABBAR.map(function (item) {
      var on = isActive(item);
      var cls = on ? ' class="active"' : '';
      var current = on ? ' aria-current="page"' : '';
      return '<a href="' + esc(item.href) + '"' + cls + current + '>' +
        iconTag('fas', item.icon) + '<span>' + esc(item.label) + '</span></a>';
    }).join('');
    return '<nav class="app-tabbar" aria-label="Primary mobile navigation">' + items + '</nav>';
  }

  function footer() {
    var links = FOOTER_LINKS.map(function (l) {
      var ext = l.external ? ' target="_blank" rel="noopener"' : '';
      var prefix = l.brand ? 'fab' : 'fas';
      return '<a href="' + esc(l.href) + '"' + ext + '>' + iconTag(prefix, l.icon) + esc(l.label) + '</a>';
    }).join('\n        ');
    return '<footer>' +
      '<div class="footer-links">' + links + '</div>' +
      '<p class="footer-copy">' + FOOTER_COPY + '</p>' +
      '</footer>';
  }

  function loader(label) {
    var text = label || 'Loading';
    return '<div id="loader" class="loader" role="status" aria-label="' + esc(text) + '">' +
      '<div class="loader-gem">' +
      '<img src="../gudang/icon_logo/dohan.png" alt="" width="76" height="76">' +
      '<span>' + esc(text) + '</span>' +
      '</div>' +
      '<div class="loader-bar"><div class="loader-bar-inner"></div></div>' +
      '</div>';
  }

  /**
   * Everything from the start of <body> through the open <header>,
   * i.e. skip-link, loader, floating controls, canvas and the opening
   * <div class="content"> with the header inside it.
   *
   * @param {object}  opts
   * @param {string}  opts.skip   skip-link target id/selector
   * @param {string}  opts.loader loader screen label
   */
  function shellBefore(opts) {
    opts = opts || {};
    var skip = opts.skip || '#main';
    return '' +
      '<a class="skip-link" href="' + esc(skip) + '">Skip to content</a>' +
      loader(opts.loader) +
      '<div class="scroll-progress" id="scrollProgress" role="progressbar" aria-label="Page scroll progress"></div>' +
      '<div class="toast-wrap" id="toastWrap" aria-live="polite"></div>' +
      '<button class="scroll-top" id="scrollTop" type="button" aria-label="Scroll back to top">' +
      '<i class="fas fa-chevron-up" aria-hidden="true"></i></button>' +
      '<button class="shader-toggle" id="shaderToggle" type="button" ' +
      'aria-label="Toggle animated background" data-label="Background: on">' +
      '<i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i></button>' +
      '<canvas id="glcanvas" aria-hidden="true"></canvas>' +
      '<div class="shader-overlay" aria-hidden="true"></div>' +
      '<div class="content">' +
      header();
  }

  /**
   * Everything after <main>: the footer, the closing </div> of
   * .content and the bottom tab bar.
   *
   * @param {object}  opts
   * @param {string}  opts.footer  override footer markup (default: shared footer)
   */
  function shellAfter(opts) {
    opts = opts || {};
    var foot = opts.footer != null ? opts.footer : footer();
    return foot + '</div>' + tabbar();
  }

  /* Expose. Read from window in the inline body scripts so a missing
     script degrades to an empty write instead of a thrown ReferenceError. */
  window.NOVA = {
    LOGO: LOGO,
    NAV: NAV,
    TABBAR: TABBAR,
    FOOTER_LINKS: FOOTER_LINKS,
    shellBefore: shellBefore,
    shellAfter: shellAfter,
    header: header,
    footer: footer,
    tabbar: tabbar,
  };
})();
