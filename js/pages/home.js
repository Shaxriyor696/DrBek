import { h, icon, mount, ring, fmtMin } from '../ui.js?v=mwv0pg5k';
import { get } from '../api.js?v=mwv0pg5k';
import { topicCard } from './topics.js?v=mwv0pg5k';
import { state } from '../main.js?v=mwv0pg5k';
import { themeVars } from '../topic-theme.js?v=mwv0pg5k';

const WD = ['Du', 'Se', 'Ç', 'Pa', 'Ju', 'Şa', 'Ya'];
const greeting = () => { const hr = new Date().getHours(); return hr < 5 ? 'Xayrli tun' : hr < 11 ? 'Xayrli tong' : hr < 18 ? 'Xayrli kun' : 'Xayrli keç'; };

export function ringBox(percent, size, big, small, label) {
  return h('div', { class: 'ring-wrap', style: { width: `${size}px`, height: `${size}px` } }, ring(percent, size, label),
    h('div', { class: 'ring-label' }, h('span', {}, big, h('small', {}, small))));
}
// KPI tile with a small line icon, shared by the dashboard and the results page
const KPI_IC = { topics: 'grid', library: 'layers', practice: 'target', analytics: 'clock' };
export function kpi({ img, value, label, foot, tone = '' }) {
  return h('div', { class: `kpi ${tone}` },
    h('span', { class: 'kpi-ic', 'aria-hidden': 'true' }, icon(KPI_IC[img] || 'chart')),
    h('div', { class: 'kpi-body' }, h('div', { class: 'kpi-val' }, value), h('div', { class: 'kpi-lbl' }, label), foot));
}
export const bar = (pct, cls = '') => h('div', { class: `kpi-bar ${cls}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct }, h('i', { style: { width: `${Math.max(pct, pct > 0 ? 4 : 0)}%` } }));
export const statTile = (ic, cls, value, label) => h('div', { class: `card stat tint-${cls || 'teal'}` }, h('span', { class: `ic ${cls === 'teal' ? '' : cls}` }, icon(ic)), h('div', {}, h('b', {}, value), h('span', { class: 'muted' }, label)));

export async function dashboard({ el }) {
  const [d, t, rq] = await Promise.all([get('/api/dashboard'), get('/api/topics'), get('/api/review-queue')]);
  const s = d.stats;
  const c = d.continue && !d.continue.archived ? d.continue : null;
  const heroTopic = c ? c.topicId : '03';
  const heroImg = (c?.cardImage || 'assets/topics/topic_03.webp').replace(/\.webp$/, '_banner.webp?v=3');
  const lessonHref = c ? `/topics/${c.topicId}/sections/${c.lessonId}${c.lastBlock ? `#${c.lastBlock}` : ''}` : '/topics';
  const contCard = h('section', { class: 'cont-card hero-dark', style: themeVars(heroTopic) },
    h('img', { src: heroImg, alt: '' }),
    h('div', { class: 'txt' },
      c ? h('span', { class: 'eyebrow' }, `Öqişni davom ettiring · ${c.topicTitle}`) : null,
      h('h2', {}, c ? c.lessonTitle : 'Birinçi mavzuni tanlang'),
      c ? null : h('span', { class: 'sub' }, `15 ta mavzu · ${s.lessonsTotal} ta bölim`),
      c ? h('div', { class: 'hero-prog' }, h('b', {}, `${c.read}/${c.total} bölim`), h('div', { class: 'track', role: 'progressbar', 'aria-valuenow': c.read, 'aria-valuemin': 0, 'aria-valuemax': c.total, 'aria-label': 'Mavzu progressi' }, h('span', { style: { width: `${c.total ? Math.max(4, (c.read / c.total) * 100) : 0}%` } }))) : null,
      h('a', { class: 'btn hero-btn', href: lessonHref }, c ? 'Davom etiş' : 'Mavzularni köriş', icon('arrowRight'))));
  const left = Math.max(0, Math.ceil(s.dailyGoal - s.todayMinutes));
  // last 7 days as mini bars (today solid); older API responses without `week` just skip it
  const week = s.week || [];
  const wmax = Math.max(s.dailyGoal, ...week.map((x) => x.minutes), 1);
  const goal = h('section', { class: 'card pad dgoal' },
    h('div', { class: 'row between', style: { flexWrap: 'nowrap' } }, h('h3', {}, icon('target', 'sm'), 'Bugungi maqsad'),
      s.streak ? h('span', { class: 'streak-chip', title: 'Ketma-ket dars yoki test bilan ötgan kunlar' }, h('b', {}, s.streak), ' kun seriya') : null),
    h('div', { class: 'dgoal-body' },
      ringBox(s.goalPercent, 116, `${Math.round(s.todayMinutes)} / ${s.dailyGoal}`, 'daqiqa', `Bugun ${Math.round(s.todayMinutes)} daqiqa, maqsad ${s.dailyGoal}`),
      h('div', { class: 'dgoal-txt' }, left > 0 ? [h('small', {}, 'Yana'), h('b', {}, `${left} daqiqa`), h('span', { class: 'xs muted' }, 'kunlik maqsadgaça')] : [h('b', {}, 'Bajarildi!'), h('span', { class: 'xs muted' }, 'Bugungi maqsad yopildi')])),
    week.length ? h('div', { class: 'mini-week', role: 'img', 'aria-label': `Oxirgi 7 kun: ${week.map((x) => `${WD[(new Date(`${x.day}T12:00:00Z`).getUTCDay() + 6) % 7]} ${Math.round(x.minutes)} daqiqa`).join(', ')}` },
      week.map((x, i) => h('div', { class: `mw-col${i === week.length - 1 ? ' now' : ''}`, title: `${x.day}: ${Math.round(x.minutes)} daqiqa` },
        h('div', { class: 'mw-track' }, h('i', { style: { height: `${x.minutes > 0 ? Math.max(8, (x.minutes / wmax) * 100) : 0}%` } })),
        h('span', {}, WD[(new Date(`${x.day}T12:00:00Z`).getUTCDay() + 6) % 7])))) : null);
  // phone layout: a slim goal card and a "next step" list instead of the ring / coverage / KPI tiles
  const gp = Math.min(100, Math.round(s.goalPercent || 0));
  const mGoal = h('section', { class: 'card m-goal m-only' },
    h('div', { class: 'row between' }, h('b', {}, 'Bugungi maqsad'), h('b', {}, `${Math.round(s.todayMinutes)} / ${s.dailyGoal} daq`)),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': gp, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Bugungi maqsad' }, h('span', { style: { width: `${gp ? Math.max(gp, 3) : 0}%` } })),
    h('span', { class: 'small muted' }, left > 0 ? `${left} daqiqa qoldi · ${gp}%` : 'Bugungi maqsad bajarildi'));
  const step = (ic, title, sub, href) => h('a', { class: 'step-row', href }, h('span', { class: 'step-ic' }, icon(ic)), h('span', { class: 'grow' }, h('b', {}, title), h('span', {}, sub)), icon('right'));
  const steps = h('section', { class: 'm-only m-steps' },
    h('h2', {}, 'Keyingi qadam'),
    step('test', 'Mavzudan test', c ? `${c.topicTitle} · test` : 'Avval mavzu tanlang', c ? `/practice?topic=${c.topicId}` : '/practice'),
    step('chart', 'Natijalar', 'Öqiş ritmi va faollik', '/analytics'),
    step('refresh', 'Takrorlaş', `${rq.items.length} ta bölim`, rq.items[0] ? `/topics/${rq.items[0].topicId}/sections/${rq.items[0].lessonId}` : '/analytics'));
  const covPct = Math.round((s.topicsRead / 15) * 100);
  const lessPct = s.lessonsTotal ? Math.round((s.lessonsRead / s.lessonsTotal) * 100) : 0;
  const cov = h('section', { class: 'card pad dcov' },
    h('div', { class: 'row between', style: { flexWrap: 'nowrap' } }, h('h3', {}, icon('layers', 'sm'), '15 mavzu qamrovi'), h('b', { class: 'dcov-pct' }, `${covPct}%`)),
    h('div', { class: 'topic-dots', role: 'list', 'aria-label': 'Mavzular holati' }, t.topics.map((tp) => {
      const st = tp.lessonsTotal && tp.lessonsRead >= tp.lessonsTotal ? 'done' : tp.lessonsRead > 0 ? 'part' : '';
      return h('a', { class: `tdot ${st}`, role: 'listitem', href: `/topics/${tp.id}`, title: `${tp.id} ${tp.title}: ${tp.lessonsRead || 0}/${tp.lessonsTotal} bölim` }, tp.id);
    })),
    h('div', { class: 'dcov-meta' },
      h('div', {}, h('b', {}, `${s.lessonsRead} / ${s.lessonsTotal}`), h('span', { class: 'xs muted' }, ' bölim öqilgan')),
      h('div', { class: 'dcov-legend', 'aria-hidden': 'true' }, h('i', { class: 'tdot-sw done' }), 'tugagan', h('i', { class: 'tdot-sw part' }), 'boshlangan')),
    bar(lessPct),
    h('a', { class: 'dcov-link', href: '/analytics' }, 'Batafsil natijalar', icon('arrowRight', 'sm')));
  const review = rq.items.length ? h('section', { class: 'card pad', style: { marginTop: '18px' } },
    h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, 'Takrorlaş navbati'), h('span', { class: 'xs muted', title: rq.rule }, 'Siz belgilagan va past natijali bölimlar')),
    h('ul', { class: 'list' }, rq.items.slice(0, 4).map((it) => h('li', { class: 'row between', style: { padding: '10px 0', borderBottom: '1px solid var(--border)' } },
      h('a', { href: `/topics/${it.topicId}/sections/${it.lessonId}`, style: { fontWeight: 700 } }, it.title),
      h('span', { class: `badge ${it.reason === 'low_score' ? 'warn' : ''}` }, it.reason === 'low_score' ? `Oxirgi test: ${it.percent}%` : 'Siz belgilagansiz'))))) : null;
  mount(el,
    h('div', { class: 'title-row', style: { marginBottom: '14px' } },
      h('p', { class: 'm-hello m-only' }, `Salom${state.me?.profile?.name ? `, ${state.me.profile.name.split(' ')[0]}` : ''}`),
      h('div', { class: 'd-only' }, h('p', { class: 'hello' }, `${greeting()}${state.me?.profile?.name ? `, ${state.me.profile.name.split(' ')[0]}` : ''}!`), h('h1', {}, 'Fiziologiyani tizimli örganing'), h('p', { class: 'sub' }, '15 asosiy mavzu · kitob asosida · AI yordamçi bilan.')),
      t.access === 'review_preview' ? h('span', { class: 'preview-chip', title: 'Darslar kitobga asoslangan; özbekça matnlar Claude yordamida tayyorlangan va ekspert tekşiruvini kutmoqda.' }, icon('info', 'sm'), 'Oldindan köriş rejimi') : null),
    d.sample ? h('div', { class: 'banner info', style: { margin: '0 0 14px' } }, icon('info', 'sm'), h('span', {}, 'Web köriniş: grafiklar uçun 1 haftalik namuna faoliyat qöşilgan. ', h('a', { href: '/settings' }, 'Tozalaş'))) : null,
    h('div', { class: 'dash-hero' }, contCard, mGoal, goal, cov),
    steps,
    h('div', { class: 'kpi-row dash-kpis' },
      kpi({ img: 'topics', value: `${s.topicsRead} / 15`, label: 'mavzu öqilgan', foot: bar(covPct) }),
      kpi({ img: 'library', value: `${s.lessonsRead} / ${s.lessonsTotal}`, label: 'bölim öqilgan', foot: bar(lessPct, 'blue') }),
      kpi({ img: 'practice', value: s.accuracy === null ? '—' : `${Math.round(s.accuracy)}%`, label: 'test aniqligi', foot: s.accuracy === null ? h('a', { class: 'kpi-link', href: '/practice' }, 'Birinçi testni yeçing', icon('arrowRight', 'sm')) : h('span', { class: `score ${s.accuracy >= 80 ? 'g' : s.accuracy >= 60 ? 'y' : 'r'}` }, `${s.attempts} ta uriniş`) }),
      kpi({ img: 'analytics', value: fmtMin(s.todayMinutes), label: 'bugun öqilgan vaqt', foot: h('span', { class: 'kpi-note' }, s.streak ? `${s.streak} kunlik seriya` : 'Seriyani bugun boşlang') })),
    review,
    h('div', { class: 'sec-title' }, h('h2', {}, 'Asosiy mavzular'), h('a', { href: '/topics' }, 'Barça 15 mavzu', icon('arrowRight', 'sm'))),
    h('div', { class: 'grid g3' }, t.topics.slice(0, 6).map((tp) => topicCard(tp))),
    h('a', { class: 'more-bar', href: '/topics#topic-07' }, icon('eye'), '07–15 mavzularni köriş', icon('arrowRight', 'sm')));
}
