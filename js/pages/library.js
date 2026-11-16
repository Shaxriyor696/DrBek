import { h, icon, mount, emptyBox } from '../ui.js';
import { get } from '../api.js';
import { bookmarkButton, openFigure } from '../common.js';

const authorsShort = (a) => (a.length > 2 ? `${a.slice(0, 2).join(', ')} va boshq.` : a.join(', '));
const coverOf = (b, cls = 'book-cover') => (b.coverUrl
  ? h('img', { class: cls, src: b.coverUrl, alt: `${b.title} muqovasi`, loading: 'lazy' })
  : h('div', { class: `${cls} cover-ph` }, h('b', {}, b.title), h('span', {}, b.edition)));
// a book opens as its PDF (new tab) when the file is on the server; the Guyton book also has its own table of contents
const openBtn = (b, big = false) => (b.pdfUrl
  ? h('a', { class: `btn primary${big ? ' lg' : ''}`, href: b.pdfUrl, target: '_blank', rel: 'noopener' }, icon('book', big ? undefined : 'sm'), 'O’qish')
  : b.linked ? h('a', { class: `btn primary${big ? ' lg' : ''}`, href: `/library/${b.id}` }, icon('play', big ? undefined : 'sm'), 'Mundarija')
    : h('span', { class: 'btn', 'aria-disabled': 'true' }, 'PDF yo’q'));

export async function library({ el }) {
  const { books, fields } = await get('/api/shelf');
  let sel = books.find((b) => b.field !== 'Fiziologiya')?.id || books[0]?.id; let q = ''; let ff = '';
  const grid = h('div', { class: 'grid g3 book-grid' });
  const side = h('aside', { class: 'card pad stack book-side', style: { gap: '12px' } });
  function drawSide() {
    const b = books.find((x) => x.id === sel);
    if (!b) { mount(side); return; }
    mount(side, h('h2', { style: { margin: 0, fontSize: '22px' } }, 'Tanlangan kitob'),
      coverOf(b, 'side-cover'),
      h('div', {}, h('b', { style: { fontSize: '19px', lineHeight: 1.3, display: 'block' } }, b.title), h('div', { class: 'small muted', style: { marginTop: '4px' } }, b.description)),
      openBtn(b, true),
      b.linked && b.pdfUrl ? h('a', { class: 'btn', href: `/library/${b.id}` }, icon('layers', 'sm'), 'Mundarija va mavzular') : null,
      h('ul', { class: 'list info-list', style: { fontSize: '15px' } },
        h('li', {}, icon('user'), h('span', {}, h('b', {}, 'Mualliflar: '), b.authors.join(', '))),
        h('li', {}, icon('layers'), h('span', {}, h('b', {}, 'Nashr: '), `${b.edition} · ${b.publisher}`)),
        h('li', {}, icon('file'), h('span', {}, h('b', {}, 'Hajmi: '), `${b.pages.toLocaleString('ru-RU')} bet`)),
        h('li', {}, icon('globe'), h('span', {}, h('b', {}, 'Til: '), b.language)),
        h('li', {}, icon('book'), h('span', {}, h('b', {}, 'Soha: '), b.field))),
      b.pdfUrl ? null : h('p', { class: 'xs muted', style: { margin: 0 } }, 'Bu kitobning PDF fayli serverga ulanmagan.'));
  }
  function draw() {
    const nq = q.toLowerCase();
    const list = books.filter((b) => (!ff || b.field === ff) && (!nq || `${b.title} ${b.authors.join(' ')} ${b.publisher} ${b.field}`.toLowerCase().includes(nq)));
    mount(grid, list.length ? list.map((b) => h('article', { class: `card book-card${b.id === sel ? ' sel' : ''}` },
      h('button', { type: 'button', class: 'cover-btn', 'aria-label': `${b.title}: batafsil`, onclick: () => { sel = b.id; draw(); drawSide(); } }, coverOf(b)),
      h('div', { class: 'body' },
        h('span', { class: 'pill field-pill' }, b.field),
        h('h3', {}, h('button', { type: 'button', class: 'title-btn', onclick: () => { sel = b.id; draw(); drawSide(); } }, b.title)),
        h('div', { class: 'row small muted', style: { gap: '6px', flexWrap: 'nowrap' } }, icon('user', 'sm'), h('span', { class: 'grow ellipsis' }, authorsShort(b.authors))),
        h('div', { class: 'row small', style: { gap: '8px' } }, h('b', {}, b.edition), h('span', { class: 'muted' }, `· ${b.pages.toLocaleString('ru-RU')} bet · ${b.language}`)),
        h('div', { class: 'acts' }, bookmarkButton({ targetType: 'book', targetId: b.id, title: b.title }, b.saved), openBtn(b)))))
      : emptyBox('search', 'Mos kitob topilmadi', null));
  }
  let st;
  mount(el,
    h('div', { class: 'title-row' }, h('div', {}, h('h1', {}, 'Kutubxona'), h('p', { class: 'sub' }, `Tibbiyot kitoblari: ${books.length} ta kitob. Muqovani bosing — batafsil, “O’qish” — kitobni ochadi.`))),
    h('div', { class: 'row', style: { marginBottom: '16px' } },
      h('div', { class: 'grow', style: { position: 'relative', minWidth: '220px' } }, h('span', { style: { position: 'absolute', left: '14px', top: '13px', color: 'var(--text-2)' } }, icon('search')),
        h('input', { type: 'search', class: 'big-search', placeholder: 'Kitob yoki muallif bo’yicha qidirish…', 'aria-label': 'Kutubxonada qidirish', oninput: (e) => { clearTimeout(st); st = setTimeout(() => { q = e.target.value.trim(); draw(); }, 150); } })),
      h('select', { class: 'lang-btn', style: { boxShadow: 'none', fontWeight: 700 }, 'aria-label': 'Soha', onchange: (e) => { ff = e.target.value; draw(); } }, h('option', { value: '' }, 'Barcha sohalar'), fields.map((f) => h('option', { value: f }, f)))),
    h('div', { class: 'lib-layout' }, grid, side));
  draw(); drawSide();
}

export async function book({ el, params, setTitle }) {
  const [{ books }, shelf] = await Promise.all([get('/api/library'), get('/api/shelf')]);
  const b = books.find((x) => x.id === params.bookId);
  if (!b) {
    const sb = shelf.books.find((x) => x.id === params.bookId);
    if (!sb) { mount(el, emptyBox('book', 'Kitob topilmadi', null)); return; }
    setTitle(sb.title);
    mount(el, h('nav', { class: 'crumbs' }, h('a', { href: '/library' }, 'Kutubxona'), icon('right', 'sm'), h('span', {}, sb.title)),
      h('div', { class: 'card pad book-detail' }, coverOf(sb, 'side-cover'),
        h('div', { class: 'stack', style: { gap: '10px' } }, h('span', { class: 'pill field-pill', style: { alignSelf: 'flex-start' } }, sb.field), h('h1', { style: { margin: 0 } }, sb.title),
          h('p', { class: 'muted', style: { margin: 0 } }, `${sb.edition} · ${sb.publisher} · ${sb.pages.toLocaleString('ru-RU')} bet`),
          h('p', { style: { margin: 0 } }, h('b', {}, 'Mualliflar: '), sb.authors.join(', ')), h('p', { style: { margin: 0 } }, sb.description),
          h('div', { class: 'row' }, openBtn(sb, true), bookmarkButton({ targetType: 'book', targetId: sb.id, title: sb.title }, sb.saved)))));
    return;
  }
  setTitle(b.title);
  mount(el, h('nav', { class: 'crumbs' }, h('a', { href: '/library' }, 'Kutubxona'), icon('right', 'sm'), h('span', {}, b.title)),
    h('h1', {}, b.title), h('p', { class: 'muted' }, `${b.edition} · ${b.authors.join(', ')}`),
    b.topics.map((t) => h('section', { class: 'card pad', id: `u-${t.id}`, style: { marginBottom: '14px' } },
      h('h2', { style: { marginTop: 0, fontSize: '18px' } }, `${t.unit}-qism: ${t.unitTitle} → `, h('a', { href: `/topics/${t.id}` }, `${t.id} ${t.title}`)),
      h('ul', { class: 'list' }, t.chapters.map((c) => h('li', { class: 'row between small', style: { padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' } },
        h('a', { href: `/topics/${t.id}/sections/${c.id}` }, `${c.id.replace('ch', '')}. ${c.titleUz}`, h('span', { class: 'muted' }, ` (${c.titleOriginal})`)),
        b.pdfAvailable ? h('a', { href: `/source-pdf/${b.id}#page=${c.pdfPages[0]}`, target: '_blank', rel: 'noopener', class: 'xs' }, `${c.printedPages[0]}–${c.printedPages[1]}-betlar`) : h('span', { class: 'xs muted' }, `${c.printedPages[0]}–${c.printedPages[1]}-betlar`)))))));
}

const TYPES = [['', 'Hammasi'], ['lesson', 'Bo’limlar'], ['text', 'Matn'], ['term', 'Atamalar'], ['figure', 'Rasmlar']];
export async function search({ el, query, navigate }) {
  const q = (query.q || '').trim();
  const type = query.type || '';
  const page = +query.page || 1;
  if (!q) { mount(el, h('h1', {}, 'Qidiruv'), emptyBox('search', 'Qidiruv so’zini kiriting', 'Yuqoridagi qidiruv maydonidan foydalaning.')); return; }
  const r = await get(`/api/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}&page=${page}`);
  const go = (p) => navigate(`/search?${new URLSearchParams({ q, ...(p.type ?? type ? { type: p.type ?? type } : {}), ...(p.page ? { page: p.page } : {}) })}`);
  const link = (x) => {
    if (x.type === 'figure') return h('button', { type: 'button', class: 'figref', style: { fontWeight: 800, textAlign: 'left' }, onclick: () => openFigure(x.id.replace('figure:', '')) }, x.title);
    if (x.type === 'topic') return h('a', { href: `/topics/${x.topicId}`, style: { fontWeight: 800 } }, x.title);
    if (x.lessonId) return h('a', { href: `/topics/${x.topicId}/sections/${x.lessonId}?tab=${x.lang === 'en' ? 'full' : 'simple'}${x.blockId ? `#${x.blockId}` : ''}`, style: { fontWeight: 800 } }, x.title);
    return h('b', {}, x.title);
  };
  mount(el, h('h1', {}, `“${q}” bo’yicha natijalar`), h('p', { class: 'muted small' }, `${r.total} ta natija`),
    h('div', { class: 'row', style: { flexWrap: 'wrap', marginBottom: '14px' } }, TYPES.map(([k, l]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(k === type), onclick: () => go({ type: k }) }, l))),
    r.results.length ? h('div', { class: 'stack' }, r.results.map((x) => h('article', { class: 'card pad', style: { padding: '14px' } },
      h('div', { class: 'row', style: { gap: '6px', marginBottom: '4px', flexWrap: 'wrap' } }, h('span', { class: 'badge' }, x.badge || x.type), x.lang === 'en' ? h('span', { class: 'badge gray' }, 'EN') : null, x.lessonTitle ? h('span', { class: 'xs muted' }, x.lessonTitle) : null),
      link(x), x.snippet ? h('p', { class: 'small', style: { margin: '6px 0 0' } }, x.snippet.replace(/\*\*/g, '')) : null)))
      : emptyBox('search', 'Hech narsa topilmadi', 'Boshqa so’z bilan yoki inglizcha atama bilan qidirib ko’ring.'),
    r.pages > 1 ? h('div', { class: 'row between', style: { marginTop: '16px' } },
      page > 1 ? h('button', { type: 'button', class: 'btn', onclick: () => go({ page: page - 1 }) }, icon('left'), 'Oldingi') : h('span'), h('span', { class: 'small' }, `${page} / ${r.pages}`),
      page < r.pages ? h('button', { type: 'button', class: 'btn', onclick: () => go({ page: page + 1 }) }, 'Keyingi', icon('right')) : h('span')) : null);
}
