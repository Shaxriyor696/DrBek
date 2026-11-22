// App shell + client router.
import { h, icon, mount, toast, confirmBox, skeleton, errorBox } from './ui.js?v=mwsbaqve';
import { get, post } from './api.js?v=mwsbaqve';
import { mascot } from './mascot.js?v=mwsbaqve';

export const state = { me: null, lastPosition: null, dirty: null, cleanup: null };

// URL abstraction. Normal mode uses real paths (history API). Demo mode (static
// web preview, window.DS_DEMO) keeps the path in the hash as "p--topics--03"
// because the host only passes plain #names; query and anchor stay in memory.
export const DEMO = !!window.DS_DEMO;
const encPath = (p) => `p${p.replace(/\//g, '--')}`;
const decPath = (hs) => (hs.startsWith('p--') ? hs.slice(1).replace(/--/g, '/') : '/');
let demoSearch = ''; let demoAnchor = ''; let pendingHash = null;
export const loc = {
  get path() { return DEMO ? decPath(location.hash.slice(1)) : location.pathname; },
  get search() { return DEMO ? demoSearch : location.search; },
  get anchor() { return DEMO ? demoAnchor : location.hash; },
};
// Change the URL without rendering (tab switches, canonical redirects).
export function replaceUrlQuiet(to) {
  if (!DEMO) { history.replaceState({}, '', to); return; }
  const u = new URL(to, 'http://x'); demoSearch = u.search; demoAnchor = u.hash;
}
function setUrl(to, replace) {
  if (!DEMO) { if (replace) history.replaceState({}, '', to); else history.pushState({}, '', to); return false; }
  const u = new URL(to, 'http://x'); demoSearch = u.search; demoAnchor = u.hash;
  const want = `#${encPath(u.pathname)}`;
  if (location.hash === want) return false;
  pendingHash = want;
  if (replace) location.replace(want); else location.hash = want;
  return true; // hashchange will render
}

const NAV = [
  { href: '/dashboard', label: 'Boş sahifa', short: 'Asosiy', icon: 'home', match: /^\/dashboard/ },
  { href: '/topics', label: 'Mavzular', short: 'Mavzular', icon: 'book', match: /^\/topics/ },
  { href: '/practice', label: 'Testlar', short: 'Testlar', icon: 'test', match: /^\/practice/ },
  { href: '/saved', label: 'Saqlanganlar', short: 'Saqlangan', icon: 'bookmark', match: /^\/saved/ },
  { href: '/assistant', label: 'AI yordamçi', short: 'AI', icon: 'sparkles', match: /^\/assistant/ },
  { href: '/library', label: 'Kutubxona', icon: 'library', match: /^\/library/, sep: true },
  { href: '/analytics', label: 'Natijalar', icon: 'chart', match: /^\/analytics/ },
];
const BOTTOM = NAV.slice(0, 5);
// simple line icons (same set in the sidebar, bottom bar and the mobile menu sheet)
const navIcon = (n) => icon(n.icon, 'nav-ic');

const ROUTES = [
  { re: /^\/login$/, page: 'auth', fn: 'login', public: true, bare: true },
  { re: /^\/register$/, page: 'auth', fn: 'register', public: true, bare: true },
  { re: /^\/forgot-password$/, page: 'auth', fn: 'forgot', public: true, bare: true },
  { re: /^\/reset-password$/, page: 'auth', fn: 'reset', public: true, bare: true },
  { re: /^\/verify-email$/, page: 'auth', fn: 'verify', public: true, bare: true },
  { re: /^\/onboarding$/, page: 'auth', fn: 'onboarding', bare: true },
  { re: /^\/dashboard$/, page: 'home', fn: 'dashboard', title: 'Boş sahifa' },
  { re: /^\/topics$/, page: 'topics', fn: 'catalog', title: '15 ta mavzu' },
  { re: /^\/topics\/(\d{2})$/, page: 'topics', fn: 'topic', keys: ['topicId'], title: 'Mavzu' },
  { re: /^\/topics\/(\d{2})\/sections\/([\w-]+)$/, page: 'reader', fn: 'reader', keys: ['topicId', 'sectionId'], title: 'Dars' },
  { re: /^\/library$/, page: 'library', fn: 'library', title: 'Kutubxona' },
  { re: /^\/library\/([\w-]+)$/, page: 'library', fn: 'book', keys: ['bookId'], title: 'Kitob' },
  { re: /^\/search$/, page: 'library', fn: 'search', title: 'Qidiruv' },
  { re: /^\/practice$/, page: 'practice', fn: 'practice', title: 'Testlar' },
  { re: /^\/practice\/([\w-]+)$/, page: 'practice', fn: 'attempt', keys: ['attemptId'], title: 'Test' },
  { re: /^\/practice\/([\w-]+)\/results$/, page: 'practice', fn: 'results', keys: ['attemptId'], title: 'Test natijasi' },
  { re: /^\/saved$/, page: 'saved', fn: 'saved', title: 'Saqlanganlar' },
  { re: /^\/analytics$/, page: 'analytics', fn: 'analytics', title: 'Natijalar' },
  { re: /^\/assistant$/, page: 'assistant', fn: 'assistant', title: 'AI yordamçi' },
  { re: /^\/settings$/, page: 'settings', fn: 'settings', title: 'Sozlamalar' },
  { re: /^\/admin$/, page: 'admin', fn: 'admin', title: 'Kontent boşqaruvi' },
  { re: /^\/admin\/lessons\/(ch\d{2})$/, page: 'admin', fn: 'lesson', keys: ['lessonId'], title: 'Dars tekşiruvi' },
];

const pageCache = {};
async function loadPage(name) {
  if (!pageCache[name]) pageCache[name] = await import(`./pages/${name}.js?v=mwsbaqve`);
  return pageCache[name];
}

export async function loadMe() {
  try {
    const r = await get('/api/me');
    state.me = r.user; state.lastPosition = r.lastPosition;
  } catch { state.me = null; }
  return state.me;
}

export function navigate(to, { replace = false } = {}) {
  if (state.dirty && !window.confirm('Saqlanmagan özgarişlar bor. Sahifadan çiqasizmi?')) return;
  state.dirty = null;
  if (!setUrl(to, replace)) render();
}
export const setDirty = (reason) => { state.dirty = reason || null; };

window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener(DEMO ? 'hashchange' : 'popstate', () => { if (DEMO) { if (location.hash === pendingHash) pendingHash = null; else { demoSearch = ''; demoAnchor = ''; } } render(); });
window.addEventListener('ds:unauth', () => { state.me = null; if (!loc.path.match(/^\/(login|register|forgot-password|reset-password|verify-email)/)) navigate(`/login?next=${encodeURIComponent(loc.path + loc.search)}`, { replace: true }); });
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const url = new URL(a.href, location.href);
  if (DEMO && url.pathname.startsWith('/source-pdf/')) { e.preventDefault(); toast('Web körinişda kitob PDF fayli ulanmagan. Töliq ilovada kitob sahifasi oçiladi.'); return; }
  if (DEMO && a.getAttribute('href')?.startsWith('#')) { e.preventDefault(); document.getElementById(a.getAttribute('href').slice(1))?.scrollIntoView(); return; }
  if (url.origin !== location.origin || url.pathname.startsWith('/source-pdf/') || url.pathname.startsWith('/media/') || url.pathname.startsWith('/api/')) return;
  e.preventDefault();
  if (url.pathname === loc.path && url.search === loc.search && url.hash) { document.getElementById(url.hash.slice(1))?.scrollIntoView(); return; }
  navigate(url.pathname + url.search + url.hash);
});

function shell(route) {
  const me = state.me;
  const initials = (me?.profile?.name || me?.email || '?').trim().slice(0, 1).toUpperCase();
  const path = loc.path;
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Asosiy menyu' },
    h('a', { class: 'brand', href: '/dashboard', 'aria-label': 'iMedu boş sahifa' },
      h('img', { class: 'mono', src: 'assets/imedu-mono-64.png', alt: '' }),
      h('img', { class: 'word', src: 'assets/imedu-wordmark.png?v=2', alt: 'iMedu' })),
    h('nav', { class: 'nav' }, NAV.map((n) => [n.sep ? h('hr', { class: 'nav-sep' }) : null, h('a', { href: n.href, 'aria-current': n.match.test(path) ? 'page' : null, title: n.label }, navIcon(n), h('span', {}, n.label))])),
    h('div', { class: 'side-foot stack' },
      me?.roles?.some((r) => ['admin', 'editor', 'reviewer'].includes(r)) ? h('nav', { class: 'nav' }, h('a', { href: '/admin', 'aria-current': path.startsWith('/admin') ? 'page' : null, title: 'Kontent boşqaruvi' }, icon('shield'), h('span', {}, 'Kontent boşqaruvi'))) : null,
      h('a', { class: 'profile-chip', href: '/settings', title: 'Profil va sozlamalar' }, h('span', { class: 'avatar' }, initials),
        h('span', { class: 'pc-text grow' }, h('b', { style: { display: 'block' } }, me?.profile?.name || 'Profil'), h('span', { class: 'xs muted' }, me?.profile?.course ? `${me.profile.course}-kurs` : 'Sozlamalar')),
        h('span', { class: 'pc-text' }, icon('right', 'sm')))));
  const searchInput = h('input', { type: 'search', name: 'q', placeholder: 'Mavzu yoki bölim qidiriş', 'aria-label': 'Qidiruv', value: route.fn === 'search' ? new URLSearchParams(loc.search).get('q') || '' : '' });
  const topbar = h('header', { class: 'topbar' },
    h('a', { class: 'm-brand', href: '/dashboard', 'aria-label': 'iMedu boş sahifa' },
      h('img', { class: 'mono', src: 'assets/imedu-mono-64.png', alt: '' }),
      h('img', { class: 'word', src: 'assets/imedu-wordmark.png?v=2', alt: 'iMedu' })),
    h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Menyuni oçiş yoki yopiş', title: 'Menyuni oçiş / yopiş', 'aria-controls': 'sidebar', onclick: onMenuBtn }, icon('menu')),
    h('form', { class: 'search', role: 'search', onsubmit: (e) => { e.preventDefault(); const q = searchInput.value.trim(); if (q) navigate(`/search?q=${encodeURIComponent(q)}`); } }, icon('search'), searchInput),
    h('div', { class: 'top-actions' },
      h('a', { class: 'icon-btn m-search', href: '/search', title: 'Qidiruv', 'aria-label': 'Qidiruv' }, icon('search')),
      h('button', { class: 'icon-btn m-menu', type: 'button', 'aria-label': 'Menyu', 'aria-haspopup': 'dialog', onclick: () => menuSheet(initials) }, icon('menu')),
      h('a', { class: 'icon-btn bell', href: '/analytics', title: 'Eslatmalar va natijalar', 'aria-label': 'Eslatmalar' }, icon('bell')),
      h('span', { class: 'lang-btn', title: 'Interfeys tili: özbekça' }, 'UZ', icon('chevDown', 'sm')),
      h('a', { class: 'user-btn', href: '/settings', title: 'Profil', 'aria-label': 'Profil va sozlamalar' }, h('span', { class: 'ini' }, initials))));
  const main = h('main', { class: 'content', id: 'main', tabindex: '-1' });
  const verify = me && !me.emailVerified ? h('div', { class: 'banner info', style: { margin: '0 0 14px' } }, icon('info', 'sm'),
    h('span', { class: 'grow' }, 'Email manzilingiz hali tasdiqlanmagan. Poçtangizdagi havolani oçing.'),
    h('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.target.disabled = true; try { await post('/api/auth/resend-verification'); toast('Tasdiqlaş xati qayta yuborildi.'); } catch (err) { toast(err.message); } } }, 'Qayta yuboriş')) : null;
  const bottom = h('nav', { class: 'bottom-nav', 'aria-label': 'Pastki menyu' }, BOTTOM.map((n) => h('a', { href: n.href, 'aria-current': n.match.test(path) ? 'page' : null }, navIcon(n), h('span', {}, n.short))));
  const back = h('div', { class: 'drawer-back hidden', id: 'sb-back', onclick: () => toggleSidebar(false) });
  // floating AI mascot; hidden where the AI is already open (assistant, lesson side panel), where the page has its own (analytics) or would distract (tests, admin)
  const fab = ['assistant', 'reader', 'admin', 'analytics'].includes(route.page) || route.fn === 'attempt' ? null : mascot(() => navigate('/assistant'));
  const app = h('div', { class: `app${sbPref() ? ` sb-${sbPref()}` : ''}` }, sidebar, back, h('div', { class: 'main' }, topbar, h('div', { style: { padding: '0 28px' }, class: 'verify-wrap' }, verify), main), bottom, fab);
  return { app, main };
}
// Desktop: the menu button collapses the sidebar to an icon rail (or expands the rail on
// mid-size screens, where the rail is the default). The choice is remembered per browser.
const sbPref = () => { try { return localStorage.getItem('ds:sidebar') || ''; } catch { return ''; } };
// Mobile menu: a bottom sheet with every page (the sidebar is hidden on phones)
function menuSheet() {
  if (document.querySelector('.sheet-back')) return;
  const prev = document.activeElement;
  const items = [...NAV, { href: '/settings', label: 'Profil' }, { href: '/settings', label: 'Sozlamalar' }];
  // lock the page behind the sheet so it doesn't scroll or jump while the menu is open
  const y = window.scrollY;
  const body = document.body.style;
  Object.assign(body, { position: 'fixed', top: `-${y}px`, left: '0', right: '0', width: '100%' });
  const unlock = (toTop) => { Object.assign(body, { position: '', top: '', left: '', right: '', width: '' }); window.scrollTo(0, toTop ? 0 : y); };
  const close = (navigated) => {
    back.classList.remove('on'); document.removeEventListener('keydown', onKey);
    if (navigated) { back.remove(); unlock(true); return; } // a new page renders: start it at the top
    setTimeout(() => { back.remove(); unlock(false); prev?.focus?.({ preventScroll: true }); }, 220);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
    h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' }, h('h2', { id: 'sheet-title' }, 'Menyu'), h('button', { class: 'sheet-x', type: 'button', 'aria-label': 'Yopiş', onclick: () => close() }, icon('x'))),
    h('nav', { class: 'sheet-list' }, items.map((n) => h('a', { href: n.href, 'aria-current': n.match?.test(loc.path) ? 'page' : null, onclick: () => close(true) }, h('span', { class: 'grow' }, n.label), icon('right')))));
  const back = h('div', { class: 'sheet-back', onclick: (e) => { if (e.target === back) close(); } }, sheet);
  document.body.appendChild(back);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => back.classList.add('on'));
  sheet.querySelector('.sheet-x').focus({ preventScroll: true });
}

function onMenuBtn() {
  const w = window.innerWidth;
  if (w <= 720) { toggleSidebar(true); return; }
  const app = document.querySelector('.app');
  if (!app) return;
  const wide = w > 1100;
  const cls = wide ? 'sb-collapsed' : 'sb-expanded';
  const on = !app.classList.contains(cls);
  app.classList.remove('sb-collapsed', 'sb-expanded');
  if (on) app.classList.add(cls);
  try { localStorage.setItem('ds:sidebar', on ? cls.slice(3) : ''); } catch { /* private mode */ }
}
function toggleSidebar(open) {
  document.getElementById('sidebar')?.classList.toggle('open', open);
  document.getElementById('sb-back')?.classList.toggle('hidden', !open);
}

let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  const root = document.getElementById('root');
  if (state.cleanup) { try { state.cleanup(); } catch { /* */ } state.cleanup = null; }
  const path = loc.path === '/' ? (state.me ? '/dashboard' : '/login') : loc.path;
  if (path !== loc.path) { if (setUrl(path, true)) return; }
  let route = null; let params = {};
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (m) { route = r; (r.keys || []).forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; }
  }
  if (!route) {
    mount(root, notFound());
    return;
  }
  if (!route.public && !state.me) { navigate(`/login?next=${encodeURIComponent(loc.path + loc.search)}`, { replace: true }); return; }
  if (route.public && state.me && ['login', 'register'].includes(route.fn)) { navigate('/dashboard', { replace: true }); return; }
  if (state.me && !state.me.profile.onboarded && route.fn !== 'onboarding' && !route.public) { navigate('/onboarding', { replace: true }); return; }
  document.title = `${route.title ? route.title + ' — ' : ''}iMedu`;
  let container;
  if (route.bare) { container = h('div', {}); mount(root, container); }
  else { const s = shell(route); mount(root, s.app); container = s.main; }
  mount(container, skeleton(5));
  const query = Object.fromEntries(new URLSearchParams(loc.search));
  try {
    const mod = await loadPage(route.page);
    if (seq !== renderSeq) return;
    const ctx = { params, query, el: container, state, navigate, setTitle: (t) => { document.title = `${t} — iMedu`; }, isCurrent: () => seq === renderSeq };
    const cleanup = await mod[route.fn](ctx);
    if (seq !== renderSeq) { if (typeof cleanup === 'function') cleanup(); return; }
    state.cleanup = typeof cleanup === 'function' ? cleanup : null;
    if (!loc.anchor) { window.scrollTo(0, 0); }
    if (!route.bare && document.activeElement === document.body) container.focus({ preventScroll: true });
  } catch (err) {
    if (seq !== renderSeq) return;
    console.error(err);
    mount(container, err.status === 404 ? notFound(err.message) : errorBox(err, () => render()));
  }
}

function notFound(msg) {
  return h('div', { class: 'card pad empty', style: { maxWidth: '560px', margin: '60px auto' } }, icon('alert'),
    h('h2', {}, 'Sahifa topilmadi'), h('p', {}, msg || 'Bunday manzil mavjud emas yoki öçirilgan.'),
    h('a', { class: 'btn primary', href: state.me ? '/dashboard' : '/login' }, 'Boş sahifaga qaytiş'));
}

export async function logout() {
  if (!(await confirmBox('Hisobdan çiqiş', 'Haqiqatan ham çiqmoqçimisiz?', 'Çiqiş'))) return;
  await post('/api/auth/logout');
  state.me = null;
  navigate('/login');
}

(async () => {
  await loadMe();
  render();
})();
