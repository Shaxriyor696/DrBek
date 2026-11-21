// REST API: content, progress, reading time, saved items, notes, quizzes, analytics, profile, search.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { E, ApiError, id, nowIso, v } from './http.js';
import { computeAnalytics, dayKey } from './analytics.js';
import { ftsQuery, ftsQueryAll, plainText } from './content.js';
import { rateLimit } from './auth.js';

const need = (user) => { if (!user) throw E.unauth(); return user; };
const J = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export function getProfile(db, userId) {
  return db.prepare('SELECT * FROM profiles WHERE user_id=?').get(userId);
}

function profileOut(p) {
  return {
    name: p.name, university: p.university, course: p.course, direction: p.direction, studyLang: p.study_lang,
    dailyGoalMin: p.daily_goal_min, timezone: p.timezone, readerFont: p.reader_font, readerLine: p.reader_line,
    onboarded: !!p.onboarded_at,
  };
}

export function apiRoutes(router, { db, content, config }) {
  const telemetry = (user, type, target) => {
    db.prepare('INSERT INTO telemetry (id, user_id, type, target, at) VALUES (?,?,?,?,?)').run(id('ev_'), user?.id || null, type, target || null, nowIso());
  };

  // ------------------------------------------------------------- me / profile
  router.get('/api/me', ({ user }) => {
    if (!user) return { body: { user: null } };
    const p = getProfile(db, user.id);
    const last = db.prepare('SELECT lesson_id, last_block, last_tab, updated_at FROM lesson_progress WHERE user_id=? ORDER BY updated_at DESC LIMIT 1').get(user.id);
    return { body: { user: { id: user.id, email: user.email, roles: user.roles, emailVerified: user.emailVerified, profile: profileOut(p) }, lastPosition: last || null } };
  });

  router.patch('/api/profile', ({ user, body }) => {
    need(user);
    const tzs = Intl.supportedValuesOf('timeZone');
    const d = v(body, {
      name: { type: 'string', min: 2, max: 80 },
      university: { type: 'string', max: 120 },
      course: { type: 'int', min: 1, max: 7 },
      direction: { type: 'string', max: 80 },
      studyLang: { type: 'string', oneOf: ['uz', 'ru', 'en'] },
      dailyGoalMin: { type: 'int', oneOf: [15, 30, 45] },
      timezone: { type: 'string', max: 64 },
      readerFont: { type: 'int', min: 15, max: 24 },
      readerLine: { type: 'number', min: 1.4, max: 2.1 },
      completeOnboarding: { type: 'bool' },
    });
    if (d.timezone && !tzs.includes(d.timezone) && d.timezone !== 'UTC') throw E.invalid({ timezone: 'Vaqt zonasi notöğri.' });
    if (d.completeOnboarding) {
      const errs = {};
      const cur = getProfile(db, user.id);
      if (!(d.name || cur.name)) errs.name = 'Ismingizni kiriting.';
      if (!(d.course || cur.course)) errs.course = 'Kursni tanlang.';
      if (Object.keys(errs).length) throw E.invalid(errs);
    }
    const map = { name: 'name', university: 'university', course: 'course', direction: 'direction', studyLang: 'study_lang', dailyGoalMin: 'daily_goal_min', timezone: 'timezone', readerFont: 'reader_font', readerLine: 'reader_line' };
    const sets = []; const vals = [];
    for (const [k, col] of Object.entries(map)) if (d[k] !== undefined) { sets.push(`${col}=?`); vals.push(d[k]); }
    if (d.completeOnboarding) { sets.push('onboarded_at=COALESCE(onboarded_at, ?)'); vals.push(nowIso()); telemetry(user, 'onboarding_completed'); }
    sets.push('updated_at=?'); vals.push(nowIso());
    db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE user_id=?`).run(...vals, user.id);
    return { body: { profile: profileOut(getProfile(db, user.id)) } };
  });

  // ------------------------------------------------------------- content
  router.get('/api/topics', ({ user }) => {
    need(user);
    const done = new Set(db.prepare('SELECT lesson_id FROM lesson_progress WHERE user_id=? AND completed_at IS NOT NULL').all(user.id).map((r) => r.lesson_id));
    const opened = new Set(db.prepare('SELECT lesson_id FROM lesson_progress WHERE user_id=?').all(user.id).map((r) => r.lesson_id));
    const saved = new Set(db.prepare(`SELECT target_id FROM bookmarks WHERE user_id=? AND target_type='topic' AND deleted_at IS NULL`).all(user.id).map((r) => r.target_id));
    const topics = content.topicList(user).map((t) => {
      const vis = t.sections.filter((s) => content.canSee(s.status, user));
      const read = vis.filter((s) => done.has(s.id)).length;
      const started = vis.some((s) => opened.has(s.id));
      return {
        id: t.id, order: t.order, title: t.title, description: t.description, cardImage: t.cardImage, bookUnit: t.bookUnit,
        lessonsTotal: vis.length, lessonsRead: read, saved: saved.has(t.id),
        state: vis.length === 0 ? 'no_material' : read === vis.length ? 'read' : started ? 'started' : 'not_started',
        publishedCount: t.sections.filter((s) => s.status === 'published').length,
      };
    });
    return { body: { contentVersion: content.contentVersion, access: content.access, topics } };
  });

  router.get('/api/topics/:id', ({ user, params }) => {
    need(user);
    const t = content.topicList(user).find((x) => x.id === params.id);
    if (!t) throw E.notFound('Mavzu');
    telemetry(user, 'topic_opened', t.id);
    const prog = new Map(db.prepare('SELECT * FROM lesson_progress WHERE user_id=?').all(user.id).map((r) => [r.lesson_id, r]));
    const lastLessonAttempt = db.prepare(`SELECT scope_id, correct, total, submitted_at FROM quiz_attempts WHERE user_id=? AND scope_type='lesson' AND status='submitted' ORDER BY submitted_at DESC`).all(user.id);
    const lastBy = new Map();
    for (const a of lastLessonAttempt) if (!lastBy.has(a.scope_id)) lastBy.set(a.scope_id, a);
    const saved = new Set(db.prepare(`SELECT target_id FROM bookmarks WHERE user_id=? AND target_type='lesson' AND deleted_at IS NULL`).all(user.id).map((r) => r.target_id));
    const full = content.topics.find((x) => x.id === t.id);
    const sections = t.sections.map((s) => {
      const p = prog.get(s.id);
      const a = lastBy.get(s.id);
      return {
        ...s, visible: content.canSee(s.status, user),
        progress: p ? { completed: !!p.completed_at, opened: true, lastBlock: p.last_block } : { completed: false, opened: false },
        lastQuiz: a ? { percent: Math.round((a.correct / a.total) * 100), at: a.submitted_at } : null,
        saved: saved.has(s.id),
        questionCount: content.questionPool({ lessonId: s.id }).length,
        translation: content.translationInfo(s.id),
      };
    });
    const cov = content.coverage.topics.find((c) => c.topicId === t.id);
    const idx = content.topics.findIndex((x) => x.id === t.id);
    return {
      body: {
        topic: { id: t.id, title: t.title, description: t.description, cardImage: t.cardImage, bookUnit: t.bookUnit, saved: !!db.prepare(`SELECT 1 FROM bookmarks WHERE user_id=? AND target_type='topic' AND target_id=? AND deleted_at IS NULL`).get(user.id, t.id) },
        sections, coverage: cov, plannedSections: full.plannedSections,
        books: content.books.map((b) => ({ id: b.id, title: b.title, edition: b.edition, authors: b.authors })),
        topicQuestionCount: content.questionPool({ topicId: t.id }).length,
        prevTopic: idx > 0 ? { id: content.topics[idx - 1].id, title: content.topics[idx - 1].title } : null,
        nextTopic: idx < content.topics.length - 1 ? { id: content.topics[idx + 1].id, title: content.topics[idx + 1].title } : null,
      },
    };
  });

  router.get('/api/lessons/:id', ({ user, params }) => {
    need(user);
    const r = content.resolveSectionId(params.id);
    if (!r) throw E.notFound('Bölim');
    const got = content.lesson(r.id, user);
    if (!got) throw E.notFound('Bölim');
    if (got.status === 'archived') throw new ApiError(410, 'archived', 'Bu bölim arxivlangan. Mavzu sahifasidan boşqa bölimni tanlang.');
    if (!got.visible) throw new ApiError(403, 'not_published', 'Bu bölim hali tayyorlanmoqda (tekşiruvdan ötmagan).');
    const l = got.lesson;
    const figures = l.figureIds.map((fid) => content.figure(fid)).filter(Boolean).map((f) => figureOut(f));
    const topic = content.topics.find((t) => t.id === l.topicId);
    const order = topic.sections.map((s) => s.id);
    const i = order.indexOf(l.id);
    const p = db.prepare('SELECT * FROM lesson_progress WHERE user_id=? AND lesson_id=?').get(user.id, l.id);
    const now = nowIso();
    db.prepare(`INSERT INTO lesson_progress (user_id, lesson_id, first_opened_at, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id, lesson_id) DO UPDATE SET updated_at=excluded.updated_at`).run(user.id, l.id, now, now);
    telemetry(user, 'lesson_started', l.id);
    const book = content.books.find((b) => b.id === l.source.bookId);
    const translation = content.translations.get(l.id);
    const { review: _r, importedAt: _i, ...rest } = l;
    return {
      body: {
        lesson: rest, status: got.status, aliasOf: r.aliasOf || null, figures,
        translation: translation ? { ...content.translationInfo(l.id), blocks: translation.blocks, figures: translation.figures } : null,
        book: { id: book.id, title: book.title, edition: book.edition, authors: book.authors, year: book.year },
        topic: { id: topic.id, title: topic.title },
        prev: i > 0 ? { id: order[i - 1], title: content.lessonIndex.get(order[i - 1]).titleUz } : null,
        next: i < order.length - 1 ? { id: order[i + 1], title: content.lessonIndex.get(order[i + 1]).titleUz } : null,
        progress: p ? { completed: !!p.completed_at, completedAt: p.completed_at, readVersion: p.read_version, lastBlock: p.last_block, lastTab: p.last_tab, reviewFlag: !!p.review_flag } : { completed: false },
        updatedSinceRead: !!(p && p.completed_at && p.read_version && p.read_version !== l.contentVersion),
        questionCount: content.questionPool({ lessonId: l.id }).length,
        saved: !!db.prepare(`SELECT 1 FROM bookmarks WHERE user_id=? AND target_type='lesson' AND target_id=? AND deleted_at IS NULL`).get(user.id, l.id),
      },
    };
  });

  function figureOut(f) {
    return {
      imageId: f.imageId, kind: f.kind, figureNumber: f.figureNumber, url: f.assetPath ? `/media/${f.assetPath}` : null,
      originalCaption: f.originalCaption, captionUz: f.captionUz || content.figCaptionsUz.get(f.imageId) || null, altTextUz: f.altTextUz,
      pdfPage: f.pdfPage, pdfPageIndex: f.pdfPageIndex, printedPageLabel: f.printedPageLabel,
      dimensions: f.dimensions, reviewStatus: content.status('figure', f.imageId, f.reviewStatus), coverage: f.coverage,
      lessonId: f.lessonId, topicId: f.topicId, bookEditionId: f.bookEditionId, cropMethod: f.cropMethod,
    };
  }

  router.get('/api/figures/:id', ({ user, params }) => {
    need(user);
    const f = content.figure(params.id);
    if (!f) throw E.notFound('Rasm');
    const meta = content.lessonMeta(f.lessonId);
    if (!meta || !content.canSee(meta.status, user)) throw E.forbidden();
    telemetry(user, 'figure_opened', f.imageId);
    return { body: { figure: figureOut(f) } };
  });

  router.get('/api/sources/:bookId', ({ user, params, query }) => {
    need(user);
    const b = content.books.find((x) => x.id === params.bookId);
    if (!b) throw E.notFound('Kitob');
    const page = query.page ? parseInt(query.page, 10) : null;
    if (page !== null && !(page >= 1 && page <= b.pdf.pages)) throw E.invalid({ page: 'Sahifa raqami notöğri.' });
    telemetry(user, 'source_opened', `${b.id}:${page || ''}`);
    return { body: { book: b, pdfAvailable: !!config.bookPdfPath, pdfUrl: config.bookPdfPath ? `/source-pdf/${b.id}${page ? `#page=${page}` : ''}` : null, printedPage: page ? page - b.pdf.printedPageOffset : null } };
  });

  router.get('/api/library', ({ user }) => {
    need(user);
    const saved = new Set(db.prepare(`SELECT target_id FROM bookmarks WHERE user_id=? AND target_type='book' AND deleted_at IS NULL`).all(user.id).map((r) => r.target_id));
    return {
      body: {
        books: content.books.map((b) => ({
          ...b, saved: saved.has(b.id), pdfAvailable: !!config.bookPdfPath,
          topics: content.topics.filter((t) => t.bookUnit.bookId === b.id).map((t) => ({ id: t.id, title: t.title, unit: t.bookUnit.unit, unitTitle: t.bookUnit.title, chapters: t.sections.map((s) => ({ id: s.id, titleOriginal: s.titleOriginal, titleUz: s.titleUz, pdfPages: s.pdfPages, printedPages: s.printedPages })) })),
        })),
      },
    };
  });

  // Library shelf: books listed in content/library.json; their PDFs and covers live in
  // LIBRARY_DIR (data/library by default, outside git) and are served at /library-files/.
  const shelf = (() => { try { return JSON.parse(fs.readFileSync(path.join(config.contentDir, 'library.json'), 'utf8')); } catch { return { fields: [], books: [] }; } })();
  const libFile = (rel) => fs.existsSync(path.join(config.libraryDir, rel));
  router.get('/api/shelf', ({ user }) => {
    need(user);
    const saved = new Set(db.prepare(`SELECT target_id FROM bookmarks WHERE user_id=? AND target_type='book' AND deleted_at IS NULL`).all(user.id).map((r) => r.target_id));
    return {
      body: {
        fields: shelf.fields,
        books: shelf.books.map((b) => ({
          ...b, saved: saved.has(b.id),
          coverUrl: libFile(`covers/${b.id}.jpg`) ? `/library-files/covers/${b.id}.jpg` : null,
          pdfUrl: libFile(`${b.id}.pdf`) ? `/library-files/${b.id}.pdf` : (b.linked && config.bookPdfPath ? `/source-pdf/${b.id}` : null),
        })),
      },
    };
  });

  router.get('/api/glossary', ({ user, query }) => {
    need(user);
    let terms = content.glossary;
    if (query.lessonId) terms = terms.filter((t) => t.lessonId === query.lessonId);
    return { body: { terms: terms.slice(0, 2000) } };
  });

  // ------------------------------------------------------------- search
  router.get('/api/search', ({ user, query }) => {
    need(user);
    const q = String(query.q || '').slice(0, 200);
    const fq = ftsQuery(q);
    if (!fq) return { body: { results: [], total: 0 } };
    const kinds = { topic: 'Mavzu', lesson: 'Bölim', summary: 'Bölim', original: 'Bölim', translation: 'Ma’lumot (UZ)', term: 'Atama', book: 'Kitob', figure: 'Rasm' };
    const filterKind = query.type && ['topic', 'lesson', 'term', 'book', 'figure', 'text'].includes(query.type) ? query.type : null;
    const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
    const per = 20;
    const stmt = db.prepare(`SELECT chunk_id, kind, topic_id, lesson_id, block_id, lang, locator, title, raw, bm25(search_chunks, 5.0, 1.0) AS score
      FROM search_chunks WHERE search_chunks MATCH ? ORDER BY score LIMIT 400`);
    let rows = stmt.all(ftsQueryAll(q));
    if (rows.length < 10) { const ids = new Set(rows.map((r) => r.chunk_id)); rows = rows.concat(stmt.all(fq).filter((r) => !ids.has(r.chunk_id))); }
    rows = rows.filter((r) => !r.lesson_id || content.canSee(content.lessonMeta(r.lesson_id)?.status, user));
    if (query.topic) rows = rows.filter((r) => r.topic_id === query.topic);
    if (query.lang) rows = rows.filter((r) => r.lang === query.lang);
    if (filterKind) rows = rows.filter((r) => (filterKind === 'text' ? ['summary', 'original', 'translation'].includes(r.kind) : r.kind === filterKind || (filterKind === 'lesson' && r.kind === 'lesson')));
    const toks = (q.toLowerCase().replace(/[‘’ʻʼ`']/g, '').match(/[\p{L}\p{N}]{2,}/gu) || []);
    const results = rows.slice((page - 1) * per, page * per).map((r) => {
      const { displayTitle, ...locator } = J(r.locator, {});
      return {
        id: r.chunk_id, type: r.kind, badge: kinds[r.kind], topicId: r.topic_id, lessonId: r.lesson_id, blockId: r.block_id, lang: r.lang,
        title: plainText(displayTitle || r.title), snippet: snippet(r.raw, toks), locator: Object.keys(locator).length ? locator : null,
        lessonTitle: r.lesson_id ? content.lessonIndex.get(r.lesson_id)?.titleUz : null,
      };
    });
    return { body: { results, total: rows.length, page, pages: Math.ceil(rows.length / per) } };
  });

  // ------------------------------------------------------------- progress & reading time
  router.patch('/api/progress/:lessonId', ({ user, params, body }) => {
    need(user);
    const meta = content.lessonMeta(params.lessonId);
    if (!meta || !content.canSee(meta.status, user)) throw E.notFound('Bölim');
    const d = v(body, {
      completed: { type: 'bool' }, lastBlock: { type: 'string', max: 80 }, lastTab: { type: 'string', oneOf: ['simple', 'uzfull', 'full', 'terms', 'source'] },
      reviewFlag: { type: 'bool' },
    });
    const l = content.lessonFile(params.lessonId);
    const now = nowIso();
    db.prepare(`INSERT INTO lesson_progress (user_id, lesson_id, first_opened_at, updated_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING`).run(user.id, l.id, now, now);
    if (body.completed !== undefined) {
      if (d.completed) {
        db.prepare('UPDATE lesson_progress SET completed_at=COALESCE(completed_at, ?), read_version=? WHERE user_id=? AND lesson_id=?').run(now, l.contentVersion, user.id, l.id);
        telemetry(user, 'lesson_completed', l.id);
      } else db.prepare('UPDATE lesson_progress SET completed_at=NULL, read_version=NULL WHERE user_id=? AND lesson_id=?').run(user.id, l.id);
    }
    if (d.lastBlock !== undefined) db.prepare('UPDATE lesson_progress SET last_block=? WHERE user_id=? AND lesson_id=?').run(d.lastBlock, user.id, l.id);
    if (d.lastTab !== undefined) db.prepare('UPDATE lesson_progress SET last_tab=? WHERE user_id=? AND lesson_id=?').run(d.lastTab, user.id, l.id);
    if (body.reviewFlag !== undefined) db.prepare('UPDATE lesson_progress SET review_flag=? WHERE user_id=? AND lesson_id=?').run(d.reviewFlag ? 1 : 0, user.id, l.id);
    db.prepare('UPDATE lesson_progress SET updated_at=? WHERE user_id=? AND lesson_id=?').run(now, user.id, l.id);
    const p = db.prepare('SELECT * FROM lesson_progress WHERE user_id=? AND lesson_id=?').get(user.id, l.id);
    return { body: { progress: { completed: !!p.completed_at, completedAt: p.completed_at, lastBlock: p.last_block, lastTab: p.last_tab, reviewFlag: !!p.review_flag } } };
  });

  router.post('/api/reading/heartbeat', ({ user, body }) => {
    need(user);
    const d = v(body, {
      eventId: { type: 'string', required: true, re: /^[A-Za-z0-9_-]{8,64}$/ },
      sessionId: { type: 'string', required: true, max: 64 },
      lessonId: { type: 'string', required: true, re: /^ch\d{2}$/ },
      startMs: { type: 'int', required: true }, endMs: { type: 'int', required: true },
    });
    const now = Date.now();
    if (d.endMs <= d.startMs || d.endMs - d.startMs > 45000) throw E.invalid({ endMs: 'Interval notöğri.' });
    if (d.endMs > now + 5000 || d.startMs < now - 15 * 60000) throw E.invalid({ startMs: 'Interval vaqti notöğri.' });
    if (!content.lessonIndex.has(d.lessonId)) throw E.notFound('Bölim');
    rateLimit(db, `hb:${user.id}`, 30, 60);
    const r = db.prepare('INSERT OR IGNORE INTO activity_intervals (event_id, user_id, lesson_id, session_id, start_ms, end_ms, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(`${user.id}:${d.eventId}`, user.id, d.lessonId, d.sessionId, d.startMs, d.endMs, nowIso());
    return { body: { ok: true, duplicate: r.changes === 0 } };
  });

  // ------------------------------------------------------------- bookmarks & collections
  const TARGETS = ['topic', 'lesson', 'book', 'figure', 'selection', 'ai_answer'];
  function bookmarkOut(b) {
    return { id: b.id, targetType: b.target_type, targetId: b.target_id, title: b.title, snippet: b.snippet, meta: J(b.meta, {}), collectionId: b.collection_id, createdAt: b.created_at };
  }
  router.get('/api/bookmarks', ({ user, query }) => {
    need(user);
    let rows = db.prepare('SELECT * FROM bookmarks WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC').all(user.id);
    if (query.type) rows = rows.filter((r) => r.target_type === query.type);
    if (query.collection) rows = rows.filter((r) => r.collection_id === query.collection);
    if (query.q) { const q = String(query.q).toLowerCase(); rows = rows.filter((r) => `${r.title} ${r.snippet}`.toLowerCase().includes(q)); }
    const cols = db.prepare('SELECT * FROM collections WHERE user_id=? ORDER BY created_at').all(user.id);
    return { body: { bookmarks: rows.map(bookmarkOut), collections: cols.map((c) => ({ id: c.id, name: c.name })) } };
  });
  router.post('/api/bookmarks', ({ user, body }) => {
    need(user);
    const d = v(body, {
      targetType: { type: 'string', required: true, oneOf: TARGETS }, targetId: { type: 'string', required: true, max: 120 },
      title: { type: 'string', max: 300 }, snippet: { type: 'string', max: 4000 }, collectionId: { type: 'string', max: 40 },
    });
    validateTarget(d.targetType, d.targetId, user, body.meta);
    if (d.collectionId) ownCollection(user, d.collectionId);
    const meta = body.meta && typeof body.meta === 'object' ? JSON.stringify(body.meta).slice(0, 4000) : null;
    const ex = db.prepare('SELECT * FROM bookmarks WHERE user_id=? AND target_type=? AND target_id=?').get(user.id, d.targetType, d.targetId);
    if (ex) {
      db.prepare('UPDATE bookmarks SET deleted_at=NULL, title=COALESCE(?, title), snippet=COALESCE(?, snippet), meta=COALESCE(?, meta), collection_id=COALESCE(?, collection_id) WHERE id=?')
        .run(d.title || null, d.snippet || null, meta, d.collectionId || null, ex.id);
      return { body: { bookmark: bookmarkOut(db.prepare('SELECT * FROM bookmarks WHERE id=?').get(ex.id)), existed: !ex.deleted_at } };
    }
    const bid = id('bm_');
    db.prepare('INSERT INTO bookmarks (id, user_id, target_type, target_id, title, snippet, meta, collection_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(bid, user.id, d.targetType, d.targetId, d.title || null, d.snippet || null, meta, d.collectionId || null, nowIso());
    telemetry(user, 'bookmark_added', `${d.targetType}:${d.targetId}`);
    return { status: 201, body: { bookmark: bookmarkOut(db.prepare('SELECT * FROM bookmarks WHERE id=?').get(bid)) } };
  });
  const ownBookmark = (user, bid) => { const b = db.prepare('SELECT * FROM bookmarks WHERE id=? AND user_id=?').get(bid, user.id); if (!b) throw E.notFound('Saqlangan element'); return b; };
  const ownCollection = (user, cid) => { const c = db.prepare('SELECT * FROM collections WHERE id=? AND user_id=?').get(cid, user.id); if (!c) throw E.notFound('Papka'); return c; };
  router.delete('/api/bookmarks/:id', ({ user, params }) => {
    need(user); ownBookmark(user, params.id);
    db.prepare('UPDATE bookmarks SET deleted_at=? WHERE id=?').run(nowIso(), params.id);
    return { body: { ok: true, undo: `/api/bookmarks/${params.id}/restore` } };
  });
  router.post('/api/bookmarks/:id/restore', ({ user, params }) => {
    need(user); ownBookmark(user, params.id);
    db.prepare('UPDATE bookmarks SET deleted_at=NULL WHERE id=?').run(params.id);
    return { body: { ok: true } };
  });
  router.patch('/api/bookmarks/:id', ({ user, params, body }) => {
    need(user); ownBookmark(user, params.id);
    if (body.collectionId) ownCollection(user, body.collectionId);
    db.prepare('UPDATE bookmarks SET collection_id=? WHERE id=?').run(body.collectionId || null, params.id);
    return { body: { ok: true } };
  });
  router.post('/api/collections', ({ user, body }) => {
    need(user);
    const d = v(body, { name: { type: 'string', required: true, min: 1, max: 60, msg: 'Papka nomini kiriting.' } });
    const cid = id('col_');
    db.prepare('INSERT INTO collections (id, user_id, name, created_at) VALUES (?,?,?,?)').run(cid, user.id, d.name, nowIso());
    return { status: 201, body: { collection: { id: cid, name: d.name } } };
  });
  router.patch('/api/collections/:id', ({ user, params, body }) => {
    need(user); ownCollection(user, params.id);
    const d = v(body, { name: { type: 'string', required: true, min: 1, max: 60 } });
    db.prepare('UPDATE collections SET name=? WHERE id=?').run(d.name, params.id);
    return { body: { ok: true } };
  });
  router.delete('/api/collections/:id', ({ user, params }) => {
    need(user); ownCollection(user, params.id);
    // items and notes are kept; they simply leave the folder
    db.prepare('DELETE FROM collections WHERE id=?').run(params.id);
    return { body: { ok: true } };
  });

  function validateTarget(type, tid, user, meta) {
    if (type === 'topic' && !content.topics.some((t) => t.id === tid)) throw E.notFound('Mavzu');
    if (type === 'lesson' && !content.lessonIndex.has(tid)) throw E.notFound('Bölim');
    if (type === 'book' && !content.books.some((b) => b.id === tid) && !shelf.books.some((b) => b.id === tid)) throw E.notFound('Kitob');
    if (type === 'figure' && !content.figure(tid)) throw E.notFound('Rasm');
    if (type === 'selection' && !(meta && content.lessonIndex.has(meta.lessonId))) throw E.invalid({ meta: 'Parça manbasi (lessonId) kerak.' });
    if (type === 'ai_answer') {
      const m = db.prepare('SELECT m.id FROM chat_messages m JOIN chat_threads t ON t.id=m.thread_id WHERE m.id=? AND t.user_id=?').get(tid, user.id);
      if (!m) throw E.notFound('AI javobi');
    }
  }

  // ------------------------------------------------------------- notes
  const noteOut = (n) => ({ id: n.id, lessonId: n.lesson_id, topicId: n.topic_id, anchorBlock: n.anchor_block, selectionText: n.selection_text, figureId: n.figure_id, chatMessageId: n.chat_message_id, contentVersion: n.content_version, body: n.body, collectionId: n.collection_id, createdAt: n.created_at, updatedAt: n.updated_at, lessonTitle: n.lesson_id ? content.lessonIndex.get(n.lesson_id)?.titleUz : null });
  router.get('/api/notes', ({ user, query }) => {
    need(user);
    let rows = db.prepare('SELECT * FROM notes WHERE user_id=? ORDER BY updated_at DESC').all(user.id);
    if (query.lessonId) rows = rows.filter((r) => r.lesson_id === query.lessonId);
    if (query.q) { const q = String(query.q).toLowerCase(); rows = rows.filter((r) => `${r.body} ${r.selection_text || ''}`.toLowerCase().includes(q)); }
    return { body: { notes: rows.map(noteOut) } };
  });
  router.get('/api/notes/:id', ({ user, params }) => {
    need(user);
    const n = db.prepare('SELECT * FROM notes WHERE id=? AND user_id=?').get(params.id, user.id);
    if (!n) throw E.notFound('Qayd');
    return { body: { note: noteOut(n) } };
  });
  router.post('/api/notes', ({ user, body }) => {
    need(user);
    const d = v(body, {
      lessonId: { type: 'string', re: /^ch\d{2}$/ }, anchorBlock: { type: 'string', max: 80 }, selectionText: { type: 'string', max: 4000 },
      figureId: { type: 'string', max: 40 }, chatMessageId: { type: 'string', max: 40 }, body: { type: 'string', max: 20000, default: '' },
    });
    if (d.lessonId && !content.lessonIndex.has(d.lessonId)) throw E.notFound('Bölim');
    if (d.figureId && !content.figure(d.figureId)) throw E.notFound('Rasm');
    if (d.chatMessageId) validateTarget('ai_answer', d.chatMessageId, user);
    const nid = id('nt_'); const now = nowIso();
    const topicId = d.lessonId ? content.lessonIndex.get(d.lessonId).topicId : null;
    db.prepare(`INSERT INTO notes (id, user_id, lesson_id, topic_id, anchor_block, selection_text, figure_id, chat_message_id, content_version, body, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(nid, user.id, d.lessonId || null, topicId, d.anchorBlock || null, d.selectionText || null, d.figureId || null, d.chatMessageId || null, content.contentVersion, d.body ?? '', now, now);
    telemetry(user, 'note_saved', nid);
    return { status: 201, body: { note: noteOut(db.prepare('SELECT * FROM notes WHERE id=?').get(nid)) } };
  });
  router.patch('/api/notes/:id', ({ user, params, body }) => {
    need(user);
    const n = db.prepare('SELECT * FROM notes WHERE id=? AND user_id=?').get(params.id, user.id);
    if (!n) throw E.notFound('Qayd');
    const d = v(body, { body: { type: 'string', max: 20000 }, updatedAt: { type: 'string', max: 40 } });
    if (d.updatedAt && d.updatedAt !== n.updated_at) throw E.conflict('Qayd boşqa oynada özgartirilgan. Sahifani yangilab, qayta saqlang.');
    const now = nowIso();
    db.prepare('UPDATE notes SET body=?, updated_at=? WHERE id=?').run(d.body ?? n.body, now, n.id);
    return { body: { note: noteOut(db.prepare('SELECT * FROM notes WHERE id=?').get(n.id)) } };
  });
  router.delete('/api/notes/:id', ({ user, params }) => {
    need(user);
    const r = db.prepare('DELETE FROM notes WHERE id=? AND user_id=?').run(params.id, user.id);
    if (!r.changes) throw E.notFound('Qayd');
    return { body: { ok: true } };
  });

  // ------------------------------------------------------------- quizzes
  router.get('/api/quiz/bank', ({ user, query }) => {
    need(user);
    if (query.scopeType === 'lesson') {
      if (!content.lessonIndex.has(query.scopeId)) throw E.notFound('Bölim');
      return { body: { available: content.questionPool({ lessonId: query.scopeId }).length } };
    }
    if (query.scopeType === 'topic') {
      if (!content.topics.some((t) => t.id === query.scopeId)) throw E.notFound('Mavzu');
      return { body: { available: content.questionPool({ topicId: query.scopeId }).length } };
    }
    throw E.invalid({ scopeType: 'lesson yoki topic' });
  });

  router.get('/api/practice/overview', ({ user }) => {
    need(user);
    const topics = content.topics.map((t) => ({
      id: t.id, title: t.title, available: content.questionPool({ topicId: t.id }).length,
      lessons: t.sections.map((s) => ({ id: s.id, title: s.titleUz, available: content.questionPool({ lessonId: s.id }).length })).filter((s) => s.available > 0),
    }));
    const attempts = db.prepare('SELECT * FROM quiz_attempts WHERE user_id=? ORDER BY started_at DESC LIMIT 100').all(user.id);
    return { body: { topics, attempts: labelAttempts(attempts).map(attemptSummary) } };
  });

  function labelAttempts(rows) {
    const best = new Map(); const latest = new Map();
    for (const a of rows.filter((x) => x.status === 'submitted')) {
      const k = `${a.scope_type}:${a.scope_id}`;
      const pct = a.correct / a.total;
      if (!latest.has(k) || a.submitted_at > latest.get(k).submitted_at) latest.set(k, a);
      if (!best.has(k) || pct > best.get(k).correct / best.get(k).total) best.set(k, a);
    }
    return rows.map((a) => {
      const k = `${a.scope_type}:${a.scope_id}`;
      return { ...a, isLatest: latest.get(k)?.id === a.id, isBest: best.get(k)?.id === a.id };
    });
  }
  function scopeTitle(type, sid) {
    if (type === 'lesson') return content.lessonIndex.get(sid)?.titleUz || sid;
    if (type === 'topic') return content.topics.find((t) => t.id === sid)?.title || sid;
    return 'Xatolarni qayta yeçiş';
  }
  function attemptSummary(a) {
    return { id: a.id, scopeType: a.scope_type, scopeId: a.scope_id, scopeTitle: scopeTitle(a.scope_type, a.scope_id), mode: a.mode, status: a.status, correct: a.correct, total: a.total ?? J(a.snapshot).length, unanswered: a.unanswered, percent: a.total ? Math.round((a.correct / a.total) * 1000) / 10 : null, startedAt: a.started_at, submittedAt: a.submitted_at, isLatest: !!a.isLatest, isBest: !!a.isBest, parentAttemptId: a.parent_attempt_id };
  }

  const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  router.post('/api/quiz-attempts', ({ user, body }) => {
    need(user);
    const d = v(body, {
      scopeType: { type: 'string', required: true, oneOf: ['lesson', 'topic', 'mistakes'] }, scopeId: { type: 'string', required: true, max: 40 },
      count: { type: 'int', required: true, oneOf: [5, 10, 20] }, mode: { type: 'string', required: true, oneOf: ['practice', 'exam'] },
      clientKey: { type: 'string', required: true, re: /^[A-Za-z0-9_-]{8,64}$/ },
    });
    const ex = db.prepare('SELECT * FROM quiz_attempts WHERE user_id=? AND client_key=?').get(user.id, d.clientKey);
    if (ex) return { body: { attemptId: ex.id, existed: true } };
    let pool; let parent = null;
    if (d.scopeType === 'lesson') { if (!content.lessonIndex.has(d.scopeId)) throw E.notFound('Bölim'); pool = content.questionPool({ lessonId: d.scopeId }); }
    else if (d.scopeType === 'topic') { if (!content.topics.some((t) => t.id === d.scopeId)) throw E.notFound('Mavzu'); pool = content.questionPool({ topicId: d.scopeId }); }
    else {
      const src = db.prepare(`SELECT * FROM quiz_attempts WHERE id=? AND user_id=? AND status='submitted'`).get(d.scopeId, user.id);
      if (!src) throw E.notFound('Uriniş');
      parent = src.id;
      const ans = new Map(db.prepare('SELECT question_id, option_id FROM quiz_answers WHERE attempt_id=?').all(src.id).map((r) => [r.question_id, r.option_id]));
      const wrongIds = J(src.snapshot).filter((q) => ans.get(q.id) !== q.answerOptionId).map((q) => q.id);
      pool = db.prepare(`SELECT q.* FROM questions q JOIN (SELECT id, MAX(version) v FROM questions GROUP BY id) m ON m.id=q.id AND m.v=q.version`).all().filter((q) => wrongIds.includes(q.id));
      d.count = pool.length;
    }
    if (!pool.length) throw new ApiError(404, 'no_bank', 'Bu qamrov uçun tasdiqlangan savollar banki hali yöq.');
    const chosen = shuffle(pool).slice(0, Math.min(d.count, pool.length));
    const snapshot = chosen.map((q) => ({
      id: q.id, version: q.version, lessonId: q.lesson_id, topicId: q.topic_id, stem: q.stem,
      options: shuffle(J(q.options)), answerOptionId: q.answer_option_id, explanation: q.explanation, source: J(q.source_ref), status: q.status,
    }));
    const aid = id('qa_');
    db.prepare(`INSERT INTO quiz_attempts (id, user_id, scope_type, scope_id, mode, status, snapshot, parent_attempt_id, client_key, started_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(aid, user.id, d.scopeType, d.scopeId, d.mode, 'in_progress', JSON.stringify(snapshot), parent, d.clientKey, nowIso());
    telemetry(user, 'quiz_started', aid);
    return { status: 201, body: { attemptId: aid, insufficient: pool.length < d.count, available: pool.length } };
  });

  const ownAttempt = (user, aid) => { const a = db.prepare('SELECT * FROM quiz_attempts WHERE id=? AND user_id=?').get(aid, user.id); if (!a) throw E.notFound('Uriniş'); return a; };

  router.get('/api/quiz-attempts/:id', ({ user, params }) => {
    need(user);
    const a = ownAttempt(user, params.id);
    const snap = J(a.snapshot);
    const ans = new Map(db.prepare('SELECT * FROM quiz_answers WHERE attempt_id=?').all(a.id).map((r) => [r.question_id, r]));
    const reveal = a.status === 'submitted';
    return {
      body: {
        attempt: attemptSummary(a),
        questions: snap.map((q, i) => {
          const r = ans.get(q.id);
          const checked = !!r?.checked_at;
          const show = reveal || checked;
          return {
            id: q.id, n: i + 1, stem: q.stem, options: q.options, unreviewed: q.status !== 'approved',
            selected: r?.option_id || null, flagged: !!r?.flagged, checked,
            ...(show ? { answerOptionId: q.answerOptionId, explanation: q.explanation, source: q.source, correct: r?.option_id === q.answerOptionId } : {}),
          };
        }),
      },
    };
  });

  router.put('/api/quiz-attempts/:id/answers/:qid', ({ user, params, body }) => {
    need(user);
    const a = ownAttempt(user, params.id);
    if (a.status === 'submitted') throw E.conflict('Uriniş yakunlangan, javobni özgartirib bölmaydi.');
    const q = J(a.snapshot).find((x) => x.id === params.qid);
    if (!q) throw E.notFound('Savol');
    const optionId = body.optionId === null ? null : String(body.optionId || '');
    if (optionId && !q.options.some((o) => o.id === optionId)) throw E.invalid({ optionId: 'Variant topilmadi.' });
    const r = db.prepare('SELECT * FROM quiz_answers WHERE attempt_id=? AND question_id=?').get(a.id, q.id);
    if (r?.checked_at && optionId !== undefined && body.optionId !== undefined && optionId !== r.option_id) throw E.conflict('Tekşirilgan savol javobi bu urinişda özgarmaydi.');
    db.prepare(`INSERT INTO quiz_answers (attempt_id, question_id, option_id, flagged, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(attempt_id, question_id) DO UPDATE SET option_id=CASE WHEN quiz_answers.checked_at IS NULL THEN excluded.option_id ELSE quiz_answers.option_id END, flagged=excluded.flagged, updated_at=excluded.updated_at`)
      .run(a.id, q.id, body.optionId === undefined ? (r?.option_id ?? null) : optionId, body.flagged ? 1 : 0, nowIso());
    return { body: { ok: true, savedAt: nowIso() } };
  });

  router.post('/api/quiz-attempts/:id/check', ({ user, params, body }) => {
    need(user);
    const a = ownAttempt(user, params.id);
    if (a.mode !== 'practice') throw E.conflict('Imtihon rejimida javoblar yakunda körsatiladi.');
    if (a.status === 'submitted') throw E.conflict('Uriniş yakunlangan.');
    const q = J(a.snapshot).find((x) => x.id === body.questionId);
    if (!q) throw E.notFound('Savol');
    const r = db.prepare('SELECT * FROM quiz_answers WHERE attempt_id=? AND question_id=?').get(a.id, q.id);
    if (!r?.option_id) throw E.invalid({ optionId: 'Avval variantni tanlang.' });
    if (!r.checked_at) db.prepare('UPDATE quiz_answers SET checked_at=? WHERE attempt_id=? AND question_id=?').run(nowIso(), a.id, q.id);
    return { body: { correct: r.option_id === q.answerOptionId, answerOptionId: q.answerOptionId, explanation: q.explanation, source: q.source } };
  });

  router.post('/api/quiz-attempts/:id/submit', ({ user, params }) => {
    need(user);
    const a = ownAttempt(user, params.id);
    if (a.status !== 'submitted') {
      const snap = J(a.snapshot);
      const ans = new Map(db.prepare('SELECT question_id, option_id FROM quiz_answers WHERE attempt_id=?').all(a.id).map((r) => [r.question_id, r.option_id]));
      const g = gradeAttempt(snap, ans);
      db.prepare(`UPDATE quiz_attempts SET status='submitted', correct=?, total=?, unanswered=?, submitted_at=? WHERE id=? AND status='in_progress'`).run(g.correct, g.total, g.unanswered, nowIso(), a.id);
      telemetry(user, 'quiz_submitted', a.id);
    }
    return { body: { attempt: attemptSummary(db.prepare('SELECT * FROM quiz_attempts WHERE id=?').get(a.id)) } };
  });

  router.get('/api/quiz-attempts/:id/results', ({ user, params }) => {
    need(user);
    const a = ownAttempt(user, params.id);
    if (a.status !== 'submitted') throw E.conflict('Natija uriniş yakunlangandan keyin oçiladi.');
    const snap = J(a.snapshot);
    const ans = new Map(db.prepare('SELECT question_id, option_id FROM quiz_answers WHERE attempt_id=?').all(a.id).map((r) => [r.question_id, r.option_id]));
    const history = labelAttempts(db.prepare('SELECT * FROM quiz_attempts WHERE user_id=? AND scope_type=? AND scope_id=? ORDER BY started_at DESC').all(user.id, a.scope_type, a.scope_id));
    const me = history.find((h) => h.id === a.id) || a;
    const started = Date.parse(a.started_at); const ended = Date.parse(a.submitted_at);
    return {
      body: {
        attempt: attemptSummary(me), durationSec: Math.round((ended - started) / 1000),
        items: snap.map((q, i) => {
          const sel = ans.get(q.id) || null;
          return { n: i + 1, id: q.id, stem: q.stem, options: q.options, selected: sel, answerOptionId: q.answerOptionId, result: !sel ? 'unanswered' : sel === q.answerOptionId ? 'correct' : 'wrong', explanation: q.explanation, source: q.source, lessonId: q.lessonId, lessonTitle: content.lessonIndex.get(q.lessonId)?.titleUz };
        }),
        history: history.filter((h) => h.status === 'submitted').map(attemptSummary),
      },
    };
  });

  // ------------------------------------------------------------- analytics / dashboard
  router.get('/api/analytics', ({ user, query }) => {
    need(user);
    const range = ['day', 'week', 'month'].includes(query.range) ? query.range : 'week';
    const p = getProfile(db, user.id);
    return { body: computeAnalytics(db, content, user, p, { range }) };
  });

  router.get('/api/review-queue', ({ user }) => {
    need(user);
    const flagged = db.prepare('SELECT lesson_id FROM lesson_progress WHERE user_id=? AND review_flag=1').all(user.id).map((r) => ({ lessonId: r.lesson_id, reason: 'flagged' }));
    const last = new Map();
    for (const a of db.prepare(`SELECT scope_id, correct, total, submitted_at FROM quiz_attempts WHERE user_id=? AND scope_type='lesson' AND status='submitted' ORDER BY submitted_at DESC`).all(user.id)) if (!last.has(a.scope_id)) last.set(a.scope_id, a);
    const low = [...last.entries()].filter(([, a]) => a.correct / a.total < 0.7).map(([lid, a]) => ({ lessonId: lid, reason: 'low_score', percent: Math.round((a.correct / a.total) * 100) }));
    const seen = new Set();
    const items = [...flagged, ...low].filter((x) => (seen.has(x.lessonId) ? false : seen.add(x.lessonId))).map((x) => ({ ...x, title: content.lessonIndex.get(x.lessonId)?.titleUz, topicId: content.lessonIndex.get(x.lessonId)?.topicId }));
    return { body: { items, rule: 'Siz belgilagan bölimlar va oxirgi testida 70% dan past natija olingan bölimlar (oddiy qoida, adaptiv model emas).' } };
  });

  router.get('/api/dashboard', ({ user }) => {
    need(user);
    const p = getProfile(db, user.id);
    const a = computeAnalytics(db, content, user, p, { range: 'day' });
    const last = db.prepare('SELECT * FROM lesson_progress WHERE user_id=? ORDER BY updated_at DESC LIMIT 1').get(user.id);
    let cont = null;
    if (last) {
      const meta = content.lessonMeta(last.lesson_id);
      if (meta && meta.status !== 'archived' && content.canSee(meta.status, user)) {
        const t = content.topics.find((x) => x.id === meta.topicId);
        const vis = t.sections.filter((s) => content.canSee(content.status('lesson', s.id, s.status), user));
        const done = db.prepare(`SELECT COUNT(*) n FROM lesson_progress WHERE user_id=? AND completed_at IS NOT NULL AND lesson_id IN (${vis.map(() => '?').join(',')})`).get(user.id, ...vis.map((s) => s.id)).n;
        cont = { lessonId: last.lesson_id, lessonTitle: meta.titleUz, topicId: t.id, topicTitle: t.title, cardImage: t.cardImage, lastBlock: last.last_block, lastTab: last.last_tab, read: done, total: vis.length };
      } else if (meta) cont = { archived: true, topicId: meta.topicId, message: 'Oxirgi öqigan bölimingiz arxivlangan. Mavzudan boşqa bölimni tanlang.' };
    }
    const todayKey = dayKey(Date.now(), p.timezone);
    return { body: { continue: cont, stats: { todayMinutes: a.todayMinutes, dailyGoal: a.dailyGoal, goalPercent: a.goalPercent, topicsRead: a.topicsRead, lessonsRead: a.lessonsRead, lessonsTotal: a.lessonsTotal, accuracy: a.allTimeAccuracy, attempts: a.attemptsCount, streak: a.streak, today: todayKey, week: a.series.slice(-7).map((r) => ({ day: r.bucket, minutes: r.activeMinutes })) } } };
  });
}

export function gradeAttempt(snapshot, answers) {
  let correct = 0; let unanswered = 0;
  for (const q of snapshot) {
    const sel = answers.get(q.id);
    if (!sel) unanswered++;
    else if (sel === q.answerOptionId) correct++;
  }
  return { correct, total: snapshot.length, unanswered, percent: snapshot.length ? Math.round((correct / snapshot.length) * 1000) / 10 : 0 };
}

function snippet(raw, toks) {
  const text = plainText(raw || '');
  const low = text.toLowerCase().replace(/[‘’ʻʼ`']/g, (c) => c);
  let pos = -1;
  for (const t of toks) {
    const re = new RegExp(t.split('').map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("[‘’ʻʼ`']?"), 'i');
    const m = re.exec(low);
    if (m) { pos = m.index; break; }
  }
  if (pos < 0) return text.slice(0, 220);
  const s = Math.max(0, pos - 90);
  return (s > 0 ? '…' : '') + text.slice(s, s + 240) + (s + 240 < text.length ? '…' : '');
}
