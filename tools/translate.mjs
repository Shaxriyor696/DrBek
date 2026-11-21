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
import { newUzbekAlphabet } from './uz-alphabet.mjs';
import { geminiStream } from '../server/gemini.js';

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
const cleanText = (text) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const capText = (c) => cleanText(String(c || '')).replace(/^(Figure|Table)\s*\d+-\d+\.?\s*/, '');

// Items a lesson needs translated: headings + paragraphs of the full text, plus figure captions.
function itemsFor(lesson, manifest) {
  const items = [];
  for (const b of lesson.blocks.full) {
    if (b.type === 'heading') items.push({ id: b.bid, kind: 'heading', text: cleanText(b.text) });
    else if (b.type === 'paragraph') items.push({ id: b.bid, kind: b.boxed ? 'boxed' : 'paragraph', lead: b.lead ? cleanText(b.lead) : undefined, text: cleanText(b.text) });
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
  for (const block of Object.values(blocks)) {
    if (block.text) block.text = newUzbekAlphabet(block.text);
    if (block.lead) block.lead = newUzbekAlphabet(block.lead);
  }
  for (const id of Object.keys(figures)) figures[id] = newUzbekAlphabet(figures[id]);
  const total = items.length;
  const translated = items.filter((it) => (it.id.startsWith('fig:') ? figures[it.id.slice(4)] : blocks[it.id]?.[it.text.trim() ? 'text' : 'lead'])).length;
  const out = {
    lessonId: lesson.id, lang: 'uz', bookId: lesson.source.bookId, chapter: lesson.source.chapter,
    sourceContentVersion: lesson.contentVersion,
    status: 'needs_review',
    method: meta.method, translator: meta.translator, model: meta.model || null,
    createdAt: meta.createdAt || now(), updatedAt: now(),
    coverage: { translated, total },
    note: newUzbekAlphabet('Kitob matnining to‘liq o‘zbekcha tarjimasi (qisqartirilmagan). Ekspert tekshiruvidan o‘tmagan.'),
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

// --------------------------------------------------------------------- run
const SYSTEM = `You translate Guyton and Hall Textbook of Medical Physiology (14th ed.) into Uzbek (Latin script) for Uzbek medical students.
Rules:
- Translate COMPLETELY and faithfully. Never summarize, shorten, merge or skip sentences; every sentence of the source must appear in the translation. Do not add facts, explanations or comments.
- Use correct Uzbek medical terminology and the project's Latin spelling: ö, ğ, ş, ç and the tutuq sign ’ (ma’lumot, ta’sir). Use “double quotes”, — between words and – for numeric ranges. Preserve foreign names and established international terminology (e.g. harakat potensiali, giperpolyarizatsiya, A-V tugun, Purkinye tolalari).
- Keep all numbers, units, ranges, chemical symbols and abbreviations exactly (use a decimal comma: 0,3 m/s; keep minus signs: –55 mV). Never add a numerical value. A range with two endpoints must keep exactly those two endpoints. Check distinctions such as myelinated vs unmyelinated and increase vs decrease before returning.
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
  const input = `Translate every item into Uzbek.\n\n${JSON.stringify(payload)}`;
  let text;
  if (cfg.provider === 'gemini') {
    await cfg.waitForRequest();
    const response = await geminiStream(cfg, {
      system: `${SYSTEM}\nReturn only JSON with this schema: ${JSON.stringify(SCHEMA)}`,
      input, maxTokens: 16000, signal: AbortSignal.timeout(120_000),
    });
    text = response.text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
    cfg.usage.input += Math.ceil(input.length / 4);
    cfg.usage.output += Math.ceil(text.length / 4);
  } else {
    const stream = client.messages.stream({
      model: cfg.model,
      max_tokens: 32000,
      system: SYSTEM,
      output_config: { effort: cfg.effort, format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: input }],
    });
    const msg = await stream.finalMessage();
    cfg.usage.input += msg.usage.input_tokens || 0;
    cfg.usage.output += msg.usage.output_tokens || 0;
    if (msg.stop_reason === 'max_tokens' && batch.length > 1) {
      const mid = Math.ceil(batch.length / 2);
      return [...await translateBatch(client, cfg, lesson, batch.slice(0, mid)), ...await translateBatch(client, cfg, lesson, batch.slice(mid))];
    }
    if (msg.stop_reason === 'refusal') throw new Error(`refusal on ${batch[0].id}`);
    text = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
    if (!Array.isArray(parsed.items)) throw new Error('items array missing');
  } catch {
    if (attempt < 3) return translateBatch(client, cfg, lesson, batch, attempt + 1);
    throw new Error(`invalid JSON for batch starting ${batch[0].id}`);
  }
  const byId = new Map(parsed.items.map((x) => [x.id, x]));
  const res = [];
  for (const it of batch) {
    const x = byId.get(it.id);
    // sanity: a full translation should not be drastically shorter than the source
    if (typeof x?.text !== 'string' || (it.text.trim() && !x.text.trim()) || (words(it.text) > 25 && words(x.text) < words(it.text) * 0.55)) continue;
    if (it.lead && (typeof x.lead !== 'string' || !x.lead.trim())) continue;
    res.push({ id: it.id, text: cleanText(x.text).trim(), lead: it.lead ? cleanText(x.lead).trim() : undefined });
  }
  return res;
}

async function run(args) {
  loadEnv();
  const only = args.only ? args.only.split(',').map((s) => s.trim()) : null;
  const ids = only || (args.all ? allLessonIds() : null);
  if (!ids) { console.error('Specify --only ch11,ch12 or --all'); process.exit(2); }
  const manifest = new Map(readJson(path.join(CONTENT, 'figures', 'manifest.json')).figures.map((f) => [f.imageId, f]));
  const provider = args.provider || 'anthropic';
  if (!['anthropic', 'gemini'].includes(provider)) throw new Error('Use --provider anthropic or gemini.');
  const gemini = provider === 'gemini';
  const model = gemini ? (process.env.GEMINI_TRANSLATE_MODEL || process.env.GEMINI_MODEL) : (process.env.TRANSLATE_MODEL || process.env.AI_MODEL || 'claude-opus-5-5');
  const cfg = { provider, model, geminiModel: model, geminiApiKey: process.env.GEMINI_API_KEY, effort: process.env.TRANSLATE_EFFORT || 'medium', usage: { input: 0, output: 0 } };
  const rpm = Number(args.rpm || 12);
  if (!Number.isFinite(rpm) || rpm < 1) throw new Error('--rpm must be at least 1.');
  let nextRequest = 0;
  cfg.waitForRequest = async () => {
    const slot = Math.max(Date.now(), nextRequest);
    nextRequest = slot + Math.ceil(60_000 / rpm);
    if (slot > Date.now()) await new Promise((resolve) => setTimeout(resolve, slot - Date.now()));
  };
  const maxWords = +(args['batch-words'] || 1500);
  const plan = [];
  for (const id of ids) {
    if (!fs.existsSync(lessonPath(id))) { console.error(`unknown lesson ${id}`); process.exit(2); }
    const lesson = readJson(lessonPath(id));
    const items = itemsFor(lesson, manifest);
    const ex = loadTranslation(id);
    const done = (it) => (it.id.startsWith('fig:') ? ex?.figures?.[it.id.slice(4)] : ex?.blocks?.[it.id]?.[it.text.trim() ? 'text' : 'lead']);
    const pending = items.filter((it) => !done(it));
    plan.push({ lesson, items, pending, ex });
  }
  const pw = plan.reduce((s, p) => s + p.pending.reduce((a, it) => a + words(it.text) + words(it.lead), 0), 0);
  const nb = plan.reduce((s, p) => s + batches(p.pending, maxWords).length, 0);
  console.log(`Chapters: ${plan.length} · blocks to translate: ${plan.reduce((s, p) => s + p.pending.length, 0)} · English words: ${pw.toLocaleString('en')} · requests: ${nb}`);
  console.log(`Rough token estimate: input ≈ ${Math.round(pw * 1.4 + nb * 600).toLocaleString('en')}, output ≈ ${Math.round(pw * 2.6).toLocaleString('en')} (Uzbek uses more tokens than English). Check current pricing for ${cfg.model} before a full run.`);
  if (args['dry-run']) return;
  const apiKey = gemini ? cfg.geminiApiKey : process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !model) throw new Error(`Set the ${gemini ? 'Gemini key and model' : 'Anthropic API key'} in .env.`);
  let client;
  if (!gemini) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey, maxRetries: 4, timeout: 10 * 60 * 1000 });
  }
  const conc = Math.max(1, +(args.concurrency || 2));
  const queue = [...plan];
  let stopped = false;
  let skipped = 0;
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const { lesson, items } = p;
      const blocks = { ...(p.ex?.blocks || {}) }; const figures = { ...(p.ex?.figures || {}) };
      const bs = batches(p.pending, maxWords);
      for (let i = 0; i < bs.length && !stopped; i++) {
        let got;
        try {
          for (let attempt = 1; ; attempt++) {
            try {
              got = await translateBatch(client, cfg, lesson, bs[i]);
              break;
            } catch (e) {
              if (!gemini || attempt >= 3 || !([429, 500, 503].includes(e.status) || e.cause?.code)) throw e;
              const retrySeconds = Number(/retry in (\d+)s/i.exec(e.message)?.[1]);
              const delay = Number.isFinite(retrySeconds) ? retrySeconds * 1000 + 1000 : attempt * 5000;
              nextRequest = Math.max(nextRequest, Date.now() + delay);
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        } catch (e) {
          console.error(`  ${lesson.id} batch ${i + 1}/${bs.length}: ${e.message}${e.cause?.code ? ` (${e.cause.code})` : ''}`);
          skipped += bs[i].length;
          if ([401, 403, 429].includes(e.status) || e.cause?.code) stopped = true;
          continue;
        }
        skipped += bs[i].length - got.length;
        if (!got.length) continue;
        for (const g of got) {
          if (g.id.startsWith('fig:')) figures[g.id.slice(4)] = g.text;
          else blocks[g.id] = { text: g.text, ...(g.lead ? { lead: g.lead } : {}) };
        }
        const out = saveTranslation(lesson, items, blocks, figures, { method: 'machine', translator: gemini ? 'Gemini API' : 'Claude API', model: cfg.model, createdAt: p.ex?.createdAt });
        console.log(`  ${lesson.id} batch ${i + 1}/${bs.length} · ${out.coverage.translated}/${out.coverage.total}${got.length < bs[i].length ? ` (${bs[i].length - got.length} rejected, will retry on next run)` : ''}`);
      }
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  console.log(`Tokens ${gemini ? 'estimated' : 'used'}: input ${cfg.usage.input.toLocaleString('en')}, output ${cfg.usage.output.toLocaleString('en')}. Restart the server to load the new text.`);
  if (stopped || skipped) {
    console.error('Some blocks remain untranslated. Rerun to resume.');
    process.exitCode = 1;
  }
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

// --------------------------------------------------------------------- export / lint
// export: write the English source of a chapter in the same "@@ id" format a translator fills in.
function exportSource(id) {
  const manifest = new Map(readJson(path.join(CONTENT, 'figures', 'manifest.json')).figures.map((f) => [f.imageId, f]));
  const lesson = readJson(lessonPath(id));
  const out = [`# ${id} — ${lesson.titleOriginal} (EN manba). Har bir "@@" blokini o‘zbekchaga tarjima qiling; id va LEAD: qatorlarini saqlang.`, ''];
  for (const it of itemsFor(lesson, manifest)) {
    out.push(`@@ ${it.id}`, `# kind: ${it.kind}`);
    if (it.lead) out.push(`LEAD: ${it.lead}`);
    out.push(it.text || '', '');
  }
  const dir = path.join(ROOT, 'tools', 'translations-src', 'en');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${id}.en.txt`);
  fs.writeFileSync(p, out.join('\n'));
  console.log(`${id}: ${out.filter((l) => l.startsWith('@@')).length} blocks -> ${path.relative(ROOT, p)}`);
}

// Uzbek typography (as in Microsoft Word): o‘ g‘ O‘ G‘ with U+2018, tutuq belgisi with U+2019 (ma’lumot),
// “double quotes”, " — " for a dash between words, "–" for numeric ranges. No ASCII ' or " inside Uzbek text.
const TYPO_RULES = [
  [/[oOgG][’'`ʻʼ´]/g, 'o‘/g‘ uchun ‘ (U+2018) kerak'],
  [/'/g, "ASCII ' ishlatilmasin (‘ yoki ’ kerak)"],
  [/[ʻʼ`´]/g, 'ʻ ʼ ` ´ o‘rniga ‘ yoki ’ ishlatilsin'],
  [/(^|[^oOgG])‘/g, '‘ faqat o‘/g‘ da ishlatiladi (tutuq uchun ’)'],
  [/"/g, 'ASCII " o‘rniga “ ” ishlatilsin'],
  [/ - /g, 'so‘zlar orasidagi tire " — " bo‘lishi kerak'],
  [/[ \t]+(?=[,;:!?])/g, 'tinish belgisidan oldin ortiqcha bo‘shliq'],
  [/[\u0400-\u04FF]/g, 'kirill harfi aralashib qolgan (lotin harfi kerak)'],
];
function lintFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  let bad = 0;
  src.split('\n').forEach((line, i) => {
    if (line.startsWith('#') || line.startsWith('@@')) return;
    const body = line.replace(/^LEAD:\s*/, '');
    if (body !== newUzbekAlphabet(body)) {
      bad++;
      if (bad <= 40) console.log(`${path.basename(file)}:${i + 1}: yangi alifbo bo‘yicha yozilishi kerak`);
    }
    const withoutMarkup = body.replace(/\*\*[^*]+\*\*|(?<![\p{L}\p{N}])_[^_]+_(?![\p{L}\p{N}])/gu, '');
    if (/[*_\\|]|-{3,}/.test(withoutMarkup)) {
      bad++;
      if (bad <= 40) console.log(`${path.basename(file)}:${i + 1}: noto‘g‘ri formatlash belgisi`);
    }
    for (const [re, msg] of TYPO_RULES) {
      re.lastIndex = 0;
      const m = re.exec(body);
      if (m) { bad++; if (bad <= 40) console.log(`${path.basename(file)}:${i + 1}: ${msg} — …${body.slice(Math.max(0, m.index - 20), m.index + 20)}…`); }
    }
  });
  console.log(`${path.basename(file)}: ${bad ? `${bad} ta belgi xatosi` : 'belgilar to‘g‘ri'}`);
  return bad;
}

const [cmd, ...rest] = process.argv.slice(2);
const args = {}; const pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) { const k = rest[i].slice(2); const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; args[k] = v; } else pos.push(rest[i]);
}
if (cmd === 'compile') { if (!pos.length) { console.error('compile <file.uz.txt>...'); process.exit(2); } pos.forEach(compile); }
else if (cmd === 'run') await run(args);
else if (cmd === 'status') status();
else if (cmd === 'export') pos.forEach(exportSource);
else if (cmd === 'lint') { const n = pos.map(lintFile).reduce((x, y) => x + y, 0); process.exit(n ? 1 : 0); }
else { console.log('Usage: node tools/translate.mjs status | run [--only chNN,..|--all] [--dry-run] [--concurrency 2] | compile <file>'); }
