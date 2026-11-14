import { h, icon, mount, fmtMin } from '../ui.js';
import { get } from '../api.js';
import { ringBox, statTile } from './home.js';

const RANGES = [['day', 'Kunlik'], ['week', 'Haftalik'], ['month', 'Oylik']];
const MON = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
const WD = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sha', 'Ya'];
const wdOf = (key) => WD[(new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7];

// Bars with a smooth line through the tops and value labels (as in the UI package).
function barLine(rows, { labels, unit = '' }) {
  const W = 680; const H = 250; const L = 34; const B = 26; const T = 22;
  const n = rows.length; const vals = rows.map((r) => Math.round(r.v));
  const vmax = Math.max(10, Math.ceil(Math.max(...vals, 1) / 10) * 10);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'chart'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', rows.map((r, i) => `${labels[i]}: ${vals[i]}${unit}`).join(', '));
  const el = (t, a, txt) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (txt !== undefined) e.textContent = txt; svg.appendChild(e); return e; };
  const defs = el('defs', {});
  defs.innerHTML = '<linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2DB6AE"/><stop offset="1" stop-color="#BFE9E3"/></linearGradient>';
  const y = (v) => H - B - ((H - B - T) * v) / vmax;
  for (let g = 0; g <= 5; g++) { const v = (vmax * g) / 5; const yy = y(v); el('line', { x1: L, x2: W - 8, y1: yy, y2: yy, stroke: '#E5EEED' }); el('text', { x: L - 8, y: yy + 4, 'font-size': 12, 'text-anchor': 'end', fill: '#536671' }, Math.round(v)); }
  const bw = (W - L - 8) / n; const pts = [];
  rows.forEach((r, i) => {
    const v = vals[i]; const x = L + i * bw + bw * 0.2; const w = bw * 0.6; const top = y(v);
    const rect = el('rect', { x, y: top, width: w, height: Math.max(0, H - B - top), rx: 6, fill: 'url(#bg1)' });
    const t = document.createElementNS(NS, 'title'); t.textContent = `${labels[i]}: ${v}${unit}`; rect.appendChild(t);
    pts.push([x + w / 2, top]);
    if (n <= 14 || i % 2 === 0) el('text', { x: x + w / 2, y: H - 6, 'font-size': 13, 'text-anchor': 'middle', fill: '#536671' }, labels[i]);
    if (v > 0 && n <= 14) el('text', { x: x + w / 2, y: top - 10, 'font-size': 13, 'font-weight': 800, 'text-anchor': 'middle', fill: '#142D4E' }, v);
  });
  if (pts.length > 1) {
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i]; const cx = (x0 + x1) / 2; d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; }
    el('path', { d, fill: 'none', stroke: '#0B6E73', 'stroke-width': 2.5 });
    pts.forEach(([px, py]) => el('circle', { cx: px, cy: py, r: 4.5, fill: '#fff', stroke: '#0B6E73', 'stroke-width': 2.5 }));
  }
  return svg;
}

function calendar(todayKey, activeDays) {
  let [y, m] = todayKey.split('-').map(Number);
  const box = h('div', {});
  const draw = () => {
    const first = new Date(Date.UTC(y, m - 1, 1)); const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'd out' }, ''));
    for (let d = 1; d <= days; d++) {
      const k = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push(h('span', { class: `d ${k === todayKey ? 'today' : activeDays.has(k) ? 'act' : ''}`, title: activeDays.has(k) ? 'O‘qilgan kun' : null }, activeDays.has(k) && k !== todayKey ? '✓' : String(d)));
    }
    mount(box,
      h('div', { class: 'row between', style: { marginBottom: '6px', flexWrap: 'nowrap' } },
        h('button', { type: 'button', class: 'icon-btn', style: { width: '34px', height: '34px', border: 0 }, 'aria-label': 'Oldingi oy', onclick: () => { m--; if (m < 1) { m = 12; y--; } draw(); } }, icon('left', 'sm')),
        h('b', {}, `${MONTHS[m - 1]} ${y}`),
        h('button', { type: 'button', class: 'icon-btn', style: { width: '34px', height: '34px', border: 0 }, 'aria-label': 'Keyingi oy', onclick: () => { m++; if (m > 12) { m = 1; y++; } draw(); } }, icon('right', 'sm'))),
      h('div', { class: 'cal' }, WD.map((d) => h('span', { class: 'dh' }, d)), cells));
  };
  draw();
  return box;
}

export async function analytics({ el, query }) {
  let range = RANGES.some(([k]) => k === query.range) ? query.range : 'week';
  const body = h('div', {});
  const btns = RANGES.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === range), onclick: () => { range = k; btns.forEach((b, i) => b.setAttribute('aria-selected', String(RANGES[i][0] === k))); load(); } }, l));
  const [rq] = await Promise.all([get('/api/review-queue')]);
  async function load() {
    // "Haftalik" = this week's 7 days; "Kunlik" = last 14 days; "Oylik" = last 12 months
    const a = await get(`/api/analytics?range=${range === 'month' ? 'month' : 'day'}`);
    let rows = a.series;
    if (range === 'week') rows = rows.slice(-7);
    const labels = rows.map((r) => (range === 'month' ? MON[+r.bucket.slice(5, 7) - 1] : range === 'week' ? wdOf(r.bucket) : `${+r.bucket.slice(8, 10)}.${r.bucket.slice(5, 7)}`));
    const sum = rows.reduce((t, r) => ({ min: t.min + r.activeMinutes, done: t.done + r.lessonsCompleted, c: t.c + r.correct, q: t.q + r.questions }), { min: 0, done: 0, c: 0, q: 0 });
    const acc = sum.q ? Math.round((sum.c / sum.q) * 100) : null;
    const per = { day: 'so‘nggi 14 kun', week: 'so‘nggi 7 kun', month: 'so‘nggi 12 oy' }[range];
    const dayRows = range === 'month' ? (await get('/api/analytics?range=day')).series : a.series;
    const active = new Set(dayRows.filter((r) => r.activeMinutes > 0 || r.lessonsCompleted > 0 || r.quizzes > 0).map((r) => r.bucket));
    const shownTopics = a.topics.filter((t) => t.read > 0 || t.quizzes > 0);
    const tRows = (shownTopics.length ? shownTopics : a.topics.slice(0, 3)).slice(0, 6);
    const sc = (v) => (v === null ? 'n' : v >= 80 ? 'g' : v >= 60 ? 'y' : 'r');
    mount(body,
      h('div', { class: 'stat-row four', style: { marginTop: 0 } },
        statTile('layers', 'teal', `${a.topicsRead} / 15`, 'asosiy mavzu o‘qilgan'),
        statTile('book', 'blue', `${a.lessonsRead} / ${a.lessonsTotal}`, 'ichki bo‘lim o‘qilgan'),
        statTile('target', 'coral', acc === null ? '—' : `${acc}%`, 'test aniqligi'),
        statTile('clock', 'violet', fmtMin(sum.min), 'o‘qish vaqti')),
      h('p', { class: 'xs muted', style: { margin: '8px 0 0' } }, `Aniqlik va o‘qish vaqti: ${per}.`),
      h('div', { class: 'an-grid' },
        h('section', { class: 'card pad' }, h('h3', { style: { margin: 0, fontSize: '21px' } }, range === 'month' ? 'Oylik o‘qish vaqti' : 'Kunlik o‘qish vaqti'), h('p', { class: 'small muted', style: { margin: '2px 0 8px' } }, `${RANGES.find((r) => r[0] === range)[1]} dinamikada, daqiqada`),
          barLine(rows.map((r) => ({ v: r.activeMinutes })), { labels, unit: ' daq' }),
          h('p', { class: 'xs muted', style: { margin: '6px 0 0' } }, `Faqat faol o‘qish vaqti hisoblanadi (2 daqiqa harakatsizlikdan keyin to‘xtaydi). Vaqt zonasi: ${a.timezone}.`)),
        h('section', { class: 'card pad' }, h('h3', { style: { margin: '0 0 10px', fontSize: '21px' } }, 'Bugungi maqsad'),
          h('div', { class: 'row', style: { flexWrap: 'wrap', alignItems: 'center', gap: '18px' } },
            ringBox(a.goalPercent, 170, `${Math.round(a.todayMinutes)} / ${a.dailyGoal}`, 'daqiqa', `Bugun ${Math.round(a.todayMinutes)} daqiqa`),
            h('div', { class: 'grow', style: { minWidth: '230px', borderLeft: '1px solid var(--border)', paddingLeft: '14px' } }, calendar(a.today, active))),
          h('p', { class: 'xs muted', style: { margin: '8px 0 0' } }, `Seriya: ${a.streak} kun · maqsadni Profil sozlamalarida o‘zgartirasiz.`))),
      h('div', { class: 'an-grid2' },
        h('section', { class: 'card pad' }, h('h3', { style: { margin: '0 0 12px', fontSize: '21px' } }, 'Asosiy mavzular kesimida'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'ttable' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Mavzu'), h('th', {}, 'Bo‘limlar'), h('th', {}, 'Test'), h('th', { 'aria-label': 'Ochish' }, ''))),
            h('tbody', {}, tRows.map((t) => h('tr', {},
              h('td', {}, h('span', { class: 'n' }, t.id), h('b', {}, t.title)),
              h('td', {}, `${t.read} / ${t.lessons}`),
              h('td', {}, h('span', { class: `score ${sc(t.quizAccuracy)}` }, t.quizAccuracy === null ? '—' : `${t.quizAccuracy}%`)),
              h('td', {}, h('a', { href: `/topics/${t.id}`, 'aria-label': `${t.title} mavzusini ochish`, style: { color: 'var(--text)' } }, icon('right')))))))),
          h('p', { class: 'xs muted', style: { margin: '10px 0 0' } }, shownTopics.length ? `${shownTopics.length} ta mavzuda faollik bor.` : 'Hali faollik yo‘q — dars o‘qing yoki test yeching.')),
        h('section', { class: 'card pad stack' }, h('h3', { style: { margin: 0, fontSize: '21px' } }, 'Takrorlash tavsiyalari'),
          rq.items.length ? rq.items.slice(0, 3).map((it) => {
            const tp = a.topics.find((t) => t.id === it.topicId);
            return h('div', { class: 'rec', style: { gridTemplateColumns: '110px 1fr auto' } },
              h('img', { src: (tp?.cardImage || '').replace(/\.webp$/, '_wide.webp'), alt: '' }),
              h('div', {}, h('b', { style: { display: 'block', fontSize: '17px' } }, it.title), h('span', { class: 'small muted' }, it.reason === 'low_score' ? `Oxirgi test: ${it.percent}%` : 'Siz takrorlash uchun belgilagansiz')),
              h('a', { class: 'btn small', href: `/topics/${it.topicId}/sections/${it.lessonId}`, style: { borderColor: 'var(--primary)', color: 'var(--primary)' } }, icon('play', 'sm'), 'Takrorlash'));
          }) : h('p', { class: 'small muted', style: { margin: 0 } }, 'Hozircha tavsiya yo‘q. Darsda bayroqcha bilan belgilagan yoki testda 70% dan past natija olgan bo‘limlaringiz shu yerda chiqadi.'),
          h('p', { class: 'xs muted', style: { margin: 0 } }, rq.rule))),
      h('div', { class: 'note-bar' }, icon('info'), 'O‘qish progressi va test natijasi alohida hisoblanadi.'));
  }
  mount(el, h('div', { class: 'title-row' },
    h('div', {}, h('h1', {}, 'O‘rganishingiz raqamlarda'), h('p', { class: 'sub' }, '15 ta asosiy mavzu bo‘yicha faoliyatingiz va natijalaringiz.')),
    h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Davr' }, btns)), body);
  await load();
}
