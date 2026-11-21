// Source-grounded AI chat widget, shared by the reader side panel and the assistant page.
import { h, icon, mount, toast } from './ui.js?v=mwqduuu9';
import { get, post, streamPost } from './api.js?v=mwqduuu9';
import { openFigure } from './common.js?v=mwqduuu9';
import { navigate } from './main.js?v=mwqduuu9';

const QUICK = [['explain', 'Soddalaştir', 'zap'], ['example', 'Misol keltir', 'book'], ['term', 'Atamani izohla', 'file'], ['quiz', 'Savol ber', 'help']];

export function createChat({ lessonId = null, topicId = null, threadId = null, onThread, compact = false, onSaveNote, onSources } = {}) {
  let tid = threadId;
  let status = null;
  let busy = null; // AbortController while streaming
  const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
  const ta = h('textarea', { rows: 2, placeholder: 'Savolingizni yozing…', 'aria-label': 'AI ga savol', maxlength: 2000 });
  const sendBtn = h('button', { type: 'submit', class: 'btn primary', 'aria-label': 'Yuboriş' }, icon('send'));
  const micBtn = h('button', { type: 'button', class: 'btn mic-btn hidden', 'aria-label': 'Ovozli savol', title: 'Ovozli savol: bosing, gapiring, yana bosing' }, icon('mic'));
  const ctxChip = h('div', { class: 'ctx-chip hidden' });
  let pendingSel = null;
  const notice = h('div', { class: 'banner info hidden', style: { marginBottom: '8px' } });

  const form = h('form', { class: 'stack', style: { gap: '8px' }, onsubmit: (e) => { e.preventDefault(); ask({ text: ta.value.trim() }); } },
    ctxChip,
    h('div', { class: 'quick' }, QUICK.map(([a, l, ic]) => h('button', { type: 'button', onclick: () => ask({ action: a, text: ta.value.trim() }) }, h('span', { style: { color: 'var(--primary)' } }, icon(ic, 'sm')), l))),
    h('div', { class: 'chat-input' }, ta, micBtn, sendBtn));

  // Voice question: record with MediaRecorder (max 60 s), the server turns it into
  // text, and the text lands in the input box for the student to check and send.
  let rec = null;
  const MAX_REC_MS = 60000;
  const audioType = (t) => { const base = (t || '').split(';')[0]; return base === 'audio/mp4' || base === 'audio/x-m4a' ? 'audio/m4a' : base; };
  const toB64 = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = reject; r.readAsDataURL(blob); });
  const micIdle = () => { micBtn.classList.remove('rec'); micBtn.disabled = false; mount(micBtn, icon('mic')); micBtn.setAttribute('aria-label', 'Ovozli savol'); };
  micBtn.addEventListener('click', async () => {
    if (rec) { rec.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { toast('Bu brauzer ovoz yozişni qöllamaydi.'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast('Mikrofonga ruxsat berilmadi.'); return; }
    const pref = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t));
    const r = new MediaRecorder(stream, pref ? { mimeType: pref } : undefined);
    const parts = [];
    const timer = setTimeout(() => r.state === 'recording' && r.stop(), MAX_REC_MS);
    r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    r.onstop = async () => {
      clearTimeout(timer); rec = null;
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(parts, { type: r.mimeType || pref || 'audio/webm' });
      if (blob.size < 1000) { micIdle(); return; }
      micBtn.classList.remove('rec'); micBtn.disabled = true; mount(micBtn, h('span', { class: 'xs' }, '…'));
      const ph = ta.placeholder; ta.placeholder = 'Ovoz matnga aylantirilmoqda…';
      try {
        const res = await post('/api/chat/transcribe', { mimeType: audioType(blob.type), audio: await toB64(blob) });
        if (res.text) { ta.value = [ta.value.trim(), res.text].filter(Boolean).join(' '); ta.focus(); }
        else toast('Ovoz tuşunilmadi. Qayta urinib köring.');
      } catch (e) { toast(e.message); }
      ta.placeholder = ph;
      micIdle();
    };
    r.start();
    rec = r;
    micBtn.classList.add('rec'); mount(micBtn, icon('stop')); micBtn.setAttribute('aria-label', 'Yozişni töxtatiş');
  });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

  const el = h('div', { class: 'chat stack', style: { gap: '8px', minHeight: 0 } }, notice, log, h('p', { class: 'xs muted chat-disclaimer', style: { margin: 0 } }, 'Javoblar faqat ilovadagi kitob materialiga tayanadi. Tibbiy maslahat emas.'), form);

  function setSelection(sel) {
    pendingSel = sel;
    if (!sel) { ctxChip.classList.add('hidden'); return; }
    mount(ctxChip, icon('file', 'sm'), h('span', { class: 'grow' }, `Belgilangan matn: “${sel.text.slice(0, 140)}${sel.text.length > 140 ? '…' : ''}”`),
      h('button', { type: 'button', class: 'icon-btn', style: { width: '28px', height: '28px', minHeight: 0 }, 'aria-label': 'Olib taşlaş', onclick: () => setSelection(null) }, icon('x', 'sm')));
    ctxChip.classList.remove('hidden');
  }

  function sourceList(sources, citations) {
    if (!sources?.length) return null;
    const cited = new Set((citations || []).map((c) => c.sourceId));
    const shown = cited.size ? sources.filter((s) => cited.has(s.sourceId)) : sources;
    return h('details', { open: !cited.size },
      h('summary', { class: 'xs', style: { cursor: 'pointer', fontWeight: 700 } }, cited.size ? `Manbalar (${shown.length})` : `Topilgan manba parçalari (${shown.length})`),
      h('ul', { class: 'src-list' }, shown.map((s) => h('li', { id: `src-${s.sourceId}` },
        h('b', {}, `[${s.n}] `), srcLink(s),
        h('div', { class: 'xs muted' }, `${s.lang === 'en' ? 'Ma’lumot (EN)' : s.kind === 'figure' ? 'Kitob rasmi' : 'Umumiy ma’lumot'}${s.pdfPage ? ` · kitob ${s.printedPage}-bet (PDF ${s.pdfPage})` : ''}${s.lessonStatus && s.lessonStatus !== 'published' ? ' · tekşiruvda' : ''}`),
        s.snippet ? h('div', { class: 'xs', style: { marginTop: '4px' } }, `“${s.snippet.replace(/\*\*/g, '')}…”`) : null))));
  }
  function srcLink(s) {
    if (s.imageId) return h('button', { type: 'button', class: 'figref', onclick: () => openFigure(s.imageId) }, s.title);
    if (s.lessonId) return h('a', { href: `/topics/${s.topicId}/sections/${s.lessonId}?tab=${s.lang === 'en' ? 'full' : 'simple'}${s.blockId ? `#${s.blockId}` : ''}` }, s.title);
    return h('span', {}, s.title);
  }

  // Render answer text with citation markers inserted at their character offsets.
  function answerBody(text, citations, sources) {
    const box = h('div', { class: 'bubble' });
    const marks = [...(citations || [])].sort((a, b) => a.at - b.at);
    let last = 0;
    const seenAt = new Set();
    for (const c of marks) {
      const key = `${c.at}:${c.n}`;
      if (seenAt.has(key)) continue; seenAt.add(key);
      box.appendChild(document.createTextNode(text.slice(last, c.at)));
      box.appendChild(h('button', { type: 'button', class: 'cite', title: c.citedText ? `“${c.citedText}”` : c.title, 'aria-label': `Manba ${c.n}: ${c.title}`, onclick: () => {
        if (c.imageId) openFigure(c.imageId);
        else if (c.lessonId) navigate(`/topics/${(sources || []).find((s) => s.sourceId === c.sourceId)?.topicId || ''}/sections/${c.lessonId}${c.blockId ? `#${c.blockId}` : ''}`);
      } }, String(c.n)));
      last = c.at;
    }
    box.appendChild(document.createTextNode(text.slice(last)));
    return box;
  }

  function renderMsg(m) {
    if (m.role === 'user') {
      return h('div', { class: 'msg user' }, m.context?.selection ? h('div', { class: 'xs muted', style: { marginLeft: '24px' } }, `Belgilangan: “${m.context.selection.slice(0, 100)}…”`) : null, h('div', { class: 'bubble' }, m.content));
    }
    const sources = m.context?.sources || [];
    const warn = { no_source: 'Manbada topilmadi', unavailable: 'AI ulanmagan', timeout: 'Vaqt tugadi', error: 'Xato', stopped: 'Töxtatildi', refused: 'Javob berilmadi' }[m.status];
    return h('div', { class: 'msg ai' },
      h('div', { class: 'row xs muted', style: { gap: '6px', marginBottom: '4px' } }, icon('sparkles', 'sm'), 'AI yordamçi', warn ? h('span', { class: 'badge warn' }, warn) : null,
        m.status === 'complete' && !(m.citations || []).length ? h('span', { class: 'badge warn', title: 'Javobda manbaga havola yöq — ehtiyot böling' }, 'Manbasiz') : null),
      answerBody(m.content || '', m.citations, sources),
      sourceList(sources, m.citations),
      m.id && ['complete'].includes(m.status) ? h('div', { class: 'row', style: { gap: '6px', marginTop: '6px' } },
        h('button', { type: 'button', class: 'btn small', onclick: async () => { try { await post('/api/bookmarks', { targetType: 'ai_answer', targetId: m.id, title: (m.content || '').slice(0, 80), snippet: (m.content || '').slice(0, 600) }); toast('Javob saqlandi.'); } catch (e) { toast(e.message); } } }, icon('bookmark', 'sm'), 'Saqlaş'),
        onSaveNote ? h('button', { type: 'button', class: 'btn small', onclick: () => onSaveNote(m) }, icon('note', 'sm'), 'Qaydga') : null) : null);
  }

  async function load() {
    try {
      status = await get('/api/chat/status');
      if (!status.available) { notice.textContent = status.demo ? 'Web körinişda AI ulanmagan. Savol yuborsangiz, kitobdan mos parçalar körsatiladi.' : `AI hali ulanmagan: serverda ${({ gemini: 'GEMINI_API_KEY', grok: 'XAI_API_KEY' })[status.provider] || 'ANTHROPIC_API_KEY'} yöq. Savol yuborsangiz, kitobdan mos parçalar körsatiladi.`; notice.classList.remove('hidden'); }
      if (status.voice) micBtn.classList.remove('hidden');
      if (tid) {
        const r = await get(`/api/chat/threads/${tid}`);
        mount(log, r.messages.map(renderMsg));
        const lastAi = [...r.messages].reverse().find((m) => m.role !== 'user');
        onSources?.(lastAi?.context?.sources || []);
      } else mount(log, compact
        ? h('div', { class: 'msg ai chat-hello' }, h('div', { class: 'bubble' }, 'Salom! Savolingizni yozing, mikrofon orqali ayting yoki pastdagi tugmalardan birini tanlang. Javoblar kitobga havola bilan beriladi.'))
        : h('p', { class: 'small muted' }, 'Savol bering — javob kitobdagi materiallarga havola bilan beriladi.'));
      log.scrollTop = log.scrollHeight;
    } catch (e) { mount(log, h('p', { class: 'small' }, e.message)); }
  }

  async function ask({ text = '', action = null, selection = null, blockId = null } = {}) {
    if (busy) return;
    const sel = selection || pendingSel;
    if (!text && !action) { ta.focus(); return; }
    if (!tid) {
      try { const r = await post('/api/chat/threads', { lessonId: lessonId || undefined, topicId: !lessonId && topicId ? topicId : undefined }); tid = r.thread.id; onThread?.(r.thread); }
      catch (e) { toast(e.message); return; }
      mount(log);
    }
    ta.value = ''; setSelection(null);
    log.appendChild(renderMsg({ role: 'user', content: [action ? QUICK.find((q) => q[0] === action)?.[1] || action : '', text].filter(Boolean).join(': '), context: { selection: sel?.text } }));
    const live = h('div', { class: 'bubble' }, h('span', { class: 'muted' }, 'Manbalar qidirilmoqda…'));
    const liveWrap = h('div', { class: 'msg ai' }, h('div', { class: 'row xs muted', style: { gap: '6px', marginBottom: '4px' } }, icon('sparkles', 'sm'), 'AI yordamçi'), live);
    log.appendChild(liveWrap); log.scrollTop = log.scrollHeight;
    busy = new AbortController();
    mount(sendBtn, icon('stop')); sendBtn.type = 'button'; sendBtn.setAttribute('aria-label', 'Töxtatiş');
    const stop = () => busy?.abort();
    sendBtn.addEventListener('click', stop, { once: true });
    let sources = []; let textAcc = ''; const cits = [];
    try {
      await streamPost(`/api/chat/threads/${tid}/messages`, { text: text || undefined, action: action || undefined, selection: sel?.text, blockId: sel?.blockId || blockId || undefined, lessonId: lessonId || undefined }, {
        signal: busy.signal,
        onEvent: (ev, d) => {
          if (ev === 'sources') { sources = d.sources; onSources?.(d.sources); mount(live, h('span', { class: 'muted' }, sources.length ? `${sources.length} ta manba topildi, javob yozilmoqda…` : 'Manba topilmadi.')); }
          else if (ev === 'delta') { if (!textAcc) mount(live); textAcc += d.text; live.textContent = textAcc; log.scrollTop = log.scrollHeight; }
          else if (ev === 'citation') cits.push(d);
          else if (ev === 'done') liveWrap.replaceWith(renderMsg({ id: d.messageId, role: 'assistant', content: d.content, citations: d.citations, status: d.status === 'complete_uncited' ? 'complete' : d.status, context: { sources } }));
          else if (ev === 'error') liveWrap.replaceWith(renderMsg({ role: 'assistant', content: `${d.partial || ''}${d.partial ? '\n\n' : ''}${d.message}`, citations: cits, status: d.status, context: { sources } }));
        },
      });
    } catch (e) {
      if (e.name === 'AbortError') liveWrap.replaceWith(renderMsg({ role: 'assistant', content: `${textAcc}\n\n(Töxtatildi)`, citations: cits, status: 'stopped', context: { sources } }));
      else liveWrap.replaceWith(h('div', { class: 'banner danger' }, e.message));
    } finally {
      sendBtn.removeEventListener('click', stop);
      busy = null; mount(sendBtn, icon('send')); sendBtn.type = 'submit'; sendBtn.setAttribute('aria-label', 'Yuboriş');
      log.scrollTop = log.scrollHeight;
    }
  }

  load();
  return { el, ask, setSelection, stop: () => busy?.abort(), get threadId() { return tid; } };
}
