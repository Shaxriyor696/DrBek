import { h, icon, mount, ring, fmtMin } from '../ui.js';
import { get } from '../api.js';
import { topicCard } from './topics.js';

export function ringBox(percent, size, big, small, label) {
  return h('div', { class: 'ring-wrap', style: { width: `${size}px`, height: `${size}px` } }, ring(percent, size, label),
    h('div', { class: 'ring-label' }, h('span', {}, big, h('small', {}, small))));
}
export const statTile = (ic, cls, value, label) => h('div', { class: `card stat tint-${cls || 'teal'}` }, h('span', { class: `ic ${cls === 'teal' ? '' : cls}` }, icon(ic)), h('div', {}, h('b', {}, value), h('span', { class: 'muted' }, label)));

export async function dashboard({ el }) {
  const [d, t, rq] = await Promise.all([get('/api/dashboard'), get('/api/topics'), get('/api/review-queue')]);
  const s = d.stats;
  const c = d.continue && !d.continue.archived ? d.continue : null;
  const contCard = h('section', { class: 'cont-card' },
    h('img', { src: c?.cardImage || 'assets/topics/topic_03.webp', alt: '' }),
    h('div', { class: 'txt' },
      h('span', { class: 'eyebrow' }, c ? 'Davom eting:' : 'Shu yerdan boshlang:'),
      h('h2', {}, c ? c.topicTitle : 'Yurak'),
      h('span', { class: 'small', style: { fontWeight: 600 } }, c ? c.lessonTitle : 'Yurakning ritmik qo‘zg‘alishi — to‘liq o‘zbekcha tarjima bilan'),
      c ? h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('div', { class: 'progress grow', style: { background: 'rgba(255,255,255,.7)' }, role: 'progressbar', 'aria-valuenow': c.read, 'aria-valuemin': 0, 'aria-valuemax': c.total, 'aria-label': 'Mavzu progressi' }, h('span', { style: { width: `${c.total ? Math.max(4, (c.read / c.total) * 100) : 0}%` } })), h('span', { class: 'small', style: { fontWeight: 700, whiteSpace: 'nowrap' } }, `${c.read}/${c.total} bo‘lim`)) : null,
      h('a', { class: 'btn primary', style: { alignSelf: 'flex-start' }, href: c ? `/topics/${c.topicId}/sections/${c.lessonId}${c.lastBlock ? `#${c.lastBlock}` : ''}` : '/topics/03/sections/ch10?tab=uzfull' }, icon('play'), c ? 'Davom etish' : 'O‘qishni boshlash')));
  const left = Math.max(0, s.dailyGoal - s.todayMinutes);
  const goal = h('section', { class: 'card pad goal-card' },
    h('h3', { style: { margin: 0 } }, 'Bugungi maqsad'),
    h('div', { class: 'gbody' },
      ringBox(s.goalPercent, 120, `${Math.round(s.todayMinutes)} / ${s.dailyGoal}`, 'daqiqa', `Bugun ${Math.round(s.todayMinutes)} daqiqa, maqsad ${s.dailyGoal}`),
      h('div', { class: 'small', style: { lineHeight: 1.6 } }, h('span', { style: { color: 'var(--primary)' } }, icon('target')), h('br'),
        left > 0 ? ['Kunlik o‘qish maqsadingizga yana ', h('span', { class: 'tag-mini' }, `${Math.ceil(left)} daqiqa`), ' qoldi'] : 'Bugungi maqsad bajarildi!')));
  const covPct = Math.round((s.topicsRead / 15) * 100);
  const cov = h('section', { class: 'card pad stack', style: { gap: '14px' } },
    h('h3', { class: 'row', style: { margin: 0, flexWrap: 'nowrap' } }, h('span', { style: { color: 'var(--primary)' } }, icon('layers')), '15 mavzu qamrovi'),
    h('div', { class: 'progress', style: { height: '14px' }, role: 'progressbar', 'aria-valuenow': s.topicsRead, 'aria-valuemax': 15, 'aria-label': 'O‘qilgan mavzular' }, h('span', { style: { width: `${Math.max(covPct, s.lessonsRead ? 3 : 0)}%` } })),
    h('div', { class: 'row between' }, h('span', {}, `${s.topicsRead} / 15 mavzu o‘qilgan`), h('b', {}, `${covPct}%`)),
    h('span', { class: 'xs muted' }, `${s.lessonsRead} / ${s.lessonsTotal} bo‘lim “O‘qib bo‘ldim” deb belgilangan`));
  const review = rq.items.length ? h('section', { class: 'card pad', style: { marginTop: '18px' } },
    h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, 'Takrorlash navbati'), h('span', { class: 'xs muted', title: rq.rule }, 'Siz belgilagan va past natijali bo‘limlar')),
    h('ul', { class: 'list' }, rq.items.slice(0, 4).map((it) => h('li', { class: 'row between', style: { padding: '10px 0', borderBottom: '1px solid var(--border)' } },
      h('a', { href: `/topics/${it.topicId}/sections/${it.lessonId}`, style: { fontWeight: 700 } }, it.title),
      h('span', { class: `badge ${it.reason === 'low_score' ? 'warn' : ''}` }, it.reason === 'low_score' ? `Oxirgi test: ${it.percent}%` : 'Siz belgilagansiz'))))) : null;
  mount(el,
    h('div', { class: 'title-row', style: { marginBottom: '14px' } },
      h('div', {}, h('h1', {}, 'Fiziologiyani tizimli o‘rganing'), h('p', { class: 'sub' }, '15 asosiy mavzu. Bir joyda.')),
      t.access === 'review_preview' ? h('span', { class: 'preview-chip', title: 'Darslar kitobga asoslangan; o‘zbekcha matnlar Claude yordamida tayyorlangan va ekspert tekshiruvini kutmoqda.' }, icon('info', 'sm'), 'Oldindan ko‘rish rejimi') : null),
    d.sample ? h('div', { class: 'banner info', style: { margin: '0 0 14px' } }, icon('info', 'sm'), h('span', {}, 'Web ko‘rinish: grafiklar uchun 1 haftalik namuna faoliyat qo‘shilgan. ', h('a', { href: '/settings' }, 'Tozalash'))) : null,
    h('div', { class: 'dash-hero' }, contCard, goal, cov),
    h('div', { class: 'stat-row' },
      statTile('layers', 'teal', `${s.topicsRead} / 15`, 'mavzu o‘qilgan'),
      statTile('target', 'coral', s.accuracy === null ? '—' : `${Math.round(s.accuracy)}%`, s.accuracy === null ? 'test aniqligi (hali test yo‘q)' : 'test aniqligi'),
      statTile('clock', 'violet', fmtMin(s.todayMinutes), s.streak ? `bugun o‘qilgan vaqt · seriya ${s.streak} kun` : 'bugun o‘qilgan vaqt')),
    review,
    h('div', { class: 'sec-title' }, h('h2', {}, 'Asosiy mavzular'), h('a', { href: '/topics' }, 'Barcha 15 mavzu', icon('arrowRight', 'sm'))),
    h('div', { class: 'grid g3' }, t.topics.slice(0, 6).map((tp) => topicCard(tp))),
    h('a', { class: 'more-bar', href: '/topics#topic-07' }, icon('eye'), '07–15 mavzularni ko‘rish', icon('arrowRight', 'sm')));
}
