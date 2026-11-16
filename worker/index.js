// DrBek AI proxy (Cloudflare Worker). The GitHub Pages site is static, so it cannot hold the
// Gemini key; this Worker keeps the key as a secret (GEMINI_API_KEY) and answers two calls:
//   POST /chat        { question, ctxText?, history?, sources[] } → SSE: delta… then done
//   POST /transcribe  { audio (base64), mimeType }                → { text }
// The page does retrieval itself (book passages from its own search index) and sends the
// passages along; the Worker builds the same prompt as the Node server (server/ai-core.js).
import { geminiStream, extractCitations, GEMINI_AUDIO_TYPES } from '../server/gemini.js';
import { SYSTEM_GEMINI, TRANSCRIBE_PROMPT, plainAnswer, geminiPrompt } from '../server/ai-core.js';

const DEFAULT_ORIGINS = 'https://shaxriyor696.github.io,http://localhost:3000';
const PER_MINUTE = 10;
const hits = new Map(); // best-effort per-IP limit (per Worker instance)

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

function cors(origin) {
  return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin' };
}
const json = (status, body, origin) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) } });

function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > PER_MINUTE;
}

function cfg(env, voice = false) {
  return {
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: (voice ? env.GEMINI_VOICE_MODEL : env.GEMINI_MODEL) || (voice ? 'gemini-3-flash-preview,gemini-3.1-flash-lite' : 'gemini-3-flash-preview,gemini-3.5-flash-lite,gemini-3.1-flash-lite'),
  };
}

async function chat(req, env, origin) {
  let b;
  try { b = await req.json(); } catch { return json(400, { message: 'JSON noto’g’ri.' }, origin); }
  const question = str(b.question, 2000).trim();
  if (!question) return json(422, { message: 'Savolingizni yozing.' }, origin);
  const sources = (Array.isArray(b.sources) ? b.sources : []).slice(0, 8)
    .map((s, i) => ({ n: i + 1, title: str(s?.title, 300), text: str(s?.text, 2200), pdfPage: Number.isInteger(s?.pdfPage) ? s.pdfPage : null }))
    .filter((s) => s.text || s.title);
  if (!sources.length) return json(422, { message: 'Manba parchalari kerak.' }, origin);
  const hist = (Array.isArray(b.history) ? b.history : []).slice(-8)
    .map((m) => ({ role: m?.role === 'user' ? 'user' : 'assistant', content: str(m?.content, 4000) })).filter((m) => m.content);
  const ctxText = [str(b.ctxText, 3500), `Savol: ${question}`].filter(Boolean).join('\n');
  const prompt = geminiPrompt({ hist, sources, ctxText });

  const { readable, writable } = new TransformStream();
  const w = writable.getWriter(); const enc = new TextEncoder();
  const send = (event, data) => w.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  (async () => {
    const ac = new AbortController();
    let idle = setTimeout(() => ac.abort(new Error('timeout')), 30000);
    const bump = () => { clearTimeout(idle); idle = setTimeout(() => ac.abort(new Error('timeout')), 30000); };
    try {
      const out = await geminiStream(cfg(env), { system: SYSTEM_GEMINI, input: prompt, maxTokens: 4096, thinking: env.GEMINI_THINKING || 'low', signal: ac.signal, onActivity: bump }, (t) => { bump(); send('delta', { text: t }); });
      const { text, citations } = extractCitations(plainAnswer(out.text), sources);
      await send('done', { content: text, cites: citations.map((c) => ({ n: c.n, at: c.at })) });
    } catch (e) {
      const timeout = ac.signal.aborted;
      console.error('[chat]', e.status || '', e.message);
      await send('error', { message: timeout ? 'AI 30 soniya javob bermadi. Qayta urinib ko’ring.' : e.status === 429 ? 'Bepul AI limiti vaqtincha tugadi. Bir daqiqadan so’ng qayta urinib ko’ring.' : 'AI xizmatida xato. Birozdan so’ng qayta urinib ko’ring.' });
    } finally { clearTimeout(idle); await w.close(); }
  })();
  return new Response(readable, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', ...cors(origin) } });
}

async function transcribe(req, env, origin) {
  let b;
  try { b = await req.json(); } catch { return json(400, { message: 'JSON noto’g’ri.' }, origin); }
  const audio = str(b.audio, 4 * 1024 * 1024);
  if (!audio || !/^[A-Za-z0-9+/=]+$/.test(audio) || !GEMINI_AUDIO_TYPES.includes(b.mimeType)) return json(422, { message: 'Audio noto’g’ri.' }, origin);
  try {
    const r = await geminiStream(cfg(env, true), { input: [{ type: 'text', text: TRANSCRIBE_PROMPT }, { type: 'audio', data: audio, mime_type: b.mimeType }], maxTokens: 1024, thinking: 'low' });
    return json(200, { text: r.text.trim().slice(0, 2000) }, origin);
  } catch (e) {
    console.error('[transcribe]', e.status || '', e.message);
    return json(502, { message: 'Ovozni matnga aylantirib bo’lmadi. Qayta urinib ko’ring yoki savolni yozing.' }, origin);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim());
    if (url.pathname === '/' && req.method === 'GET') return new Response('DrBek AI proxy: ishlayapti', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (!allowed.includes(origin)) return new Response('Forbidden', { status: 403 });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (req.method !== 'POST') return json(405, { message: 'POST kerak.' }, origin);
    if (!env.GEMINI_API_KEY) return json(503, { message: 'AI kaliti sozlanmagan.' }, origin);
    if (limited(req.headers.get('cf-connecting-ip') || 'x')) return json(429, { message: 'Juda ko’p so’rov. Bir daqiqadan so’ng qayta urinib ko’ring.' }, origin);
    if (url.pathname === '/chat') return chat(req, env, origin);
    if (url.pathname === '/transcribe') return transcribe(req, env, origin);
    return json(404, { message: 'Topilmadi.' }, origin);
  },
};
