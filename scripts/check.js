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
if (fs.existsSync(tdir)) for (const f of fs.readdirSync(tdir).filter((x) => x.endsWith('.uz.json'))) {
  const tr = JSON.parse(fs.readFileSync(path.join(tdir, f), 'utf8'));
  const l = JSON.parse(fs.readFileSync(path.join(C, 'lessons', `${tr.lessonId}.json`), 'utf8'));
  const bids = new Set(l.blocks.full.map((b) => b.bid));
  for (const k of Object.keys(tr.blocks)) if (!bids.has(k)) errors.push(`${f}: unknown block ${k}`);
  if (tr.coverage.translated === tr.coverage.total) trFull++;
}
const qdir = path.join(C, 'questions'); let qn = 0;
if (fs.existsSync(qdir)) for (const f of fs.readdirSync(qdir).filter((x) => x.endsWith('.json'))) {
  for (const q of JSON.parse(fs.readFileSync(path.join(qdir, f), 'utf8')).questions) {
    qn++;
    if (!q.options.some((o) => o.id === q.answerOptionId)) errors.push(`${q.id}: answer not among options`);
    if (new Set(q.options.map((o) => o.id)).size !== q.options.length) errors.push(`${q.id}: duplicate option ids`);
    if (!q.source?.lessonId) errors.push(`${q.id}: no source`);
  }
}
console.log(`Mavzular: ${topics.length} · darslar: ${lessons} · asl matn: ${words.toLocaleString('en')} so‘z · rasm/jadval kesilgan: ${figsIn}/${man.size} · to‘liq tarjima: ${trFull}/${lessons} bob · test savollari: ${qn}`);
if (warn.length) console.log(`Qo‘lda tekshirish kerak (${warn.length}):\n  ${warn.join('\n  ')}`);
if (errors.length) { console.error(`XATOLAR (${errors.length}):\n  ${errors.join('\n  ')}`); process.exit(1); }
console.log('OK');
