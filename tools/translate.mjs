#!/usr/bin/env node
// Full Uzbek translation of the book text, block by block, aligned to the lesson's
// "full" blocks (same bid), so figures stay in place and every paragraph keeps its
// page reference. Output: content/translations/chNN.uz.json (never touched by the importer).
//
//   node tools/translate.mjs status                      # what is translated
//   node tools/translate.mjs run --dry-run               # size estimate, no API calls
//   node tools/translate.mjs run --only ch11,ch12        # translate (needs ANTHROPIC_API_KEY)
//   node tools/translate.mjs run --all                   # every chapter without a full translation
//   node tools/translate.mjs compile tools/translations-src/ch10.uz.txt   # hand-made translation file -> JSON
//
// Resumable: finished blocks are saved after every batch; a re-run only sends what is missing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = process.env.CONTENT_DIR ? path.resolve(process.env.CONTENT_DIR) : path.join(ROOT, 'content');
const TDIR = path.join(CONTENT, 'translations');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const now = () => new Date().toISOString();

function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const lessonPath = (id) => path.join(CONTENT, 'lessons', `${id}.json`);
const allLessonIds = () => fs.readdirSync(path.join(CONTENT, 'lessons')).filter((f) => /^ch\d{2}\.json$/.test(f)).map((f) => f.slice(0, 4)).sort();
const capText = (c) => String(c || '').replace(/^(Figure|Table)\s*\d+-\d+\.?\s*/, '');

// Items a lesson needs translated: headings + paragraphs of the full text, plus figure captions.
function itemsFor(lesson, manifest) {
  const items = [];
  for (const b of lesson.blocks.full) {
    if (b.type === 'heading') items.push({ id: b.bid, kind: 'heading', text: b.text });
    else if (b.type === 'paragraph') items.push({ id: b.bid, kind: b.boxed ? 'boxed' : 'paragraph', lead: b.lead || undefined, text: b.text });
  }
  for (const fid of lesson.figureIds) {
    const f = manifest.get(fid);
    if (f?.originalCaption) items.push({ id: `fig:${fid}`, kind: 'caption', text: capText(f.originalCaption) });
  }
  return items;
}

function loadTranslation(id) {
  const p = path.join(TDIR, `${id}.uz.json`);
  return fs.existsSync(p) ? readJson(p) : null;
}

function saveTranslation(lesson, items, blocks, figures, meta) {
  fs.mkdirSync(TDIR, { recursive: true });
  const total = items.length;
  const translated = items.filter((it) => (it.id.startsWith('fig:') ? figures[it.id.slice(4)] : (blocks[it.id]?.text || blocks[it.id]?.lead))).length;
  const out = {
    lessonId: lesson.id, lang: 'uz', bookId: lesson.source.bookId, chapter: lesson.source.chapter,
    sourceContentVersion: lesson.contentVersion,
    status: 'needs_review',
    method: meta.method, translator: meta.translator, model: meta.model || null,
    createdAt: meta.createdAt || now(), updatedAt: now(),
    coverage: { translated, total },
    note: 'Kitob matnining to‘liq o‘zbekcha tarjimasi (qisqartirilmagan). Ekspert tekshiruvidan o‘tmagan.',
    blocks, figures,
  };
  const p = path.join(TDIR, `${lesson.id}.uz.json`);
  fs.writeFileSync(`${p}.tmp`, JSON.stringify(out, null, 1));
  fs.renameSync(`${p}.tmp`, p);
  return out;
}

const words = (s) => (String(s || '').match(/\S+/g) || []).length;

// --------------------------------------------------------------------- compile (hand-made file)
function compile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const parts = src.split(/^@@\s+/m).slice(1);
  const map = new Map();
  for (const part of parts) {
    const [head, ...rest] = part.split('\n');
    const id = head.trim();
    let lines = rest.join('\n').trim().split('\n');
    let lead;
    if (lines[0]?.startsWith('LEAD:')) { lead = lines[0].slice(5).trim(); lines = lines.slice(1); }
    map.set(id, { lead, text: lines.join(' ').replace(/\s+/g, ' ').trim() });
  }
  const lessonId = path.basename(file).slice(0, 4);
  const lesson = readJson(lessonPath(lessonId));
  const manifest = new Map(readJson(path.join(CONTENT, 'figures', 'manifest.json')).figures.map((f) => [f.imageId, f]));
  const items = itemsFor(lesson, manifest);
  const known = new Set(items.map((i) => i.id));
  const unknown = [...map.keys()].filter((k) => !known.has(k));
  if (unknown.length) throw new Error(`${file}: unknown block ids: ${unknown.join(', ')}`);
  const blocks = {}; const figures = {};
  for (const it of items) {
    const t = map.get(it.id);
    if (!t) continue;
    if (it.lead && !t.lead) console.warn(`  ! ${it.id}: original has a lead-in heading, translation has none`);
    if (it.id.startsWith('fig:')) figures[it.id.slice(4)] = t.text;
    else blocks[it.id] = { text: t.text, ...(t.lead ? { lead: t.lead } : {}) };
  }
  const missing = items.filter((it) => !map.has(it.id)).map((it) => it.id);
  const out = saveTranslation(lesson, items, blocks, figures, { method: 'manual', translator: 'Claude (DrStudy sessiyasi)' });
  console.log(`${lessonId}: ${out.coverage.translated}/${out.coverage.total} blocks${missing.length ? `, missing: ${missing.join(', ')}` : ''}`);
}

// --------------------------------------------------------------------- run (Claude API)
const SYSTEM = `You translate Guyton and Hall Textbook of Medical Physiology (14th ed.) into Uzbek (Latin script) for Uzbek medical students.
Rules:
- Translate COMPLETELY and faithfully. Never summarize, shorten, merge or skip sentences; every sentence of the source must appear in the translation. Do not add facts, explanations or comments.
- Use correct Uzbek medical terminology in Latin script with the letters o‘ and g‘ (U+2018) and the apostrophe ’ for tutuq belgisi. Keep established international terms (e.g. "harakat potensiali", "giperpolyarizatsiya", "A-V tugun", "Purkinye tolalari"). When a key term is first introduced in an item, you may add the English term in parentheses.
- Keep all numbers, units, ranges, chemical symbols and abbreviations exactly (use a decimal comma: 0,3 m/s; keep minus signs: –55 mV).
- Keep the inline markup: **bold** and _italic_ stay around the corresponding translated words. Write figure/table references as **Rasm 10-1** / **Jadval 10-1** (also for "Figures 10-1 and 10-3" → "**Rasm 10-1** va **Rasm 10-3**"). Chapter references: "9-bob".
- The source was extracted from a PDF: silently repair broken words such as "con ductive", "sodi um", "selfexcitation", "Figure 102" (= Figure 10-2).
- kind=heading: translate as a short heading in sentence case (not ALL CAPS). kind=caption: a figure caption. A "lead" is the bold run-in heading of the paragraph: translate it separately into "lead".
- Return JSON exactly matching the schema, one entry per input item with the same id.`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, lead: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function batches(items, maxWords) {
  const out = []; let cur = []; let w = 0;
  for (const it of items) {
    const n = words(it.text) + words(it.lead);
    if (cur.length && w + n > maxWords) { out.push(cur); cur = []; w = 0; }
    cur.push(it); w += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function translateBatch(client, cfg, lesson, batch, attempt = 1) {
  const payload = {
    chapter: `${lesson.source.chapter}. ${lesson.titleOriginal}`,
    chapterUz: lesson.titleUz,
    items: batch.map((it) => ({ id: it.id, kind: it.kind, ...(it.lead ? { lead: it.lead } : {}), text: it.text })),
  };
  const stream = client.messages.stream({
    model: cfg.model,
    max_tokens: 32000,
    system: SYSTEM,
    output_config: { effort: cfg.effort, format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `Translate every item into Uzbek.\n\n${JSON.stringify(payload)}` }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'max_tokens' && batch.length > 1) {
    const mid = Math.ceil(batch.length / 2);
    return [...await translateBatch(client, cfg, lesson, batch.slice(0, mid)), ...await translateBatch(client, cfg, lesson, batch.slice(mid))];
  }
  if (msg.stop_reason === 'refusal') throw new Error(`refusal on ${batch[0].id}`);
  const text = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    if (attempt < 3) return translateBatch(client, cfg, lesson, batch, attempt + 1);
    throw new Error(`invalid JSON for batch starting ${batch[0].id}`);
  }
  const byId = new Map(parsed.items.map((x) => [x.id, x]));
  const res = [];
  for (const it of batch) {
    const x = byId.get(it.id);
    // sanity: a full translation should not be drastically shorter than the source
    if (!x || !x.text?.trim() || (words(it.text) > 25 && words(x.text) < words(it.text) * 0.55)) continue;
    res.push({ id: it.id, text: x.text.trim(), lead: it.lead ? (x.lead || '').trim() || undefined : undefined });
  }
  cfg.usage.input += msg.usage.input_tokens || 0;
  cfg.usage.output += msg.usage.output_tokens || 0;
  return res;
}

async function run(args) {
  loadEnv();
  const only = args.only ? args.only.split(',').map((s) => s.trim()) : null;
  const ids = only || (args.all ? allLessonIds() : null);
  if (!ids) { console.error('Specify --only ch11,ch12 or --all'); process.exit(2); }
  const manifest = new Map(readJson(path.join(CONTENT, 'figures', 'manifest.json')).figures.map((f) => [f.imageId, f]));
  const cfg = { model: process.env.TRANSLATE_MODEL || process.env.AI_MODEL || 'claude-opus-5-5', effort: process.env.TRANSLATE_EFFORT || 'medium', usage: { input: 0, output: 0 } };
  const maxWords = +(args['batch-words'] || 1500);
  const plan = [];
  for (const id of ids) {
    if (!fs.existsSync(lessonPath(id))) { console.error(`unknown lesson ${id}`); process.exit(2); }
    const lesson = readJson(lessonPath(id));
    const items = itemsFor(lesson, manifest);
    const ex = loadTranslation(id);
    const done = (it) => (it.id.startsWith('fig:') ? ex?.figures?.[it.id.slice(4)] : ex?.blocks?.[it.id]?.text);
    const pending = items.filter((it) => !done(it));
    plan.push({ lesson, items, pending, ex });
  }
  const pw = plan.reduce((s, p) => s + p.pending.reduce((a, it) => a + words(it.text) + words(it.lead), 0), 0);
  const nb = plan.reduce((s, p) => s + batches(p.pending, maxWords).length, 0);
  console.log(`Chapters: ${plan.length} · blocks to translate: ${plan.reduce((s, p) => s + p.pending.length, 0)} · English words: ${pw.toLocaleString('en')} · requests: ${nb}`);
  console.log(`Rough token estimate: input ≈ ${Math.round(pw * 1.4 + nb * 600).toLocaleString('en')}, output ≈ ${Math.round(pw * 2.6).toLocaleString('en')} (Uzbek uses more tokens than English). Check current pricing for ${cfg.model} before a full run.`);
  if (args['dry-run']) return;
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set (.env). Nothing translated.'); process.exit(2); }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4, timeout: 10 * 60 * 1000 });
  const conc = Math.max(1, +(args.concurrency || 2));
  const queue = [...plan];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const { lesson, items } = p;
      const blocks = { ...(p.ex?.blocks || {}) }; const figures = { ...(p.ex?.figures || {}) };
      const bs = batches(p.pending, maxWords);
      for (let i = 0; i < bs.length; i++) {
        let got;
        try { got = await translateBatch(client, cfg, lesson, bs[i]); } catch (e) { console.error(`  ${lesson.id} batch ${i + 1}/${bs.length}: ${e.message}`); continue; }
        for (const g of got) {
          if (g.id.startsWith('fig:')) figures[g.id.slice(4)] = g.text;
          else blocks[g.id] = { text: g.text, ...(g.lead ? { lead: g.lead } : {}) };
        }
        const out = saveTranslation(lesson, items, blocks, figures, { method: 'machine', translator: 'Claude API', model: cfg.model, createdAt: p.ex?.createdAt });
        console.log(`  ${lesson.id} batch ${i + 1}/${bs.length} · ${out.coverage.translated}/${out.coverage.total}${got.length < bs[i].length ? ` (${bs[i].length - got.length} rejected, will retry on next run)` : ''}`);
      }
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  console.log(`Done. Tokens used: input ${cfg.usage.input.toLocaleString('en')}, output ${cfg.usage.output.toLocaleString('en')}. Restart the server (or Admin → reload) to index the new text.`);
}

function status() {
  const manifest = new Map(readJson(path.join(CONTENT, 'figures', 'manifest.json')).figures.map((f) => [f.imageId, f]));
  let full = 0; let part = 0;
  for (const id of allLessonIds()) {
    const lesson = readJson(lessonPath(id));
    const total = itemsFor(lesson, manifest).length;
    const ex = loadTranslation(id);
    const n = ex?.coverage?.translated || 0;
    if (n === total) full++; else if (n) part++;
    if (n) console.log(`${id}  ${n}/${total}  ${ex.method}  ${ex.status}`);
  }
  console.log(`Fully translated: ${full}/85 · partial: ${part}`);
}

const [cmd, ...rest] = process.argv.slice(2);
const args = {}; const pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) { const k = rest[i].slice(2); const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; args[k] = v; } else pos.push(rest[i]);
}
if (cmd === 'compile') { if (!pos.length) { console.error('compile <file.uz.txt>...'); process.exit(2); } pos.forEach(compile); }
else if (cmd === 'run') await run(args);
else if (cmd === 'status') status();
else { console.log('Usage: node tools/translate.mjs status | run [--only chNN,..|--all] [--dry-run] [--concurrency 2] | compile <file>'); }
