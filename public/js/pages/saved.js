import { h, icon, mount, toast, emptyBox, promptBox, confirmBox, fmtDate, inline } from '../ui.js';
import { get, post, patch, del } from '../api.js';
import { openFigure } from '../common.js';
import { setDirty } from '../main.js';

const TABS = [['topic', 'Mavzular'], ['lesson', 'Bölimlar'], ['notes', 'Qaydlar'], ['ai_answer', 'AI javoblari'], ['figure', 'Rasmlar'], ['selection', 'Parçalar']];
const KIND = { topic: ['layers', 'Asosiy mavzu', ''], lesson: ['folder', 'Içki bölim', 'violet'], figure: ['image', 'Kitob rasmi', ''], selection: ['file', 'Parça', 'violet'], ai_answer: ['sparkles', 'AI javobi', 'violet'], book: ['book', 'Kitob', ''] };
const wide = (u) => String(u || '').replace(/\.webp$/, '_wide.webp?v=3');

export async function saved({ el, state, query }) {
  let tab = TABS.some(([k]) => k === query.type) ? query.type : 'topic';
  let col = null; let q = ''; let topicFilter = '';
  const tz = state.me.profile.timezone;
  const [{ topics }, lib] = await Promise.all([get('/api/topics'), get('/api/library')]);
  const topicOf = new Map(); // lessonId -> topic
  for (const b of lib.books) for (const t of b.topics) for (const c of t.chapters) topicOf.set(c.id, topics.find((x) => x.id === t.id));
  const topicById = new Map(topics.map((t) => [t.id, t]));
  let all = []; let collections = []; let notes = [];
  let activeNote = null;

  const grid = h('div', { class: 'grid g2' });
  const folders = h('nav', { class: 'card pad folders', 'aria-label': 'Papkalar', style: { padding: '10px' } });
  const notePanel = h('aside', { class: 'card pad stack', style: { gap: '12px' } });

  const tpOf = (b) => (b.targetType === 'topic' ? topicById.get(b.targetId) : topicOf.get(b.meta?.lessonId || b.targetId) || null);
  const hrefOf = (b) => {
    if (b.targetType === 'topic') return `/topics/${b.targetId}`;
    if (b.targetType === 'lesson') return `/topics/${tpOf(b)?.id || '03'}/sections/${b.targetId}`;
    if (b.targetType === 'selection') return `/topics/${b.meta.topicId}/sections/${b.meta.lessonId}?tab=${b.meta.tab || 'simple'}${b.meta.blockId ? `#${b.meta.blockId}` : ''}`;
    if (b.targetType === 'book') return `/library/${b.targetId}`;
    if (b.targetType === 'ai_answer') return '/assistant';
    return null;
  };

  function card(b) {
    const [ic, kl, kc] = KIND[b.targetType] || KIND.topic;
    const tp = tpOf(b);
    const link = hrefOf(b);
    const img = h('img', { src: tp ? wide(tp.cardImage) : '/assets/topics/topic_03_wide.webp?v=3', alt: '', loading: 'lazy' });
    if (b.targetType === 'figure') get(`/api/figures/${encodeURIComponent(b.targetId)}`).then((r) => { if (r.figure.url) img.src = r.figure.url; }).catch(() => {});
    const open = b.targetType === 'figure' ? h('button', { type: 'button', class: 'btn primary small', onclick: () => openFigure(b.targetId) }, icon('arrowRight', 'sm'), 'Oçiş')
      : link ? h('a', { class: 'btn primary small', href: link }, icon('arrowRight', 'sm'), 'Oçiş') : null;
    return h('article', { class: 'card scard' },
      h('div', { class: `img ${b.targetType === 'figure' ? 'fig' : ''}` }, img,
        h('span', { class: `pill kind ${kc}` }, icon(ic, 'sm'), kl),
        h('button', { type: 'button', class: 'icon-btn', style: { color: 'var(--primary)' }, 'aria-label': 'Saqlanganlardan olib taşlaş', title: 'Olib taşlaş', onclick: async () => {
          try { await del(`/api/bookmarks/${b.id}`); await reload(); toast('Öçirildi.', { action: 'Qaytariş', onAction: async () => { await post(`/api/bookmarks/${b.id}/restore`); reload(); } }); } catch (err) { toast(err.message); }
        } }, icon('bookmarkFill'))),
      h('div', { class: 'body' },
        b.targetType === 'topic' ? h('div', { class: 'row', style: { gap: '12px', flexWrap: 'nowrap' } }, h('b', { style: { color: 'var(--brand)', fontSize: '20px' } }, b.targetId), h('span', { class: 't' }, tp?.title || b.title))
          : h('div', {}, tp ? h('span', { class: 'small muted' }, `${tp.id} ${tp.title}`) : null, h('div', { class: 't' }, b.title || b.targetId)),
        b.snippet && b.targetType !== 'topic' ? h('p', { class: 'small', style: { margin: 0, color: 'var(--text-2)' } }, inline(b.snippet.slice(0, 180))) : null,
        h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '10px', marginTop: 'auto' } }, open,
          h('span', { class: 'row xs muted', style: { gap: '6px', flexWrap: 'nowrap', borderLeft: '1px solid var(--border)', paddingLeft: '10px' } }, icon('clock', 'sm'), h('span', {}, 'Saqlangan:', h('br'), fmtDate(b.createdAt, tz))),
          h('select', { 'aria-label': 'Papkaga köçiriş', class: 'xs', style: { marginLeft: 'auto', maxWidth: '110px', border: '1px solid var(--border)', borderRadius: '8px', padding: '4px' }, onchange: async (e) => { try { await patch(`/api/bookmarks/${b.id}`, { collectionId: e.target.value || null }); toast('Papkaga köçirildi.'); reload(); } catch (err) { toast(err.message); } } },
            h('option', { value: '' }, 'Papkasiz'), collections.map((c) => h('option', { value: c.id, selected: b.collectionId === c.id }, c.name))))));
  }

  function noteCard(n) {
    const tp = n.topicId ? topicById.get(n.topicId) : null;
    return h('article', { class: 'card scard' },
      h('div', { class: 'img' }, h('img', { src: tp ? wide(tp.cardImage) : '/assets/topics/topic_03_wide.webp?v=3', alt: '' }), h('span', { class: 'pill kind violet' }, icon('note', 'sm'), 'Şaxsiy qayd')),
      h('div', { class: 'body' },
        tp ? h('span', { class: 'small muted' }, `${tp.id} ${tp.title}`) : null,
        h('div', { class: 't' }, n.lessonTitle || 'Qayd'),
        h('p', { class: 'small', style: { margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-2)' } }, (n.body || '(böş qayd)').slice(0, 140)),
        h('div', { class: 'row', style: { gap: '8px', marginTop: 'auto' } },
          h('button', { type: 'button', class: 'btn primary small', onclick: () => { activeNote = n; drawNote(); } }, icon('edit', 'sm'), 'Tahrirlaş'),
          n.lessonId ? h('a', { class: 'btn small', href: `/topics/${n.topicId}/sections/${n.lessonId}${n.anchorBlock ? `#${n.anchorBlock}` : ''}` }, 'Darsda oçiş') : null)));
  }

  function drawNote() {
    const n = activeNote;
    if (!n) {
      mount(notePanel, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('span', { style: { color: 'var(--primary)' } }, icon('file')), h('h2', { style: { margin: 0, fontSize: '22px' } }, 'Şaxsiy qayd')),
        h('p', { class: 'small muted', style: { margin: 0 } }, notes.length ? 'Qaydni tanlang — şu yerda tahrirlaysiz.' : 'Hali qayd yöq. Dars içida matnni belgilab “Qayd” tugmasini bosing.'));
      return;
    }
    let cur = n; let t;
    const ta = h('textarea', { rows: 12, 'aria-label': 'Qayd matni', style: { width: '100%', minHeight: '260px', padding: '14px', border: '1px solid var(--border)', borderRadius: '14px', fontSize: '17px', lineHeight: 1.6, resize: 'vertical' } });
    ta.value = n.body || '';
    const status = h('span', { class: 'xs muted', 'aria-live': 'polite' }, `Saqlangan · ${fmtDate(n.updatedAt, tz)}`);
    const save = async () => {
      if (ta.value === cur.body) { setDirty(null); return; }
      status.textContent = 'Saqlanmoqda…';
      try { cur = (await patch(`/api/notes/${cur.id}`, { body: ta.value, updatedAt: cur.updatedAt })).note; Object.assign(n, cur); status.textContent = `Saqlangan · ${fmtDate(cur.updatedAt, tz)}`; setDirty(null); }
      catch (e) { status.textContent = e.status === 409 ? 'Boşqa oynada özgargan — sahifani yangilang' : `Saqlanmadi: ${e.message}`; }
    };
    ta.addEventListener('input', () => { setDirty('note'); status.textContent = 'Yozilmoqda…'; clearTimeout(t); t = setTimeout(save, 900); });
    ta.addEventListener('blur', () => { clearTimeout(t); save(); });
    mount(notePanel,
      h('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } }, h('span', { style: { color: 'var(--primary)' } }, icon('file')), h('h2', { style: { margin: 0, fontSize: '22px' } }, `Şaxsiy qayd: ${n.lessonTitle || ''}`)),
      h('span', { class: 'pill', style: { alignSelf: 'flex-start' } }, icon('user', 'sm'), 'Şaxsiy qayd'),
      n.selectionText ? h('div', { class: 'ctx-chip' }, `“${n.selectionText.slice(0, 200)}”`) : null,
      ta, status,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn soft grow', onclick: () => { clearTimeout(t); save(); } }, icon('edit'), 'Saqlaş'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Qaydni öçiriş', onclick: async () => { if (!(await confirmBox('Qaydni öçiriş', 'Bu qayd butunlay öçiriladi.', 'Öçiriş', true))) return; try { await del(`/api/notes/${n.id}`); activeNote = null; setDirty(null); await reload(); } catch (e) { toast(e.message); } } }, icon('trash'))));
  }

  function drawFolders() {
    const cnt = (cid) => all.filter((b) => (cid === null ? true : b.collectionId === cid)).length;
    mount(folders,
      h('button', { type: 'button', 'aria-current': String(col === null), onclick: () => { col = null; draw(); } }, icon('folder'), 'Barçasi', h('span', { class: 'cnt' }, cnt(null))),
      collections.map((c) => h('button', { type: 'button', 'aria-current': String(col === c.id), onclick: () => { col = c.id; draw(); }, ondblclick: async () => { const n = await promptBox('Papka nomi', 'Yangi nom', c.name); if (n) { await patch(`/api/collections/${c.id}`, { name: n }).catch((e) => toast(e.message)); reload(); } } },
        icon(/yurak/i.test(c.name) ? 'heart' : /keyin/i.test(c.name) ? 'clock' : 'folder'), c.name, h('span', { class: 'cnt' }, cnt(c.id)))),
      col ? h('button', { type: 'button', class: 'xs', style: { color: 'var(--danger)', fontWeight: 600 }, onclick: async () => { if (await confirmBox('Papkani öçiriş', 'Içidagi elementlar öçmaydi, faqat papkasiz bölib qoladi.', 'Öçiriş', true)) { await del(`/api/collections/${col}`); col = null; reload(); } } }, icon('trash', 'sm'), 'Papkani öçiriş') : null);
  }

  function draw() {
    tabBtns.forEach((b, i) => b.setAttribute('aria-selected', String(TABS[i][0] === tab)));
    drawFolders();
    const qq = q.toLowerCase();
    if (tab === 'notes') {
      const ns = notes.filter((n) => (!topicFilter || n.topicId === topicFilter) && (!qq || `${n.body} ${n.lessonTitle} ${n.selectionText || ''}`.toLowerCase().includes(qq)));
      mount(grid, ns.length ? ns.map(noteCard) : emptyBox('note', 'Qaydlar yöq', 'Dars içida matnni belgilab “Qayd” tugmasini bosing.'));
    } else {
      const bs = all.filter((b) => b.targetType === tab && (col === null || b.collectionId === col) && (!topicFilter || tpOf(b)?.id === topicFilter) && (!qq || `${b.title} ${b.snippet || ''}`.toLowerCase().includes(qq)));
      mount(grid, bs.length ? bs.map(card) : emptyBox('bookmark', 'Bu bölimda hali heç narsa saqlanmagan', 'Mavzu, bölim, rasm yoki AI javobidagi saqlaş belgisini bosing.', h('a', { class: 'btn primary', href: '/topics' }, 'Mavzularga ötiş')));
    }
    drawNote();
  }
  async function reload() {
    const [r, nr] = await Promise.all([get('/api/bookmarks'), get('/api/notes')]);
    all = r.bookmarks; collections = r.collections; notes = nr.notes;
    if (activeNote) activeNote = notes.find((n) => n.id === activeNote.id) || null;
    if (!activeNote && notes.length) [activeNote] = notes;
    draw();
  }
  const tabBtns = TABS.map(([k, l]) => h('button', { type: 'button', role: 'tab', onclick: () => { tab = k; draw(); } }, l));
  const topicSel = h('select', { 'aria-label': 'Mavzu böyiça filtr', class: 'lang-btn', style: { boxShadow: 'none', height: '48px', fontWeight: 700 }, onchange: (e) => { topicFilter = e.target.value; draw(); } },
    h('option', { value: '' }, 'Barça mavzular'), topics.map((t) => h('option', { value: t.id }, `${t.id} ${t.title}`)));
  let st;
  mount(el,
    h('span', { class: 'pill', style: { marginBottom: '6px' } }, icon('bookmark', 'sm'), 'Saqlanganlar'),
    h('h1', { style: { margin: '8px 0 14px' } }, 'Özingiz uçun yiğilgan bilimlar'),
    h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Tur', style: { marginBottom: '14px' } }, tabBtns),
    h('div', { class: 'row', style: { marginBottom: '14px' } }, topicSel,
      h('div', { class: 'grow', style: { position: 'relative', minWidth: '200px' } }, h('span', { style: { position: 'absolute', left: '14px', top: '13px', color: 'var(--text-2)' } }, icon('search')),
        h('input', { type: 'search', class: 'big-search', placeholder: 'Saqlanganlarni qidiriş', 'aria-label': 'Saqlanganlarni qidiriş', oninput: (e) => { clearTimeout(st); st = setTimeout(() => { q = e.target.value.trim(); draw(); }, 200); } })),
      h('button', { type: 'button', class: 'btn primary', onclick: async () => { const n = await promptBox('Yangi papka', 'Papka nomi'); if (n) { try { await post('/api/collections', { name: n }); reload(); } catch (e) { toast(e.message); } } } }, icon('plus'), 'Papka')),
    h('div', { class: 'saved-layout' }, folders, grid, notePanel),
    h('a', { class: 'more-bar', href: all.find((b) => b.targetType === 'lesson') ? hrefOf(all.find((b) => b.targetType === 'lesson')) : '/topics' }, icon('refresh'), 'Saqlangan bölimlarni takrorlaş', icon('arrowRight', 'sm')));
  await reload();
  return () => setDirty(null);
}
