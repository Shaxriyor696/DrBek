import { h, icon, mount, toast, inline, rid, emptyBox, fmtDate, uiZoom } from '../ui.js?v=mwqeam7z';
import { get, post, patch, del } from '../api.js?v=mwqeam7z';
import { bookmarkButton, openFigure, figureBlock, statusBadge, figLabel } from '../common.js?v=mwqeam7z';
import { createChat } from '../chat.js?v=mwqeam7z';
import { setDirty, loc, replaceUrlQuiet } from '../main.js?v=mwqeam7z';
import { normalizeSearchText as n } from '../search-text.js?v=mwqeam7z';

const TABS = [['simple', 'Umumiy ma’lumot'], ['uzfull', 'Ma’lumot (UZ)'], ['full', 'Ma’lumot (EN)'], ['terms', 'Atamalar'], ['source', 'Manba']];

export async function reader({ el, params, query, state, navigate, setTitle }) {
  let data;
  try { data = await get(`/api/lessons/${encodeURIComponent(params.sectionId)}`); }
  catch (err) {
    if (err.status === 410 || err.status === 403) {
      mount(el, emptyBox(err.status === 410 ? 'folder' : 'clock', err.status === 410 ? 'Bölim arxivlangan' : 'Bölim hali tayyor emas', err.message, h('a', { class: 'btn primary', href: `/topics/${params.topicId}` }, 'Mavzuga qaytiş')));
      return;
    }
    throw err;
  }
  const L = data.lesson;
  if (L.topicId !== params.topicId || L.id !== params.sectionId) {
    replaceUrlQuiet(`/topics/${L.topicId}/sections/${L.id}${loc.search}${loc.anchor}`);
  }
  setTitle(L.titleUz);
  const topicData = await get(`/api/topics/${L.topicId}`).catch(() => null);
  const figs = new Map(data.figures.map((f) => [f.imageId, f]));
  const known = new Set(figs.keys());
  const TR = data.translation;
  const uzFigure = (f) => ({
    ...f,
    originalCaption: '',
    captionUz: TR?.figures?.[f.imageId] || f.captionUz || 'Rasm izohi hali tarjima qilinmagan.',
  });
  const onFigure = (fid) => {
    const figure = figs.get(fid);
    return openFigure(tab === 'uzfull' && figure ? uzFigure(figure) : figure || fid, { onSave: saveFigure, onNote: noteFromFigure });
  };
  let tab = TABS.some(([k]) => k === query.tab) ? query.tab : (data.progress.lastTab || 'simple');
  let completed = !!data.progress.completed;
  const sessionId = rid();
  const cleanups = [];

  // ---------------------------------------------------------------- font size
  const profile = state.me.profile;
  let font = profile.readerFont || 18;
  const prose = h('article', { class: 'prose', id: 'lesson-body', tabindex: '-1' });
  const applyFont = () => { prose.style.setProperty('--reader-font', `${font}px`); };
  applyFont();
  let fontTimer;
  const setFont = (d) => {
    font = Math.min(24, Math.max(15, font + d)); applyFont();
    clearTimeout(fontTimer); fontTimer = setTimeout(() => patch('/api/profile', { readerFont: font }).then(() => { profile.readerFont = font; }).catch(() => {}), 600);
  };

  // ---------------------------------------------------------------- blocks
  const blockEl = (b) => {
    const idAttr = b.id || b.anchor || b.bid;
    const io = { onFigure, knownFigures: known };
    switch (b.type) {
      case 'heading': return h(b.level <= 2 ? 'h2' : b.level === 3 ? 'h3' : 'h4', { id: idAttr, 'data-bid': b.bid }, b.text.replace(/\s*\(Fig\.[^)]*\)/, (m) => m), b.pdfPage ? h('span', { class: 'xs muted', style: { fontWeight: 500, marginLeft: '8px' } }, `· ${b.pdfPage - 5}-bet`) : null);
      case 'paragraph': return h('p', { id: idAttr, 'data-bid': b.bid, class: b.boxed ? 'boxed' : null }, b.lead ? h('span', { class: 'lead-in' }, `${b.lead} `) : null, inline(b.text, io));
      case 'list': return h(b.ordered ? 'ol' : 'ul', { 'data-bid': b.bid, id: b.bid }, b.items.map((it) => h('li', { class: it.depth ? 'd1' : null }, inline(it.text, io))));
      case 'table': return h('div', { class: 'table-wrap', 'data-bid': b.bid, id: b.bid }, h('table', {},
        b.header?.length ? h('thead', {}, h('tr', {}, b.header.map((c) => h('th', {}, inline(c, io))))) : null,
        h('tbody', {}, b.rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, inline(c, io))))))));
      case 'figure': { const f = figs.get(b.imageId); return f ? h('div', { 'data-bid': b.bid, id: b.bid }, figureBlock(f, (x) => onFigure(x.imageId))) : null; }
      default: return null;
    }
  };

  const trBlock = (b) => {
    if (b.type === 'figure') {
      const f = figs.get(b.imageId);
      return f ? h('div', { 'data-bid': b.bid, id: b.bid }, figureBlock(uzFigure(f), () => onFigure(f.imageId))) : null;
    }
    const x = TR?.blocks?.[b.bid];
    if (!x || (b.text?.trim() ? !x.text?.trim() : !x.lead?.trim())) return null;
    return blockEl({ ...b, text: x.text || '', lead: x.lead });
  };

  function termsView() {
    let q = '';
    const list = h('div', { class: 'stack', style: { gap: '10px' } });
    const draw = () => {
      const items = L.glossary.filter((g) => !q || n(`${g.termUz} ${g.original || ''} ${g.contextUz}`).includes(n(q)));
      mount(list, items.length ? items.map((g) => h('div', { class: 'card pad', style: { padding: '12px 14px' } },
        h('div', { class: 'row between' }, h('b', {}, g.termUz, g.original ? h('span', { class: 'muted', style: { fontWeight: 500 } }, ` (${g.original})`) : null),
          h('button', { type: 'button', class: 'btn small', onclick: () => { openPanel('ai'); chat.ask({ action: 'term', text: g.termUz }); } }, icon('sparkles', 'sm'), 'AI izohi')),
        h('p', { class: 'small', style: { margin: '6px 0 0' } }, inline(g.contextUz, { onFigure, knownFigures: known })))) : h('p', { class: 'muted' }, 'Mos atama topilmadi.'));
    };
    draw();
    return h('div', { class: 'stack' },
      h('p', { class: 'small muted' }, 'Atamalar özbekça izohdan avtomatik ajratilgan (qalin yozilgan sözlar) va tekşirilişi kerak. Pastda kitobdagi asl ta’rif jumlalari keltirilgan.'),
      h('input', { type: 'search', placeholder: 'Atama qidiriş', 'aria-label': 'Atama qidiriş', oninput: (e) => { q = e.target.value.trim(); draw(); } }),
      list,
      L.bookDefinitions?.length ? h('section', {}, h('h2', {}, 'Kitobdagi ta’riflar (EN)'), h('ul', {}, L.bookDefinitions.map((d) => h('li', { class: 'small' }, `${d.text}. `, h('a', { href: `/source-pdf/${L.source.bookId}#page=${d.pdfPage}`, target: '_blank', rel: 'noopener', class: 'xs' }, `${d.printedPage}-bet`))))) : null,
      L.keyNumbers?.length ? h('section', {}, h('h2', {}, 'Muhim raqamlar (EN)'), h('ul', {}, L.keyNumbers.map((d) => h('li', { class: 'small' }, `${d.text}. `, h('span', { class: 'xs muted' }, `${d.printedPage}-bet`))))) : null);
  }

  function sourceView() {
    const b = data.book;
    const pdf = (p) => `/source-pdf/${b.id}#page=${p}`;
    return h('div', { class: 'stack' },
      h('section', { class: 'card pad' },
        h('h2', { style: { marginTop: 0 } }, b.title),
        h('p', { class: 'small' }, `${b.edition} · ${b.authors.join(', ')} · ${b.year}`),
        h('ul', { class: 'small' },
          h('li', {}, `Bob: ${L.source.chapter} — ${L.titleOriginal}`),
          h('li', {}, `Kitob sahifalari: ${L.printedPages[0]}–${L.printedPages[1]} (PDF ${L.pdfPages[0]}–${L.pdfPages[1]})`),
          h('li', {}, `Qism: ${L.source.unit}`),
          h('li', {}, 'Umumiy ma’lumot: avvalgi öqiş jarayonida kitobdan tayyorlangan qisqa şarh (maşina yordamida, ekspert tekşiruvi kutilmoqda).'),
          h('li', {}, 'Ma’lumot (EN): kitob PDF faylidan avtomatik ajratilgan töliq inglizça matn.'),
          h('li', {}, TR ? `Ma’lumot (UZ): ${TR.translated}/${TR.total} blok · ${TR.translator || 'Holati'} · tekşirilişi kerak.` : 'Ma’lumot (UZ): hali yöq.')),
        h('div', { class: 'row', style: { flexWrap: 'wrap' } },
          h('a', { class: 'btn', href: pdf(L.pdfPages[0]), target: '_blank', rel: 'noopener' }, icon('external'), 'Kitobda oçiş'),
          h('a', { class: 'btn', href: `/library/${b.id}` }, icon('book'), 'Kutubxonada'))),
      h('section', { class: 'card pad' },
        h('h3', { style: { marginTop: 0 } }, 'Holat'),
        h('div', { class: 'row', style: { flexWrap: 'wrap' } }, statusBadge(data.status), h('span', { class: 'badge warn' }, 'Tarjima: maşina yordamida'), h('span', { class: 'xs muted' }, `Kontent versiyasi ${L.contentVersion}`))),
      h('section', {},
        h('h2', {}, `Bobdagi rasmlar va jadvallar (${data.figures.length})`),
        h('div', { class: 'grid g3' }, data.figures.map((f) => h('button', { type: 'button', class: 'card', style: { padding: '8px', cursor: 'zoom-in', textAlign: 'left' }, onclick: () => onFigure(f.imageId) },
          f.url ? h('img', { src: f.url, alt: '', loading: 'lazy', style: { width: '100%', height: '140px', objectFit: 'contain', background: '#fff' } }) : h('div', { class: 'empty small', style: { height: '140px' } }, icon('image')),
          h('div', { class: 'xs', style: { marginTop: '6px' } }, h('b', {}, figLabel(f)), ` · ${f.printedPageLabel}-bet`))))));
  }

  function renderTab() {
    tabBtns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    if (tab === 'simple') {
      mount(prose,
        h('div', { class: 'callout small', style: { marginBottom: '1em' } }, icon('info', 'sm'), ` Bu — kitob bobi böyiça umumiy ma’lumot (qisqartirilgan). Kitobdagidek töliq matn uçun ${TR ? '“Ma’lumot (UZ)”' : '“Ma’lumot (EN)”'} bölimini oçing.`),
        L.objectives?.length ? h('div', { class: 'card pad', style: { marginBottom: '1em', background: '#F7FBFA' } }, h('b', {}, 'Bu darsda:'), h('ul', { style: { margin: '6px 0 0' } }, L.objectives.slice(0, 8).map((o) => h('li', { class: 'small' }, inline(o))))) : null,
        L.blocks.simple.map(blockEl));
    } else if (tab === 'uzfull') {
      if (!TR) {
        mount(prose, emptyBox('book', 'Bu bobning töliq özbekça tarjimasi hali tayyor emas', 'Hozirça “Umumiy ma’lumot” (qisqa şarh) va “Ma’lumot (EN)” (kitobning töliq matni) mavjud. Özbekça töliq matn tarjima skripti işga tuşirilgaç şu yerda paydo böladi.',
          h('div', { class: 'row', style: { justifyContent: 'center', flexWrap: 'wrap' } },
            h('button', { type: 'button', class: 'btn primary', onclick: () => { tab = 'full'; renderTab(); } }, 'Ma’lumot (EN) ni oçiş'),
            h('button', { type: 'button', class: 'btn', onclick: () => { tab = 'simple'; renderTab(); } }, 'Umumiy ma’lumot'))));
      } else {
        mount(prose,
          TR.translated < TR.total ? h('div', { class: 'callout small' }, `Tarjima davom etmoqda. ${TR.total - TR.translated} ta matn bo‘lagi yoki rasm izohi qoldi.`) : null,
          L.blocks.full.map(trBlock));
      }
    } else if (tab === 'full') {
      mount(prose, h('div', { class: 'callout small', style: { marginBottom: '1em' } }, icon('book', 'sm'), ' Guyton & Hall, 14-naşr — kitobning töliq asl inglizça matni. Rasm havolalarini bosib kitob rasmini köring.'), L.blocks.full.map(blockEl));
    } else if (tab === 'terms') mount(prose, termsView());
    else mount(prose, sourceView());
    drawOutline();
    observeBlocks();
    const u = new URL(loc.path + loc.search + loc.anchor, 'http://x'); u.searchParams.set('tab', tab); replaceUrlQuiet(u.pathname + u.search + u.hash);
  }

  const tabBtns = TABS.map(([k, l]) => { const b = h('button', { type: 'button', role: 'tab', 'data-tab': k, onclick: () => { tab = k; renderTab(); saveProgress({ lastTab: k }); prose.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); } }, l); return b; });

  // ---------------------------------------------------------------- toc
  const outlineBox = h('div', { class: 'outline' });
  function drawOutline() {
    const heads = tab === 'uzfull' && TR ? L.blocks.full.filter((b) => b.type === 'heading' && TR.blocks[b.bid]?.text?.trim()).map((b) => ({ id: b.id || b.bid, text: TR.blocks[b.bid].text, sub: b.level > 2 }))
      : tab === 'full' ? L.outline.filter((o) => o.level <= 2).map((o) => ({ id: o.id, text: o.title, sub: o.level > 1 }))
      : tab === 'simple' ? L.blocks.simple.filter((b) => b.type === 'heading').map((b) => ({ id: b.id || b.bid, text: b.text, sub: b.level > 2 })) : [];
    mount(outlineBox, heads.length ? [h('div', { class: 'xs muted', style: { padding: '8px 10px 2px', fontWeight: 800 } }, 'Şu dars içida'), heads.slice(0, 60).map((x) => h('a', { href: `#${x.id}`, style: x.sub ? { paddingLeft: '22px' } : null, onclick: (e) => { e.preventDefault(); jump(x.id); closeDrawers(); } }, x.text.length > 60 ? `${x.text.slice(0, 58)}…` : x.text))] : []);
  }
  const toc = h('aside', { class: 'card toc', 'aria-label': 'Mavzu bölimlari' },
    h('div', { class: 'row between', style: { padding: '6px 10px' } }, h('a', { href: `/topics/${L.topicId}`, class: 'small', style: { fontWeight: 800, minHeight: 0, padding: 0 } }, `${L.topicId} ${data.topic.title}`)),
    (topicData?.sections || []).map((s) => h('a', { href: `/topics/${L.topicId}/sections/${s.id}`, 'aria-current': s.id === L.id ? 'page' : null }, h('span', { class: 'n' }, s.progress.completed ? icon('check', 'sm') : String(s.order).padStart(2, '0')), h('span', {}, s.titleUz))),
    outlineBox);

  function jump(idOrBid) {
    const t = document.getElementById(idOrBid) || prose.querySelector(`[data-bid="${CSS.escape(idOrBid)}"]`);
    if (!t) return false;
    t.scrollIntoView({ block: 'start' });
    t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 2000);
    return true;
  }

  // ---------------------------------------------------------------- progress
  let progTimer; let pendingProg = {};
  function saveProgress(p, now = false) {
    Object.assign(pendingProg, p);
    clearTimeout(progTimer);
    const run = () => { const body = pendingProg; pendingProg = {}; return patch(`/api/progress/${L.id}`, body).catch(() => {}); };
    if (now) return run();
    progTimer = setTimeout(run, 2500);
  }
  let io = null;
  function observeBlocks() {
    io?.disconnect();
    if (!['simple', 'uzfull', 'full'].includes(tab)) return;
    const vis = new Map();
    io = new IntersectionObserver((ents) => {
      for (const e of ents) { if (e.isIntersecting) vis.set(e.target, e.boundingClientRect.top); else vis.delete(e.target); }
      const top = [...vis.entries()].sort((a, b) => a[1] - b[1])[0];
      if (top) saveProgress({ lastBlock: top[0].dataset.bid, lastTab: tab });
    }, { rootMargin: '-80px 0px -60% 0px' });
    prose.querySelectorAll('[data-bid]').forEach((n) => io.observe(n));
  }
  cleanups.push(() => { io?.disconnect(); if (Object.keys(pendingProg).length) saveProgress({}, true); });

  // ---------------------------------------------------------------- reading heartbeat (active time only)
  let lastAct = Date.now(); let lastBeat = Date.now();
  const act = () => { lastAct = Date.now(); };
  const evs = ['scroll', 'keydown', 'pointermove', 'pointerdown', 'touchstart', 'wheel'];
  evs.forEach((e) => window.addEventListener(e, act, { passive: true }));
  const beat = () => {
    const now = Date.now();
    const visible = document.visibilityState === 'visible';
    const active = visible && now - lastAct < 120000;
    const start = Math.max(lastBeat, now - 30000);
    lastBeat = now;
    if (!active || now - start < 1000) return;
    post('/api/reading/heartbeat', { eventId: rid(), sessionId, lessonId: L.id, startMs: start, endMs: now }).catch(() => {});
  };
  const hbTimer = setInterval(beat, 30000);
  const onVis = () => { if (document.visibilityState === 'hidden') beat(); else { lastBeat = Date.now(); act(); } };
  document.addEventListener('visibilitychange', onVis);
  cleanups.push(() => { beat(); clearInterval(hbTimer); document.removeEventListener('visibilitychange', onVis); evs.forEach((e) => window.removeEventListener(e, act)); });

  // ---------------------------------------------------------------- side panel: AI + notes
  const chat = createChat({ lessonId: L.id, topicId: L.topicId, compact: true, onSaveNote: (m) => newNote({ body: m.content, chatMessageId: m.id }) });
  const notesBox = h('div', { class: 'stack', style: { gap: '10px' } });
  let panelTab = 'ai';
  const ptBtns = [['ai', 'AI suhbat'], ['notes', 'Qaydlar']].map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === panelTab), onclick: () => openPanel(k) }, l));
  const panelBody = h('div', { class: 'scroll' });
  const side = h('aside', { class: 'card side-panel', id: 'side-panel', 'aria-label': 'AI yordamçi va qaydlar' },
    h('div', { class: 'head stack', style: { gap: '12px' } },
      h('div', { class: 'panel-hero' },
        h('img', { class: 'panel-mascot', src: 'assets/ai-mascot.webp', alt: '', width: 52, height: 52 }),
        h('div', { class: 'grow', style: { minWidth: 0 } },
          h('div', { class: 'panel-title' }, 'Şu bölimni tuşuntir'),
          h('div', { class: 'panel-sub' }, 'AI yordamçi · kitob asosida')),
        h('button', { type: 'button', class: 'icon-btn panel-close', 'aria-label': 'Panelni yopiş', onclick: () => closePanel() }, icon('x'))),
      h('p', { class: 'panel-lead' }, 'Mavzu: ', h('b', {}, L.titleUz), '. Tuşunmagan joyingizni sörang yoki matndan belgilang.'),
      h('div', { class: 'seg panel-tabs', role: 'tablist' }, ptBtns)),
    panelBody);
  function drawPanel() {
    ptBtns.forEach((b, i) => b.setAttribute('aria-selected', String(['ai', 'notes'][i] === panelTab)));
    mount(panelBody, panelTab === 'ai' ? chat.el : notesBox);
    if (panelTab === 'notes') loadNotes();
  }
  const back = h('div', { class: 'drawer-back hidden', onclick: () => closeDrawers() });
  const readerEl = h('div', { class: 'reader' });
  function openPanel(k) {
    panelTab = k || panelTab; drawPanel();
    readerEl.classList.remove('ai-closed');
    if (window.matchMedia('(max-width: 1280px)').matches) { side.classList.add('open'); back.classList.remove('hidden'); }
  }
  function closePanel() {
    side.classList.remove('open'); back.classList.add('hidden');
    if (!window.matchMedia('(max-width: 1280px)').matches) readerEl.classList.add('ai-closed');
  }
  function closeDrawers() { side.classList.remove('open'); toc.classList.remove('open'); back.classList.add('hidden'); }

  // notes
  async function loadNotes() {
    try {
      const { notes } = await get(`/api/notes?lessonId=${L.id}`);
      mount(notesBox,
        h('button', { type: 'button', class: 'btn primary', onclick: () => newNote({}) }, icon('plus'), 'Yangi qayd'),
        notes.length ? notes.map(noteCard) : h('p', { class: 'small muted' }, 'Bu darsda hali qayd yöq. Matnni belgilab “Qayd” tugmasini bosing yoki yangi qayd yarating.'));
    } catch (e) { mount(notesBox, h('p', { class: 'small' }, e.message)); }
  }
  function noteCard(n) {
    let cur = n;
    const status = h('span', { class: 'xs muted', 'aria-live': 'polite' }, `Saqlangan · ${fmtDate(n.updatedAt, profile.timezone)}`);
    const ta = h('textarea', { rows: 4, 'aria-label': 'Qayd matni', style: { width: '100%', padding: '10px', border: '1px solid var(--border)', borderRadius: '10px', resize: 'vertical' } });
    ta.value = n.body;
    let t; let saving = Promise.resolve();
    const save = () => {
      saving = saving.then(async () => {
        if (ta.value === cur.body) { setDirty(null); return; }
        status.textContent = 'Saqlanmoqda…';
        try { cur = (await patch(`/api/notes/${cur.id}`, { body: ta.value, updatedAt: cur.updatedAt })).note; status.textContent = `Saqlangan · ${fmtDate(cur.updatedAt, profile.timezone)}`; setDirty(null); }
        catch (e) { status.textContent = e.status === 409 ? 'Boşqa oynada özgargan — sahifani yangilang' : `Saqlanmadi: ${e.message}`; status.style.color = 'var(--danger)'; }
      });
      return saving;
    };
    ta.addEventListener('input', () => { setDirty('note'); status.textContent = 'Yozilmoqda…'; clearTimeout(t); t = setTimeout(save, 900); });
    ta.addEventListener('blur', () => { clearTimeout(t); save(); });
    cleanups.push(() => { clearTimeout(t); if (ta.value !== cur.body) save(); });
    return h('div', { class: 'card pad', style: { padding: '12px' } },
      n.selectionText ? h('button', { type: 'button', class: 'ctx-chip', style: { border: 0, width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: '8px' }, onclick: () => { if (n.anchorBlock && !jump(n.anchorBlock)) toast('Bu parça boşqa bölimda (tab) — “Umumiy ma’lumot”, “Ma’lumot (UZ)” yoki “Ma’lumot (EN)”ni oçing.'); } }, icon('file', 'sm'), `“${n.selectionText.slice(0, 160)}”`) : null,
      n.figureId ? h('button', { type: 'button', class: 'figref', onclick: () => onFigure(n.figureId) }, figLabel(figs.get(n.figureId) || { figureNumber: n.figureId })) : null,
      ta,
      h('div', { class: 'row between' }, status,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Qaydni öçiriş', onclick: async () => { await saving; try { await del(`/api/notes/${cur.id}`); setDirty(null); toast('Qayd öçirildi.'); loadNotes(); } catch (e) { toast(e.message); } } }, icon('trash'))));
  }
  async function newNote({ selectionText, anchorBlock, figureId, chatMessageId, body = '' }) {
    try {
      await post('/api/notes', { lessonId: L.id, selectionText, anchorBlock, figureId, chatMessageId, body });
      openPanel('notes');
      setTimeout(() => notesBox.querySelector('textarea')?.focus(), 300);
    } catch (e) { toast(e.message); }
  }
  function noteFromFigure(f) { newNote({ figureId: f.imageId }); }
  async function saveFigure(f) {
    try { await post('/api/bookmarks', { targetType: 'figure', targetId: f.imageId, title: `${figLabel(f)} — ${L.titleUz}`, snippet: f.originalCaption }); toast('Rasm saqlandi.'); } catch (e) { toast(e.message); }
  }

  // ---------------------------------------------------------------- selection toolbar
  const selbar = h('div', { class: 'selbar hidden', role: 'toolbar', 'aria-label': 'Belgilangan matn' });
  document.body.appendChild(selbar);
  cleanups.push(() => selbar.remove());
  let curSel = null;
  // touch screens: the phone's own copy menu sits right above the selection, so our bar docks
  // at the bottom of the screen instead; tapping it collapses the selection, so for a moment
  // after a press on the bar we keep it (and curSel) instead of hiding.
  const touchUI = () => window.matchMedia('(pointer: coarse), (max-width: 720px)').matches;
  let barPressedAt = 0;
  selbar.addEventListener('pointerdown', () => { barPressedAt = Date.now(); });
  const hideSel = (force = false) => { if (!force && Date.now() - barPressedAt < 700) return; selbar.classList.add('hidden'); curSel = null; };
  function onSelect() {
    const s = window.getSelection();
    const text = s && !s.isCollapsed ? s.toString().replace(/\s+/g, ' ').trim() : '';
    if (!text || text.length < 3 || !prose.contains(s.anchorNode)) { hideSel(); return; }
    const blk = (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement).closest('[data-bid]');
    curSel = { text: text.slice(0, 3000), blockId: blk?.dataset.bid || null };
    const r = s.getRangeAt(0).getBoundingClientRect();
    mount(selbar,
      h('button', { type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => { const c = curSel; hideSel(true); window.getSelection()?.removeAllRanges(); openPanel('ai'); chat.ask({ action: 'explain', selection: c }); } }, icon('sparkles', 'sm'), 'Tuşuntir'),
      h('button', { type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => { const c = curSel; hideSel(true); window.getSelection()?.removeAllRanges(); newNote({ selectionText: c.text, anchorBlock: c.blockId }); } }, icon('note', 'sm'), 'Qayd'),
      h('button', { type: 'button', onmousedown: (e) => e.preventDefault(), onclick: async () => { const c = curSel; hideSel(true); window.getSelection()?.removeAllRanges(); try { await post('/api/bookmarks', { targetType: 'selection', targetId: `${L.id}:${c.blockId || ''}:${rid().slice(0, 8)}`, title: L.titleUz, snippet: c.text, meta: { lessonId: L.id, topicId: L.topicId, blockId: c.blockId, tab } }); toast('Parça saqlandi.'); } catch (e) { toast(e.message); } } }, icon('bookmark', 'sm'), 'Saqlaş'));
    selbar.classList.remove('hidden');
    if (touchUI()) { selbar.classList.add('sheet'); selbar.style.top = ''; selbar.style.left = ''; return; }
    selbar.classList.remove('sheet');
    const z = uiZoom(); const sy = window.scrollY / z;
    const top = sy + r.top / z - 52;
    const left = Math.max(8, Math.min((window.scrollX + r.left + r.width / 2) / z - 140, document.documentElement.clientWidth - 296));
    selbar.style.top = `${top < sy + 60 ? sy + r.bottom / z + 8 : top}px`;
    selbar.style.left = `${left}px`;
  }
  const onUp = () => setTimeout(onSelect, 10);
  prose.addEventListener('mouseup', onUp);
  prose.addEventListener('touchend', onUp);
  // phones select by long-press and drag handles, which fire no mouseup: follow the selection itself
  let selT;
  const onSelChange = () => { if (!touchUI()) return; clearTimeout(selT); selT = setTimeout(onSelect, 250); };
  document.addEventListener('selectionchange', onSelChange);
  cleanups.push(() => { document.removeEventListener('selectionchange', onSelChange); clearTimeout(selT); });
  const onKeySel = (e) => { if (e.key === 'Escape') hideSel(); };
  const onDocDown = (e) => { if (!selbar.contains(e.target) && !prose.contains(e.target)) { barPressedAt = 0; hideSel(); } };
  document.addEventListener('keydown', onKeySel);
  document.addEventListener('mousedown', onDocDown);
  document.addEventListener('touchstart', onDocDown, { passive: true });
  cleanups.push(() => { document.removeEventListener('keydown', onKeySel); document.removeEventListener('mousedown', onDocDown); document.removeEventListener('touchstart', onDocDown); });

  // ---------------------------------------------------------------- header & bottom bar
  const doneBtn = h('button', { type: 'button', class: `btn ${completed ? '' : 'primary'}` });
  const drawDone = () => { mount(doneBtn, icon('checkCircle'), completed ? 'Öqilgan ✓' : 'Öqib böldim'); doneBtn.className = `btn ${completed ? 'soft' : 'primary'}`; doneBtn.setAttribute('aria-pressed', String(completed)); };
  drawDone();
  doneBtn.addEventListener('click', async () => {
    doneBtn.disabled = true;
    try {
      const r = await patch(`/api/progress/${L.id}`, { completed: !completed });
      completed = r.progress.completed; drawDone();
      toast(completed ? 'Bölim öqilgan deb belgilandi.' : 'Belgi olib taşlandi.');
    } catch (e) { toast(e.message); } finally { doneBtn.disabled = false; }
  });
  let flagged = !!data.progress.reviewFlag;
  const flagBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-pressed': String(flagged), title: 'Takrorlaş navbatiga qöşiş', 'aria-label': 'Takrorlaş uçun belgilaş' }, icon('flag'));
  flagBtn.addEventListener('click', async () => {
    try { const r = await patch(`/api/progress/${L.id}`, { reviewFlag: !flagged }); flagged = r.progress.reviewFlag; flagBtn.setAttribute('aria-pressed', String(flagged)); toast(flagged ? 'Takrorlaş navbatiga qöşildi.' : 'Takrorlaş navbatidan olindi.'); } catch (e) { toast(e.message); }
  });
  const startQuiz = async () => {
    try { const r = await post('/api/quiz-attempts', { scopeType: 'lesson', scopeId: L.id, mode: 'practice', count: 10, clientKey: rid() }); navigate(`/practice/${r.attemptId}`); }
    catch (e) { toast(e.message); }
  };

  const top = h('div', {},
    h('nav', { class: 'crumbs', 'aria-label': 'Yöl' }, h('a', { href: '/dashboard', 'aria-label': 'Boş sahifa' }, icon('home', 'sm')), h('span', {}, '/'), h('a', { href: '/topics' }, '15 ta mavzu'), h('span', {}, '/'), h('a', { href: `/topics/${L.topicId}` }, `${L.topicId} ${data.topic.title}`), h('span', {}, '/'), h('b', { style: { color: 'var(--text)' } }, L.titleUz)),
    h('div', { class: 'reader-head' },
      h('h1', {}, L.titleUz),
      h('span', { class: 'pill' }, icon('book', 'sm'), `${L.source.chapter}-bob · kitob ${L.printedPages[0]}–${L.printedPages[1]}-bet · ~${L.estMinutes} daq`)));
  const header = h('header', { class: 'stack', style: { gap: '10px', marginBottom: '12px' } },
    h('div', { class: 'row between', style: { flexWrap: 'wrap', gap: '8px' } },
      h('span', { class: 'small muted' }, L.titleOriginal),
      h('div', { class: 'reader-tools' },
        h('button', { type: 'button', class: 'icon-btn toc-btn', 'aria-label': 'Bölimlar röyxati', onclick: () => { toc.classList.add('open'); back.classList.remove('hidden'); } }, icon('list')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Matnni kiçiklaştiriş', onclick: () => setFont(-1) }, h('span', { style: { fontWeight: 800, fontSize: '13px' } }, 'A−')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Matnni kattalaştiriş', onclick: () => setFont(1) }, h('span', { style: { fontWeight: 800, fontSize: '17px' } }, 'A+')),
        bookmarkButton({ targetType: 'lesson', targetId: L.id, title: L.titleUz }, data.saved),
        flagBtn,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'AI yordamçi', title: 'AI yordamçi', onclick: () => openPanel('ai') }, icon('sparkles')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Qaydlar', title: 'Qaydlar', onclick: () => openPanel('notes') }, icon('note')))),
    data.aliasOf ? h('div', { class: 'banner info' }, icon('info', 'sm'), h('span', {}, `Dizayndagi “${params.sectionId}” bölimi kitobning şu bobiga kiradi.`)) : null,
    data.updatedSinceRead ? h('div', { class: 'banner info' }, icon('refresh', 'sm'), h('span', {}, 'Siz öqiganingizdan keyin bu dars yangilangan. Özgarişlarni körib çiqing.')) : null,
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Dars körinişi' }, tabBtns));

  const bar = h('div', { class: 'card reader-actions' },
    doneBtn,
    data.questionCount ? h('button', { type: 'button', class: 'btn', onclick: startQuiz }, icon('test'), `Test yeçiş (${data.questionCount})`) : h('a', { class: 'btn', href: `/practice?topic=${L.topicId}` }, icon('test'), 'Testlar'),
    data.next ? h('a', { class: 'btn', href: `/topics/${L.topicId}/sections/${data.next.id}` }, 'Keyingi bölim', icon('right')) : h('a', { class: 'btn', href: `/topics/${L.topicId}` }, 'Mavzuga qaytiş', icon('right')));

  mount(readerEl, toc, h('div', { style: { minWidth: 0 } }, h('div', { class: 'card pad reading' }, header, prose), bar), side);
  if (window.matchMedia('(max-width: 1280px)').matches) readerEl.classList.remove('ai-closed');
  mount(el, top, readerEl, back);
  renderTab();
  drawPanel();

  // restore position
  const target = loc.anchor ? decodeURIComponent(loc.anchor.slice(1)) : (data.progress.lastTab === tab ? data.progress.lastBlock : null);
  if (target) requestAnimationFrame(() => { if (!jump(target) && loc.anchor) toast('Bu joy özgargan yoki boşqa bölimda — dars boşidan körsatildi.'); });

  return () => { cleanups.forEach((f) => { try { f(); } catch { /* */ } }); setDirty(null); chat.stop(); };
}
