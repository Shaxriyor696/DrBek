import { h, icon, mount, toast, rid, emptyBox, confirmBox, fmtDate, inline, ring } from '../ui.js?v=mwnipjbv';
import { get, post, put } from '../api.js?v=mwnipjbv';
import { setDirty } from '../main.js?v=mwnipjbv';

const pct = (a) => (a.percent === null || a.percent === undefined ? '—' : `${a.percent}%`);

export async function practice({ el, query, navigate, state }) {
  const d = await get('/api/practice/overview');
  const withQ = d.topics.filter((t) => t.available > 0);
  let scopeType = query.lesson ? 'lesson' : 'topic';
  let scopeId = query.lesson || query.topic || withQ[0]?.id || '';
  let count = 10; let mode = 'practice';

  const scopeSel = h('select', { id: 'q-scope', 'aria-label': 'Qamrov' });
  const fillScope = () => {
    mount(scopeSel, withQ.flatMap((t) => [
      h('option', { value: `topic:${t.id}`, selected: scopeType === 'topic' && scopeId === t.id }, `${t.id} ${t.title} — butun mavzu (${t.available} savol)`),
      t.lessons.map((l) => h('option', { value: `lesson:${l.id}`, selected: scopeType === 'lesson' && scopeId === l.id }, `   · ${l.title} (${l.available})`)),
    ]));
  };
  fillScope();
  scopeSel.addEventListener('change', () => { [scopeType, scopeId] = scopeSel.value.split(':'); });
  const chipGroup = (vals, cur, set, label) => {
    const bs = vals.map(([v, l]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(v === cur), onclick: () => { set(v); bs.forEach((b, i) => b.setAttribute('aria-pressed', String(vals[i][0] === v))); } }, l));
    return h('div', { class: 'row', role: 'group', 'aria-label': label, style: { flexWrap: 'wrap' } }, bs);
  };
  let key = rid();
  const startBtn = h('button', { type: 'button', class: 'btn primary' }, icon('test'), 'Testni boşlaş');
  startBtn.addEventListener('click', async () => {
    if (!scopeId) return;
    startBtn.disabled = true;
    try {
      const r = await post('/api/quiz-attempts', { scopeType, scopeId, count, mode, clientKey: key });
      if (r.insufficient) toast(`Bankda faqat ${r.available} ta savol bor — şunça savol berildi.`);
      key = rid();
      navigate(`/practice/${r.attemptId}`);
    } catch (e) { toast(e.message); startBtn.disabled = false; }
  });

  const setup = withQ.length ? h('section', { class: 'card pad stack' },
    h('h2', { style: { margin: 0 } }, 'Yangi test'),
    h('div', { class: 'field' }, h('label', { for: 'q-scope' }, 'Mavzu yoki bölim'), scopeSel),
    h('div', { class: 'field' }, h('span', { style: { fontWeight: 700, fontSize: '14px' } }, 'Savollar soni'), chipGroup([[5, '5'], [10, '10'], [20, '20']], count, (v) => { count = v; }, 'Savollar soni')),
    h('div', { class: 'field' }, h('span', { style: { fontWeight: 700, fontSize: '14px' } }, 'Rejim'), chipGroup([['practice', 'Maşq (har savoldan keyin tekşiriş)'], ['exam', 'Imtihon (natija oxirida)']], mode, (v) => { mode = v; }, 'Rejim')),
    h('p', { class: 'xs muted', style: { margin: 0 } }, 'Testlar ixtiyoriy. Savollar kitob materialiga asoslangan va hali ekspert tekşiruvidan ötmagan.'),
    startBtn)
    : emptyBox('test', 'Test savollari hali tayyor emas', 'Savollar banki faqat tekşirilgan manbadan tuziladi. Hozirça savollar yöq.');

  const hist = d.attempts.length ? h('section', { class: 'card pad' },
    h('h2', { style: { marginTop: 0 } }, 'Urinişlar tarixi'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['Qamrov', 'Rejim', 'Natija', 'Sana', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, d.attempts.map((a) => h('tr', {},
        h('td', {}, a.scopeTitle, a.isBest ? h('span', { class: 'badge ok', style: { marginLeft: '6px' } }, 'Eng yaxşi') : null, a.isLatest && !a.isBest ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'Oxirgi') : null),
        h('td', {}, a.mode === 'exam' ? 'Imtihon' : 'Maşq'),
        h('td', {}, a.status === 'submitted' ? `${a.correct}/${a.total} · ${pct(a)}` : h('span', { class: 'badge warn' }, 'Tugallanmagan')),
        h('td', { class: 'small' }, fmtDate(a.submittedAt || a.startedAt, state.me.profile.timezone)),
        h('td', {}, h('a', { class: 'btn small', href: a.status === 'submitted' ? `/practice/${a.id}/results` : `/practice/${a.id}` }, a.status === 'submitted' ? 'Natija' : 'Davom etiş')))))))) : null;

  mount(el, h('h1', {}, 'Testlar'), h('p', { class: 'muted' }, 'Özingizni tekşiriş uçun ixtiyoriy testlar. Öqiş progressi testga boğliq emas.'),
    h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0,1fr)', gap: '18px' } }, setup, hist));
}

export async function attempt({ el, params, navigate }) {
  const d = await get(`/api/quiz-attempts/${params.attemptId}`);
  if (d.attempt.status === 'submitted') { navigate(`/practice/${params.attemptId}/results`, { replace: true }); return; }
  const A = d.attempt; const Q = d.questions;
  let i = Math.max(0, Q.findIndex((q) => !q.selected)); if (i < 0) i = 0;
  const qnav = h('div', { class: 'qnav', role: 'list', 'aria-label': 'Savollar' });
  const card = h('div', {});
  const saveState = h('span', { class: 'xs muted', 'aria-live': 'polite' });
  setDirty(null);

  const drawNav = () => mount(qnav, Q.map((q, k) => h('button', { type: 'button', role: 'listitem', class: [q.selected ? 'answered' : '', k === i ? 'current' : '', q.flagged ? 'flag' : '', q.checked ? (q.correct ? 'right' : 'wrongq') : ''].join(' '), 'aria-label': `${k + 1}-savol${q.selected ? ', javob berilgan' : ''}${q.flagged ? ', belgilangan' : ''}`, 'aria-current': k === i ? 'step' : null, onclick: () => { i = k; draw(); } }, String(k + 1))));

  async function choose(q, optId) {
    if (q.checked) return;
    const prev = q.selected; q.selected = optId; draw();
    saveState.textContent = 'Saqlanmoqda…';
    try { await put(`/api/quiz-attempts/${A.id}/answers/${q.id}`, { optionId: optId, flagged: q.flagged }); saveState.textContent = 'Javob saqlandi'; }
    catch (e) { q.selected = prev; draw(); saveState.textContent = ''; toast(e.message); }
  }
  async function flag(q) {
    q.flagged = !q.flagged; draw();
    try { await put(`/api/quiz-attempts/${A.id}/answers/${q.id}`, { flagged: q.flagged }); } catch (e) { toast(e.message); }
  }
  async function check(q) {
    try { const r = await post(`/api/quiz-attempts/${A.id}/check`, { questionId: q.id }); Object.assign(q, { checked: true, correct: r.correct, answerOptionId: r.answerOptionId, explanation: r.explanation, source: r.source }); draw(); }
    catch (e) { toast(e.message); }
  }
  async function submit() {
    const un = Q.filter((q) => !q.selected).length;
    if (!(await confirmBox('Testni yakunlaş', un ? `${un} ta savolga javob berilmagan. Ular notöğri hisoblanadi. Yakunlaysizmi?` : 'Barça savollarga javob berdingiz. Yakunlaysizmi?', 'Yakunlaş'))) return;
    try { await post(`/api/quiz-attempts/${A.id}/submit`); navigate(`/practice/${A.id}/results`, { replace: true }); } catch (e) { toast(e.message); }
  }

  function draw() {
    drawNav();
    const q = Q[i];
    const answered = Q.filter((x) => x.selected).length;
    mount(card,
      h('div', { class: 'qtop' }, h('b', {}, `Savol ${i + 1} / ${Q.length}`),
        h('div', { class: 'row', style: { gap: '8px' } }, q.unreviewed ? h('span', { class: 'badge warn' }, 'Savol tekşirilmagan') : null,
          h('button', { type: 'button', class: 'btn small', 'aria-pressed': String(q.flagged), onclick: () => flag(q) }, icon('flag', 'sm'), q.flagged ? 'Belgilangan' : 'Keyinroq'))),
      h('div', { class: 'row', style: { flexWrap: 'nowrap', margin: '12px 0 0' } }, h('div', { class: 'progress grow', role: 'progressbar', 'aria-valuenow': answered, 'aria-valuemin': 0, 'aria-valuemax': Q.length, 'aria-label': 'Javob berilgan savollar' }, h('span', { style: { width: `${(answered / Q.length) * 100}%` } })), h('b', { style: { fontSize: '20px' } }, `${Math.round((answered / Q.length) * 100)}%`)),
      h('div', { class: 'stem' }, inline(q.stem)),
      h('div', { role: 'radiogroup', 'aria-label': 'Javob variantlari' }, q.options.map((o, k) => {
        const isSel = q.selected === o.id;
        const st = q.checked ? (o.id === q.answerOptionId ? 'right' : isSel ? 'wrong' : '') : '';
        return h('label', { class: `opt ${isSel ? 'sel' : ''} ${st}` },
          h('input', { type: 'radio', name: `q-${q.id}`, value: o.id, checked: isSel, disabled: q.checked, onchange: () => choose(q, o.id) }),
          h('span', { class: 'L' }, 'ABCDEF'[k]), h('span', {}, inline(o.text)));
      })),
      q.checked ? h('div', { class: `banner ${q.correct ? 'ok' : 'danger'}`, style: { marginTop: '14px' } }, icon(q.correct ? 'checkCircle' : 'x', 'sm'), h('div', {}, h('b', {}, q.correct ? 'Töğri! ' : 'Notöğri. '), inline(q.explanation || ''),
        q.source ? h('div', { class: 'xs', style: { marginTop: '6px' } }, srcLink(q.source)) : null)) : null,
      A.mode === 'practice' && !q.checked
        ? h('button', { type: 'button', class: 'btn primary lg block', style: { marginTop: '18px' }, disabled: !q.selected, onclick: () => check(q) }, icon('check'), 'Javobni tekşiriş')
        : i < Q.length - 1 ? h('button', { type: 'button', class: 'btn primary lg block', style: { marginTop: '18px' }, onclick: () => { i++; draw(); } }, 'Keyingi savol', icon('right'))
          : h('button', { type: 'button', class: 'btn primary lg block', style: { marginTop: '18px' }, onclick: submit }, icon('flag'), 'Yakunlaş'),
      h('div', { class: 'grid g2', style: { marginTop: '12px' } },
        h('button', { type: 'button', class: 'btn', disabled: i === 0, onclick: () => { i--; draw(); } }, icon('left'), 'Oldingi'),
        h('button', { type: 'button', class: 'btn', disabled: i === Q.length - 1, onclick: () => { i++; draw(); } }, icon('pause'), 'Ötkazib turiş')));
  }

  const scopeLabel = A.scopeType === 'lesson' ? 'Bölim' : A.scopeType === 'topic' ? 'Mavzu' : 'Qamrov';
  mount(el,
    h('div', { class: 'quiz-head' },
      h('span', { class: 'qi' }, icon('test')),
      h('div', { class: 'grow' }, h('h1', { style: { margin: 0 } }, `${A.scopeTitle} böyiça test`), h('p', { class: 'muted', style: { margin: '2px 0 0', fontSize: '17px' } }, `${A.mode === 'exam' ? 'Imtihon rejimi' : 'Maşq rejimi'} · ${Q.length} savol`)),
      h('span', { class: 'pill' }, icon('cap', 'sm'), 'Ixtiyoriy test')),
    h('div', { class: 'quiz-layout' },
      h('div', {}, h('section', { class: 'card q-card', 'aria-live': 'polite' }, card)),
      h('aside', { class: 'stack', style: { gap: '18px' } },
        h('section', { class: 'card pad' }, h('h2', { style: { fontSize: '22px' } }, 'Savollar navigatsiyasi'), qnav,
          h('ul', { class: 'legend' }, h('li', {}, h('span', { class: 'sw a' }), 'Javob berilgan'), h('li', {}, h('span', { class: 'sw c' }), 'Joriy savol'), h('li', {}, h('span', { class: 'sw' }), 'Javob berilmagan'))),
        h('section', { class: 'card pad' },
          h('ul', { class: 'list info-list' },
            h('li', {}, icon('heart'), h('span', {}, h('b', {}, `${scopeLabel}: `), A.scopeTitle)),
            h('li', {}, icon('layers'), h('span', {}, h('b', {}, 'Rejim: '), A.mode === 'exam' ? 'imtihon (javoblar oxirida)' : 'maşq (har savolni tekşiriş)')),
            h('li', {}, icon('target'), h('span', {}, 'Test ixtiyoriy'))),
          h('button', { type: 'button', class: 'btn primary lg block', style: { marginTop: '16px' }, onclick: submit }, icon('flag'), 'Yakunlaş')))),
    h('div', { class: 'autosave' }, h('span', { class: 'row', style: { gap: '8px' } }, icon('cloud', 'sm'), saveState), h('span', {}, 'Manba: Guyton & Hall, 14-naşr · savollar tekşirilmagan')));
  saveState.textContent = 'Javoblar avtomatik saqlanadi';
  draw();
}

function srcLink(s) {
  if (!s) return null;
  const txt = `Manba: ${s.lessonTitle || (s.lessonId ? `${+s.lessonId.slice(2)}-bob` : '')}${s.printedPage ? `, kitob ${s.printedPage}-bet` : ''}${s.figure ? `, ${s.figure}` : ''}`;
  return s.lessonId && s.topicId ? h('a', { href: `/topics/${s.topicId}/sections/${s.lessonId}?tab=${/-f\d+$/.test(s.blockId || '') ? 'uzfull' : 'simple'}${s.blockId ? `#${s.blockId}` : ''}` }, txt) : h('span', {}, txt);
}

const MEDAL = '<svg viewBox="0 0 120 140" width="140" height="160" aria-hidden="true"><path d="M38 78 22 134l22-10 12 18 14-52Z" fill="#14989B"/><path d="M82 78l16 56-22-10-12 18-14-52Z" fill="#0B6E73"/><circle cx="60" cy="56" r="46" fill="#E9B949"/><circle cx="60" cy="56" r="37" fill="#F5D16E" stroke="#D49B21" stroke-width="3"/><path d="m60 34 7 14 15 2-11 11 3 15-14-7-14 7 3-15-11-11 15-2Z" fill="#D49B21"/></svg>';

export async function results({ el, params, navigate }) {
  const d = await get(`/api/quiz-attempts/${params.attemptId}/results`);
  const A = d.attempt;
  const c = d.items.filter((x) => x.result === 'correct').length;
  const w = d.items.filter((x) => x.result === 'wrong').length;
  const u = d.items.filter((x) => x.result === 'unanswered').length;
  const wrong = d.items.filter((x) => x.result !== 'correct');
  const topicId = d.items[0]?.source?.topicId || (A.scopeType === 'topic' ? A.scopeId : null);
  const tp = topicId ? await get(`/api/topics/${topicId}`).catch(() => null) : null;
  const vis = tp ? tp.sections.filter((s) => s.visible) : [];
  const read = vis.filter((s) => s.progress.completed).length;
  const retry = async (type, id) => {
    try { const r = await post('/api/quiz-attempts', { scopeType: type, scopeId: id, count: 10, mode: A.mode, clientKey: rid() }); navigate(`/practice/${r.attemptId}`); } catch (e) { toast(e.message); }
  };
  const mins = Math.floor(d.durationSec / 60); const secs = d.durationSec % 60;
  const p = Math.round(A.percent || 0);
  const medal = h('div', { class: 'medal-w' }); medal.innerHTML = p >= 70 ? MEDAL : '';
  const item = (x, k) => h('details', { class: 'card pad', open: k === 0 },
    h('summary', { style: { cursor: 'pointer', listStyle: 'none' } }, h('div', { class: 'row between' }, h('span', { class: 'pill' }, `Savol ${k + 1} / ${wrong.length}`), icon('chevDown')),
      h('div', { style: { fontWeight: 800, fontSize: '20px', marginTop: '8px' } }, inline(x.stem))),
    x.options.map((o) => {
      const ok = o.id === x.answerOptionId; const bad = o.id === x.selected && !ok;
      return h('div', { class: `opt-res ${ok ? 'ok' : bad ? 'bad' : ''}` }, h('input', { type: 'radio', disabled: true, checked: o.id === x.selected, 'aria-hidden': 'true' }), h('span', {}, inline(o.text)),
        ok ? h('span', { class: 'tag' }, '✓ Töğri') : bad ? h('span', { class: 'tag' }, '✗ Notöğri') : null);
    }),
    x.result === 'unanswered' ? h('p', { class: 'xs muted', style: { margin: '6px 0 0' } }, 'Bu savolga javob berilmagan.') : null,
    h('div', { class: 'banner info', style: { marginTop: '10px' } }, icon('info', 'sm'), h('div', {}, h('b', {}, 'Izoh: '), inline(x.explanation || ''), h('div', { class: 'xs', style: { marginTop: '4px' } }, srcLink({ ...x.source, lessonId: x.lessonId, lessonTitle: x.lessonTitle, topicId: x.source?.topicId })))));
  const recLessons = [...new Map(wrong.map((x) => [x.lessonId, x])).values()].slice(0, 3);
  const recs = (recLessons.length ? recLessons : d.items.slice(0, 2)).map((x) => {
    const sec = tp?.sections.find((s) => s.id === x.lessonId);
    return h('a', { class: 'rec', href: `/topics/${x.source?.topicId || topicId}/sections/${x.lessonId}` },
      h('img', { src: tp ? tp.topic.cardImage.replace(/\.webp$/, '_wide.webp') : 'assets/topics/topic_03_wide.webp', alt: '' }),
      h('div', {}, h('b', { style: { fontSize: '17px', display: 'block' } }, x.lessonTitle), h('span', { class: 'small muted' }, `${tp ? `${tp.topic.id} ${tp.topic.title} · ` : ''}${sec ? `${String(sec.order).padStart(2, '0')}-bölim` : ''}`)), icon('right'));
  });
  mount(el,
    h('div', { style: { marginBottom: '16px' } }, h('h1', { style: { margin: 0 } }, 'Natijangiz va keyingi qadam'), h('p', { class: 'sub', style: { margin: '4px 0 0' } }, `${A.scopeTitle} · ${A.mode === 'exam' ? 'Imtihon' : 'Maşq'} natijasi${A.isBest ? ' · eng yaxşi natija' : ''}`)),
    h('section', { class: 'res-hero' },
      h('div', { class: 'art' }, h('img', { src: tp?.topic.cardImage || 'assets/topics/topic_03.webp', alt: '' })),
      h('div', {}, (() => { const r = h('div', { class: 'ring-wrap', style: { width: '190px', height: '190px' } }, ring(p, 190, `${p}% töğri`), h('div', { class: 'ring-label' }, h('span', { style: { fontSize: '44px' } }, `${p}%`, h('small', {}, 'töğri javoblar')))); return r; })()),
      h('ul', {},
        h('li', {}, h('span', { class: 'dot-ic ok' }, icon('check')), h('span', {}, h('b', {}, c), ' ta töğri')),
        h('li', {}, h('span', { class: 'dot-ic bad' }, icon('x')), h('span', {}, h('b', {}, w), ' ta xato')),
        h('li', {}, h('span', { class: 'dot-ic na' }), h('span', {}, h('b', {}, u), ' ta javobsiz')),
        h('li', {}, h('span', { style: { color: 'var(--primary)' } }, icon('clock')), h('span', {}, h('b', {}, `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`), h('br'), h('span', { class: 'small muted' }, 'sarflangan vaqt')))),
      medal),
    h('section', { class: 'card two-prog' },
      h('div', {}, icon('book'), h('div', { class: 'grow' }, h('b', {}, 'Öqiş jarayoni'), h('div', { class: 'small muted' }, tp ? `${tp.topic.id} ${tp.topic.title} böyiça ${vis.length} ta bölimdan ${read} tasi öqilgan` : '—'),
        h('div', { class: 'row', style: { flexWrap: 'nowrap', marginTop: '6px' } }, h('div', { class: 'progress grow' }, h('span', { style: { width: `${vis.length ? (read / vis.length) * 100 : 0}%` } })), h('b', {}, `${read} / ${vis.length}`)))),
      h('div', {}, icon('target'), h('div', { class: 'grow' }, h('b', {}, 'Test jarayoni'), h('div', { class: 'small muted' }, `${A.total} ta savoldan ${c} tasi töğri`),
        h('div', { class: 'row', style: { flexWrap: 'nowrap', marginTop: '6px' } }, h('div', { class: 'progress grow' }, h('span', { style: { width: `${p}%` } })), h('b', {}, `${c} / ${A.total}`))))),
    h('div', { class: 'res-grid' },
      h('section', {}, h('h2', { style: { margin: '18px 0 12px', fontSize: '26px' } }, wrong.length ? 'Xatolarni tuşunib oling' : 'Barça javoblar töğri!'),
        wrong.length ? h('div', { class: 'stack' }, wrong.map(item)) : h('div', { class: 'card pad' }, h('p', { style: { margin: 0 } }, 'Ajoyib natija. Keyingi bölimga öting yoki boşqa mavzu testini yeçing.')),
        h('details', { class: 'card pad', style: { marginTop: '14px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: 800 } }, `Barça savollar (${d.items.length})`),
          h('ol', { class: 'small', style: { paddingLeft: '20px' } }, d.items.map((x) => h('li', { style: { margin: '6px 0' } }, inline(x.stem), ' — ', h('b', { style: { color: x.result === 'correct' ? 'var(--ok)' : 'var(--danger)' } }, x.result === 'correct' ? 'töğri' : x.result === 'wrong' ? 'xato' : 'javobsiz')))))),
      h('section', { class: 'card pad stack', style: { marginTop: '18px' } }, h('h2', { style: { margin: 0, fontSize: '22px' } }, 'Keyingi örganiş uçun tavsiyalar'), recs,
        h('a', { class: 'btn', href: topicId ? `/topics/${topicId}` : '/topics', style: { borderColor: 'var(--primary)', color: 'var(--primary)' } }, icon('book'), 'Bölimga qaytiş'),
        d.history.length > 1 ? h('div', { class: 'small' }, h('b', {}, 'Urinishlar: '), d.history.slice(0, 5).map((x, k) => [k ? ', ' : '', h('a', { href: `/practice/${x.id}/results` }, `${Math.round(x.percent)}%`)])) : null)),
    h('section', { class: 'card res-foot' },
      h('a', { href: topicId ? `/topics/${topicId}` : '/practice', class: 'row', style: { fontWeight: 800, textDecoration: 'none', gap: '8px' } }, icon('left'), tp ? `${tp.topic.title} mavzusiga qaytiş` : 'Testlarga qaytiş'),
      h('div', { class: 'row' },
        wrong.length ? h('button', { type: 'button', class: 'btn', style: { borderColor: 'var(--text)' }, onclick: () => retry('mistakes', A.id) }, icon('refresh'), 'Xatolarni qayta yeçiş') : null,
        A.scopeType !== 'mistakes' ? h('button', { type: 'button', class: 'btn primary', onclick: () => retry(A.scopeType, A.scopeId) }, icon('refresh'), 'Yangi uriniş') : null)));
}
