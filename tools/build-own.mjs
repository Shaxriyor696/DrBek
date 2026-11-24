#!/usr/bin/env node
// iMedu'ning o'z matni (tools/own-src/chNN.uz.md) -> content/lessons/chNN.json
//
//   node tools/build-own.mjs ch01 [ch02 ...]
//
// Manba formati:
//   --- front matter (id, title, objectives, sources) ---
//   === full | === simple | === terms   bo'limlari
//   ## / ### sarlavha, oddiy xatboshi, "- " / "  - " ro'yxat, "1. " raqamli ro'yxat,
//   "| a | b |" jadval, "> " ramkali (klinik) xatboshi,
//   "!fig r-ch01-01 | izoh" rasm.
// Matn oddiy lotin yozuvida yoziladi; bu skript uni yangi alifboga o'giradi.
// Rasmlar content/figures/img/<id>.webp da bo'lishi kerak (tayyorlash: Python, 1600 px).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { newUzbekAlphabet as uz } from './uz-alphabet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = path.join(ROOT, 'content');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
// keep each file's own indentation and trailing newline (smaller diffs)
const writeJson = (p, d) => {
  const raw = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '{\n "x"';
  const indent = raw.match(/\n( +)"/)?.[1] || ' ';
  fs.writeFileSync(p, JSON.stringify(d, null, indent) + (raw.endsWith('\n') ? '\n' : ''));
};

function webpSize(file) {
  const b = fs.readFileSync(file);
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
  return null;
}

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);

function parse(src) {
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) throw new Error('front matter yo‘q');
  const meta = { objectives: [] };
  let inObj = false;
  for (const ln of fm[1].split('\n')) {
    if (/^objectives:\s*$/.test(ln)) { inObj = true; continue; }
    if (inObj && ln.startsWith('- ')) { meta.objectives.push(ln.slice(2).trim()); continue; }
    inObj = false;
    const m = ln.match(/^(\w+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  const parts = {};
  let cur = null;
  for (const ln of src.slice(fm[0].length).split('\n')) {
    const m = ln.match(/^=== (\w+)\s*$/);
    if (m) { cur = m[1]; parts[cur] = []; continue; }
    if (cur) parts[cur].push(ln);
  }
  return { meta, parts };
}

function blocks(lines, id, prefix, captions) {
  const out = [];
  let n = 0;
  const bid = () => `${id}-${prefix}${n++}`;
  let para = [];
  let list = null;
  let table = null;
  let box = [];
  const flushPara = () => { if (para.length) { out.push({ type: 'paragraph', text: uz(para.join(' ')), bid: bid() }); para = []; } };
  const flushList = () => { if (list) { out.push({ type: 'list', ordered: list.ordered, items: list.items, bid: bid() }); list = null; } };
  const flushTable = () => {
    if (!table) return;
    const rows = table.filter((r) => !/^\|\s*-/.test(r)).map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => uz(c.trim())));
    out.push({ type: 'table', header: rows[0], rows: rows.slice(1), bid: bid() });
    table = null;
  };
  const flushBox = () => {
    if (!box.length) return;
    // a box may contain a lead line and list items
    const items = box.filter((l) => /^- /.test(l));
    const text = box.filter((l) => !/^- /.test(l)).join(' ');
    out.push({ type: 'paragraph', boxed: true, text: uz(text + (items.length ? ' ' + items.map((l) => `• ${l.slice(2)}`).join(' ') : '')), bid: bid() });
    box = [];
  };
  const flushAll = () => { flushPara(); flushList(); flushTable(); flushBox(); };
  for (const raw of lines) {
    const ln = raw.replace(/\s+$/, '');
    if (!ln.trim()) { flushAll(); continue; }
    let m;
    if ((m = ln.match(/^(#{2,3}) (.*)$/))) {
      flushAll();
      const b = bid();
      out.push({ type: 'heading', level: m[1].length, text: uz(m[2]), id: `${id}-${slug(m[2])}`, bid: b });
      continue;
    }
    if ((m = ln.match(/^!fig (\S+)(?:\s*\|\s*(.*))?$/))) {
      flushAll();
      if (m[2] && !captions.has(m[1])) captions.set(m[1], uz(m[2]));
      out.push({ type: 'figure', imageId: m[1], bid: bid() });
      continue;
    }
    if (ln.startsWith('|')) { flushPara(); flushList(); flushBox(); (table ||= []).push(ln); continue; }
    if (ln.startsWith('> ')) { flushPara(); flushList(); flushTable(); box.push(ln.slice(2).trim()); continue; }
    if ((m = ln.match(/^(\s*)(- |\d+\. )(.*)$/))) {
      flushPara(); flushTable(); flushBox();
      const ordered = /\d/.test(m[2]);
      const depth = m[1].length >= 2 ? 1 : 0;
      if (!list || (depth === 0 && list.ordered !== ordered)) { flushList(); list = { ordered, items: [] }; }
      list.items.push({ text: uz(m[3]), depth });
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1].text += ' ' + uz(ln.trim()); continue; }
    flushList(); flushTable(); flushBox();
    para.push(ln.trim());
  }
  flushAll();
  return out;
}

const words = (bs) => bs.reduce((s, b) => s + (b.text ? b.text.split(/\s+/).length : 0)
  + (b.items ? b.items.reduce((a, i) => a + i.text.split(/\s+/).length, 0) : 0)
  + (b.rows ? b.rows.flat().join(' ').split(/\s+/).length : 0), 0);

function build(id) {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'own-src', `${id}.uz.md`), 'utf8');
  const { meta, parts } = parse(src);
  const captions = new Map();
  const full = blocks(parts.full || [], id, 'o', captions);
  const simple = blocks(parts.simple || [], id, 's', captions);
  const glossary = (parts.terms || []).filter((l) => l.startsWith('- ')).map((l) => {
    // "- uzbek | english | definition"  (english is never alphabet-converted)
    const p = l.slice(2).split('|').map((x) => x.trim());
    const [term, en, def] = p.length >= 3 ? p : [p[0], '', p[1]];
    return { id: `${id}-t-${slug(term)}`, termUz: uz(term), original: en, contextUz: uz(def || '') };
  });
  const figureIds = [...new Set([...full, ...simple].filter((b) => b.type === 'figure').map((b) => b.imageId))];

  const lp = path.join(C, 'lessons', `${id}.json`);
  const L = readJson(lp);
  const ch = Number(id.slice(2));
  Object.assign(L, {
    titleUz: uz(meta.title || L.titleUz),
    subtitle: uz(`iMedu matni · manbalar: ${meta.sources || ''}`),
    own: true,
    translationStatus: 'own',
    source: { bookId: L.source?.bookId || 'guyton-hall-14', chapter: ch, unit: L.source?.unit, kind: 'own', sources: meta.sources || '' },
    outline: full.filter((b) => b.type === 'heading').map((b) => ({ level: b.level, title: b.text, id: b.id })),
    objectives: meta.objectives.map(uz),
    blocks: { simple, full },
    glossary,
    bookDefinitions: [],
    keyNumbers: [],
    figureIds,
    estMinutes: Math.max(5, Math.round(words(full) / 180)),
    counts: { figures: figureIds.length, figuresIncluded: figureIds.length, terms: glossary.length, words: words(full), unplacedInSummary: 0 },
  });
  writeJson(lp, L);

  // figure manifest
  const mp = path.join(C, 'figures', 'manifest.json');
  const man = readJson(mp);
  const byId = new Map(man.figures.map((f) => [f.imageId, f]));
  figureIds.forEach((fid, i) => {
    const file = path.join(C, 'figures', 'img', `${fid}.webp`);
    if (!fs.existsSync(file)) throw new Error(`rasm topilmadi: ${file}`);
    const [, c, k] = fid.match(/^r-ch(\d+)-(\d+)$/) || [];
    byId.set(fid, {
      imageId: fid, kind: 'figure', bookEditionId: 'imedu',
      figureNumber: `${Number(c)}.${Number(k)}-rasm`,
      pdfPageIndex: null, pdfPage: null, printedPageLabel: null,
      originalCaption: '', captionUz: captions.get(fid) || null, altTextUz: captions.get(fid) || null,
      sourceSectionId: id, topicId: L.topicId, lessonId: id,
      assetPath: `figures/img/${fid}.webp`, dimensions: webpSize(file),
      reviewStatus: 'needs_review', usageStatus: 'own', coverage: 'included',
    });
  });
  // merge with Python: keeps the manifest's float formatting (70.0) untouched
  const own = figureIds.map((fid) => byId.get(fid));
  const py = `import json,sys
p=sys.argv[1]; own=json.loads(sys.stdin.read())
raw=open(p,encoding='utf-8').read(); m=json.loads(raw)
ids={f['imageId'] for f in own}
m['figures']=[f for f in m['figures'] if f['imageId'] not in ids]+own
open(p,'w',encoding='utf-8').write(json.dumps(m,ensure_ascii=False,indent=2)+('\\n' if raw.endswith('\\n') else ''))`;
  execFileSync('python3', ['-c', py, mp], { input: JSON.stringify(own) });

  // the old Guyton translation is superseded by the own text
  const tp = path.join(C, 'translations', `${id}.uz.json`);
  if (fs.existsSync(tp)) fs.rmSync(tp);

  // topics.json section metadata
  const tpath = path.join(C, 'topics.json');
  const T = readJson(tpath);
  for (const t of T.topics) for (const s of t.sections) if (s.id === id) {
    Object.assign(s, { titleUz: L.titleUz, own: true, estMinutes: L.estMinutes, counts: L.counts });
  }
  writeJson(tpath, T);
  console.log(`${id}: ${full.length} blok, ${L.counts.words} so‘z, ${figureIds.length} rasm, ${glossary.length} atama`);
}

for (const id of process.argv.slice(2)) build(id);
