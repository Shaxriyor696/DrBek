// Content integrity check: npm run check
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const C = process.env.CONTENT_DIR || path.join(root, 'content');
const J = (p) => JSON.parse(fs.readFileSync(path.join(C, p), 'utf8'));
const errors = []; const warn = [];
const topics = J('topics.json').topics;
const man = new Map(J('figures/manifest.json').figures.map((f) => [f.imageId, f]));
let lessons = 0; let figsIn = 0; let words = 0;
for (const t of topics) for (const s of t.sections) {
  const p = path.join(C, 'lessons', `${s.id}.json`);
  if (!fs.existsSync(p)) { errors.push(`lesson file missing: ${s.id}`); continue; }
  const l = JSON.parse(fs.readFileSync(p, 'utf8')); lessons++;
  if (!l.blocks.simple.length) errors.push(`${s.id}: empty Uzbek summary`);
  if (!l.blocks.full.length) errors.push(`${s.id}: empty original text`);
  for (const b of l.blocks.full) if (b.type !== 'figure') words += (`${b.lead || ''} ${b.text}`.match(/\S+/g) || []).length;
  for (const fid of l.figureIds) {
    const f = man.get(fid);
    if (!f) { errors.push(`${s.id}: figure ${fid} not in manifest`); continue; }
    if (f.assetPath && !fs.existsSync(path.join(C, f.assetPath))) errors.push(`${fid}: image file missing`);
    if (f.coverage === 'included') figsIn++; else warn.push(`${fid}: ${f.coverage || 'not cropped'} (${f.cropMethod || '—'})`);
  }
}
const tdir = path.join(C, 'translations'); let trFull = 0;
const translationGaps = [];
for (const topic of topics) for (const { id } of topic.sections) {
  const lessonFile = path.join(C, 'lessons', `${id}.json`);
  if (!fs.existsSync(lessonFile)) continue;
  const lesson = JSON.parse(fs.readFileSync(lessonFile, 'utf8'));
  const file = path.join(tdir, `${id}.uz.json`);
  const tr = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const blocks = lesson.blocks.full.filter((b) => ['paragraph', 'heading'].includes(b.type));
  const bids = new Set(blocks.map((b) => b.bid));
  const figures = new Set(lesson.figureIds.filter((fid) => man.get(fid)?.originalCaption));
  const missing = blocks.filter((b) => b.text.trim() ? !tr?.blocks?.[b.bid]?.text?.trim() : !tr?.blocks?.[b.bid]?.lead?.trim()).length
    + [...figures].filter((fid) => !tr?.figures?.[fid]?.trim()).length;
  const total = bids.size + figures.size;
  if (missing) translationGaps.push(`${id}: ${total - missing}/${total}`);
  else trFull++;
  if (!tr) continue;
  for (const bid of Object.keys(tr.blocks)) if (!bids.has(bid)) errors.push(`${id}: unknown block ${bid}`);
  for (const fid of Object.keys(tr.figures)) if (!figures.has(fid)) errors.push(`${id}: unknown caption ${fid}`);
  if (tr.coverage.total !== total || tr.coverage.translated !== total - missing) errors.push(`${id}: translation coverage does not match content`);
}
if (process.argv.includes('--require-full-uz')) errors.push(...translationGaps.map((gap) => `Incomplete Uzbek translation: ${gap}`));
const qdir = path.join(C, 'questions'); let qn = 0;
if (fs.existsSync(qdir)) for (const f of fs.readdirSync(qdir).filter((x) => x.endsWith('.json'))) {
  for (const q of JSON.parse(fs.readFileSync(path.join(qdir, f), 'utf8')).questions) {
    qn++;
    if (!q.options.some((o) => o.id === q.answerOptionId)) errors.push(`${q.id}: answer not among options`);
    if (new Set(q.options.map((o) => o.id)).size !== q.options.length) errors.push(`${q.id}: duplicate option ids`);
    if (!q.source?.lessonId) errors.push(`${q.id}: no source`);
  }
}
console.log(`Mavzular: ${topics.length} · darslar: ${lessons} · asl matn: ${words.toLocaleString('en')} so’z · rasm/jadval kesilgan: ${figsIn}/${man.size} · to’liq tarjima: ${trFull}/${lessons} bob · test savollari: ${qn}`);
if (warn.length) console.log(`Qo’lda tekshirish kerak (${warn.length}):\n  ${warn.join('\n  ')}`);
if (errors.length) { console.error(`XATOLAR (${errors.length}):\n  ${errors.join('\n  ')}`); process.exit(1); }
console.log('OK');
