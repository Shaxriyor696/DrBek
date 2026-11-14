#!/usr/bin/env node
// Builds the static web preview ("demo") of DrBek: the same SPA as the real app,
// but API calls are answered in the browser (public/js/demo-api.js) from JSON
// snapshots of the real API plus the student's state in localStorage.
//
//   node tools/build-demo.mjs [outDir]      (default: dist/demo)
//
// Starts the real server on a temporary database, registers a fresh student,
// snapshots every read-only endpoint, packs book figures per chapter as data URLs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'demo'));
const PORT = 3299;
const BASE = `http://127.0.0.1:${PORT}`;
const tmpDb = path.join(os.tmpdir(), `drstudy-demo-${Date.now()}.db`);

const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const mk = (p) => fs.mkdirSync(p, { recursive: true });
const write = (rel, data) => { const f = path.join(OUT, rel); mk(path.dirname(f)); fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data)); };
const relAssets = (s) => s.replace(/"\/assets\//g, '"assets/');

async function main() {
  rm(OUT); mk(OUT);
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATABASE_FILE: tmpDb, ANTHROPIC_API_KEY: '', BOOK_PDF_PATH: '', CONTENT_ACCESS: 'review_preview', MAIL_OUTBOX: path.join(os.tmpdir(), 'drstudy-demo-outbox.log') }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* */ } await new Promise((r) => setTimeout(r, 200)); }
    let cookie = '';
    const call = async (p, method = 'GET', body) => {
      const r = await fetch(BASE + p, { method, headers: { 'x-requested-with': 'drstudy', cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.getSetCookie?.() || [];
      if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
      const t = await r.text();
      if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${t.slice(0, 200)}`);
      return t;
    };
    await call('/api/auth/register', 'POST', { name: 'Mehmon', email: 'demo@drstudy.local', password: 'demo-parol-123' });
    await call('/api/auth/login', 'POST', { email: 'demo@drstudy.local', password: 'demo-parol-123' });
    await call('/api/profile', 'PATCH', { name: 'Mehmon', course: 2, direction: 'Davolash ishi', completeOnboarding: true });

    const topics = JSON.parse(await call('/api/topics'));
    write('demo/data/topics.json', relAssets(JSON.stringify(topics)));
    write('demo/data/library.json', relAssets(await call('/api/library')));
    write('demo/data/practice.json', relAssets(await call('/api/practice/overview')));
    const lessons = [];
    for (const t of topics.topics) {
      // lesson calls create progress rows; fetch topic first so its snapshot is clean
      const td = JSON.parse(await call(`/api/topics/${t.id}`));
      write(`demo/data/topic-${t.id}.json`, relAssets(JSON.stringify(td)));
      for (const s of td.sections) lessons.push({ id: s.id, topicId: t.id });
    }
    const search = [];
    const figIndex = {};
    for (const { id, topicId } of lessons) {
      const raw = await call(`/api/lessons/${id}`);
      const d = JSON.parse(raw);
      write(`demo/data/lesson-${id}.json`, relAssets(raw));
      const L = d.lesson;
      search.push({ k: 'lesson', t: topicId, l: id, title: L.titleUz, en: L.titleOriginal });
      for (const b of L.blocks.full) if (b.type === 'heading') search.push({ k: 'original', t: topicId, l: id, b: b.id || b.bid, title: b.text, lang: 'en', p: b.pdfPage });
      for (const b of L.blocks.simple) {
        if (b.type === 'heading') search.push({ k: 'summary', t: topicId, l: id, b: b.id || b.bid, title: b.text, lang: 'uz' });
        else if (b.type === 'paragraph') search.push({ k: 'summary', t: topicId, l: id, b: b.id || b.bid, title: L.titleUz, text: b.text.slice(0, 600), lang: 'uz' });
      }
      if (d.translation) for (const b of L.blocks.full) { const x = d.translation.blocks[b.bid]; if (x && b.type === 'paragraph') search.push({ k: 'translation', t: topicId, l: id, b: b.id || b.bid, title: L.titleUz, text: x.text.slice(0, 600), lang: 'uz', p: b.pdfPage }); }
      for (const g of L.glossary || []) search.push({ k: 'term', t: topicId, l: id, title: g.termUz, en: g.original || '', text: (g.contextUz || '').slice(0, 300), lang: 'uz' });
      for (const f of d.figures) { figIndex[f.imageId] = id; search.push({ k: 'figure', t: topicId, l: id, f: f.imageId, title: (f.figureNumber || '').replace(/^Figure/, 'Rasm').replace(/^Table/, 'Jadval'), text: (f.captionUz || f.originalCaption || '').slice(0, 300), lang: f.captionUz ? 'uz' : 'en', p: f.pdfPage }); }
    }
    write('demo/data/search.json', search);
    write('demo/data/figindex.json', figIndex);
    // question bank with answers (graded in the browser in demo mode)
    const qs = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'content', 'questions')).filter((x) => x.endsWith('.json'))) qs.push(...JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'questions', f), 'utf8')).questions);
    write('demo/data/questions.json', qs);
    console.log(`snapshots: ${topics.topics.length} topics, ${lessons.length} lessons, ${search.length} search rows, ${qs.length} questions`);
  } finally { srv.kill(); rm(tmpDb); }

  // figures: one JSON pack per chapter {imageId: dataURL}, re-encoded to keep the pack small
  const imgDir = path.join(ROOT, 'content', 'figures', 'img');
  const tmpImg = fs.mkdtempSync(path.join(os.tmpdir(), 'dsfig-'));
  execFileSync('python3', ['-I', '-c', `
import sys, os
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
for f in os.listdir(src):
    if not f.endswith('.webp'): continue
    im = Image.open(os.path.join(src, f)); im.load()
    if im.width > 1100: im = im.resize((1100, round(im.height * 1100 / im.width)), Image.LANCZOS)
    im.save(os.path.join(dst, f), 'WEBP', quality=72, method=6)
`, imgDir, tmpImg]);
  const packs = {};
  for (const f of fs.readdirSync(tmpImg)) {
    const m = /^gh14-(?:fig|tab)-(\d{2})-/.exec(f); if (!m) continue;
    const ch = `ch${m[1]}`;
    (packs[ch] ||= {})[f.replace(/\.webp$/, '')] = `data:image/webp;base64,${fs.readFileSync(path.join(tmpImg, f)).toString('base64')}`;
  }
  let total = 0;
  for (const [ch, p] of Object.entries(packs)) { const s = JSON.stringify(p); total += s.length; write(`demo/media/${ch}.json`, s); }
  rm(tmpImg);
  console.log(`figure packs: ${Object.keys(packs).length} chapters, ${(total / 1e6).toFixed(1)} MB`);

  // app shell: public/ with absolute asset paths made relative
  const copy = (from, to) => {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, e.name); const b = path.join(to, e.name);
      if (e.isDirectory()) { mk(b); copy(a, b); continue; }
      if (/\.(js|css)$/.test(e.name)) fs.writeFileSync(b, fs.readFileSync(a, 'utf8').replace(/(['"`(])\/assets\//g, '$1assets/'));
      else fs.copyFileSync(a, b);
    }
  };
  mk(path.join(OUT, 'js')); copy(path.join(ROOT, 'public', 'js'), path.join(OUT, 'js'));
  // GitHub Pages serves the demo under /<repo>/: make hard-coded /assets/ paths relative.
  const relJs = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) relJs(f); else if (f.endsWith('.js')) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/(['"`])\/assets\//g, '$1assets/')); } };
  relJs(path.join(OUT, 'js'));
  mk(path.join(OUT, 'assets')); copy(path.join(ROOT, 'public', 'assets'), path.join(OUT, 'assets'));
  for (const big of ['drbek-mono-512.png', 'drbek-mono-192.png']) rm(path.join(OUT, 'assets', big));
  fs.writeFileSync(path.join(OUT, 'app.css'), fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8').replace(/url\(\/assets\//g, 'url(assets/'));
  // Artifact-style page fragment (the host adds the document skeleton); also works as a plain file.
  write('index.html', `<!doctype html>
<html lang="uz">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="claude:viewport-fit-sides" content="cover">
<title>DrBek — fiziologiya</title>
<link rel="icon" type="image/png" href="assets/drbek-mono-64.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="app.css">
<style>:root{color-scheme:light}body{background-color:#F2F8F7}</style>
<div id="root"><div class="empty" role="status">Yuklanmoqda…</div></div>
<div class="toast-wrap" id="toasts" aria-live="polite"></div>
<script>window.DS_DEMO = true;</script>
<script type="module" src="js/main.js"></script>
`);
  const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
  console.log(`demo written to ${OUT} (${count(OUT)} files)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
