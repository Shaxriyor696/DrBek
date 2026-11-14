import { h, icon, mount, toast, confirmBox, fmtDate } from '../ui.js';
import { get, del } from '../api.js';
import { createChat } from '../chat.js';
import { openFigure } from '../common.js';

const TOPIC_IC = { '03': 'heart', '04': 'heart', '07': 'cloud' };

export async function assistant({ el, query, state }) {
  let { threads } = await get('/api/chat/threads');
  const { topics } = await get('/api/topics');
  let current = query.thread || null;
  const topicId = query.topic || null;
  const listBox = h('nav', { class: 'card pad threads stack', style: { gap: '4px', padding: '12px' }, 'aria-label': 'Suhbatlar' });
  const chatBox = h('section', { class: 'card pad chat-page', style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '10px' } });
  const srcBox = h('aside', { class: 'card pad' });
  let chat = null;
  const tTitle = (id) => topics.find((t) => t.id === id)?.title;
  function drawSources(sources) {
    mount(srcBox,
      h('div', { class: 'row between', style: { flexWrap: 'nowrap', borderBottom: '1px solid var(--border)', paddingBottom: '12px' } }, h('h2', { class: 'row', style: { margin: 0, fontSize: '22px', flexWrap: 'nowrap' } }, h('span', { style: { color: 'var(--primary)' } }, icon('layers')), 'Manbalar'), h('span', { class: 'muted', title: 'Javoblar faqat ilovadagi kitob materialidan olinadi' }, icon('info'))),
      sources?.length ? h('ul', { class: 'src-list' }, sources.map((s) => h('li', {},
        h('b', {}, `[${s.n}] `), s.imageId ? h('button', { type: 'button', class: 'figref', onclick: () => openFigure(s.imageId) }, s.title) : s.lessonId ? h('a', { href: `/topics/${s.topicId}/sections/${s.lessonId}${s.blockId ? `#${s.blockId}` : ''}` }, s.title) : h('span', {}, s.title),
        h('div', { class: 'xs muted' }, `${s.lang === 'en' ? 'Asl matn (EN)' : s.kind === 'figure' ? 'Kitob rasmi' : 'O‘zbekcha matn'}${s.printedPage ? ` · kitob ${s.printedPage}-bet` : ''}`),
        s.snippet ? h('div', { class: 'xs', style: { marginTop: '4px' } }, `“${s.snippet.replace(/\*\*/g, '').slice(0, 220)}…”`) : null)))
        : h('div', { class: 'src-empty' }, icon('book'), h('h3', { style: { margin: '10px 0 4px' } }, 'Manbalar shu yerda chiqadi'), h('p', { class: 'small muted' }, 'Savol bersangiz, javobga asos bo‘lgan kitob parchalari va rasmlari shu panelda ko‘rsatiladi.')));
  }
  function drawList() {
    mount(listBox,
      h('h2', { class: 'row', style: { margin: '2px 4px 8px', fontSize: '19px', flexWrap: 'nowrap' } }, icon('message'), 'Suhbatlar'),
      threads.length ? threads.map((t) => h('div', { class: 'row', style: { gap: '2px', flexWrap: 'nowrap' } },
        h('button', { type: 'button', class: 'th', 'aria-current': String(t.id === current), onclick: () => { current = t.id; openChat(); } }, icon(TOPIC_IC[t.topicId] || 'sparkles', 'sm'),
          h('span', { class: 'stack grow', style: { gap: 0, minWidth: 0 } }, h('span', { class: 'small', style: { fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.title), h('span', { class: 'xs muted' }, fmtDate(t.updatedAt, state.me.profile.timezone)))),
        h('button', { type: 'button', class: 'icon-btn', style: { width: '32px', height: '32px', border: 0, background: 'transparent' }, 'aria-label': 'Suhbatni o‘chirish', onclick: async () => { if (!(await confirmBox('Suhbatni o‘chirish', 'Bu suhbat butunlay o‘chiriladi.', 'O‘chirish', true))) return; try { await del(`/api/chat/threads/${t.id}`); threads = threads.filter((x) => x.id !== t.id); if (current === t.id) { current = null; openChat(); } drawList(); } catch (e) { toast(e.message); } } }, icon('trash', 'sm')))) : h('p', { class: 'small muted', style: { margin: '4px' } }, 'Hali suhbat yo‘q.'),
      h('button', { type: 'button', class: 'btn', style: { borderColor: 'var(--primary)', color: 'var(--primary)', marginTop: '8px' }, onclick: () => { current = null; openChat(); } }, icon('plus'), 'Yangi suhbat'));
  }
  function openChat() {
    chat?.stop();
    const th = threads.find((t) => t.id === current);
    const tid = th?.topicId || topicId;
    chat = createChat({ threadId: current, topicId: tid, lessonId: th?.lessonId || null, onSources: drawSources, onThread: (t) => { threads.unshift(t); current = t.id; drawList(); } });
    mount(chatBox,
      h('div', { class: 'row between', style: { alignItems: 'flex-start' } },
        h('div', {}, h('h1', { class: 'row', style: { margin: 0, fontSize: 'clamp(24px,2.4vw,34px)', flexWrap: 'nowrap' } }, h('span', { style: { color: 'var(--primary)' } }, icon('sparkles')), 'Mavzuni birga tushunamiz'),
          h('p', { class: 'muted', style: { margin: '4px 0 0' } }, 'Fiziologiya mavzularini AI bilan sodda, tushunarli va interaktiv o‘rganing.'))),
      tid ? h('span', { class: 'ctx-pill', style: { alignSelf: 'flex-start' } }, icon('layers', 'sm'), `${tid} ${tTitle(tid) || ''}`, th?.lessonId ? [icon('arrowRight', 'sm'), th.title] : null) : null,
      chat.el);
    drawSources([]);
    drawList();
  }
  mount(el, h('div', { class: 'ai-layout' }, listBox, chatBox, srcBox));
  openChat();
  return () => chat?.stop();
}
