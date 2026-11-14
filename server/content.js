// Content store: reads the versioned import files in content/, applies review /
// publish state from the DB, and maintains the full-text search index.
import fs from 'node:fs';
import path from 'node:path';
import { nowIso } from './http.js';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

export function plainText(s) {
  return String(s || '').replace(/\*\*/g, '').replace(/(^|\s)_([^_]+)_(?=\s|[.,;:)]|$)/g, '$1$2');
}

function blockText(b) {
  if (b.type === 'list') return b.items.map((i) => i.text).join(' ');
  if (b.type === 'table') return [b.header, ...b.rows].map((r) => r.join(' ')).join(' ');
  if (b.type === 'bibliography') return '';
  return [b.lead, b.text].filter(Boolean).join(' ');
}

export class ContentStore {
  constructor(dir, db, { access = 'review_preview' } = {}) {
    this.dir = dir;
    this.db = db;
    this.access = access; // 'review_preview' shows in_review lessons with a banner; 'published_only' hides them
    this.reload();
  }

  reload() {
    const d = this.dir;
    if (!fs.existsSync(path.join(d, 'topics.json'))) {
      throw new Error(`Content not found in ${d}. Run the importer first (see README).`);
    }
    const t = readJson(path.join(d, 'topics.json'));
    this.contentVersion = t.contentVersion;
    this.topics = t.topics;
    this.books = readJson(path.join(d, 'books.json')).books;
    this.aliases = readJson(path.join(d, 'aliases.json')).sections;
    const man = readJson(path.join(d, 'figures', 'manifest.json'));
    this.figures = new Map(man.figures.map((f) => [f.imageId, f]));
    this.glossary = readJson(path.join(d, 'glossary.json')).terms;
    this.coverage = readJson(path.join(d, 'coverage-report.json'));
    this.inventory = readJson(path.join(d, 'inventory.json'));
    this.lessonCache = new Map();
    this.lessonIndex = new Map();
    for (const tp of this.topics) for (const s of tp.sections) this.lessonIndex.set(s.id, { ...s, topicId: tp.id });
    this.loadTranslations();
    this.loadQuestions();
    this.ensureIndex();
  }

  // Full Uzbek translations of the book text (content/translations/chNN.uz.json),
  // kept separate from the importer output so a re-import never overwrites them.
  loadTranslations() {
    this.translations = new Map();
    this.figCaptionsUz = new Map();
    const tdir = path.join(this.dir, 'translations');
    this.translationStamp = '';
    if (!fs.existsSync(tdir)) return;
    for (const f of fs.readdirSync(tdir).filter((x) => /^ch\d{2}\.uz\.json$/.test(x)).sort()) {
      const tr = readJson(path.join(tdir, f));
      if (!this.lessonIndex.has(tr.lessonId)) continue;
      this.translations.set(tr.lessonId, tr);
      for (const [k, v] of Object.entries(tr.figures || {})) this.figCaptionsUz.set(k, v);
      this.translationStamp += `${f}:${fs.statSync(path.join(tdir, f)).mtimeMs};`;
    }
  }

  translationInfo(id) {
    const tr = this.translations.get(id);
    if (!tr) return null;
    return { status: tr.status, method: tr.method, translator: tr.translator, translated: tr.coverage?.translated ?? 0, total: tr.coverage?.total ?? 0, sourceContentVersion: tr.sourceContentVersion, updatedAt: tr.updatedAt };
  }

  lessonFile(id) {
    if (!/^ch\d{2}$/.test(id)) return null;
    if (!this.lessonCache.has(id)) {
      const p = path.join(this.dir, 'lessons', `${id}.json`);
      if (!fs.existsSync(p)) return null;
      this.lessonCache.set(id, readJson(p));
    }
    return this.lessonCache.get(id);
  }

  // effective status = admin override (content_state) or the imported status
  status(type, targetId, fallback) {
    const r = this.db.prepare('SELECT status FROM content_state WHERE target_type=? AND target_id=?').get(type, targetId);
    return r ? r.status : fallback;
  }

  canSee(lessonStatus, user) {
    if (user && (user.roles.includes('admin') || user.roles.includes('editor') || user.roles.includes('reviewer'))) return lessonStatus !== 'archived' || true;
    if (lessonStatus === 'published') return true;
    if (this.access === 'review_preview' && ['in_review', 'approved'].includes(lessonStatus)) return true;
    return false;
  }

  lessonMeta(id) {
    const m = this.lessonIndex.get(id);
    if (!m) return null;
    return { ...m, status: this.status('lesson', id, m.status) };
  }

  resolveSectionId(id) {
    if (this.lessonIndex.has(id)) return { id };
    if (this.aliases[id]) return { id: this.aliases[id], aliasOf: id };
    return null;
  }

  topicList(user) {
    return this.topics.map((t) => ({
      id: t.id, order: t.order, title: t.title, description: t.description, cardImage: t.cardImage,
      bookUnit: t.bookUnit,
      sections: t.sections.map((s) => ({ ...s, status: this.status('lesson', s.id, s.status) }))
        .filter((s) => this.canSee(s.status, user) || s.status !== 'archived'),
    }));
  }

  lesson(id, user) {
    const meta = this.lessonMeta(id);
    if (!meta) return null;
    const l = this.lessonFile(id);
    if (!l) return null;
    const visible = this.canSee(meta.status, user);
    return { lesson: l, status: meta.status, visible };
  }

  figure(imageId) { return this.figures.get(imageId) || null; }

  // ------------------------------------------------------------------ questions
  loadQuestions() {
    const qdir = path.join(this.dir, 'questions');
    const now = nowIso();
    const files = fs.existsSync(qdir) ? fs.readdirSync(qdir).filter((f) => f.endsWith('.json')) : [];
    const ins = this.db.prepare(`INSERT INTO questions (id, version, topic_id, lesson_id, stem, options, answer_option_id, explanation, difficulty, source_ref, status, origin)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id, version) DO NOTHING`);
    let n = 0;
    for (const f of files) {
      const data = readJson(path.join(qdir, f));
      for (const q of data.questions) {
        if (!q.options.some((o) => o.id === q.answerOptionId)) throw new Error(`Question ${q.id}: answer id not among options`);
        if (!this.lessonIndex.has(q.lessonId)) throw new Error(`Question ${q.id}: unknown lesson ${q.lessonId}`);
        ins.run(q.id, q.version, q.topicId, q.lessonId, q.stem, JSON.stringify(q.options), q.answerOptionId, q.explanation,
          q.difficulty || null, JSON.stringify(q.source), q.status || 'needs_review', data.origin || null);
        n++;
      }
    }
    this.questionCount = n;
    void now;
  }

  // questions usable for students: latest version, status approved (or needs_review in preview mode)
  questionPool({ lessonId, topicId }) {
    const allowed = this.access === 'review_preview' ? ['approved', 'needs_review'] : ['approved'];
    const rows = this.db.prepare(`SELECT q.* FROM questions q
      JOIN (SELECT id, MAX(version) v FROM questions GROUP BY id) m ON m.id=q.id AND m.v=q.version
      WHERE ${lessonId ? 'q.lesson_id = ?' : 'q.topic_id = ?'}`).all(lessonId || topicId);
    return rows.filter((r) => allowed.includes(this.status('question', r.id, r.status)) && r.status !== 'rejected');
  }

  // ------------------------------------------------------------------ search index
  ensureIndex() {
    const key = 'search_index_version';
    const want = `${this.contentVersion}:${this.lessonIndex.size}:${fs.statSync(path.join(this.dir, 'topics.json')).mtimeMs}:${this.translationStamp}`;
    const have = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);
    if (have && have.value === want) return;
    const stmt = this.db.prepare('INSERT INTO search_chunks (chunk_id, kind, topic_id, lesson_id, block_id, lang, locator, raw, title, body) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const ins = { run: (cid, kind, tid, lid, bid, lang, loc, title, body) => stmt.run(cid, kind, tid, lid, bid, lang, loc, body, normSearch(title), normSearch(body)) };
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM search_chunks');
      for (const t of this.topics) {
        ins.run(`topic:${t.id}`, 'topic', t.id, null, null, 'uz', null, t.title, `${t.title} ${t.description} ${t.bookUnit.title}`);
        for (const s of t.sections) {
          const l = this.lessonFile(s.id);
          if (!l) continue;
          ins.run(`lesson:${s.id}`, 'lesson', t.id, s.id, null, 'uz', null, l.titleUz, `${l.titleUz} ${l.titleOriginal} ${(l.objectives || []).join(' ')}`);
          // Uzbek summary chunks: one per heading section
          this.chunkBlocks(l.blocks.simple, (title, body, firstBid, pages) => {
            ins.run(`uz:${s.id}:${firstBid}`, 'summary', t.id, s.id, firstBid, 'uz',
              JSON.stringify({ pdfPages: pages || l.pdfPages }), title || l.titleUz, body);
          });
          // original text chunks (English), grouped paragraphs
          let buf = []; let first = null; let page = null; let head = l.titleOriginal;
          const flush = () => {
            if (!buf.length) return;
            ins.run(`en:${s.id}:${first}`, 'original', t.id, s.id, first, 'en', JSON.stringify({ pdfPage: page }), head, buf.join(' '));
            buf = []; first = null;
          };
          for (const b of l.blocks.full) {
            if (b.type === 'heading') { flush(); head = b.text; continue; }
            if (b.type !== 'paragraph') continue;
            if (!first) { first = b.bid; page = b.pdfPage; }
            buf.push(plainText(blockText(b)));
            if (buf.join(' ').length > 1400) flush();
          }
          flush();
          // full Uzbek translation chunks (same grouping as the original text)
          const tr = this.translations.get(s.id);
          if (tr) {
            let tb = []; let tf = null; let tp = null; let th = l.titleUz;
            const tflush = () => { if (tb.length) ins.run(`tr:${s.id}:${tf}`, 'translation', t.id, s.id, tf, 'uz', JSON.stringify({ pdfPage: tp }), th, tb.join(' ')); tb = []; tf = null; };
            for (const b of l.blocks.full) {
              const x = tr.blocks[b.bid];
              if (b.type === 'heading') { tflush(); th = x?.text || th; continue; }
              if (b.type !== 'paragraph' || !x) continue;
              if (!tf) { tf = b.bid; tp = b.pdfPage; }
              tb.push(plainText([x.lead, x.text].filter(Boolean).join(' ')));
              if (tb.join(' ').length > 1400) tflush();
            }
            tflush();
          }
          for (const g of l.glossary) {
            ins.run(`term:${g.id}`, 'term', t.id, s.id, null, 'uz', null, g.termUz, `${g.termUz} ${g.original || ''} ${g.contextUz}`);
          }
          for (const fid of l.figureIds) {
            const f = this.figures.get(fid);
            if (f) ins.run(`figure:${fid}`, 'figure', t.id, s.id, null, 'en', JSON.stringify({ pdfPage: f.pdfPage }), f.figureNumber, `${f.originalCaption || ''} ${this.figCaptionsUz.get(fid) || ''}`);
          }
        }
      }
      for (const b of this.books) ins.run(`book:${b.id}`, 'book', null, null, null, 'en', null, b.title, `${b.title} ${b.authors.join(' ')} ${b.edition}`);
      this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, want);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  chunkBlocks(blocks, emit) {
    let title = null; let body = []; let first = null; let pages = null;
    const flush = () => { if (body.length) emit(title, body.join(' '), first, pages); body = []; first = null; };
    for (const b of blocks) {
      if (b.type === 'heading') { flush(); title = plainText(b.text); pages = b.pdfPages || null; first = b.bid; continue; }
      if (b.type === 'figure') continue;
      if (!first) first = b.bid;
      body.push(plainText(blockText(b)));
    }
    flush();
  }
}

export function normSearch(s) {
  return String(s || '').replace(/[‘’ʻʼ`']/g, '').normalize('NFKC');
}

// FTS query from free text: keep word tokens, OR them, prefix match.
export function ftsQuery(text, max = 12) {
  const norm = String(text || '').toLowerCase()
    .replace(/[‘’ʻʼ`']/g, '')
    .normalize('NFKC');
  const stop = new Set(['va', 'bu', 'nima', 'qanday', 'uchun', 'bilan', 'ham', 'the', 'and', 'of', 'is', 'a', 'in', 'to', 'nega', 'qaysi', 'mi', 'da', 'ni', 'bir', 'shu', 'haqida', 'tushuntir', 'tushuntiring', 'menga']);
  const toks = [...new Set((norm.match(/[\p{L}\p{N}]{2,}/gu) || []).filter((w) => !stop.has(w)))].slice(0, max);
  if (!toks.length) return null;
  return toks.map((w) => `"${w.replace(/"/g, '')}"*`).join(' OR ');
}

// AND variant (all words) — tried first for better precision.
export function ftsQueryAll(text, max = 12) {
  const q = ftsQuery(text, max);
  return q ? q.split(' OR ').join(' AND ') : null;
}
