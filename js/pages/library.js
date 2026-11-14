import { h, icon, mount, emptyBox } from '../ui.js';
import { get } from '../api.js';
import { bookmarkButton, openFigure } from '../common.js';
import { wide } from './topics.js';

export async function library({ el }) {
  const [{ books }, { topics }] = await Promise.all([get('/api/library'), get('/api/topics')]);
  const b = books[0];
  let sel = '03'; let q = ''; let tf = '';
  const grid = h('div', { class: 'grid g3' });
  const side = h('aside', { class: 'card pad stack', style: { gap: '12px' } });
  const unitOf = (id) => b.topics.find((t) => t.id === id);
  function drawSide() {
    const t = topics.find((x) => x.id === sel); const u = unitOf(sel);
    mount(side, h('h2', { style: { margin: 0, fontSize: '24px' } }, 'Tanlangan mavzu'),
      h('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } }, h('span', { style: { color: 'var(--primary)' } }, icon('layers')), h('div', {}, h('b', { style: { fontSize: '22px' } }, `${t.id} ${t.title}`), h('div', { class: 'small muted' }, t.description))),
      h('img', { src: t.cardImage, alt: '', style: { width: '100%', borderRadius: '16px', aspectRatio: '1.5', objectFit: 'cover' } }),
      h('a', { class: 'btn primary lg', href: `/topics/${t.id}` }, icon('play'), 'Mavzuni ochish'),
      h('h3', { style: { margin: '6px 0 0' } }, 'Manba ma’lumotlari'),
      h('ul', { class: 'list info-list', style: { fontSize: '15px' } },
        h('li', {}, icon('book'), h('span', {}, h('b', {}, 'Kitob: '), b.title)),
        h('li', {}, icon('user'), h('span', {}, h('b', {}, 'Mualliflar: '), b.authors.join(', '))),
        h('li', {}, icon('layers'), h('span', {}, h('b', {}, 'Nashr: '), `${b.edition}, ${b.year}`)),
        h('li', {}, icon('globe'), h('span', {}, h('b', {}, 'Til: '), 'asl matn inglizcha; izoh va tarjima o‘zbekcha')),
        h('li', {}, icon('file'), h('span', {}, h('b', {}, 'Qism / boblar: '), `${u.unit}-qism, ${u.chapters.map((c) => +c.id.slice(2)).join(', ')}-boblar`))),
      b.pdfAvailable ? null : h('p', { class: 'xs muted', style: { margin: 0 } }, 'Kitob PDF fayli serverga ulanmagan — “Kitobda ochish” havolalari ishlamaydi.'));
  }
  function draw() {
    const nq = q.toLowerCase();
    const list = topics.filter((t) => (!tf || t.id === tf) && (!nq || `${t.title} ${unitOf(t.id).chapters.map((c) => `${c.titleUz} ${c.titleOriginal}`).join(' ')}`.toLowerCase().includes(nq)));
    mount(grid, list.length ? list.map((t) => { const u = unitOf(t.id); return h('article', { class: 'card tcard lcard', style: { outline: t.id === sel ? '2px solid var(--primary)' : null } },
      h('div', { class: 'img' }, h('img', { src: wide(t.cardImage), alt: '', loading: 'lazy' })),
      h('div', { class: 'body' },
        h('h3', {}, h('button', { type: 'button', style: { all: 'unset', cursor: 'pointer' }, onclick: () => { sel = t.id; draw(); drawSide(); } }, t.title)),
        h('div', { class: 'row small', style: { gap: '8px', flexWrap: 'nowrap' } }, icon('user', 'sm'), h('span', { class: 'grow' }, 'Guyton & Hall, 14-nashr'), h('span', { class: 'pill', style: { padding: '2px 10px' } }, 'UZ · EN')),
        h('div', { class: 'row small', style: { gap: '8px' } }, icon('layers', 'sm'), h('b', {}, `${t.id}-mavzu`), h('span', { class: 'muted' }, `· ${u.chapters.length} bob`)),
        h('div', { class: 'acts' }, bookmarkButton({ targetType: 'topic', targetId: t.id, title: `${t.id} ${t.title}` }, t.saved), h('a', { class: 'btn primary', href: `/library/${b.id}#u-${t.id}` }, icon('play', 'sm'), 'Mundarija')))); })
      : emptyBox('search', 'Mos manba topilmadi', null));
  }
  let st;
  mount(el,
    h('div', { class: 'title-row' }, h('div', {}, h('h1', {}, 'Mavzularga bog‘langan manbalar'), h('p', { class: 'sub' }, 'Fiziologiyaning 15 ta asosiy mavzusi bo‘yicha o‘quv manbalar to‘plami.'))),
    h('div', { class: 'row', style: { marginBottom: '16px' } },
      h('div', { class: 'grow', style: { position: 'relative', minWidth: '220px' } }, h('span', { style: { position: 'absolute', left: '14px', top: '13px', color: 'var(--text-2)' } }, icon('search')),
        h('input', { type: 'search', class: 'big-search', placeholder: 'Kutubxonada qidirish…', 'aria-label': 'Kutubxonada qidirish', oninput: (e) => { clearTimeout(st); st = setTimeout(() => { q = e.target.value.trim(); draw(); }, 150); } })),
      h('select', { class: 'lang-btn', style: { boxShadow: 'none', fontWeight: 700 }, 'aria-label': 'Mavzu', onchange: (e) => { tf = e.target.value; draw(); } }, h('option', { value: '' }, 'Barcha 15 mavzu'), topics.map((t) => h('option', { value: t.id }, `${t.id} ${t.title}`))),
      bookmarkButton({ targetType: 'book', targetId: b.id, title: b.title }, b.saved)),
    h('div', { class: 'lib-layout' }, grid, side),
    h('div', { class: 'more-bar', style: { justifyContent: 'flex-start', padding: '0 24px', fontSize: '20px' } }, icon('book'), 'Asl manba va sodda izohni birga o‘rganing.'));
  draw(); drawSide();
}

export async function book({ el, params, setTitle }) {
  const { books } = await get('/api/library');
  const b = books.find((x) => x.id === params.bookId);
  if (!b) { mount(el, emptyBox('book', 'Kitob topilmadi', null)); return; }
  setTitle(b.title);
  mount(el, h('nav', { class: 'crumbs' }, h('a', { href: '/library' }, 'Kutubxona'), icon('right', 'sm'), h('span', {}, b.title)),
    h('h1', {}, b.title), h('p', { class: 'muted' }, `${b.edition} · ${b.authors.join(', ')}`),
    b.topics.map((t) => h('section', { class: 'card pad', id: `u-${t.id}`, style: { marginBottom: '14px' } },
      h('h2', { style: { marginTop: 0, fontSize: '18px' } }, `${t.unit}-qism: ${t.unitTitle} → `, h('a', { href: `/topics/${t.id}` }, `${t.id} ${t.title}`)),
      h('ul', { class: 'list' }, t.chapters.map((c) => h('li', { class: 'row between small', style: { padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' } },
        h('a', { href: `/topics/${t.id}/sections/${c.id}` }, `${c.id.replace('ch', '')}. ${c.titleUz}`, h('span', { class: 'muted' }, ` (${c.titleOriginal})`)),
        b.pdfAvailable ? h('a', { href: `/source-pdf/${b.id}#page=${c.pdfPages[0]}`, target: '_blank', rel: 'noopener', class: 'xs' }, `${c.printedPages[0]}–${c.printedPages[1]}-betlar`) : h('span', { class: 'xs muted' }, `${c.printedPages[0]}–${c.printedPages[1]}-betlar`)))))));
}

const TYPES = [['', 'Hammasi'], ['lesson', 'Bo‘limlar'], ['text', 'Matn'], ['term', 'Atamalar'], ['figure', 'Rasmlar']];
export async function search({ el, query, navigate }) {
  const q = (query.q || '').trim();
  const type = query.type || '';
  const page = +query.page || 1;
  if (!q) { mount(el, h('h1', {}, 'Qidiruv'), emptyBox('search', 'Qidiruv so‘zini kiriting', 'Yuqoridagi qidiruv maydonidan foydalaning.')); return; }
  const r = await get(`/api/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}&page=${page}`);
  const go = (p) => navigate(`/search?${new URLSearchParams({ q, ...(p.type ?? type ? { type: p.type ?? type } : {}), ...(p.page ? { page: p.page } : {}) })}`);
  const link = (x) => {
    if (x.type === 'figure') return h('button', { type: 'button', class: 'figref', style: { fontWeight: 800, textAlign: 'left' }, onclick: () => openFigure(x.id.replace('figure:', '')) }, x.title);
    if (x.type === 'topic') return h('a', { href: `/topics/${x.topicId}`, style: { fontWeight: 800 } }, x.title);
    if (x.lessonId) return h('a', { href: `/topics/${x.topicId}/sections/${x.lessonId}?tab=${x.lang === 'en' ? 'full' : 'simple'}${x.blockId ? `#${x.blockId}` : ''}`, style: { fontWeight: 800 } }, x.title);
    return h('b', {}, x.title);
  };
  mount(el, h('h1', {}, `“${q}” bo‘yicha natijalar`), h('p', { class: 'muted small' }, `${r.total} ta natija`),
    h('div', { class: 'row', style: { flexWrap: 'wrap', marginBottom: '14px' } }, TYPES.map(([k, l]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(k === type), onclick: () => go({ type: k }) }, l))),
    r.results.length ? h('div', { class: 'stack' }, r.results.map((x) => h('article', { class: 'card pad', style: { padding: '14px' } },
      h('div', { class: 'row', style: { gap: '6px', marginBottom: '4px', flexWrap: 'wrap' } }, h('span', { class: 'badge' }, x.badge || x.type), x.lang === 'en' ? h('span', { class: 'badge gray' }, 'EN') : null, x.lessonTitle ? h('span', { class: 'xs muted' }, x.lessonTitle) : null),
      link(x), x.snippet ? h('p', { class: 'small', style: { margin: '6px 0 0' } }, x.snippet.replace(/\*\*/g, '')) : null)))
      : emptyBox('search', 'Hech narsa topilmadi', 'Boshqa so‘z bilan yoki inglizcha atama bilan qidirib ko‘ring.'),
    r.pages > 1 ? h('div', { class: 'row between', style: { marginTop: '16px' } },
      page > 1 ? h('button', { type: 'button', class: 'btn', onclick: () => go({ page: page - 1 }) }, icon('left'), 'Oldingi') : h('span'), h('span', { class: 'small' }, `${page} / ${r.pages}`),
      page < r.pages ? h('button', { type: 'button', class: 'btn', onclick: () => go({ page: page + 1 }) }, 'Keyingi', icon('right')) : h('span')) : null);
}
