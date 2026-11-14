// App shell + client router.
import { h, icon, mount, toast, confirmBox, skeleton, errorBox } from './ui.js';
import { get, post } from './api.js';

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
  { href: '/dashboard', label: 'Bosh sahifa', icon: 'home', match: /^\/dashboard/ },
  { href: '/topics', label: '15 ta mavzu', icon: 'layers', match: /^\/topics/ },
  { href: '/library', label: 'Kutubxona', icon: 'book', match: /^\/library/ },
  { href: '/practice', label: 'Testlar', icon: 'test', match: /^\/practice/ },
  { href: '/saved', label: 'Saqlanganlar', icon: 'bookmark', match: /^\/saved/ },
  { href: '/analytics', label: 'Natijalar', icon: 'chart', match: /^\/analytics/ },
  { href: '/assistant', label: 'AI yordamchi', icon: 'sparkles', match: /^\/assistant/ },
];
const BOTTOM = [NAV[0], NAV[1], NAV[3], NAV[4], NAV[6]];

const ROUTES = [
  { re: /^\/login$/, page: 'auth', fn: 'login', public: true, bare: true },
  { re: /^\/register$/, page: 'auth', fn: 'register', public: true, bare: true },
  { re: /^\/forgot-password$/, page: 'auth', fn: 'forgot', public: true, bare: true },
  { re: /^\/reset-password$/, page: 'auth', fn: 'reset', public: true, bare: true },
  { re: /^\/verify-email$/, page: 'auth', fn: 'verify', public: true, bare: true },
  { re: /^\/onboarding$/, page: 'auth', fn: 'onboarding', bare: true },
  { re: /^\/dashboard$/, page: 'home', fn: 'dashboard', title: 'Bosh sahifa' },
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
  { re: /^\/assistant$/, page: 'assistant', fn: 'assistant', title: 'AI yordamchi' },
  { re: /^\/settings$/, page: 'settings', fn: 'settings', title: 'Sozlamalar' },
  { re: /^\/admin$/, page: 'admin', fn: 'admin', title: 'Kontent boshqaruvi' },
  { re: /^\/admin\/lessons\/(ch\d{2})$/, page: 'admin', fn: 'lesson', keys: ['lessonId'], title: 'Dars tekshiruvi' },
];

const pageCache = {};
async function loadPage(name) {
  if (!pageCache[name]) pageCache[name] = await import(`./pages/${name}.js`);
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
  if (state.dirty && !window.confirm('Saqlanmagan o‘zgarishlar bor. Sahifadan chiqasizmi?')) return;
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
  if (DEMO && url.pathname.startsWith('/source-pdf/')) { e.preventDefault(); toast('Web ko‘rinishda kitob PDF fayli ulanmagan. To‘liq ilovada kitob sahifasi ochiladi.'); return; }
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
    h('a', { class: 'brand', href: '/dashboard', 'aria-label': 'DrBek bosh sahifa' },
      h('img', { class: 'mono', src: 'assets/drbek-mono-64.png', alt: '' }),
      h('img', { class: 'word', src: 'assets/drbek-wordmark.png', alt: 'DrBek' })),
    h('nav', { class: 'nav' }, NAV.map((n) => h('a', { href: n.href, 'aria-current': n.match.test(path) ? 'page' : null, title: n.label }, icon(n.icon), h('span', {}, n.label)))),
    h('div', { class: 'side-foot stack' },
      me?.roles?.some((r) => ['admin', 'editor', 'reviewer'].includes(r)) ? h('nav', { class: 'nav' }, h('a', { href: '/admin', 'aria-current': path.startsWith('/admin') ? 'page' : null, title: 'Kontent boshqaruvi' }, icon('shield'), h('span', {}, 'Kontent boshqaruvi'))) : null,
      h('a', { class: 'profile-chip', href: '/settings', title: 'Profil va sozlamalar' }, h('span', { class: 'avatar' }, initials),
        h('span', { class: 'pc-text grow' }, h('b', { style: { display: 'block' } }, me?.profile?.name || 'Profil'), h('span', { class: 'xs muted' }, me?.profile?.course ? `${me.profile.course}-kurs` : 'Sozlamalar')),
        h('span', { class: 'pc-text' }, icon('right', 'sm')))));
  const searchInput = h('input', { type: 'search', name: 'q', placeholder: 'Mavzu yoki bo‘lim qidirish', 'aria-label': 'Qidiruv', value: route.fn === 'search' ? new URLSearchParams(loc.search).get('q') || '' : '' });
  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Menyuni ochish', 'aria-controls': 'sidebar', onclick: () => toggleSidebar(true) }, icon('menu')),
    h('form', { class: 'search', role: 'search', onsubmit: (e) => { e.preventDefault(); const q = searchInput.value.trim(); if (q) navigate(`/search?q=${encodeURIComponent(q)}`); } }, icon('search'), searchInput),
    h('div', { class: 'top-actions' },
      h('a', { class: 'icon-btn bell', href: '/analytics', title: 'Eslatmalar va natijalar', 'aria-label': 'Eslatmalar' }, icon('bell')),
      h('span', { class: 'lang-btn', title: 'Interfeys tili: o‘zbekcha' }, 'UZ', icon('chevDown', 'sm')),
      h('a', { class: 'user-btn', href: '/settings', title: 'Profil', 'aria-label': 'Profil va sozlamalar' }, icon('user'))));
  const main = h('main', { class: 'content', id: 'main', tabindex: '-1' });
  const verify = me && !me.emailVerified ? h('div', { class: 'banner info', style: { margin: '0 0 14px' } }, icon('info', 'sm'),
    h('span', { class: 'grow' }, 'Email manzilingiz hali tasdiqlanmagan. Pochtangizdagi havolani oching.'),
    h('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.target.disabled = true; try { await post('/api/auth/resend-verification'); toast('Tasdiqlash xati qayta yuborildi.'); } catch (err) { toast(err.message); } } }, 'Qayta yuborish')) : null;
  const bottom = h('nav', { class: 'bottom-nav', 'aria-label': 'Pastki menyu' }, BOTTOM.map((n) => h('a', { href: n.href, 'aria-current': n.match.test(path) ? 'page' : null }, icon(n.icon), n.label.replace('15 ta mavzu', 'Mavzular').replace('AI yordamchi', 'AI'))));
  const back = h('div', { class: 'drawer-back hidden', id: 'sb-back', onclick: () => toggleSidebar(false) });
  const app = h('div', { class: 'app' }, sidebar, back, h('div', { class: 'main' }, topbar, h('div', { style: { padding: '0 28px' }, class: 'verify-wrap' }, verify), main), bottom);
  return { app, main };
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
  document.title = `${route.title ? route.title + ' — ' : ''}DrBek`;
  let container;
  if (route.bare) { container = h('div', {}); mount(root, container); }
  else { const s = shell(route); mount(root, s.app); container = s.main; }
  mount(container, skeleton(5));
  const query = Object.fromEntries(new URLSearchParams(loc.search));
  try {
    const mod = await loadPage(route.page);
    if (seq !== renderSeq) return;
    const ctx = { params, query, el: container, state, navigate, setTitle: (t) => { document.title = `${t} — DrBek`; }, isCurrent: () => seq === renderSeq };
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
    h('h2', {}, 'Sahifa topilmadi'), h('p', {}, msg || 'Bunday manzil mavjud emas yoki o‘chirilgan.'),
    h('a', { class: 'btn primary', href: state.me ? '/dashboard' : '/login' }, 'Bosh sahifaga qaytish'));
}

export async function logout() {
  if (!(await confirmBox('Hisobdan chiqish', 'Haqiqatan ham chiqmoqchimisiz?', 'Chiqish'))) return;
  await post('/api/auth/logout');
  state.me = null;
  navigate('/login');
}

(async () => {
  await loadMe();
  render();
})();
