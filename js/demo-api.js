// Web preview ("demo") backend: answers /api/* calls in the browser.
// Book content comes from JSON snapshots of the real API (demo/data/*.json, built by
// tools/build-demo.mjs); the student's own state (progress, reading time, saved items,
// notes, tests, chats) lives in localStorage. The AI goes through the AI Worker when
// window.DS_AI_URL is set (see aiAnswer); otherwise only matching book passages are shown.
import { ApiErr } from './api.js?v=mwqeam7z';
import { normalizeSearchText as norm } from './search-text.js?v=mwqeam7z';

const KEY = 'ds-demo-state-v1';
const TZ_DEF = 'Asia/Tashkent';
const cache = new Map();
const load = (rel) => {
  if (!cache.has(rel)) cache.set(rel, fetch(rel).then((r) => { if (!r.ok) throw new ApiErr(404, { message: 'Ma’lumot topilmadi.' }); return r.json(); }));
  return cache.get(rel);
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const nowIso = () => new Date().toISOString();
const rid = (p) => `${p}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
const err = (status, message, extra) => new ApiErr(status, { message, ...extra });

// ------------------------------------------------------------------ state
let S = null;
function blank() {
  return {
    v: 1, loggedIn: true,
    profile: { name: 'Mehmon', university: '', course: 2, direction: 'Davolaş işi', studyLang: 'uz', dailyGoalMin: 30, timezone: TZ_DEF, readerFont: 18, readerLine: 1.7, onboarded: true },
    progress: {}, intervals: [], bookmarks: [], collections: [], notes: [], attempts: [], answers: {}, threads: [], messages: [],
  };
}
function st() {
  if (S) return S;
  try { S = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { S = null; }
  if (!S || S.v !== 1) { S = blank(); S.seedPending = true; }
  return S;
}
function persist() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* private mode: state lives for this tab only */ } }

// A small, clearly labelled sample history so the dashboards are not empty on first visit.
async function seed() {
  const s = st();
  if (!s.seedPending) return;
  delete s.seedPending;
  s.sample = true;
  const day = 864e5; const now = Date.now();
  const mins = [18, 25, 0, 32, 14, 27, 9];
  mins.forEach((m, i) => { if (!m) return; const end = now - (6 - i) * day - 3600e3 * 2; s.intervals.push([end - m * 60e3, end]); });
  const t = new Date(now - day).toISOString();
  s.progress.ch09 = { firstOpenedAt: t, updatedAt: t, completedAt: t, lastBlock: null, lastTab: 'simple', reviewFlag: false };
  s.progress.ch10 = { firstOpenedAt: t, updatedAt: new Date(now - 3600e3).toISOString(), completedAt: null, lastBlock: null, lastTab: 'uzfull', reviewFlag: false };
  const qs = (await load('demo/data/questions.json')).filter((q) => q.topicId === '03').slice(0, 5);
  if (qs.length) {
    const a = makeAttempt('topic', '03', 'practice', qs);
    a.startedAt = new Date(now - day - 600e3).toISOString();
    s.answers[a.id] = {};
    qs.forEach((q, i) => { s.answers[a.id][q.id] = { optionId: i === 2 ? q.options.find((o) => o.id !== q.answerOptionId).id : q.answerOptionId, flagged: false, checkedAt: null }; });
    submit(a);
    a.submittedAt = new Date(now - day).toISOString();
  }
  persist();
}

// ------------------------------------------------------------------ helpers
const dayKey = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const addDays = (key, n) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekStart = (key) => addDays(key, -((new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7));
function merged() {
  const iv = st().intervals.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of iv) { const l = out[out.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]); }
  return out;
}
function secByDay(tz) {
  const m = new Map();
  for (const [a, b] of merged()) { // intervals are short; split at local midnight by minute steps
    for (let s = a; s < b;) { const e = Math.min(b, s + 60e3); const k = dayKey(s, tz); m.set(k, (m.get(k) || 0) + (e - s) / 1000); s = e; }
  }
  return m;
}

async function topicsData() { return load('demo/data/topics.json'); }
async function lessonIndex() {
  const t = await topicsData();
  if (!lessonIndex.m) {
    const m = new Map();
    for (const tp of t.topics) { const d = await load(`demo/data/topic-${tp.id}.json`); for (const s of d.sections) m.set(s.id, { topicId: tp.id, titleUz: s.titleUz, visible: s.visible !== false }); }
    lessonIndex.m = m;
  }
  return lessonIndex.m;
}
const done = () => new Set(Object.entries(st().progress).filter(([, p]) => p.completedAt).map(([k]) => k));
const savedSet = (type) => new Set(st().bookmarks.filter((b) => b.targetType === type && !b.deletedAt).map((b) => b.targetId));
const pct = (c, t) => (t ? Math.round((c / t) * 1000) / 10 : null);
const submittedAttempts = () => st().attempts.filter((a) => a.status === 'submitted');

async function figurePack(imageId) {
  const m = /^gh14-(?:fig|tab)-(\d{2})-/.exec(imageId || '');
  if (!m) return {};
  try { return await load(`demo/media/ch${m[1]}.json`); } catch { return {}; }
}
async function withUrl(f) {
  const pack = await figurePack(f.imageId);
  return { ...f, url: pack[f.imageId] || null };
}

// ------------------------------------------------------------------ analytics (port of server/analytics.js)
async function analytics(range = 'week') {
  const s = st(); const tz = s.profile.timezone || TZ_DEF; const now = Date.now();
  const today = dayKey(now, tz);
  const sec = secByDay(tz);
  const completions = Object.entries(s.progress).filter(([, p]) => p.completedAt).map(([lid, p]) => ({ lessonId: lid, completedAt: p.completedAt }));
  const attempts = submittedAttempts();
  const bucketOf = (k) => (range === 'day' ? k : range === 'week' ? weekStart(k) : k.slice(0, 7));
  const buckets = [];
  if (range === 'day') for (let i = 13; i >= 0; i--) buckets.push(addDays(today, -i));
  else if (range === 'week') for (let i = 11; i >= 0; i--) buckets.push(weekStart(addDays(today, -7 * i)));
  else { const [y, m] = today.split('-').map(Number); for (let i = 11; i >= 0; i--) buckets.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7)); }
  const series = new Map(buckets.map((b) => [b, { bucket: b, activeMinutes: 0, lessonsCompleted: 0, quizzes: 0, correct: 0, questions: 0 }]));
  for (const [k, v] of sec) { const b = series.get(bucketOf(k)); if (b) b.activeMinutes += v / 60; }
  for (const c of completions) { const b = series.get(bucketOf(dayKey(Date.parse(c.completedAt), tz))); if (b) b.lessonsCompleted++; }
  for (const a of attempts) { const b = series.get(bucketOf(dayKey(Date.parse(a.submittedAt), tz))); if (b) { b.quizzes++; b.correct += a.correct; b.questions += a.total; } }
  const rows = [...series.values()].map((r) => ({ ...r, activeMinutes: Math.round(r.activeMinutes * 10) / 10, accuracy: pct(r.correct, r.questions) }));
  const totals = rows.reduce((t, r) => ({ activeMinutes: t.activeMinutes + r.activeMinutes, lessonsCompleted: t.lessonsCompleted + r.lessonsCompleted, quizzes: t.quizzes + r.quizzes, correct: t.correct + r.correct, questions: t.questions + r.questions }), { activeMinutes: 0, lessonsCompleted: 0, quizzes: 0, correct: 0, questions: 0 });
  totals.activeMinutes = Math.round(totals.activeMinutes * 10) / 10; totals.accuracy = pct(totals.correct, totals.questions);
  const activeDays = new Set([...completions.map((c) => dayKey(Date.parse(c.completedAt), tz)), ...attempts.map((a) => dayKey(Date.parse(a.submittedAt), tz))]);
  let streak = 0; let k = activeDays.has(today) ? today : addDays(today, -1);
  while (activeDays.has(k)) { streak++; k = addDays(k, -1); }
  const idx = await lessonIndex(); const d = done();
  const T = await topicsData();
  const topics = [];
  for (const t of T.topics) {
    const det = await load(`demo/data/topic-${t.id}.json`);
    const vis = det.sections.filter((x) => x.visible !== false);
    const read = vis.filter((x) => d.has(x.id)).length;
    const ta = attempts.filter((a) => (a.scopeType === 'topic' && a.scopeId === t.id) || (a.scopeType === 'lesson' && idx.get(a.scopeId)?.topicId === t.id));
    const tc = ta.reduce((x, a) => x + a.correct, 0); const tq = ta.reduce((x, a) => x + a.total, 0);
    topics.push({ id: t.id, title: t.title, cardImage: t.cardImage, lessons: vis.length, read, complete: vis.length > 0 && read === vis.length, percent: vis.length ? Math.round((read / vis.length) * 100) : null, quizAccuracy: tq ? Math.round((tc / tq) * 100) : null, quizzes: ta.length });
  }
  const goal = s.profile.dailyGoalMin || 30;
  const todayMin = (sec.get(today) || 0) / 60;
  const c = attempts.reduce((x, a) => x + a.correct, 0); const q = attempts.reduce((x, a) => x + a.total, 0);
  return {
    timezone: tz, today, range, series: rows, current: rows[rows.length - 1], totals,
    todayMinutes: Math.round(todayMin * 10) / 10, dailyGoal: goal, goalPercent: Math.min(100, Math.round((todayMin / goal) * 100)), streak,
    topicsRead: topics.filter((t) => t.complete).length, topicsTotal: 15, lessonsRead: d.size, lessonsTotal: topics.reduce((x, t) => x + t.lessons, 0),
    topics, allTimeAccuracy: pct(c, q), attemptsCount: attempts.length,
  };
}

// ------------------------------------------------------------------ quizzes
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function makeAttempt(scopeType, scopeId, mode, pool, parent = null, clientKey = null) {
  const a = {
    id: rid('qa'), scopeType, scopeId, mode, status: 'in_progress', clientKey, parentAttemptId: parent, startedAt: nowIso(), submittedAt: null,
    correct: null, total: null, unanswered: null,
    snapshot: pool.map((q) => ({ id: q.id, version: q.version, lessonId: q.lessonId, topicId: q.topicId, stem: q.stem, options: shuffle(q.options), answerOptionId: q.answerOptionId, explanation: q.explanation, source: q.source, status: q.status })),
  };
  st().attempts.unshift(a);
  return a;
}
function submit(a) {
  const ans = st().answers[a.id] || {};
  let correct = 0; let un = 0;
  for (const q of a.snapshot) { const sel = ans[q.id]?.optionId; if (!sel) un++; else if (sel === q.answerOptionId) correct++; }
  Object.assign(a, { status: 'submitted', correct, total: a.snapshot.length, unanswered: un, submittedAt: nowIso() });
}
async function pool({ lessonId, topicId }) {
  const all = await load('demo/data/questions.json');
  return all.filter((q) => q.status !== 'rejected' && (lessonId ? q.lessonId === lessonId : q.topicId === topicId));
}
function label(list) {
  const best = new Map(); const latest = new Map();
  for (const a of list.filter((x) => x.status === 'submitted')) {
    const k = `${a.scopeType}:${a.scopeId}`;
    if (!latest.has(k) || a.submittedAt > latest.get(k).submittedAt) latest.set(k, a);
    if (!best.has(k) || a.correct / a.total > best.get(k).correct / best.get(k).total) best.set(k, a);
  }
  return list.map((a) => { const k = `${a.scopeType}:${a.scopeId}`; return { a, isLatest: latest.get(k)?.id === a.id, isBest: best.get(k)?.id === a.id }; });
}
async function summary({ a, isLatest, isBest }) {
  const idx = await lessonIndex(); const T = await topicsData();
  const title = a.scopeType === 'lesson' ? idx.get(a.scopeId)?.titleUz || a.scopeId : a.scopeType === 'topic' ? T.topics.find((t) => t.id === a.scopeId)?.title || a.scopeId : 'Xatolarni qayta yeçiş';
  return { id: a.id, scopeType: a.scopeType, scopeId: a.scopeId, scopeTitle: title, mode: a.mode, status: a.status, correct: a.correct, total: a.total ?? a.snapshot.length, unanswered: a.unanswered, percent: a.total ? pct(a.correct, a.total) : null, startedAt: a.startedAt, submittedAt: a.submittedAt, isLatest: !!isLatest, isBest: !!isBest, parentAttemptId: a.parentAttemptId };
}
const ownAttempt = (id) => { const a = st().attempts.find((x) => x.id === id); if (!a) throw err(404, 'Uriniş topilmadi.'); return a; };

// ------------------------------------------------------------------ search
async function searchRows() {
  if (!searchRows.rows) {
    const rows = await load('demo/data/search.json');
    const T = await topicsData();
    searchRows.rows = [...T.topics.map((t) => ({ k: 'topic', t: t.id, title: t.title, text: t.description || '', lang: 'uz' })), ...rows].map((r) => ({ ...r, _n: norm(`${r.title} ${r.en || ''} ${r.text || ''}`), _t: norm(`${r.title} ${r.en || ''}`) }));
  }
  return searchRows.rows;
}
async function search(q, { type, topic, page = 1, limit = 20 } = {}) {
  const toks = norm(q).match(/[\p{L}\p{N}]{2,}/gu) || [];
  if (!toks.length) return { results: [], total: 0, page: 1, pages: 0 };
  const idx = await lessonIndex();
  let hits = [];
  for (const r of await searchRows()) {
    if (r.l && idx.get(r.l)?.visible === false) continue;
    let score = 0; let all = true;
    for (const t of toks) { if (r._t.includes(t)) score += 5; else if (r._n.includes(t)) score += 1; else all = false; }
    if (!score) continue;
    hits.push({ r, score: score + (all ? 10 : 0) });
  }
  if (topic) hits = hits.filter((x) => x.r.t === topic);
  if (type) hits = hits.filter(({ r }) => (type === 'text' ? ['summary', 'original', 'translation'].includes(r.k) : r.k === type));
  hits.sort((a, b) => b.score - a.score);
  const kinds = { topic: 'Mavzu', lesson: 'Bölim', summary: 'Bölim', original: 'Bölim', translation: 'Ma’lumot (UZ)', term: 'Atama', figure: 'Rasm' };
  const snip = (text) => {
    const t = String(text || ''); const low = norm(t); let pos = -1;
    for (const k of toks) { pos = low.indexOf(k); if (pos >= 0) break; }
    if (pos < 0) return t.slice(0, 220);
    const s = Math.max(0, pos - 90); return (s > 0 ? '…' : '') + t.slice(s, s + 240) + (s + 240 < t.length ? '…' : '');
  };
  const results = hits.slice((page - 1) * limit, page * limit).map(({ r }, i) => ({
    id: `${r.k}:${r.l || r.t}:${r.b || r.f || i}`, type: r.k, badge: kinds[r.k], topicId: r.t, lessonId: r.l || null, blockId: r.b || null, lang: r.lang,
    title: r.title, snippet: snip(r.text || r.en || ''), _full: String(r.text || r.en || '').slice(0, 2200), locator: r.p ? { pdfPage: r.p } : null, imageId: r.f || null,
    lessonTitle: r.l ? idx.get(r.l)?.titleUz : null,
  }));
  return { results, total: hits.length, page, pages: Math.ceil(hits.length / limit) };
}

// ------------------------------------------------------------------ outputs
const me = async () => {
  const s = st();
  if (!s.loggedIn) return { user: null };
  const last = Object.entries(s.progress).sort((a, b) => (a[1].updatedAt < b[1].updatedAt ? 1 : -1))[0];
  return {
    user: { id: 'demo', email: 'mehmon@drstudy.demo', roles: ['student'], emailVerified: true, profile: { ...s.profile } },
    lastPosition: last ? { lesson_id: last[0], last_block: last[1].lastBlock, last_tab: last[1].lastTab, updated_at: last[1].updatedAt } : null,
  };
};
const noteOut = async (n) => ({ ...n, lessonTitle: n.lessonId ? (await lessonIndex()).get(n.lessonId)?.titleUz || null : null });
const threadOut = async (t) => {
  const idx = await lessonIndex(); const T = await topicsData();
  return { ...t, lessonTitle: t.lessonId ? idx.get(t.lessonId)?.titleUz : null, topicTitle: t.topicId ? T.topics.find((x) => x.id === t.topicId)?.title : null };
};
const bmOut = (b) => { const { deletedAt: _d, ...rest } = b; return rest; };

// ------------------------------------------------------------------ router
const routes = [];
const on = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });
const needUser = () => { if (!st().loggedIn) { window.dispatchEvent(new CustomEvent('ds:unauth')); throw err(401, 'Avval tizimga kiring.'); } };

on('GET', '/api/health', () => ({ ok: true }));
on('GET', '/api/me', me);
on('POST', '/api/auth/login', () => { st().loggedIn = true; return { ok: true }; });
on('POST', '/api/auth/register', ({ body }) => { const s = st(); s.loggedIn = true; if (body?.name) s.profile.name = String(body.name).slice(0, 80); return { ok: true, user: { emailVerified: true } }; });
on('POST', '/api/auth/logout', () => { st().loggedIn = false; return { ok: true }; });
for (const p of ['forgot-password', 'reset-password', 'resend-verification', 'verify-email']) on('POST', `/api/auth/${p}`, () => ({ ok: true, message: 'Web körinişda email yuborilmaydi.' }));

on('PATCH', '/api/profile', ({ body }) => {
  needUser();
  const p = st().profile; const fe = {};
  if (body.name !== undefined && String(body.name).trim().length < 2) fe.name = 'Ismingizni kiriting.';
  if (Object.keys(fe).length) throw err(422, 'Maydonlarni tekşiring.', { fieldErrors: fe });
  for (const k of ['name', 'university', 'course', 'direction', 'studyLang', 'dailyGoalMin', 'timezone', 'readerFont', 'readerLine']) if (body[k] !== undefined) p[k] = body[k];
  if (body.completeOnboarding) p.onboarded = true;
  return { profile: { ...p } };
});
on('POST', '/api/demo/reset', () => { S = blank(); persist(); return { ok: true }; });

on('GET', '/api/topics', async () => {
  needUser();
  const T = clone(await topicsData()); const d = done(); const sv = savedSet('topic');
  for (const t of T.topics) {
    const det = await load(`demo/data/topic-${t.id}.json`);
    const vis = det.sections.filter((x) => x.visible !== false);
    const read = vis.filter((x) => d.has(x.id)).length;
    const started = vis.some((x) => st().progress[x.id]);
    Object.assign(t, { lessonsRead: read, saved: sv.has(t.id), state: vis.length === 0 ? 'no_material' : read === vis.length ? 'read' : started ? 'started' : 'not_started' });
  }
  return T;
});
on('GET', '/api/topics/:id', async ({ params }) => {
  needUser();
  let det;
  try { det = clone(await load(`demo/data/topic-${params.id}.json`)); } catch { throw err(404, 'Mavzu topilmadi.'); }
  const s = st(); const sv = savedSet('lesson');
  const lastBy = new Map();
  for (const a of submittedAttempts().filter((x) => x.scopeType === 'lesson').sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))) if (!lastBy.has(a.scopeId)) lastBy.set(a.scopeId, a);
  for (const sec of det.sections) {
    const p = s.progress[sec.id];
    sec.progress = p ? { completed: !!p.completedAt, opened: true, lastBlock: p.lastBlock } : { completed: false, opened: false };
    const a = lastBy.get(sec.id);
    sec.lastQuiz = a ? { percent: Math.round((a.correct / a.total) * 100), at: a.submittedAt } : null;
    sec.saved = sv.has(sec.id);
  }
  det.topic.saved = savedSet('topic').has(params.id);
  return det;
});
on('GET', '/api/lessons/:id', async ({ params }) => {
  needUser();
  let d;
  try { d = clone(await load(`demo/data/lesson-${params.id}.json`)); } catch { throw err(404, 'Bölim topilmadi.'); }
  const s = st(); const id = d.lesson.id; const now = nowIso();
  const prev = s.progress[id];
  s.progress[id] = { firstOpenedAt: now, completedAt: null, lastBlock: null, lastTab: null, reviewFlag: false, ...prev, updatedAt: now };
  const p = prev;
  d.progress = p ? { completed: !!p.completedAt, completedAt: p.completedAt, readVersion: d.lesson.contentVersion, lastBlock: p.lastBlock, lastTab: p.lastTab, reviewFlag: !!p.reviewFlag } : { completed: false };
  d.updatedSinceRead = false;
  d.saved = savedSet('lesson').has(id);
  d.figures = await Promise.all(d.figures.map(withUrl));
  return d;
});
on('GET', '/api/figures/:id', async ({ params }) => {
  needUser();
  const fi = await load('demo/data/figindex.json');
  const lid = fi[params.id];
  if (!lid) throw err(404, 'Rasm topilmadi.');
  const d = await load(`demo/data/lesson-${lid}.json`);
  const f = d.figures.find((x) => x.imageId === params.id);
  if (!f) throw err(404, 'Rasm topilmadi.');
  return { figure: await withUrl(f) };
});
on('GET', '/api/sources/:bookId', () => ({ book: null, pdfAvailable: false, pdfUrl: null }));
// library shelf: book list only — the web preview carries no PDFs or covers (private copies)
on('GET', '/api/shelf', async () => { needUser(); const d = clone(await load('demo/data/shelf.json')); const sv = savedSet('book'); d.books.forEach((b) => { b.saved = sv.has(b.id); }); return d; });
on('GET', '/api/library', async () => {
  needUser();
  const L = clone(await load('demo/data/library.json')); const sv = savedSet('book');
  for (const b of L.books) { b.saved = sv.has(b.id); b.pdfAvailable = false; }
  return L;
});
on('GET', '/api/search', async ({ query }) => { needUser(); return search(query.get('q') || '', { type: query.get('type'), topic: query.get('topic'), page: Math.max(1, parseInt(query.get('page') || '1', 10) || 1) }); });

on('PATCH', '/api/progress/:lessonId', ({ params, body }) => {
  needUser();
  const s = st(); const now = nowIso();
  const p = s.progress[params.lessonId] ||= { firstOpenedAt: now, completedAt: null, lastBlock: null, lastTab: null, reviewFlag: false };
  if (body.completed !== undefined) p.completedAt = body.completed ? p.completedAt || now : null;
  if (body.lastBlock !== undefined) p.lastBlock = body.lastBlock;
  if (body.lastTab !== undefined) p.lastTab = body.lastTab;
  if (body.reviewFlag !== undefined) p.reviewFlag = !!body.reviewFlag;
  p.updatedAt = now;
  return { progress: { completed: !!p.completedAt, completedAt: p.completedAt, lastBlock: p.lastBlock, lastTab: p.lastTab, reviewFlag: !!p.reviewFlag } };
});
on('POST', '/api/reading/heartbeat', ({ body }) => {
  needUser();
  const a = Number(body.startMs); const b = Number(body.endMs);
  if (!(b > a) || b - a > 45000) throw err(422, 'Interval notöğri.');
  const s = st(); s.hbSeen ||= [];
  if (s.hbSeen.includes(body.eventId)) return { ok: true, duplicate: true };
  s.hbSeen.push(body.eventId); if (s.hbSeen.length > 200) s.hbSeen.splice(0, 100);
  s.intervals.push([a, b]);
  if (s.intervals.length > 400) s.intervals = merged();
  return { ok: true, duplicate: false };
});

// bookmarks & collections
on('GET', '/api/bookmarks', ({ query }) => {
  needUser();
  let rows = st().bookmarks.filter((b) => !b.deletedAt).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (query.get('type')) rows = rows.filter((r) => r.targetType === query.get('type'));
  if (query.get('collection')) rows = rows.filter((r) => r.collectionId === query.get('collection'));
  if (query.get('q')) { const q = query.get('q').toLowerCase(); rows = rows.filter((r) => `${r.title} ${r.snippet}`.toLowerCase().includes(q)); }
  return { bookmarks: rows.map(bmOut), collections: st().collections.map((c) => ({ ...c })) };
});
on('POST', '/api/bookmarks', ({ body }) => {
  needUser();
  if (!body.targetType || !body.targetId) throw err(422, 'Saqlaş uçun manba kerak.');
  const s = st();
  const ex = s.bookmarks.find((b) => b.targetType === body.targetType && b.targetId === body.targetId);
  if (ex) { const was = !ex.deletedAt; Object.assign(ex, { deletedAt: null, title: body.title || ex.title, snippet: body.snippet || ex.snippet, meta: body.meta || ex.meta, collectionId: body.collectionId || ex.collectionId }); return { bookmark: bmOut(ex), existed: was }; }
  const b = { id: rid('bm'), targetType: body.targetType, targetId: String(body.targetId), title: body.title || null, snippet: body.snippet || null, meta: body.meta || {}, collectionId: body.collectionId || null, createdAt: nowIso(), deletedAt: null };
  s.bookmarks.push(b);
  return { bookmark: bmOut(b) };
});
const ownBm = (id) => { const b = st().bookmarks.find((x) => x.id === id); if (!b) throw err(404, 'Saqlangan element topilmadi.'); return b; };
on('DELETE', '/api/bookmarks/:id', ({ params }) => { needUser(); ownBm(params.id).deletedAt = nowIso(); return { ok: true, undo: `/api/bookmarks/${params.id}/restore` }; });
on('POST', '/api/bookmarks/:id/restore', ({ params }) => { needUser(); ownBm(params.id).deletedAt = null; return { ok: true }; });
on('PATCH', '/api/bookmarks/:id', ({ params, body }) => { needUser(); ownBm(params.id).collectionId = body.collectionId || null; return { ok: true }; });
on('POST', '/api/collections', ({ body }) => {
  needUser();
  const name = String(body.name || '').trim().slice(0, 60);
  if (!name) throw err(422, 'Papka nomini kiriting.', { fieldErrors: { name: 'Papka nomini kiriting.' } });
  const c = { id: rid('col'), name }; st().collections.push(c); return { collection: c };
});
on('PATCH', '/api/collections/:id', ({ params, body }) => { needUser(); const c = st().collections.find((x) => x.id === params.id); if (!c) throw err(404, 'Papka topilmadi.'); c.name = String(body.name || c.name).slice(0, 60); return { ok: true }; });
on('DELETE', '/api/collections/:id', ({ params }) => {
  needUser(); const s = st();
  s.collections = s.collections.filter((c) => c.id !== params.id);
  for (const b of s.bookmarks) if (b.collectionId === params.id) b.collectionId = null;
  return { ok: true };
});

// notes
on('GET', '/api/notes', async ({ query }) => {
  needUser();
  let rows = [...st().notes].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  if (query.get('lessonId')) rows = rows.filter((r) => r.lessonId === query.get('lessonId'));
  if (query.get('q')) { const q = query.get('q').toLowerCase(); rows = rows.filter((r) => `${r.body} ${r.selectionText || ''}`.toLowerCase().includes(q)); }
  return { notes: await Promise.all(rows.map(noteOut)) };
});
const ownNote = (id) => { const n = st().notes.find((x) => x.id === id); if (!n) throw err(404, 'Qayd topilmadi.'); return n; };
on('GET', '/api/notes/:id', async ({ params }) => { needUser(); return { note: await noteOut(ownNote(params.id)) }; });
on('POST', '/api/notes', async ({ body }) => {
  needUser();
  const idx = await lessonIndex(); const now = nowIso();
  const n = { id: rid('nt'), lessonId: body.lessonId || null, topicId: body.lessonId ? idx.get(body.lessonId)?.topicId || null : null, anchorBlock: body.anchorBlock || null, selectionText: body.selectionText || null, figureId: body.figureId || null, chatMessageId: body.chatMessageId || null, contentVersion: null, body: String(body.body ?? '').slice(0, 20000), collectionId: null, createdAt: now, updatedAt: now };
  st().notes.push(n);
  return { note: await noteOut(n) };
});
on('PATCH', '/api/notes/:id', async ({ params, body }) => {
  needUser();
  const n = ownNote(params.id);
  if (body.updatedAt && body.updatedAt !== n.updatedAt) throw err(409, 'Qayd boşqa oynada özgartirilgan. Sahifani yangilab, qayta saqlang.');
  if (body.body !== undefined) n.body = String(body.body).slice(0, 20000);
  n.updatedAt = nowIso();
  return { note: await noteOut(n) };
});
on('DELETE', '/api/notes/:id', ({ params }) => { needUser(); ownNote(params.id); st().notes = st().notes.filter((x) => x.id !== params.id); return { ok: true }; });

// quizzes
on('GET', '/api/quiz/bank', async ({ query }) => ({ available: (await pool(query.get('scopeType') === 'lesson' ? { lessonId: query.get('scopeId') } : { topicId: query.get('scopeId') })).length }));
on('GET', '/api/practice/overview', async () => {
  needUser();
  const P = clone(await load('demo/data/practice.json'));
  P.attempts = await Promise.all(label(st().attempts.slice(0, 100)).map(summary));
  return P;
});
on('POST', '/api/quiz-attempts', async ({ body }) => {
  needUser();
  const s = st();
  if (body.clientKey) { const ex = s.attempts.find((a) => a.clientKey === body.clientKey); if (ex) return { attemptId: ex.id, existed: true }; }
  let p; let parent = null; let count = Number(body.count) || 10;
  if (body.scopeType === 'lesson') p = await pool({ lessonId: body.scopeId });
  else if (body.scopeType === 'topic') p = await pool({ topicId: body.scopeId });
  else if (body.scopeType === 'mistakes') {
    const src = ownAttempt(body.scopeId); parent = src.id;
    const ans = s.answers[src.id] || {};
    const wrong = new Set(src.snapshot.filter((q) => ans[q.id]?.optionId !== q.answerOptionId).map((q) => q.id));
    p = (await load('demo/data/questions.json')).filter((q) => wrong.has(q.id)); count = p.length;
  } else throw err(422, 'Qamrov notöğri.');
  if (!p.length) throw err(404, 'Bu qamrov uçun tasdiqlangan savollar banki hali yöq.', { code: 'no_bank' });
  const a = makeAttempt(body.scopeType, body.scopeId, body.mode === 'exam' ? 'exam' : 'practice', shuffle(p).slice(0, Math.min(count, p.length)), parent, body.clientKey || null);
  return { attemptId: a.id, insufficient: p.length < count, available: p.length };
});
on('GET', '/api/quiz-attempts/:id', async ({ params }) => {
  needUser();
  const a = ownAttempt(params.id); const ans = st().answers[a.id] || {};
  const reveal = a.status === 'submitted';
  const [sum] = await Promise.all([summary({ a })]);
  return {
    attempt: sum,
    questions: a.snapshot.map((q, i) => {
      const r = ans[q.id]; const checked = !!r?.checkedAt; const show = reveal || checked;
      return { id: q.id, n: i + 1, stem: q.stem, options: q.options, unreviewed: q.status !== 'approved', selected: r?.optionId || null, flagged: !!r?.flagged, checked, ...(show ? { answerOptionId: q.answerOptionId, explanation: q.explanation, source: q.source, correct: r?.optionId === q.answerOptionId } : {}) };
    }),
  };
});
on('PUT', '/api/quiz-attempts/:id/answers/:qid', ({ params, body }) => {
  needUser();
  const a = ownAttempt(params.id);
  if (a.status === 'submitted') throw err(409, 'Uriniş yakunlangan, javobni özgartirib bölmaydi.');
  const q = a.snapshot.find((x) => x.id === params.qid); if (!q) throw err(404, 'Savol topilmadi.');
  const m = st().answers[a.id] ||= {};
  const r = m[q.id] ||= { optionId: null, flagged: false, checkedAt: null };
  if (body.optionId !== undefined && !r.checkedAt) r.optionId = body.optionId || null;
  r.flagged = !!body.flagged;
  return { ok: true, savedAt: nowIso() };
});
on('POST', '/api/quiz-attempts/:id/check', ({ params, body }) => {
  needUser();
  const a = ownAttempt(params.id);
  if (a.mode !== 'practice') throw err(409, 'Imtihon rejimida javoblar yakunda körsatiladi.');
  const q = a.snapshot.find((x) => x.id === body.questionId); if (!q) throw err(404, 'Savol topilmadi.');
  const r = (st().answers[a.id] || {})[q.id];
  if (!r?.optionId) throw err(422, 'Avval variantni tanlang.');
  r.checkedAt ||= nowIso();
  return { correct: r.optionId === q.answerOptionId, answerOptionId: q.answerOptionId, explanation: q.explanation, source: q.source };
});
on('POST', '/api/quiz-attempts/:id/submit', async ({ params }) => {
  needUser();
  const a = ownAttempt(params.id);
  if (a.status !== 'submitted') submit(a);
  return { attempt: await summary({ a }) };
});
on('GET', '/api/quiz-attempts/:id/results', async ({ params }) => {
  needUser();
  const a = ownAttempt(params.id);
  if (a.status !== 'submitted') throw err(409, 'Natija uriniş yakunlangandan keyin oçiladi.');
  const ans = st().answers[a.id] || {}; const idx = await lessonIndex();
  const hist = label(st().attempts.filter((x) => x.scopeType === a.scopeType && x.scopeId === a.scopeId));
  const mine = hist.find((x) => x.a.id === a.id);
  return {
    attempt: await summary(mine), durationSec: Math.round((Date.parse(a.submittedAt) - Date.parse(a.startedAt)) / 1000),
    items: a.snapshot.map((q, i) => { const sel = ans[q.id]?.optionId || null; return { n: i + 1, id: q.id, stem: q.stem, options: q.options, selected: sel, answerOptionId: q.answerOptionId, result: !sel ? 'unanswered' : sel === q.answerOptionId ? 'correct' : 'wrong', explanation: q.explanation, source: q.source, lessonId: q.lessonId, lessonTitle: idx.get(q.lessonId)?.titleUz }; }),
    history: await Promise.all(hist.filter((x) => x.a.status === 'submitted').map(summary)),
  };
});

// analytics / dashboard
on('GET', '/api/analytics', async ({ query }) => { needUser(); const r = query.get('range'); return analytics(['day', 'week', 'month'].includes(r) ? r : 'week'); });
on('GET', '/api/review-queue', async () => {
  needUser();
  const s = st(); const idx = await lessonIndex();
  const flagged = Object.entries(s.progress).filter(([, p]) => p.reviewFlag).map(([lid]) => ({ lessonId: lid, reason: 'flagged' }));
  const last = new Map();
  for (const a of submittedAttempts().filter((x) => x.scopeType === 'lesson').sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))) if (!last.has(a.scopeId)) last.set(a.scopeId, a);
  const low = [...last.entries()].filter(([, a]) => a.correct / a.total < 0.7).map(([lid, a]) => ({ lessonId: lid, reason: 'low_score', percent: Math.round((a.correct / a.total) * 100) }));
  const seen = new Set();
  const items = [...flagged, ...low].filter((x) => (seen.has(x.lessonId) ? false : seen.add(x.lessonId))).map((x) => ({ ...x, title: idx.get(x.lessonId)?.titleUz, topicId: idx.get(x.lessonId)?.topicId }));
  return { items, rule: 'Siz belgilagan bölimlar va oxirgi testida 70% dan past natija olingan bölimlar (oddiy qoida, adaptiv model emas).' };
});
on('GET', '/api/dashboard', async () => {
  needUser();
  const a = await analytics('day'); const s = st();
  const last = Object.entries(s.progress).sort((x, y) => (x[1].updatedAt < y[1].updatedAt ? 1 : -1))[0];
  let cont = null;
  if (last) {
    const idx = await lessonIndex(); const meta = idx.get(last[0]);
    if (meta) {
      const T = await topicsData(); const t = T.topics.find((x) => x.id === meta.topicId);
      const det = await load(`demo/data/topic-${t.id}.json`);
      const vis = det.sections.filter((x) => x.visible !== false); const d = done();
      cont = { lessonId: last[0], lessonTitle: meta.titleUz, topicId: t.id, topicTitle: t.title, cardImage: t.cardImage, lastBlock: last[1].lastBlock, lastTab: last[1].lastTab, read: vis.filter((x) => d.has(x.id)).length, total: vis.length };
    }
  }
  return { continue: cont, sample: !!s.sample, stats: { todayMinutes: a.todayMinutes, dailyGoal: a.dailyGoal, goalPercent: a.goalPercent, topicsRead: a.topicsRead, lessonsRead: a.lessonsRead, lessonsTotal: a.lessonsTotal, accuracy: a.allTimeAccuracy, attempts: a.attemptsCount, streak: a.streak, today: a.today } };
});

// chat: threads are kept; the AI itself is not connected in the web preview
// AI on the static site goes through the iMedu AI Worker (worker/index.js) when the page
// sets window.DS_AI_URL; the Gemini key stays in the Worker, never in this page.
const AI_URL = (typeof window !== 'undefined' && window.DS_AI_URL) || '';
on('GET', '/api/chat/status', () => ({ available: !!AI_URL, model: AI_URL ? 'Gemini' : null, voice: !!AI_URL, dailyLimit: 0, demo: true, provider: 'gemini' }));
on('POST', '/api/chat/transcribe', async ({ body }) => {
  needUser();
  if (!AI_URL) throw err(503, 'Web körinişda ovozli savol ulanmagan.');
  const r = await fetch(`${AI_URL}/transcribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: body.audio, mimeType: body.mimeType }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw err(r.status, d.message || 'Ovozni matnga aylantirib bölmadi.');
  return { text: d.text || '' };
});
on('GET', '/api/chat/threads', async () => { needUser(); return { threads: await Promise.all([...st().threads].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map(threadOut)) }; });
on('POST', '/api/chat/threads', async ({ body }) => {
  needUser();
  const idx = await lessonIndex(); const T = await topicsData(); const now = nowIso();
  const topicId = body.lessonId ? idx.get(body.lessonId)?.topicId : body.topicId || null;
  const title = body.title || (body.lessonId ? idx.get(body.lessonId)?.titleUz : topicId ? T.topics.find((t) => t.id === topicId)?.title : 'Umumiy savollar');
  const t = { id: rid('ct'), topicId, lessonId: body.lessonId || null, title, createdAt: now, updatedAt: now };
  st().threads.push(t);
  return { thread: await threadOut(t) };
});
const ownThread = (id) => { const t = st().threads.find((x) => x.id === id); if (!t) throw err(404, 'Suhbat topilmadi.'); return t; };
on('GET', '/api/chat/threads/:id', async ({ params }) => { needUser(); const t = ownThread(params.id); return { thread: await threadOut(t), messages: st().messages.filter((m) => m.threadId === t.id) }; });
on('POST', '/api/chat/threads/delete', ({ body }) => { needUser(); const ids = new Set(Array.isArray(body?.ids) ? body.ids : []); if (!ids.size) throw err(422, 'Kamida bitta suhbat tanlang.'); const s = st(); const n = s.threads.length; s.threads = s.threads.filter((t) => !ids.has(t.id)); s.messages = s.messages.filter((m) => !ids.has(m.threadId)); return { ok: true, deleted: n - s.threads.length }; });
on('DELETE', '/api/chat/threads/:id', ({ params }) => { needUser(); ownThread(params.id); const s = st(); s.threads = s.threads.filter((t) => t.id !== params.id); s.messages = s.messages.filter((m) => m.threadId !== params.id); return { ok: true }; });

// same quick actions as the server (server/ai.js), incl. "explain" sent by the selection bar
const ACTIONS = {
  explain: 'Şu joyni sodda tuşuntirib ber.',
  simplify: 'Buni soddaroq qilib, oddiy sözlar bilan tuşuntir.',
  example: 'Manbaga mos öquv misoli keltir (manbada bölmagan klinik holat töqima).',
  compare: 'Ikki tuşunçani manbaga tayanib taqqosla.',
  term: 'Bu atamani tuşuntir: ma’nosi, inglizça nomi va dars kontekstidagi örni.',
  find: 'Kitobdagi tegişli joyni top va qisqaça nima deyilganini ayt.',
  quiz: 'Menga özimni tekşiriş uçun manbaga asoslangan 3 ta qisqa savol ber (javoblarini oxirida alohida yoz).',
};
async function chatStream(tid, body, onEvent, signal) {
  needUser();
  const t = ownThread(tid); const s = st(); const idx = await lessonIndex();
  if (!body.text && !body.action) throw err(422, 'Savolingizni yozing.');
  const lessonId = body.lessonId || t.lessonId; const topicId = lessonId ? idx.get(lessonId)?.topicId : t.topicId;
  const ctx = { lessonId: lessonId || null, topicId: topicId || null, blockId: body.blockId || null, selection: body.selection || null, action: body.action || null, lessonTitle: lessonId ? idx.get(lessonId)?.titleUz : null };
  const question = [body.action ? ACTIONS[body.action] || '' : '', body.text || ''].filter(Boolean).join(' ');
  const umid = rid('cm');
  s.messages.push({ id: umid, threadId: t.id, role: 'user', content: question, context: ctx, citations: [], status: 'sent', createdAt: nowIso() });
  t.updatedAt = nowIso();
  onEvent('context', { userMessageId: umid, context: ctx });
  // retrieval query: drop question words and trim Uzbek suffixes (nasosi → nasos, natriy → natri),
  // since the preview's search matches plain substrings
  const STOP = new Set(['qanday', 'nima', 'nimaga', 'nega', 'qanaqa', 'haqida', 'ishlaydi', 'qiladi', 'nimani', 'tushuntir', 'tushuntirib', 'ber', 'bering', 'menga', 'iltimos', 'qaysi', 'qachon', 'what', 'how', 'the', 'and', 'does', 'is']);
  const stem = (w) => (w.length > 6 ? w.slice(0, -2) : w.length > 5 ? w.slice(0, -1) : w);
  const words = norm(`${body.text || ''} ${body.selection || ''}`).match(/[\p{L}\p{N}]{2,}/gu) || [];
  const q = words.filter((w) => !STOP.has(w)).map(stem).join(' ') || (ctx.lessonTitle || '');
  const near = (await search(q, { limit: 300 })).results.filter((r) => ['summary', 'original', 'translation', 'term', 'figure'].includes(r.type));
  const ranked = [...near.filter((r) => lessonId && r.lessonId === lessonId), ...near.filter((r) => !(lessonId && r.lessonId === lessonId))].slice(0, 6);
  const sources = ranked.map((r, i) => ({ sourceId: r.id, n: i + 1, kind: r.type, lang: r.lang, lessonId: r.lessonId, topicId: r.topicId, blockId: r.blockId, title: `${r.lessonTitle ? `${r.lessonTitle} — ` : ''}${r.title}`, snippet: r.snippet.slice(0, 280), pdfPage: r.locator?.pdfPage || null, printedPage: r.locator?.pdfPage ? r.locator.pdfPage - 5 : null, imageId: r.imageId, lessonStatus: null }));
  onEvent('sources', { sources });
  if (AI_URL && sources.length) return aiAnswer({ t, s, ctx, question, body, sources, full: ranked.map((r) => r._full), umid, onEvent, signal });
  const msg = sources.length
    ? 'Web körinişda AI ulanmagan. Quyida savolingizga mos topilgan kitob parçalari körsatildi — ular kitobdan olingan, AI javobi emas. Töliq ilovada AI şu manbalar asosida, havolalar bilan javob yozadi.'
    : 'Ulangan manbalarda bu savolga mos parça topilmadi. Savolni boşqaça söz bilan yozing yoki tegişli darsni oçing.';
  const amid = rid('cm');
  const status = sources.length ? 'unavailable' : 'no_source';
  s.messages.push({ id: amid, threadId: t.id, role: 'assistant', content: msg, context: { sources }, citations: [], status, createdAt: nowIso() });
  persist();
  onEvent('done', { messageId: amid, status, content: msg, citations: [] });
}

// Streams the Worker's answer: delta events pass straight through; on done the [n] offsets
// become the same citation objects the Node server sends.
async function aiAnswer({ t, s, ctx, question, body, sources, full, umid, onEvent, signal }) {
  const amid = rid('cm');
  const hist = s.messages.filter((m) => m.threadId === t.id && m.id !== umid && ['sent', 'complete'].includes(m.status)).slice(-8).map((m) => ({ role: m.role, content: m.content }));
  const ctxText = [ctx.lessonTitle ? `Joriy dars: ${ctx.lessonTitle} (${ctx.lessonId}).` : 'Umumiy savol (dars tanlanmagan).', body.selection ? `Talaba belgilagan matn (ma’lumot sifatida): <<<${body.selection}>>>` : ''].filter(Boolean).join('\n');
  const save = (content, status, citations = []) => { s.messages.push({ id: amid, threadId: t.id, role: 'assistant', content, context: { sources }, citations, status, createdAt: nowIso() }); persist(); };
  let text = '';
  try {
    const r = await fetch(`${AI_URL}/chat`, { method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, ctxText, history: hist, sources: sources.map((src, i) => ({ title: src.title, text: full[i] || src.snippet, pdfPage: src.pdfPage })) }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw Object.assign(new Error(d.message || 'AI xizmatida xato.'), { status: r.status }); }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(chunk)?.[1]; const data = /^data: (.*)$/m.exec(chunk)?.[1];
        if (!ev || !data) continue;
        const d = JSON.parse(data);
        if (ev === 'delta') { text += d.text; onEvent('delta', { text: d.text }); }
        else if (ev === 'done') {
          const citations = (d.cites || []).map((c) => { const src = sources[c.n - 1]; return src ? { n: c.n, sourceId: src.sourceId, title: src.title, citedText: src.snippet, lessonId: src.lessonId, blockId: src.blockId, pdfPage: src.pdfPage, imageId: src.imageId, at: c.at } : null; }).filter(Boolean);
          save(d.content, 'complete', citations);
          onEvent('done', { messageId: amid, status: citations.length ? 'complete' : 'complete_uncited', content: d.content, citations });
          return;
        } else if (ev === 'error') throw Object.assign(new Error(d.message), { status: 502 });
      }
    }
    throw new Error('AI javobi uzilib qoldi. Qayta urinib köring.');
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    save(text, 'error');
    onEvent('error', { messageId: amid, status: 'error', partial: text, message: e.message || 'AI xizmatida xato.' });
  }
}

// ------------------------------------------------------------------ entry points used by api.js
let ready = null;
async function boot() { ready ||= seed(); return ready; }

export async function demoApi(path, { method = 'GET', body } = {}) {
  await boot();
  const u = new URL(path, 'https://demo.local');
  const m = method.toUpperCase();
  for (const r of routes) {
    if (r.method !== m) continue;
    const g = r.re.exec(u.pathname);
    if (!g) continue;
    const params = Object.fromEntries(Object.entries(g.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
    const out = await r.fn({ params, query: u.searchParams, body: body || {} });
    if (m !== 'GET' || u.pathname === '/api/lessons/' + params.id) persist();
    return clone(out);
  }
  if (u.pathname.startsWith('/api/admin')) throw err(403, 'Web körinişda admin bölimi yöq.');
  throw err(404, 'Bu amal web körinişda mavjud emas.');
}

export async function demoStream(path, body, { onEvent, signal }) {
  await boot();
  const m = /^\/api\/chat\/threads\/([^/]+)\/messages$/.exec(path);
  if (!m) throw err(404, 'Bu amal web körinişda mavjud emas.');
  await chatStream(decodeURIComponent(m[1]), body || {}, onEvent, signal);
}
