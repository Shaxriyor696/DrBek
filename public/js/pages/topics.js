import { h, icon, mount, emptyBox } from '../ui.js';
import { get } from '../api.js';
import { bookmarkButton } from '../common.js';
import { loc } from '../main.js';
import { normalizeSearchText as norm } from '../search-text.js';
import { themeVars } from '../topic-theme.js';

export const wide = (u) => String(u || '').replace(/\.webp$/, '_wide.webp?v=3');

// Home-page card: wide 3D cover, number | title, bookmark, chevron, small progress.
export function topicCard(tp) {
  const pct = tp.lessonsTotal ? Math.round((tp.lessonsRead / tp.lessonsTotal) * 100) : 0;
  return h('article', { class: 'card tcard', id: `topic-${tp.id}` },
    h('div', { class: 'img' }, h('img', { src: wide(tp.cardImage), alt: '', loading: 'lazy' })),
    h('div', { class: 'row1' },
      h('span', { class: 'num' }, tp.id),
      h('a', { class: 'ttl', href: `/topics/${tp.id}` }, tp.title),
      bookmarkButton({ targetType: 'topic', targetId: tp.id, title: `${tp.id} ${tp.title}` }, tp.saved, 'bm'),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('right'))),
    tp.lessonsRead ? h('div', { class: 'prog' },
      h('div', { class: 'progress grow', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `${tp.title} progressi` }, h('span', { style: { width: `${pct}%` } })),
      h('span', { class: 'xs muted' }, `${tp.lessonsRead}/${tp.lessonsTotal}`)) : null);
}

// Catalog card: cover, number + title + bookmark, description, "Mavzuni ochish".
function catalogCard(tp) {
  const label = { read: 'Öqilgan', started: 'Davom etiş', not_started: 'Mavzuni oçiş', no_material: 'Mavzuni oçiş' }[tp.state] || 'Mavzuni oçiş';
  return h('article', { class: 'card tcard cat', id: `topic-${tp.id}` },
    h('div', { class: 'img' }, h('img', { src: wide(tp.cardImage), alt: '', loading: 'lazy' })),
    h('div', { class: 'row1' },
      h('span', { class: 'num' }, tp.id),
      h('a', { class: 'ttl', href: `/topics/${tp.id}` }, tp.title),
      bookmarkButton({ targetType: 'topic', targetId: tp.id, title: `${tp.id} ${tp.title}` }, tp.saved, 'bm')),
    h('p', { class: 'desc' }, tp.description),
    h('div', { class: 'act' },
      tp.lessonsRead ? h('div', { class: 'row', style: { gap: '8px', marginBottom: '10px' } },
        h('div', { class: 'progress grow', style: { height: '6px' } }, h('span', { style: { width: `${Math.round((tp.lessonsRead / tp.lessonsTotal) * 100)}%` } })),
        h('span', { class: 'xs muted' }, `${tp.lessonsRead}/${tp.lessonsTotal} bölim`)) : null,
      h('a', { class: `btn ${tp.state === 'read' ? 'soft' : 'primary'}`, href: `/topics/${tp.id}`, tabindex: '-1' }, icon(tp.state === 'read' ? 'checkCircle' : 'book'), label)));
}

export async function catalog({ el }) {
  const { topics, access } = await get('/api/topics');
  let q = ''; let filter = 'all';
  const grid = h('div', { class: 'grid g4' });
  const count = h('span', { class: 'small muted', 'aria-live': 'polite' });
  const draw = () => {
    const list = topics.filter((t) => (filter === 'all' || t.state === filter || (filter === 'saved' && t.saved)) && (!q || norm(`${t.id} ${t.title} ${t.description}`).includes(norm(q))));
    count.textContent = `${list.length} ta mavzu`;
    mount(grid, list.length ? list.map(catalogCard) : emptyBox('search', 'Mos mavzu topilmadi', 'Qidiruv sözini yoki filtrni özgartiring.'));
  };
  const chipDefs = [['all', 'Barçasi', null], ['started', 'Boşlangan', 'book'], ['read', 'Öqilgan', 'checkCircle'], ['saved', 'Saqlangan', 'bookmark']];
  const chips = chipDefs.map(([k, l, ic]) => {
    const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(k === filter), onclick: () => { filter = k; chips.forEach((c) => c.setAttribute('aria-pressed', String(c === b))); draw(); } }, ic ? icon(ic, 'sm') : null, l);
    return b;
  });
  const input = h('input', { type: 'search', class: 'big-search', placeholder: 'Mavzular orasidan qidiriş', 'aria-label': 'Mavzularni qidiriş', oninput: (e) => { q = e.target.value.trim(); draw(); } });
  mount(el,
    h('div', { class: 'title-row' },
      h('div', {}, h('h1', {}, 'Fiziologiya: 15 asosiy mavzu'), h('p', { class: 'sub' }, 'Mavzuni tanlang va içki bölimlar orqali çuqur örganing')),
      h('div', { class: 'row', role: 'group', 'aria-label': 'Filtr' }, chips)),
    h('div', { class: 'row', style: { marginBottom: '16px' } },
      h('div', { class: 'grow', style: { position: 'relative' } }, h('span', { style: { position: 'absolute', left: '14px', top: '13px', color: 'var(--text-2)' } }, icon('search')),
        input),
      count),
    access === 'review_preview' ? h('p', { class: 'preview-chip', style: { marginBottom: '14px' } }, icon('info', 'sm'), 'Oldindan köriş: darslar hali ekspert tekşiruvidan ötmagan') : null,
    grid);
  draw();
  if (loc.anchor) document.getElementById(loc.anchor.slice(1))?.scrollIntoView({ block: 'center' });
}

export async function topic({ el, params, setTitle }) {
  const d = await get(`/api/topics/${params.topicId}`);
  const t = d.topic;
  setTitle(`${t.id} ${t.title}`);
  const visible = d.sections.filter((s) => s.visible);
  const done = visible.filter((s) => s.progress.completed).length;
  const first = visible.find((s) => !s.progress.completed) || visible[0];
  const cov = d.coverage;
  const pct = visible.length ? (done / visible.length) * 100 : 0;

  const row = (s, i) => {
    const cur = first && s.id === first.id && done > 0 && !s.progress.completed;
    const state = s.progress.completed ? h('span', { class: 'state done' }, icon('checkCircle', 'sm'), 'Öqilgan')
      : cur || s.progress.opened ? h('span', { class: 'state go' }, icon('book', 'sm'), 'Davom etiş')
        : h('span', { class: 'state todo' }, 'Öqilmagan');
    const meta = [`${s.id.replace('ch', '')}-bob`, `kitob ${s.printedPages[0]}–${s.printedPages[1]}-bet`, `~${s.estMinutes} daq`, `${s.counts.figuresIncluded} rasm`];
    if (s.translation) meta.push(`ma’lumot (UZ) ${Math.round((s.translation.translated / s.translation.total) * 100)}%`);
    if (s.lastQuiz) meta.push(`test: ${s.lastQuiz.percent}%`);
    const inner = [h('span', { class: 'n' }, String(i + 1).padStart(2, '0')),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 't' }, s.titleUz), h('div', { class: 'meta' }, meta.join(' · '))),
      state, icon('right')];
    return s.visible ? h('a', { class: `sec-row ${cur ? 'cur' : ''}`, href: `/topics/${t.id}/sections/${s.id}` }, inner)
      : h('div', { class: 'sec-row', 'aria-disabled': 'true', style: { opacity: 0.6 } }, inner.slice(0, 2), h('span', { class: 'xs muted' }, 'Tayyorlanmoqda'), h('span'));
  };
  const has = [
    ['lightbulb', 'Tuşuntirişlar', cov.summaryUz.found > 0],
    ['file', 'Asosiy atamalar', true],
    ['image', 'Rasmlar', cov.figures.included > 0],
    ['book', 'Ma’lumot (UZ)', d.sections.some((s) => s.translation)],
    ['test', 'Test', d.topicQuestionCount > 0],
    ['layers', 'Manbalar', d.books.length > 0],
  ];
  const ck = (on) => h('span', { class: `ck ${on ? 'on' : ''}`, 'aria-label': on ? 'bor' : 'hali yöq' }, on ? icon('check') : null);

  mount(el,
    h('nav', { class: 'crumbs', 'aria-label': 'Yöl' }, h('a', { href: '/dashboard', 'aria-label': 'Boş sahifa' }, icon('home', 'sm')), h('span', {}, '/'), h('a', { href: '/topics' }, '15 ta mavzu'), h('span', {}, '/'), h('b', { style: { color: 'var(--text)' } }, `${t.id} ${t.title}`)),
    h('div', { class: 'topic-layout' },
      h('div', { class: 'stack', style: { gap: '18px' } },
        h('section', { class: 't-hero hero-dark', style: themeVars(t.id) },
          h('img', { src: t.cardImage.replace(/\.webp$/, '_banner.webp?v=3'), alt: '' }),
          h('div', { class: 'txt' },
            h('span', { class: 'eyebrow' }, `Asosiy mavzu: Fiziologiya · ${t.bookUnit.unit}-qism`),
            h('h1', {}, t.title),
            h('p', { class: 'lead' }, t.description),
            h('div', { class: 'hero-prog' }, h('div', { class: 'track', role: 'progressbar', 'aria-valuenow': done, 'aria-valuemin': 0, 'aria-valuemax': visible.length, 'aria-label': 'Mavzu progressi' }, h('span', { style: { width: `${pct ? Math.max(pct, 4) : 0}%` } })), h('b', {}, `${done} / ${visible.length} bölim öqilgan`)),
            h('div', { class: 'row' },
              first ? h('a', { class: 'btn hero-btn lg', href: `/topics/${t.id}/sections/${first.id}` }, icon('play'), done || first.progress.opened ? 'Davom etiş' : 'Öqişni boşlaş') : null,
              bookmarkButton({ targetType: 'topic', targetId: t.id, title: `${t.id} ${t.title}` }, t.saved, 'bm')))),
        h('section', { class: 'card pad' },
          h('div', { class: 'row between', style: { marginBottom: '14px' } }, h('h2', { style: { margin: 0, fontSize: '26px' } }, 'Mavzu bölimlari'), h('span', { class: 'pill' }, `Jami: ${d.sections.length} ta bölim`)),
          h('div', { class: 'sec-rows' }, d.sections.map(row)),
          h('p', { class: 'xs muted', style: { margin: '12px 0 0' } }, 'Har bir bölim — Guyton & Hall (14-naşr) kitobining bitta bobi: umumiy ma’lumot, ma’lumot (UZ/EN), kitob rasmlari va atamalar.'))),
      h('aside', { class: 'stack', style: { gap: '18px' } },
        h('section', { class: 'card pad' }, h('h2', { style: { fontSize: '24px', marginBottom: '6px' } }, 'Uşbu mavzuda'),
          h('ul', { class: 'list in-topic' }, has.map(([ic, l, on]) => h('li', {}, h('span', { class: 'ic' }, icon(ic)), l, ck(on))))),
        h('section', { class: 'card pad ai-card stack' },
          h('div', { class: 'head' }, h('span', { class: 'bot' }, h('img', { src: '/assets/ai-mascot.webp', alt: '', width: 64, height: 64 })), h('div', {}, h('h3', { style: { margin: 0, fontSize: '22px' } }, 'AI yordamçi'), h('span', { class: 'muted' }, `${t.title} mavzusini sodda tuşuntirib beradi`))),
          h('a', { class: 'btn primary', href: `/assistant?topic=${t.id}` }, icon('sparkles'), 'AI yordamçidan söraş', icon('right'))),
        h('section', { class: 'card pad stack' },
          h('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } }, h('span', { class: 'ic', style: { color: 'var(--primary)' } }, icon('test')),
            h('div', {}, h('h3', { style: { margin: 0, fontSize: '22px' } }, 'Mavzu böyiça test'), h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, d.topicQuestionCount ? `${t.title} mavzusi böyiça bilimingizni tekşiring (${d.topicQuestionCount} savollik bank, 10 tadan).` : 'Bu mavzu uçun test savollari hali tayyorlanmagan. Testlar ixtiyoriy.'))),
          d.topicQuestionCount ? h('a', { class: 'btn primary', href: `/practice?topic=${t.id}` }, icon('test'), 'Testni boşlaş') : h('span', { class: 'btn', 'aria-disabled': 'true' }, icon('test'), 'Test hali yöq')),
        h('details', { class: 'card pad' },
          h('summary', { style: { cursor: 'pointer', fontWeight: 800 } }, 'Material qamrovi va manbalar'),
          h('ul', { class: 'list small stack', style: { gap: '6px', marginTop: '10px' } },
            h('li', {}, `Kitob boblari: ${cov.chapters.join(', ')}`),
            h('li', {}, `Sarlavhalar: ${cov.sourceSections.found} (kutilgan ~${cov.sourceSections.expected})`),
            h('li', {}, `Rasm va jadvallar: ${cov.figures.included}/${cov.figures.expected}`),
            h('li', {}, `Özbekça izoh: ${cov.summaryUz.found}/${cov.summaryUz.chapters} bob`),
            h('li', {}, `Ekspert tasdiği: ${cov.sourceSections.published} bölim`),
            d.books.map((b) => h('li', {}, h('a', { href: `/library/${b.id}` }, b.title), ` — ${b.edition}`)))))),
    h('nav', { class: 'nav-cards', 'aria-label': 'Mavzular orasida' },
      d.prevTopic ? h('a', { class: 'card nav-card', href: `/topics/${d.prevTopic.id}` }, h('span', { class: 'icon-btn' }, icon('left')), h('div', {}, h('b', {}, `${d.prevTopic.id}  Oldingi mavzu`), h('span', { class: 'muted' }, d.prevTopic.title))) : h('span'),
      d.nextTopic ? h('a', { class: 'card nav-card next', href: `/topics/${d.nextTopic.id}` }, h('div', {}, h('b', {}, `${d.nextTopic.id}  ${d.nextTopic.title}`), h('span', { class: 'muted' }, 'Keyingi mavzu')), h('span', { class: 'icon-btn' }, icon('right'))) : h('span')));
}
