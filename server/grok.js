// Minimal xAI Grok client (OpenAI-compatible Chat Completions, REST + SSE streaming).
// Used when AI_PROVIDER=grok. Grok has no search_result citations either, so it gets the
// same numbered-source prompt as Gemini (geminiPrompt / SYSTEM_GEMINI) and the answer goes
// through extractCitations(). Voice questions still need Gemini (Grok chat takes no audio).
const URL_ = 'https://api.x.ai/v1/chat/completions';

// GROK_MODEL may list several models ("a,b"): the next one is tried while no text has
// been streamed yet — on busy/limit errors (429/5xx), on an unknown model id (400/404,
// e.g. a retired model name) and when the first word takes longer than FIRST_TEXT_MS.
const FIRST_TEXT_MS = 20000;
export async function grokStream(config, opts, onText = () => {}) {
  const models = String(config.grokModel || '').split(',').map((m) => m.trim()).filter(Boolean);
  let lastErr;
  for (const [i, model] of models.entries()) {
    let sent = false;
    const ac = new AbortController();
    const onOuter = () => ac.abort(opts.signal.reason);
    opts.signal?.addEventListener('abort', onOuter, { once: true });
    const last = i === models.length - 1;
    const slow = last ? null : setTimeout(() => ac.abort(new Error('slow_start')), FIRST_TEXT_MS);
    try {
      return await grokStreamOne(config.grokApiKey, model, { ...opts, signal: ac.signal }, (t) => { if (!sent) { sent = true; clearTimeout(slow); } onText(t); });
    } catch (e) {
      lastErr = e;
      const slowStart = ac.signal.aborted && ac.signal.reason?.message === 'slow_start';
      if (sent || opts.signal?.aborted || !(slowStart || [400, 404, 429, 500, 502, 503].includes(e.status))) throw e;
      console.warn(`[grok] ${model} ${slowStart ? `${FIRST_TEXT_MS / 1000}s içida javob boşlamadi` : `xato (${e.status})`}, keyingi model sinaladi`);
    } finally {
      clearTimeout(slow);
      opts.signal?.removeEventListener('abort', onOuter);
    }
  }
  throw lastErr || new Error('GROK_MODEL böş');
}

async function grokStreamOne(apiKey, model, { system, input, maxTokens = 4096, signal, onActivity }, onText) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: input });
  const r = await fetch(URL_, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: maxTokens }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const e = new Error(`Grok ${r.status}: ${t.slice(0, 400)}`);
    e.status = r.status;
    throw e;
  }
  let text = '';
  let status = null;
  let buf = '';
  const dec = new TextDecoder();
  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let d;
    try { d = JSON.parse(payload); } catch { return; }
    if (d.error) {
      const e = new Error(`Grok: ${d.error.message || 'stream error'}`);
      e.status = Number(d.error.code) || 500;
      throw e;
    }
    const ch = d.choices?.[0];
    const delta = ch?.delta?.content;
    if (typeof delta === 'string' && delta) { text += delta; onText(delta); }
    if (ch?.finish_reason) status = ch.finish_reason;
  };
  const reader = r.body.getReader();
  for (;;) {
    const { value: chunk, done } = await reader.read();
    if (done) break;
    onActivity?.(); // reasoning models stream for a while before the first visible word
    buf += dec.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  if (buf.trim()) handle(buf.trim());
  return { text, status };
}
