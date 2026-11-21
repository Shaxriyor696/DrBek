import { h, icon, mount, fmtMin } from '../ui.js';
import { get } from '../api.js';
import { ringBox, kpi, bar } from './home.js';

const RANGES = [['day', 'Kunlik'], ['week', 'Haftalik'], ['month', 'Oylik']];
const MON = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
const MONTHS_L = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const WD = ['Du', 'Se', 'Ç', 'Pa', 'Ju', 'Şa', 'Ya'];
const WD_FULL = ['Duşanba', 'Seşanba', 'Çorşanba', 'Payşanba', 'Juma', 'Şanba', 'Yakşanba'];
const wdIdx = (key) => (new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7;
const dayNum = (key) => +key.slice(8, 10);
const NS = 'http://www.w3.org/2000/svg';

// "11–17 noyabr" / "28 oktabr – 3 noyabr" for a run of day keys
function spanText(first, last) {
  const m1 = +first.slice(5, 7) - 1; const m2 = +last.slice(5, 7) - 1;
  return m1 === m2 ? `${dayNum(first)}–${dayNum(last)} ${MONTHS_L[m2]}` : `${dayNum(first)} ${MONTHS_L[m1]} – ${dayNum(last)} ${MONTHS_L[m2]}`;
}

// Reading-rhythm chart: one series (minutes), so one hue. Bars have rounded data-ends on a
// flat baseline; the current bucket is solid, the rest lighter; a dashed reference line marks
// the average. Only the peak and the current bucket carry value labels; every bar has a
// hover/focus tooltip with the exact value.
function rhythmChart(rows, { labels, sub, fullLabels, currentIdx, avg }) {
  // drawn in real pixels at the container's width (redrawn on resize), so the height and the
  // text size stay fixed instead of the whole chart scaling up on wide screens
  const H = 300; const L = 36; const R = 12; const T = 26; const B = 44;
  const vals = rows.map((r) => Math.round(r.activeMinutes));
  const max = Math.max(...vals, 0);
  const step = max <= 10 ? 2 : max <= 25 ? 5 : max <= 60 ? 10 : 30;
  const vmax = Math.max(step * 4, Math.ceil((max * 1.15) / step) * step);
  const y = (v) => H - B - ((H - B - T) * v) / vmax;
  const wrap = h('div', { class: 'rh-chart' });
  const tip = h('div', { class: 'rh-tip', role: 'status', 'aria-live': 'polite' });
  const render = (W) => {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'chart rh-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Öqiş vaqti: ${rows.map((r, i) => `${fullLabels[i]} ${vals[i]} daqiqa`).join(', ')}`);
  const el = (t, a, txt, parent = svg) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (txt !== undefined) e.textContent = txt; parent.appendChild(e); return e; };
  const defs = el('defs', {});
  defs.innerHTML = '<linearGradient id="rh-soft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7FD3C8"/><stop offset="1" stop-color="#CBEDE8"/></linearGradient>'
    + '<linearGradient id="rh-now" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#159A8F"/><stop offset="1" stop-color="#0E6F69"/></linearGradient>';
  for (let v = 0; v <= vmax; v += step) {
    el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: v === 0 ? '#CFDCDA' : '#EAF1F0', 'stroke-width': 1 });
    el('text', { x: L - 8, y: y(v) + 4, 'font-size': 11.5, 'text-anchor': 'end', fill: '#7A8B93' }, v);
  }
  const n = rows.length; const bw = (W - L - R) / n; const w = Math.min(44, bw * 0.56);
  const bars = [];
  rows.forEach((r, i) => {
    const v = vals[i]; const cx = L + i * bw + bw / 2; const x = cx - w / 2; const top = y(v); const base = y(0);
    const now = i === currentIdx;
    const g = el('g', { class: `rh-col${now ? ' now' : ''}`, tabindex: 0, role: 'listitem', 'aria-label': `${fullLabels[i]}: ${v} daqiqa` });
    el('rect', { x: L + i * bw, y: T - 10, width: bw, height: H - B - T + 10, fill: 'transparent', class: 'rh-hit' }, undefined, g);
    if (v > 0) {
      const hh = Math.max(3, base - top); const rr = Math.min(6, hh / 2, w / 2); const yt = base - hh;
      el('path', { d: `M${x},${base} V${yt + rr} Q${x},${yt} ${x + rr},${yt} H${x + w - rr} Q${x + w},${yt} ${x + w},${yt + rr} V${base} Z`, fill: now ? 'url(#rh-now)' : 'url(#rh-soft)', class: 'rh-bar' }, undefined, g);
    } else {
      el('rect', { x, y: base - 3, width: w, height: 3, rx: 1.5, fill: '#DCE7E5' }, undefined, g);
    }
    if (v > 0 && (v === max || now)) el('text', { x: cx, y: top - 8, 'font-size': 13, 'font-weight': 800, 'text-anchor': 'middle', fill: '#142D4E' }, v, g);
    el('text', { x: cx, y: H - B + 20, 'font-size': 12.5, 'font-weight': now ? 800 : 600, 'text-anchor': 'middle', fill: now ? '#0E6F69' : '#536671' }, labels[i], g);
    if (sub) el('text', { x: cx, y: H - B + 36, 'font-size': 11, 'text-anchor': 'middle', fill: '#98A6AD' }, sub[i], g);
    bars.push({ g, cx, top: v > 0 ? top : y(0) - 3, v, i });
  });
  if (avg > 0) {
    const ya = y(avg);
    el('line', { x1: L, x2: W - R, y1: ya, y2: ya, stroke: '#E07A5F', 'stroke-width': 1.5, 'stroke-dasharray': '5 5' });
    const lbl = `örtaça ${avg < 10 ? Math.round(avg * 10) / 10 : Math.round(avg)} daq`;
    el('rect', { x: W - R - 104, y: ya - 21, width: 104, height: 17, rx: 8.5, fill: '#FFF1EC' });
    el('text', { x: W - R - 52, y: ya - 9, 'font-size': 11, 'font-weight': 700, 'text-anchor': 'middle', fill: '#9A3F27' }, lbl);
  }
  const show = (b) => {
    bars.forEach((o) => o.g.classList.toggle('hover', o === b));
    tip.textContent = '';
    tip.append(h('b', {}, fullLabels[b.i]), h('span', {}, b.v ? `${b.v} daqiqa öqilgan` : 'Öqilmagan'));
    const box = svg.getBoundingClientRect(); const sx = box.width / W;
    tip.style.left = `${Math.min(Math.max(b.cx * sx, 70), box.width - 70)}px`;
    tip.style.top = `${Math.max(0, b.top * sx - 12)}px`;
    tip.classList.add('on');
  };
  const hide = () => { bars.forEach((o) => o.g.classList.remove('hover')); tip.classList.remove('on'); };
  bars.forEach((b) => { b.g.addEventListener('mouseenter', () => show(b)); b.g.addEventListener('focus', () => show(b)); b.g.addEventListener('mouseleave', hide); b.g.addEventListener('blur', hide); });
  wrap.replaceChildren(svg, tip);
  };
  let lastW = 0;
  const fit = () => { const w = Math.round(wrap.clientWidth); if (w > 0 && w !== lastW) { lastW = w; render(Math.max(320, w)); } };
  render(720);
  new ResizeObserver(() => requestAnimationFrame(fit)).observe(wrap);
  return wrap;
}

// 14-day activity heatmap: sequential teal, light → dark by minutes; today is outlined.
const heatLevel = (m) => (m <= 0 ? 0 : m < 5 ? 1 : m < 15 ? 2 : m < 30 ? 3 : 4);
function heatmap(days, today) {
  return h('div', { class: 'hm' },
    h('div', { class: 'hm-grid', role: 'list' }, days.map((d) => {
      const m = Math.round(d.activeMinutes); const lv = heatLevel(m);
      return h('div', { class: `hm-cell l${lv}${d.bucket === today ? ' today' : ''}`, role: 'listitem', title: `${dayNum(d.bucket)} ${MONTHS_L[+d.bucket.slice(5, 7) - 1]}, ${WD_FULL[wdIdx(d.bucket)]}: ${m ? `${m} daqiqa` : 'öqilmagan'}` },
        h('span', { class: 'hm-wd' }, WD[wdIdx(d.bucket)]), h('b', {}, dayNum(d.bucket)));
    })),
    h('div', { class: 'hm-legend', 'aria-hidden': 'true' }, h('span', {}, 'Kam'), [0, 1, 2, 3, 4].map((l) => h('i', { class: `hm-sw l${l}` })), h('span', {}, 'Köp')));
}

const scoreCls = (v) => (v === null ? 'n' : v >= 80 ? 'g' : v >= 60 ? 'y' : 'r');
const scoreWord = (v) => (v === null ? 'test yöq' : v >= 80 ? 'a’lo' : v >= 60 ? 'yaxshi' : 'takrorlang');

export async function analytics({ el, query }) {
  let range = RANGES.some(([k]) => k === query.range) ? query.range : 'week';
  const body = h('div', { class: 'an2' });
  const spanChip = h('span', { class: 'an2-span' });
  const btns = RANGES.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === range), onclick: () => { range = k; btns.forEach((b, i) => b.setAttribute('aria-selected', String(RANGES[i][0] === k))); load(); } }, l));
  const rq = await get('/api/review-queue');

  async function load() {
    // Kunlik = last 14 days; Haftalik = this week's 7 days (vs the 7 before); Oylik = last 12 months
    const dayA = await get('/api/analytics?range=day');
    const a = range === 'month' ? await get('/api/analytics?range=month') : dayA;
    const all = a.series;
    const rows = range === 'week' ? all.slice(-7) : all;
    const prev = range === 'week' ? all.slice(0, 7) : range === 'month' ? all.slice(-2, -1) : null;
    const cur = range === 'month' ? all.slice(-1) : rows;
    const labels = rows.map((r) => (range === 'month' ? MON[+r.bucket.slice(5, 7) - 1] : WD[wdIdx(r.bucket)]));
    const sub = range === 'month' ? null : rows.map((r) => String(dayNum(r.bucket)));
    const fullLabels = rows.map((r) => (range === 'month' ? `${MONTHS_L[+r.bucket.slice(5, 7) - 1]} ${r.bucket.slice(0, 4)}` : `${WD_FULL[wdIdx(r.bucket)]}, ${dayNum(r.bucket)} ${MONTHS_L[+r.bucket.slice(5, 7) - 1]}`));
    const sumOf = (list) => list.reduce((t, r) => ({ min: t.min + r.activeMinutes, c: t.c + r.correct, q: t.q + r.questions }), { min: 0, c: 0, q: 0 });
    const sum = sumOf(range === 'month' ? cur : rows); const psum = prev ? sumOf(prev) : null;
    const acc = sum.q ? Math.round((sum.c / sum.q) * 100) : (a.allTimeAccuracy != null ? Math.round(a.allTimeAccuracy) : null);
    const delta = psum ? Math.round(sum.min - psum.min) : null;
    const activeDays = rows.filter((r) => r.activeMinutes > 0).length;
    const avg = rows.length ? rows.reduce((t, r) => t + r.activeMinutes, 0) / rows.length : 0;
    const peak = rows.reduce((b, r, i) => (r.activeMinutes > (rows[b]?.activeMinutes ?? -1) ? i : b), 0);
    const per = { day: 'sönggi 14 kun', week: 'şu hafta', month: 'şu oy' }[range];
    spanChip.textContent = '';
    spanChip.append(icon('calendar', 'sm'), range === 'month' ? `${MON[+all[0].bucket.slice(5, 7) - 1]} ${all[0].bucket.slice(0, 4)} – ${MON[+all.at(-1).bucket.slice(5, 7) - 1]} ${all.at(-1).bucket.slice(0, 4)}` : spanText(rows[0].bucket, rows.at(-1).bucket));

    const left = Math.max(0, Math.ceil(a.dailyGoal - dayA.todayMinutes));
    const topicPct = Math.round((a.topicsRead / 15) * 100);
    const lessonPct = a.lessonsTotal ? Math.round((a.lessonsRead / a.lessonsTotal) * 100) : 0;
    const shownTopics = a.topics.filter((t) => t.read > 0 || t.quizzes > 0);
    const tRows = (shownTopics.length ? shownTopics : a.topics.slice(0, 3)).slice(0, 6);

    mount(body,
      h('div', { class: 'kpi-row' },
        kpi({ img: 'topics', value: `${a.topicsRead} / 15`, label: 'asosiy mavzu öqilgan', foot: bar(topicPct) }),
        kpi({ img: 'library', value: `${a.lessonsRead} / ${a.lessonsTotal}`, label: 'içki bölim öqilgan', foot: bar(lessonPct, 'blue') }),
        kpi({ img: 'practice', value: acc === null ? '—' : `${acc}%`, label: 'test aniqligi', foot: h('span', { class: `score ${scoreCls(acc)}` }, scoreWord(acc)) }),
        kpi({ img: 'analytics', value: fmtMin(sum.min), label: `öqiş vaqti · ${per}`,
          foot: delta === null ? h('span', { class: 'kpi-note' }, `${activeDays} ta faol kun`)
            : h('span', { class: `delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}` }, delta ? icon(delta > 0 ? 'up' : 'down', 'sm') : null, delta ? `${delta > 0 ? '+' : ''}${delta} daq` : 'özgarişsiz', h('small', {}, range === 'week' ? 'ötgan haftaga nisbatan' : 'ötgan oyga nisbatan')) })),

      h('div', { class: 'an2-main' },
        h('section', { class: 'card pad an2-rhythm' },
          h('div', { class: 'an2-head' },
            h('div', {}, h('h3', {}, 'Öqiş ritmi'), h('p', { class: 'small muted' }, range === 'month' ? 'Oylar kesimida, daqiqada' : 'Kunlar kesimida faol öqiş vaqti, daqiqada')),
            h('div', { class: 'an2-pills' },
              h('span', { class: 'pill-stat' }, h('small', {}, 'Jami'), h('b', {}, fmtMin(rows.reduce((t, r) => t + r.activeMinutes, 0)))),
              h('span', { class: 'pill-stat' }, h('small', {}, range === 'month' ? 'Örtaça / oy' : 'Örtaça / kun'), h('b', {}, `${Math.round(avg)} daq`)),
              range === 'month' ? null : h('span', { class: 'pill-stat' }, h('small', {}, 'Faol kunlar'), h('b', {}, `${activeDays} / ${rows.length}`)))),
          rhythmChart(rows, { labels, sub, fullLabels, currentIdx: rows.length - 1, avg }),
          h('p', { class: 'an2-insight' }, icon('sparkles', 'sm'),
            rows[peak]?.activeMinutes > 0 ? ['Eng faol: ', h('b', {}, fullLabels[peak]), ` — ${Math.round(rows[peak].activeMinutes)} daqiqa. Kunlik maqsadingiz ${a.dailyGoal} daqiqa.`] : 'Hali öqiş vaqti yöq — birinçi darsni oçing, grafik şu yerda paydo böladi.'),
          h('p', { class: 'xs muted', style: { margin: '4px 0 0' } }, `Faqat faol öqiş vaqti hisoblanadi (2 daqiqa harakatsizlikdan keyin töxtaydi). Vaqt zonasi: ${a.timezone}.`)),

        h('div', { class: 'an2-side' },
          h('section', { class: 'card pad an2-goal' },
            h('h3', {}, icon('target', 'sm'), 'Bugungi maqsad'),
            h('div', { class: 'goal-row' },
              ringBox(dayA.goalPercent, 132, `${Math.round(dayA.todayMinutes)} / ${a.dailyGoal}`, 'daqiqa', `Bugun ${Math.round(dayA.todayMinutes)} daqiqa, maqsad ${a.dailyGoal}`),
              h('div', { class: 'goal-txt' },
                left > 0 ? [h('small', {}, 'Yana'), h('b', {}, `${left} daqiqa`), h('span', { class: 'pill' }, `${dayA.goalPercent}% bajarildi`)]
                  : [h('b', {}, 'Bajarildi!'), h('span', { class: 'pill' }, '100%')])),
            h('a', { class: 'btn primary', href: '/dashboard' }, 'Öqişni davom ettiriş', icon('right', 'sm'))),
          h('section', { class: 'card pad an2-heat' },
            h('div', { class: 'row between', style: { flexWrap: 'nowrap' } }, h('h3', {}, icon('calendar', 'sm'), '14 kunlik faollik'),
              h('span', { class: 'streak', title: 'Ketma-ket dars yoki test bilan ötgan kunlar' }, h('b', {}, a.streak ?? dayA.streak), ' kun seriya')),
            heatmap(dayA.series, dayA.today)))),

      h('div', { class: 'an2-bottom' },
        h('section', { class: 'card pad an2-topics' },
          h('h3', {}, icon('layers', 'sm'), 'Mavzular böyiça'),
          h('div', { class: 'tp-list', role: 'list' }, tRows.map((t) => {
            const pct = t.lessons ? Math.round((t.read / t.lessons) * 100) : 0;
            return h('a', { class: 'tp-row', role: 'listitem', href: `/topics/${t.id}`, 'aria-label': `${t.id} ${t.title}: ${t.read} / ${t.lessons} bölim, test ${t.quizAccuracy === null ? 'yöq' : `${t.quizAccuracy}%`}` },
              h('span', { class: 'tp-n' }, t.id),
              t.cardImage ? h('img', { class: 'tp-img', src: `${t.cardImage}?v=3`, alt: '', loading: 'lazy' }) : null,
              h('div', { class: 'tp-main' }, h('b', {}, t.title), h('div', { class: 'tp-prog' }, bar(pct), h('span', { class: 'xs muted' }, `${t.read}/${t.lessons} bölim`))),
              h('span', { class: `score ${scoreCls(t.quizAccuracy)}` }, t.quizAccuracy === null ? '—' : `${t.quizAccuracy}%`),
              icon('right', 'sm'));
          })),
          h('p', { class: 'xs muted', style: { margin: '10px 0 0' } }, shownTopics.length ? `${shownTopics.length} ta mavzuda faollik bor.` : 'Hali faollik yöq — dars öqing yoki test yeçing.')),

        h('section', { class: 'card an2-review' },
          h('a', { class: 'rv-bot-link', href: '/assistant', title: 'AI yordamçini oçiş', 'aria-label': 'AI yordamçini oçiş' }, h('img', { class: 'rv-bot', src: '/assets/ai-mascot.webp', alt: '', width: 120, height: 120 })),
          h('div', { class: 'rv-body' },
            rq.items.length
              ? [h('h3', {}, 'Takrorlaş tavsiyasi'),
                rq.items.slice(0, 3).map((it) => h('div', { class: 'rv-item' },
                  h('div', {}, h('b', {}, it.title), h('div', { class: 'small muted' }, it.reason === 'low_score' ? ['Oxirgi test: ', h('span', { class: `score ${scoreCls(it.percent)}` }, `${it.percent}%`)] : 'Siz takrorlaş uçun belgilagansiz')),
                  h('a', { class: 'btn primary small', href: `/topics/${it.topicId}/sections/${it.lessonId}` }, icon('refresh', 'sm'), 'Takrorlaş')))]
              : [h('h3', {}, 'Hozirça takrorlaş şart emas'),
                h('p', { class: 'small muted', style: { margin: '0 0 10px' } }, 'Darsda bayroqça bilan belgilagan yoki testda 70% dan past natija olgan bölimlaringiz şu yerda çiqadi.'),
                h('a', { class: 'btn primary', href: '/practice' }, icon('test', 'sm'), 'Test yeçib köriş')],
            h('p', { class: 'xs muted', style: { margin: '10px 0 0' } }, rq.rule)))));
  }

  mount(el,
    h('div', { class: 'title-row an2-title' },
      h('div', {}, h('h1', {}, 'Örganişingiz raqamlarda'), h('p', { class: 'sub' }, 'Faollik, bilim va keyingi qadamlar — bir joyda.')),
      h('div', { class: 'row', style: { gap: '10px' } }, h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Davr' }, btns), spanChip)),
    body);
  await load();
}
