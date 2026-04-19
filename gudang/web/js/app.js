// <!-- ═══ APP ═══ -->
/* app.js */
import { packs, perPage } from './jawa.js';

/* ── Local State (ES modules don't allow reassigning imports) ── */
let currentPage = 1;
let activeFilter = 'all';
let searchQuery = '';

/* ── Helpers ── */
export function fmtD(n){ return n>=1000 ? (n/1000).toFixed(1).replace(/\.0$/,"")+"k" : n.toString(); }

export function relativeDate(ds){
  const parsed = new Date(ds);
  if(isNaN(parsed.getTime())) return 'Unknown date';
  const d = Math.floor((Date.now() - parsed.getTime()) / 864e5);
  if(d<=0) return 'Just now';
  if(d===1) return 'Yesterday';
  if(d<7) return d+' days ago';
  if(d<30) return Math.floor(d/7)+' weeks ago';
  if(d<365) return Math.floor(d/30)+' months ago';
  return Math.floor(d/365)+' years ago';
}

export function categoryLabel(c){ return c==='ui' ? 'UI' : 'Background'; }

/* ── Init ── */
import { jalankanJawa } from './jawa.js'; // Pastikan jalankanJawa diimport

document.addEventListener("DOMContentLoaded", () => {
  // 1. Jalankan loader seperti biasa
  setTimeout(()=>{
    const loader = document.getElementById("loader");
    if(loader) loader.classList.add("hidden");
  }, 900);

  // 2. TUNGGU data dari Google Sheets selesai, baru render
  jalankanJawa().then(() => {
    console.log("Data siap di app.js, memulai render awal...");
    
    // Inisialisasi statistik (jumlah packs)
    animateStats();
    
    // Ambil data yang sudah difilter/sort (sekarang packs sudah berisi)
    const filtered = getFilteredSorted();
    
    // Render ke HTML
    if(filtered.length) {
        render(filtered);
    } else {
        console.warn("Data berhasil dimuat tapi list kosong.");
    }

    // Inisialisasi fitur UI lainnya
    initScrollReveal();
    initScrollProgress();
    initActiveNav();
    initMobileMenu();
  });
});

/* ── Mobile Menu ── */
export function initMobileMenu() {
  const menuToggle = document.getElementById("menuToggle");
  const navLinks = document.getElementById("navLinks");
  if(!menuToggle || !navLinks) return;

  menuToggle.addEventListener("click", () => {
    navLinks.classList.toggle("active");
    const icon = menuToggle.querySelector("i");
    icon.classList.toggle("fa-bars");
    icon.classList.toggle("fa-times");
  });

  navLinks.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", () => {
      navLinks.classList.remove("active");
      const icon = menuToggle.querySelector("i");
      icon.classList.add("fa-bars");
      icon.classList.remove("fa-times");
    });
  });
}

/* ── Stats Animation ── */
export function animateStats(){
  const totalEl = document.getElementById("totalPacks");
  if(totalEl) animN(totalEl, 0, packs.length, 900);
}

export function animN(el, f, t, d, fmt){
  const s = performance.now();
  (function u(n){
    const p = Math.min((n-s)/d, 1);
    const e = 1-Math.pow(1-p, 3);
    const v = Math.round(f+(t-f)*e);
    el.textContent = fmt ? v.toLocaleString() : v;
    if(p<1) requestAnimationFrame(u);
  })(s);
}

/* ── Toast ── */
export function showToast(msg, type='info'){
  const c = document.getElementById("toastWrap");
  if(!c) return;
  const t = document.createElement("div");
  const icons = { success:'check-circle', error:'exclamation-circle', info:'info-circle', warn:'exclamation-triangle' };
  t.className = `toast toast-${type}`;
  t.innerHTML = `<i class="fas fa-${icons[type]||'info-circle'}"></i><span>${msg}</span>`;
  c.appendChild(t);
  requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.add("show")));
  setTimeout(()=>{
    t.classList.remove("show");
    setTimeout(()=>t.remove(), 350);
  }, 3200);
}

/* ── Copy Path ── */
export function copyPath(id){
  const el = document.getElementById(id);
  if(!el) return;
  navigator.clipboard.writeText(el.textContent).then(()=>{
    const btn = el.nextElementSibling;
    if(btn){
      btn.classList.add("copied");
      btn.innerHTML = '<i class="fas fa-check"></i>';
      showToast("Path copied to clipboard", "success");
      setTimeout(()=>{
        btn.classList.remove("copied");
        btn.innerHTML = '<i class="fas fa-copy"></i>';
      }, 2000);
    }
  }).catch(()=>showToast("Failed to copy", "error"));
}

/* ── Scroll Progress ── */
export function initScrollProgress(){
  const bar = document.getElementById("scrollProgress");
  if(!bar) return;
  window.addEventListener("scroll", ()=>{
    const h = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = h > 0 ? (window.scrollY / h * 100) + "%" : "0%";
  }, {passive:true});
}

/* ── Scroll to Top ── */
const stt = document.getElementById("scrollTop");
if(stt){
  window.addEventListener("scroll", ()=>{
    stt.classList.toggle("visible", window.scrollY > 400);
  }, {passive:true});
  stt.addEventListener("click", ()=>window.scrollTo({top:0, behavior:"smooth"}));
}

/* ── Scroll Reveal ── */
export function initScrollReveal(){
  const obs = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        e.target.classList.add("revealed");
        obs.unobserve(e.target);
      }
    });
  }, {threshold:0.08, rootMargin:"0px 0px -40px 0px"});
  document.querySelectorAll(".reveal").forEach(el=>obs.observe(el));
}

/* ── Active Nav ── */
export function initActiveNav(){
  const sections = ["about","guide","packs-section","faq-section"];
  const links = document.querySelectorAll(".nav-links a[data-section]");
  const obs = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        links.forEach(l=>l.classList.remove("active"));
        const match = document.querySelector(`.nav-links a[data-section="${e.target.id}"]`);
        if(match) match.classList.add("active");
      }
    });
  }, {threshold:0.2, rootMargin:"-80px 0px -50% 0px"});
  sections.forEach(id=>{
    const el = document.getElementById(id);
    if(el) obs.observe(el);
  });
}

/* ── Filter & Sort ── */
export function getFilteredSorted(){
  let list = [...packs];
  if(activeFilter==='featured') list = list.filter(p=>p.featured);
  else if(activeFilter!=='all') list = list.filter(p=>p.category===activeFilter);

  if(searchQuery){
    const k = searchQuery.toLowerCase();
    list = list.filter(p => 
      p.name.toLowerCase().includes(k) || 
      p.creator.toLowerCase().includes(k) || 
      (p.description && p.description.toLowerCase().includes(k))
    );
  }

  const sortEl = document.getElementById("sortSelect");
  const sort = sortEl ? sortEl.value : 'featured';
  if(sort==='name') list.sort((a,b)=>a.name.localeCompare(b.name));
  else if(sort==='updated') list.sort((a,b)=>new Date(b.lastUpdated)-new Date(a.lastUpdated));
  else list.sort((a,b)=>(b.featured?1:0)-(a.featured?1:0));

  return list;
}

export function setFilter(f, btn){
  activeFilter = f;
  currentPage = 1;
  document.querySelectorAll(".filter-tag").forEach(t=>t.classList.remove("active"));
  if(btn) btn.classList.add("active");
  render(getFilteredSorted());
}

export function applySort(){
  currentPage = 1;
  render(getFilteredSorted());
}

/* ── Search ── */
const searchInput = document.getElementById("search");
if(searchInput){
  searchInput.addEventListener("input", function(){
    searchQuery = this.value.trim();
    currentPage = 1;
    render(getFilteredSorted());
  });
}

/* ── Render Packs ── */
export function render(list){
  const c = document.getElementById("packs");
  if(!c) return;
  c.innerHTML = "";
  
  const countEl = document.getElementById("searchCount");
  if(countEl) countEl.textContent = list.length + " pack" + (list.length!==1?"s":"");

  const items = list.slice((currentPage-1)*perPage, currentPage*perPage);
  if(!items.length){
    c.innerHTML = `<div class="empty-state"><i class="fas fa-search"></i><p>Not found</p><p class="sub">Try different keywords or change the filter</p></div>`;
    renderPagination(list);
    return;
  }

  items.forEach((pk, i)=>{
    const d = document.createElement("div");
    d.className = "pack-card" + (pk.featured?" featured":"");
    d.style.cssText = `opacity:0;transform:translateY(20px);animation:fadeUp .45s ${i*.07}s ease forwards`;
    
    let badges = `<span class="pack-badge badge-cat">${categoryLabel(pk.category)}</span>`;
    if(pk.featured) badges += `<span class="pack-badge badge-featured"><i class="fas fa-star" style="font-size:.5rem"></i> Featured</span>`;
    if(pk.isNew) badges += `<span class="pack-badge badge-new">New</span>`;

    // Safe JSON encoding for onclick
    const pkData = encodeURIComponent(JSON.stringify(pk));

    d.innerHTML = `
      <div class="pack-img">
        <img src="${pk.icon}" alt="${pk.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
        <div class="placeholder" style="display:none"><i class="fas fa-image"></i></div>
      </div>
      <div class="pack-badges">${badges}</div>
      <h3>${pk.name}</h3>
      <div class="pack-creator">by ${pk.creator}</div>
      <p class="pack-desc">${pk.description}</p>
      <div class="pack-meta">
        <span><i class="fas fa-code-branch"></i>v${pk.version}</span>
        <span><i class="fas fa-weight-hanging"></i>${pk.size}</span>
        <span><i class="fas fa-clock"></i>${relativeDate(pk.lastUpdated)}</span>
      </div>
      <button class="pack-dl-btn" onclick='openDownload(JSON.parse(decodeURIComponent("${pkData}")) )'>
        <i class="fas fa-download"></i>Download
      </button>`;
    c.appendChild(d);
  });
  renderPagination(list);
}

/* ── Popup ── */
export function openDownload(pk){
  document.querySelectorAll(".popup").forEach(p=>p.remove());
  const p = document.createElement("div");
  p.className = "popup";
  p.addEventListener("click", e=>{ if(e.target===p) closePopup(); });
  
  const isUI = pk.category === 'ui';
  const installPath = "geode/config/geode.texture-loader/packs";

  const buttonsHtml = isUI ? `
      <button class="popup-dl" onclick="dl('${pk.download_pc}','${pk.name.replace(/'/g,"\\'")}','UI Pack')">
        <i class="fas fa-file-archive"></i> Download Stable
      </button>
      <button class="popup-dl" style="background:rgba(245, 202, 11, 0.39); color:#fbbf24; border-color:rgba(245,158,11,0.3);" onclick="dl('${pk.download_mobile}','${pk.name.replace(/'/g,"\\'")}','Extension')">
        <i class="fas fa-puzzle-piece"></i> Download Extension
      </button>
      <button class="popup-dl ghost" style="margin-top:8px; font-size:0.75rem; opacity:0.8" onclick="navigator.clipboard.writeText('${installPath}').then(()=>showToast('Install path copied!','success'))">
        <i class="fas fa-copy"></i> Copy Install Path
      </button>
  ` : `
      <button class="popup-dl" onclick="dl('${pk.download_pc}','${pk.name.replace(/'/g,"\\'")}','PC')">
        <i class="fas fa-desktop"></i> Download PC Resolution
      </button>
      <button class="popup-dl" onclick="dl('${pk.download_mobile}','${pk.name.replace(/'/g,"\\'")}','Mobile')">
        <i class="fas fa-mobile-alt"></i> Download Mobile Resolution
      </button>
  `;

  const noteHtml = isUI ? 
    `Khusus UI: Pastikan anda sudah menginstal <strong>Texture Loader</strong>. Ekstrak UI Pack dan Extension ke folder yang ditentukan.` :
    `The file will open in a new tab. Place it in <code>${installPath}</code> folder then restart the game.`;

  p.innerHTML = `<div class="popup-box">
    <div class="popup-avatar">
      <img src="${pk.icon}" alt="${pk.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
      <div class="placeholder" style="display:none"><i class="fas fa-image"></i></div>
    </div>
    <h2 style="${isUI ? 'color:var(--primary-light)' : ''}">${pk.name}</h2>
    <div class="popup-meta">v${pk.version} &middot; by ${pk.creator} &middot; ${pk.size}</div>
    <div class="popup-btns">
      ${buttonsHtml}
      <button class="popup-cancel" onclick="closePopup()">
        <i class="fas fa-times"></i> Cancel
      </button>
    </div>
    <div class="popup-note">${noteHtml}</div>
  </div>`;
  document.body.appendChild(p);
  document.body.style.overflow = "hidden";
}

export function closePopup(){
  const p = document.querySelector(".popup");
  if(!p) return;
  p.style.animation = "fadeIn .2s ease reverse forwards";
  document.body.style.overflow = "";
  setTimeout(()=>p.remove(), 200);
}

export function dl(u, name, ver){
  window.open(u, "_blank");
  showToast(`Downloading ${name} (${ver})...`, "success");
  closePopup();
}

document.addEventListener("keydown", e=>{ if(e.key==="Escape") closePopup(); });

/* ── Pagination ── */
export function renderPagination(list){
  const tp = Math.ceil(list.length / perPage);
  const nav = document.getElementById("pagination");
  if(!nav) return;
  nav.innerHTML = "";
  if(tp<=1) return;

  if(currentPage>1){
    const b = document.createElement("button");
    b.innerHTML = '<i class="fas fa-chevron-left"></i> Prev';
    b.onclick = ()=>{ currentPage--; render(list); document.getElementById("packs-section")?.scrollIntoView({behavior:"smooth"}); };
    nav.appendChild(b);
  }

  const ind = document.createElement("span");
  ind.className = "page-ind";
  ind.textContent = currentPage + " / " + tp;
  nav.appendChild(ind);

  if(currentPage<tp){
    const b = document.createElement("button");
    b.innerHTML = 'Next <i class="fas fa-chevron-right"></i>';
    b.onclick = ()=>{ currentPage++; render(list); document.getElementById("packs-section")?.scrollIntoView({behavior:"smooth"}); };
    nav.appendChild(b);
  }
}

/* ── Tabs ── */
export function switchTab(id, btn){
  document.querySelectorAll(".tab-panel").forEach(t=>t.classList.remove("active"));
  document.querySelectorAll(".guide-tab").forEach(b=>b.classList.remove("active"));
  const target = document.getElementById(id);
  if(target) target.classList.add("active");
  if(btn) btn.classList.add("active");
}

/* ── FAQ ── */
export function toggleFaq(el){
  const item = el?.parentElement;
  if(!item) return;
  const open = item.classList.contains("open");
  item.parentElement.querySelectorAll(".faq-item").forEach(i=>{
    i.classList.remove("open");
    i.querySelector(".faq-a").style.display = "none";
  });
  if(!open){
    item.classList.add("open");
    item.querySelector(".faq-a").style.display = "block";
  }
}

document.querySelectorAll(".faq-a").forEach(a=>a.style.display="none");

export function jalankanApp() {
  console.log("App Jalan");
}

/* --- Expose ke Global agar HTML (onclick/oninput) bisa akses --- */
window.setFilter = setFilter;
window.applySort = applySort;
window.openDownload = openDownload;
window.closePopup = closePopup;
window.dl = dl;
window.switchTab = switchTab;
window.toggleFaq = toggleFaq;
window.copyPath = copyPath;
window.renderPagination = renderPagination;
window.showToast = showToast;
window.initMobileMenu = initMobileMenu;
window.initScrollProgress = initScrollProgress;
window.initScrollReveal = initScrollReveal;
window.initActiveNav = initActiveNav;

console.log("✅ Semua fungsi global telah didaftarkan & app siap.");
