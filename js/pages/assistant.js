import { h, icon, mount, toast, confirmBox, fmtDate } from '../ui.js?v=mwqeam7z';
import { get, post, del } from '../api.js?v=mwqeam7z';
import { createChat } from '../chat.js?v=mwqeam7z';
import { openFigure } from '../common.js?v=mwqeam7z';

const TOPIC_IC = { '03': 'heart', '04': 'heart', '07': 'cloud' };

export async function assistant({ el, query, state }) {
  let { threads } = await get('/api/chat/threads');
  const { topics } = await get('/api/topics');
  let current = query.thread || null;
  const topicId = query.topic || null;
  const listBox = h('nav', { class: 'card threads', 'aria-label': 'Suhbatlar' });
  const chatBox = h('section', { class: 'card pad chat-page', style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '10px' } });
  const srcBox = h('aside', { class: 'card pad' });
  let chat = null;
  const tTitle = (id) => topics.find((t) => t.id === id)?.title;
  function drawSources(sources) {
    mount(srcBox,
      h('div', { class: 'row between', style: { flexWrap: 'nowrap', borderBottom: '1px solid var(--border)', paddingBottom: '12px' } }, h('h2', { class: 'row', style: { margin: 0, fontSize: '22px', flexWrap: 'nowrap' } }, h('span', { style: { color: 'var(--primary)' } }, icon('layers')), 'Manbalar'), h('span', { class: 'muted', title: 'Javoblar faqat ilovadagi kitob materialidan olinadi' }, icon('info'))),
      sources?.length ? h('ul', { class: 'src-list' }, sources.map((s) => h('li', {},
        h('b', {}, `[${s.n}] `), s.imageId ? h('button', { type: 'button', class: 'figref', onclick: () => openFigure(s.imageId) }, s.title) : s.lessonId ? h('a', { href: `/topics/${s.topicId}/sections/${s.lessonId}${s.blockId ? `#${s.blockId}` : ''}` }, s.title) : h('span', {}, s.title),
        h('div', { class: 'xs muted' }, `${s.lang === 'en' ? 'Ma’lumot (EN)' : s.kind === 'figure' ? 'Kitob rasmi' : 'Özbekça matn'}${s.printedPage ? ` · kitob ${s.printedPage}-bet` : ''}`),
        s.snippet ? h('div', { class: 'xs', style: { marginTop: '4px' } }, `“${s.snippet.replace(/\*\*/g, '').slice(0, 220)}…”`) : null)))
        : h('div', { class: 'src-empty' }, icon('book'), h('h3', { style: { margin: '10px 0 4px' } }, 'Manbalar şu yerda çiqadi'), h('p', { class: 'small muted' }, 'Savol bersangiz, javobga asos bölgan kitob parçalari va rasmlari şu panelda körsatiladi.')));
  }
  let selecting = false;
  let picked = new Set();
  function afterDelete(ids) {
    threads = threads.filter((x) => !ids.has(x.id));
    picked = new Set([...picked].filter((x) => !ids.has(x)));
    if (!threads.length) selecting = false;
    if (ids.has(current)) { current = null; openChat(); } else drawList();
  }
  async function removeOne(t) {
    if (!(await confirmBox('Suhbatni öçiriş', 'Bu suhbat butunlay öçiriladi.', 'Öçiriş', true))) return;
    try { await del(`/api/chat/threads/${t.id}`); afterDelete(new Set([t.id])); } catch (e) { toast(e.message); }
  }
  async function removePicked() {
    const ids = new Set(picked);
    if (!ids.size) return;
    const all = ids.size === threads.length;
    if (!(await confirmBox(all ? 'Barça suhbatlarni öçiriş' : 'Tanlangan suhbatlarni öçiriş', `${ids.size} ta suhbat butunlay öçiriladi. Buni qaytarib bölmaydi.`, 'Öçiriş', true))) return;
    try { await post('/api/chat/threads/delete', { ids: [...ids] }); afterDelete(ids); toast(`${ids.size} ta suhbat öçirildi`); } catch (e) { toast(e.message); }
  }
  function row(t) {
    const on = picked.has(t.id);
    const toggle = () => { on ? picked.delete(t.id) : picked.add(t.id); drawList(); };
    const meta = h('span', { class: 'th-meta' }, h('span', { class: 'th-title' }, t.title), h('span', { class: 'xs muted' }, fmtDate(t.updatedAt, state.me.profile.timezone)));
    if (selecting) {
      return h('div', { class: 'th-row' + (on ? ' picked' : '') },
        h('button', { type: 'button', class: 'th', role: 'checkbox', 'aria-checked': String(on), onclick: toggle },
          h('span', { class: 'th-check' }, on ? icon('check', 'sm') : null), meta));
    }
    return h('div', { class: 'th-row' },
      h('button', { type: 'button', class: 'th', 'aria-current': String(t.id === current), onclick: () => { current = t.id; openChat(); } }, icon(TOPIC_IC[t.topicId] || 'sparkles', 'sm'), meta),
      h('button', { type: 'button', class: 'th-del', 'aria-label': 'Suhbatni öçiriş', title: 'Öçiriş', onclick: () => removeOne(t) }, icon('trash', 'sm')));
  }
  function drawList() {
    const allOn = threads.length > 0 && picked.size === threads.length;
    mount(listBox,
      h('div', { class: 'th-head' },
        h('h2', { class: 'th-h2' }, icon('message'), h('span', { class: 'th-h2-t' }, 'Suhbatlar'), threads.length ? h('span', { class: 'th-count' }, threads.length) : null),
        threads.length ? h('button', { type: 'button', class: 'th-tool' + (selecting ? ' on' : ''), title: selecting ? 'Tanlaşni bekor qiliş' : 'Tanlab öçiriş', 'aria-label': selecting ? 'Tanlaşni bekor qiliş' : 'Tanlab öçiriş', 'aria-pressed': String(selecting), onclick: () => { selecting = !selecting; picked.clear(); drawList(); } }, icon(selecting ? 'x' : 'checkCircle', 'sm')) : null),
      selecting
        ? h('div', { class: 'th-bulk' },
          h('div', { class: 'th-row' + (allOn ? ' picked' : '') },
            h('button', { type: 'button', class: 'th th-all', role: 'checkbox', 'aria-checked': allOn ? 'true' : picked.size ? 'mixed' : 'false', onclick: () => { picked = allOn ? new Set() : new Set(threads.map((t) => t.id)); drawList(); } },
              h('span', { class: 'th-check' + (picked.size && !allOn ? ' mixed' : '') }, allOn ? icon('check', 'sm') : null), h('span', { class: 'th-title' }, 'Hammasini tanlaş'))),
          h('button', { type: 'button', class: 'btn small danger th-delbtn', disabled: !picked.size, onclick: removePicked }, icon('trash', 'sm'), picked.size ? `Öçiriş (${picked.size})` : 'Suhbatlarni tanlang'))
        : h('button', { type: 'button', class: 'btn th-new', onclick: () => { current = null; openChat(); } }, icon('plus'), 'Yangi suhbat'),
      h('div', { class: 'th-scroll' },
        threads.length ? threads.map(row) : h('p', { class: 'small muted', style: { margin: '4px' } }, 'Hali suhbat yöq.')));
  }
  function openChat() {
    chat?.stop();
    const th = threads.find((t) => t.id === current);
    const tid = th?.topicId || topicId;
    chat = createChat({ threadId: current, topicId: tid, lessonId: th?.lessonId || null, onSources: drawSources, onThread: (t) => { threads.unshift(t); current = t.id; drawList(); } });
    mount(chatBox,
      h('div', { class: 'row between', style: { alignItems: 'flex-start' } },
        h('div', {}, h('h1', { class: 'row', style: { margin: 0, fontSize: 'clamp(24px,2.4vw,34px)', flexWrap: 'nowrap' } }, h('span', { style: { color: 'var(--primary)' } }, icon('sparkles')), 'Mavzuni birga tuşunamiz'),
          h('p', { class: 'muted', style: { margin: '4px 0 0' } }, 'Fiziologiya mavzularini AI bilan sodda, tuşunarli va interaktiv örganing.'))),
      tid ? h('span', { class: 'ctx-pill', style: { alignSelf: 'flex-start' } }, icon('layers', 'sm'), `${tid} ${tTitle(tid) || ''}`, th?.lessonId ? [icon('arrowRight', 'sm'), th.title] : null) : null,
      chat.el);
    drawSources([]);
    drawList();
  }
  mount(el, h('div', { class: 'ai-layout' }, listBox, chatBox, srcBox));
  openChat();
  return () => chat?.stop();
}
