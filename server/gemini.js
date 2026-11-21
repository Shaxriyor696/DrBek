// Minimal Google Gemini client (Interactions API, REST + SSE streaming).
// Used when AI_PROVIDER=gemini: the free tier is enough for a pilot, and the model
// accepts audio directly, which powers the voice-question button.
const URL_ = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export const GEMINI_AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/m4a', 'audio/aac', 'audio/opus', 'audio/flac'];

// Streams one interaction. `input` is a string or an array of content blocks
// ({type:'text', text} / {type:'audio', data, mime_type}). Calls onText for every
// text delta of the model output; resolves with { text, status }.
// GEMINI_MODEL may list several models ("a,b,c"): free-tier models are often busy
// (503 / 429) or stall for a minute before the first word, so the next one is tried
// as long as no text has been streamed yet. Each model gets FIRST_TEXT_MS to start.
const FIRST_TEXT_MS = 20000;
export async function geminiStream(config, opts, onText = () => {}) {
  const models = String(config.geminiModel || '').split(',').map((m) => m.trim()).filter(Boolean);
  let lastErr;
  for (const [i, model] of models.entries()) {
    let sent = false;
    const ac = new AbortController();
    const onOuter = () => ac.abort(opts.signal.reason);
    opts.signal?.addEventListener('abort', onOuter, { once: true });
    // the last model in the list is allowed to take longer: there is nothing left to try
    const slow = i < models.length - 1 ? setTimeout(() => ac.abort(new Error('slow_start')), FIRST_TEXT_MS) : null;
    try {
      return await geminiStreamOne({ ...config, geminiModel: model }, { ...opts, signal: ac.signal }, (t) => { if (!sent) { sent = true; clearTimeout(slow); } onText(t); });
    } catch (e) {
      lastErr = e;
      const slowStart = ac.signal.aborted && ac.signal.reason?.message === 'slow_start';
      if (sent || opts.signal?.aborted || !(slowStart || [429, 500, 503].includes(e.status))) throw e;
      console.warn(`[gemini] ${model} ${slowStart ? `${FIRST_TEXT_MS / 1000}s içida javob boşlamadi` : `band (${e.status})`}, keyingi model sinaladi`);
    } finally {
      clearTimeout(slow);
      opts.signal?.removeEventListener('abort', onOuter);
    }
  }
  throw lastErr || new Error('GEMINI_MODEL böş');
}

async function geminiStreamOne(config, { system, input, maxTokens = 4096, thinking, signal, onActivity }, onText) {
  const body = {
    model: config.geminiModel,
    input,
    stream: true,
    generation_config: { max_output_tokens: maxTokens, ...(thinking ? { thinking_level: thinking } : {}) },
  };
  if (system) body.system_instruction = system;
  const r = await fetch(URL_, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiApiKey, 'api-revision': '2026-05-20' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const e = new Error(`Gemini ${r.status}: ${t.slice(0, 400)}`);
    e.status = r.status;
    throw e;
  }
  let text = '';
  let status = null;
  let buf = '';
  const dec = new TextDecoder();
  const handle = (raw) => {
    let event = null;
    const data = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    const payload = data.join('\n');
    if (payload === '[DONE]') return;
    let d;
    try { d = JSON.parse(payload); } catch { return; }
    const type = event || d.event_type;
    if (type === 'error' || d.error) {
      const e = new Error(`Gemini: ${d.error?.message || 'stream error'}`);
      e.status = Number(d.error?.code) || 500;
      throw e;
    }
    if (type === 'step.delta' && d.delta?.type === 'text' && typeof d.delta.text === 'string') {
      text += d.delta.text;
      onText(d.delta.text);
    }
    const st = d.interaction?.status || d.status;
    if (typeof st === 'string') status = st;
  };
  // plain reader loop: works the same in Node and in Cloudflare Workers
  const reader = r.body.getReader();
  for (;;) {
    const { value: chunk, done } = await reader.read();
    if (done) break;
    onActivity?.(); // keep-alives and thinking steps count as progress, not only text
    buf += dec.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 2); }
  }
  if (buf.trim()) handle(buf);
  return { text, status };
}

// Turns "[1]" / "[1, 3]" markers in a Gemini answer into citation offsets, the
// shape the chat UI already renders for Claude citations. Unknown numbers are dropped.
export function extractCitations(raw, sources) {
  // merge neighbours like "[3], [4]" into "[3, 4]" so no stray comma is left behind
  let prev;
  do { prev = raw; raw = raw.replace(/(\[\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\]\s*[,;]?\s*\[(?=\d)/g, '$1, '); } while (raw !== prev);
  const byN = new Map(sources.map((s) => [s.n, s]));
  const citations = [];
  let out = '';
  let last = 0;
  for (const m of raw.matchAll(/ ?\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\]/g)) {
    out += raw.slice(last, m.index);
    last = m.index + m[0].length;
    for (const n of m[1].split(/[,;]/).map((x) => Number(x.trim()))) {
      const src = byN.get(n);
      if (!src) continue;
      citations.push({ n: src.n, sourceId: src.sourceId, title: src.title, citedText: (src.text || '').slice(0, 400), lessonId: src.lessonId, blockId: src.blockId, pdfPage: src.pdfPage, bookEditionId: src.bookEditionId, imageId: src.imageId, at: out.length });
    }
  }
  out += raw.slice(last);
  return { text: out, citations };
}
