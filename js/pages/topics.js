import { h, icon, mount, emptyBox } from '../ui.js?v=mwkaouz8';
import { get } from '../api.js?v=mwkaouz8';
import { bookmarkButton } from '../common.js?v=mwkaouz8';
import { loc } from '../main.js?v=mwkaouz8';

export const wide = (u) => String(u || '').replace(/\.webp$/, '_wide.webp');

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
  const label = { read: 'O’qilgan', started: 'Davom etish', not_started: 'Mavzuni ochish', no_material: 'Mavzuni ochish' }[tp.state] || 'Mavzuni ochish';
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
        h('span', { class: 'xs muted' }, `${tp.lessonsRead}/${tp.lessonsTotal} bo’lim`)) : null,
      h('a', { class: `btn ${tp.state === 'read' ? 'soft' : 'primary'}`, href: `/topics/${tp.id}`, tabindex: '-1' }, icon(tp.state === 'read' ? 'checkCircle' : 'play'), label)));
}

export async function catalog({ el }) {
  const { topics, access } = await get('/api/topics');
  let q = ''; let filter = 'all';
  const grid = h('div', { class: 'grid g4' });
  const count = h('span', { class: 'small muted', 'aria-live': 'polite' });
  const draw = () => {
    const norm = (s) => s.toLowerCase().replace(/[‘’ʻʼ`']/g, "'");
    const list = topics.filter((t) => (filter === 'all' || t.state === filter || (filter === 'saved' && t.saved)) && (!q || norm(`${t.id} ${t.title} ${t.description}`).includes(norm(q))));
    count.textContent = `${list.length} ta mavzu`;
    mount(grid, list.length ? list.map(catalogCard) : emptyBox('search', 'Mos mavzu topilmadi', 'Qidiruv so’zini yoki filtrni o’zgartiring.'));
  };
  const chipDefs = [['all', 'Barchasi', null], ['started', 'Boshlangan', 'play'], ['read', 'O’qilgan', 'checkCircle'], ['saved', 'Saqlangan', 'bookmark']];
  const chips = chipDefs.map(([k, l, ic]) => {
    const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(k === filter), onclick: () => { filter = k; chips.forEach((c) => c.setAttribute('aria-pressed', String(c === b))); draw(); } }, ic ? icon(ic, 'sm') : null, l);
    return b;
  });
  const input = h('input', { type: 'search', class: 'big-search', placeholder: 'Mavzular orasidan qidirish', 'aria-label': 'Mavzularni qidirish', oninput: (e) => { q = e.target.value.trim(); draw(); } });
  mount(el,
    h('div', { class: 'title-row' },
      h('div', {}, h('h1', {}, 'Fiziologiya: 15 asosiy mavzu'), h('p', { class: 'sub' }, 'Mavzuni tanlang va ichki bo’limlar orqali chuqur o’rganing')),
      h('div', { class: 'row', role: 'group', 'aria-label': 'Filtr' }, chips)),
    h('div', { class: 'row', style: { marginBottom: '16px' } },
      h('div', { class: 'grow', style: { position: 'relative' } }, h('span', { style: { position: 'absolute', left: '14px', top: '13px', color: 'var(--text-2)' } }, icon('search')),
        input),
      count),
    access === 'review_preview' ? h('p', { class: 'preview-chip', style: { marginBottom: '14px' } }, icon('info', 'sm'), 'Oldindan ko’rish: darslar hali ekspert tekshiruvidan o’tmagan') : null,
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
    const state = s.progress.completed ? h('span', { class: 'state done' }, icon('checkCircle', 'sm'), 'O’qilgan')
      : cur || s.progress.opened ? h('span', { class: 'state go' }, icon('play', 'sm'), 'Davom etish')
        : h('span', { class: 'state todo' }, 'O’qilmagan');
    const meta = [`${s.id.replace('ch', '')}-bob`, `kitob ${s.printedPages[0]}–${s.printedPages[1]}-bet`, `~${s.estMinutes} daq`, `${s.counts.figuresIncluded} rasm`];
    if (s.translation) meta.push(`to’liq tarjima ${Math.round((s.translation.translated / s.translation.total) * 100)}%`);
    if (s.lastQuiz) meta.push(`test: ${s.lastQuiz.percent}%`);
    const inner = [h('span', { class: 'n' }, String(i + 1).padStart(2, '0')),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 't' }, s.titleUz), h('div', { class: 'meta' }, meta.join(' · '))),
      state, icon('right')];
    return s.visible ? h('a', { class: `sec-row ${cur ? 'cur' : ''}`, href: `/topics/${t.id}/sections/${s.id}` }, inner)
      : h('div', { class: 'sec-row', 'aria-disabled': 'true', style: { opacity: 0.6 } }, inner.slice(0, 2), h('span', { class: 'xs muted' }, 'Tayyorlanmoqda'), h('span'));
  };
  const has = [
    ['play', 'Tushuntirishlar', cov.summaryUz.found > 0],
    ['file', 'Asosiy atamalar', true],
    ['image', 'Rasmlar', cov.figures.included > 0],
    ['book', 'To’liq tarjima', d.sections.some((s) => s.translation)],
    ['test', 'Test', d.topicQuestionCount > 0],
    ['layers', 'Manbalar', d.books.length > 0],
  ];
  const ck = (on) => h('span', { class: `ck ${on ? 'on' : ''}`, 'aria-label': on ? 'bor' : 'hali yo’q' }, on ? icon('check') : null);

  mount(el,
    h('nav', { class: 'crumbs', 'aria-label': 'Yo’l' }, h('a', { href: '/dashboard', 'aria-label': 'Bosh sahifa' }, icon('home', 'sm')), h('span', {}, '/'), h('a', { href: '/topics' }, '15 ta mavzu'), h('span', {}, '/'), h('b', { style: { color: 'var(--text)' } }, `${t.id} ${t.title}`)),
    h('div', { class: 'topic-layout' },
      h('div', { class: 'stack', style: { gap: '18px' } },
        h('section', { class: 't-hero' },
          h('img', { src: t.cardImage, alt: '' }),
          h('div', { class: 'txt' },
            h('span', { class: 'pill', style: { alignSelf: 'flex-start' } }, `Asosiy mavzu: Fiziologiya · ${t.bookUnit.unit}-qism`),
            h('h1', {}, t.title),
            h('p', { class: 'lead' }, t.description),
            h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('div', { class: 'progress grow', style: { maxWidth: '300px', background: 'rgba(255,255,255,.7)' }, role: 'progressbar', 'aria-valuenow': done, 'aria-valuemin': 0, 'aria-valuemax': visible.length, 'aria-label': 'Mavzu progressi' }, h('span', { style: { width: `${pct}%` } })), h('span', { class: 'small', style: { fontWeight: 600 } }, `${done} / ${visible.length} bo’lim o’qilgan`)),
            h('div', { class: 'row' },
              first ? h('a', { class: 'btn primary lg', href: `/topics/${t.id}/sections/${first.id}` }, icon('play'), done || first.progress.opened ? 'Davom etish' : 'O’qishni boshlash') : null,
              bookmarkButton({ targetType: 'topic', targetId: t.id, title: `${t.id} ${t.title}` }, t.saved, 'bm')))),
        h('section', { class: 'card pad' },
          h('div', { class: 'row between', style: { marginBottom: '14px' } }, h('h2', { style: { margin: 0, fontSize: '26px' } }, 'Mavzu bo’limlari'), h('span', { class: 'pill' }, `Jami: ${d.sections.length} ta bo’lim`)),
          h('div', { class: 'sec-rows' }, d.sections.map(row)),
          h('p', { class: 'xs muted', style: { margin: '12px 0 0' } }, 'Har bir bo’lim — Guyton & Hall (14-nashr) kitobining bitta bobi: sodda izoh, to’liq matn, kitob rasmlari va atamalar.'))),
      h('aside', { class: 'stack', style: { gap: '18px' } },
        h('section', { class: 'card pad' }, h('h2', { style: { fontSize: '24px', marginBottom: '6px' } }, 'Ushbu mavzuda'),
          h('ul', { class: 'list in-topic' }, has.map(([ic, l, on]) => h('li', {}, h('span', { class: 'ic' }, icon(ic)), l, ck(on))))),
        h('section', { class: 'card pad ai-card stack' },
          h('div', { class: 'head' }, h('span', { class: 'bot' }, icon('bot')), h('div', {}, h('h3', { style: { margin: 0, fontSize: '22px' } }, 'AI yordamchi'), h('span', { class: 'muted' }, `${t.title} mavzusini sodda tushuntirib beradi`))),
          h('a', { class: 'btn primary', href: `/assistant?topic=${t.id}` }, icon('sparkles'), 'AI yordamchidan so’rash', icon('right'))),
        h('section', { class: 'card pad stack' },
          h('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } }, h('span', { class: 'ic', style: { color: 'var(--primary)' } }, icon('test')),
            h('div', {}, h('h3', { style: { margin: 0, fontSize: '22px' } }, 'Mavzu bo’yicha test'), h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, d.topicQuestionCount ? `${t.title} mavzusi bo’yicha bilimingizni tekshiring (${d.topicQuestionCount} savollik bank, 10 tadan).` : 'Bu mavzu uchun test savollari hali tayyorlanmagan. Testlar ixtiyoriy.'))),
          d.topicQuestionCount ? h('a', { class: 'btn primary', href: `/practice?topic=${t.id}` }, icon('play'), 'Testni boshlash') : h('span', { class: 'btn', 'aria-disabled': 'true' }, icon('test'), 'Test hali yo’q')),
        h('details', { class: 'card pad' },
          h('summary', { style: { cursor: 'pointer', fontWeight: 800 } }, 'Material qamrovi va manbalar'),
          h('ul', { class: 'list small stack', style: { gap: '6px', marginTop: '10px' } },
            h('li', {}, `Kitob boblari: ${cov.chapters.join(', ')}`),
            h('li', {}, `Sarlavhalar: ${cov.sourceSections.found} (kutilgan ~${cov.sourceSections.expected})`),
            h('li', {}, `Rasm va jadvallar: ${cov.figures.included}/${cov.figures.expected}`),
            h('li', {}, `O’zbekcha izoh: ${cov.summaryUz.found}/${cov.summaryUz.chapters} bob`),
            h('li', {}, `Ekspert tasdig’i: ${cov.sourceSections.published} bo’lim`),
            d.books.map((b) => h('li', {}, h('a', { href: `/library/${b.id}` }, b.title), ` — ${b.edition}`)))))),
    h('nav', { class: 'nav-cards', 'aria-label': 'Mavzular orasida' },
      d.prevTopic ? h('a', { class: 'card nav-card', href: `/topics/${d.prevTopic.id}` }, h('span', { class: 'icon-btn' }, icon('left')), h('div', {}, h('b', {}, `${d.prevTopic.id}  Oldingi mavzu`), h('span', { class: 'muted' }, d.prevTopic.title))) : h('span'),
      d.nextTopic ? h('a', { class: 'card nav-card next', href: `/topics/${d.nextTopic.id}` }, h('div', {}, h('b', {}, `${d.nextTopic.id}  ${d.nextTopic.title}`), h('span', { class: 'muted' }, 'Keyingi mavzu')), h('span', { class: 'icon-btn' }, icon('right'))) : h('span')));
}
