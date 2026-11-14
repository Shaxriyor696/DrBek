// Minimal admin: coverage dashboard, review queue, review decisions, publish gate,
// archive, import jobs, roles. Every route checks roles on the server.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { E, id, nowIso, v } from './http.js';

const hasRole = (u, ...r) => u && r.some((x) => u.roles.includes(x));

export function adminRoutes(router, { db, content, config, rootDir }) {
  const guard = (user, ...roles) => { if (!user) throw E.unauth(); if (!hasRole(user, 'admin', ...roles)) throw E.forbidden(); return user; };
  const audit = (user, action, target, detail) => db.prepare('INSERT INTO audit_events (id, actor_id, action, target, detail, at) VALUES (?,?,?,?,?,?)').run(id('au_'), user.id, action, target, detail ? JSON.stringify(detail) : null, nowIso());
  const setState = (user, type, tid, status, version) => db.prepare(`INSERT INTO content_state (target_type, target_id, status, content_version, updated_by, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(target_type, target_id) DO UPDATE SET status=excluded.status, content_version=excluded.content_version, updated_by=excluded.updated_by, updated_at=excluded.updated_at`).run(type, tid, status, version || null, user.id, nowIso());

  function publishGate(lessonId) {
    const l = content.lessonFile(lessonId);
    const status = content.status('lesson', lessonId, l.status);
    const missing = [];
    if (status !== 'approved') missing.push('Dars tekshiruvchi tomonidan tasdiqlanmagan (status: ' + status + ').');
    if (!l.blocks.simple.length) missing.push('O‘zbekcha izoh yo‘q.');
    if (!l.blocks.full.length) missing.push('Asl manba matni yo‘q.');
    const figs = l.figureIds.map((f) => content.figure(f));
    const notIncluded = figs.filter((f) => f.coverage !== 'included');
    if (notIncluded.length) missing.push(`${notIncluded.length} ta rasm avtomatik kesilmagan: ${notIncluded.map((f) => f.figureNumber).join(', ')}.`);
    const unreviewedFigs = figs.filter((f) => content.status('figure', f.imageId, f.reviewStatus) !== 'approved');
    if (unreviewedFigs.length) missing.push(`${unreviewedFigs.length} ta rasm hali tekshirilmagan.`);
    const qs = db.prepare(`SELECT q.id, q.status FROM questions q JOIN (SELECT id, MAX(version) v FROM questions GROUP BY id) m ON m.id=q.id AND m.v=q.version WHERE q.lesson_id=?`).all(lessonId);
    const approvedQ = qs.filter((q) => content.status('question', q.id, q.status) === 'approved').length;
    if (approvedQ < 5) missing.push(`Tasdiqlangan test savollari ${approvedQ} ta (kamida 5 ta tavsiya etiladi).`);
    return { status, missing, blocking: missing.filter((m) => !m.startsWith('Tasdiqlangan test')), approvedQuestions: approvedQ };
  }

  router.get('/api/admin/overview', ({ user }) => {
    guard(user, 'editor', 'reviewer');
    const lessons = [];
    for (const t of content.topics) for (const s of t.sections) {
      const st = content.status('lesson', s.id, s.status);
      lessons.push({ id: s.id, topicId: t.id, titleUz: s.titleUz, titleOriginal: s.titleOriginal, status: st, counts: s.counts, pdfPages: s.pdfPages });
    }
    const qs = db.prepare(`SELECT q.id, q.version, q.lesson_id, q.topic_id, q.stem, q.status FROM questions q JOIN (SELECT id, MAX(version) v FROM questions GROUP BY id) m ON m.id=q.id AND m.v=q.version`).all()
      .map((q) => ({ ...q, status: content.status('question', q.id, q.status) }));
    const figs = [...content.figures.values()];
    const figState = (f) => content.status('figure', f.imageId, f.reviewStatus);
    return {
      body: {
        contentVersion: content.contentVersion, access: content.access,
        coverage: content.coverage,
        totals: {
          lessons: lessons.length,
          lessonsByStatus: lessons.reduce((m, l) => ({ ...m, [l.status]: (m[l.status] || 0) + 1 }), {}),
          figures: figs.length,
          figuresIncluded: figs.filter((f) => f.coverage === 'included').length,
          figuresApproved: figs.filter((f) => figState(f) === 'approved').length,
          questions: qs.length,
          questionsApproved: qs.filter((q) => q.status === 'approved').length,
          terms: content.glossary.length,
        },
        lessons,
        questions: qs,
        jobs: db.prepare('SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT 20').all(),
      },
    };
  });

  router.get('/api/admin/lessons/:id', ({ user, params }) => {
    guard(user, 'editor', 'reviewer');
    const l = content.lessonFile(params.id);
    if (!l) throw E.notFound('Bo‘lim');
    const figures = l.figureIds.map((f) => ({ ...content.figure(f), reviewStatus: content.status('figure', f, content.figure(f).reviewStatus) }));
    const reviews = db.prepare('SELECT * FROM content_reviews WHERE target_id=? ORDER BY at DESC').all(params.id);
    return { body: { lesson: { id: l.id, titleUz: l.titleUz, titleOriginal: l.titleOriginal, status: content.status('lesson', l.id, l.status), contentVersion: l.contentVersion, translationStatus: l.translationStatus, source: l.source }, figures, gate: publishGate(l.id), reviews } };
  });

  router.post('/api/admin/reviews', ({ user, body }) => {
    guard(user, 'reviewer');
    const d = v(body, {
      targetType: { type: 'string', required: true, oneOf: ['lesson', 'figure', 'question'] }, targetId: { type: 'string', required: true, max: 60 },
      decision: { type: 'string', required: true, oneOf: ['approve', 'request_changes', 'reject'] }, reason: { type: 'string', max: 1000 },
    });
    if (d.decision !== 'approve' && !d.reason) throw E.invalid({ reason: 'Qaytarish sababini yozing.' });
    let version = null;
    if (d.targetType === 'lesson') { const l = content.lessonFile(d.targetId); if (!l) throw E.notFound('Bo‘lim'); version = l.contentVersion; if (content.status('lesson', l.id, l.status) === 'published' && d.decision === 'approve') throw E.conflict('Dars allaqachon nashr etilgan.'); }
    if (d.targetType === 'figure' && !content.figure(d.targetId)) throw E.notFound('Rasm');
    if (d.targetType === 'question' && !db.prepare('SELECT 1 FROM questions WHERE id=?').get(d.targetId)) throw E.notFound('Savol');
    const status = d.decision === 'approve' ? 'approved' : d.decision === 'reject' ? (d.targetType === 'lesson' ? 'changes_requested' : 'rejected') : 'changes_requested';
    db.prepare('INSERT INTO content_reviews (id, target_type, target_id, content_version, decision, reason, reviewer_id, at) VALUES (?,?,?,?,?,?,?,?)').run(id('rv_'), d.targetType, d.targetId, version, d.decision, d.reason || null, user.id, nowIso());
    setState(user, d.targetType, d.targetId, status, version);
    audit(user, `review.${d.decision}`, `${d.targetType}:${d.targetId}`, { reason: d.reason });
    return { body: { status } };
  });

  router.post('/api/admin/publish', ({ user, body }) => {
    guard(user);
    const d = v(body, { lessonId: { type: 'string', required: true, re: /^ch\d{2}$/ } });
    const l = content.lessonFile(d.lessonId);
    if (!l) throw E.notFound('Bo‘lim');
    const gate = publishGate(l.id);
    if (gate.blocking.length) return { status: 409, body: { code: 'publish_gate', message: 'Nashrdan oldin quyidagilar bajarilishi kerak.', missing: gate.missing } };
    setState(user, 'lesson', l.id, 'published', l.contentVersion);
    audit(user, 'lesson.publish', `lesson:${l.id}`, { version: l.contentVersion, warnings: gate.missing });
    return { body: { status: 'published', warnings: gate.missing } };
  });

  router.post('/api/admin/archive', ({ user, body }) => {
    guard(user);
    const d = v(body, { lessonId: { type: 'string', required: true, re: /^ch\d{2}$/ } });
    if (!content.lessonFile(d.lessonId)) throw E.notFound('Bo‘lim');
    setState(user, 'lesson', d.lessonId, 'archived');
    audit(user, 'lesson.archive', `lesson:${d.lessonId}`);
    return { body: { status: 'archived' } };
  });

  router.post('/api/admin/users/roles', ({ user, body }) => {
    guard(user);
    const d = v(body, { email: { type: 'string', required: true }, roles: { type: 'string', required: true } });
    const roles = d.roles.split(',').map((s) => s.trim()).filter(Boolean);
    if (!roles.every((r) => ['student', 'editor', 'reviewer', 'admin'].includes(r))) throw E.invalid({ roles: 'student, editor, reviewer, admin' });
    const r = db.prepare('UPDATE users SET roles=? WHERE email=?').run(JSON.stringify(roles), d.email.toLowerCase());
    if (!r.changes) throw E.notFound('Foydalanuvchi');
    audit(user, 'user.roles', d.email, { roles });
    return { body: { ok: true } };
  });

  // Background re-import. Runs the Python importer with fixed arguments (no shell),
  // then reloads content. Re-running is idempotent: stable IDs, same files.
  let running = null;
  router.post('/api/admin/imports', ({ user }) => {
    guard(user);
    if (running) return { status: 409, body: { code: 'job_running', message: 'Import allaqachon ishlayapti.', jobId: running } };
    const need = { BOOK_PDF_PATH: config.bookPdfPath, GUYTON_NOTES_DIR: config.notesDir, UI_TOPICS_JSON: config.uiTopicsJson };
    const missing = Object.entries(need).filter(([, val]) => !val || !fs.existsSync(val)).map(([k]) => k);
    const jid = id('job_');
    if (missing.length) {
      db.prepare('INSERT INTO import_jobs (id, kind, status, detail, created_by, created_at, finished_at) VALUES (?,?,?,?,?,?,?)').run(jid, 'book', 'failed', `Sozlanmagan: ${missing.join(', ')}`, user.id, nowIso(), nowIso());
      return { status: 422, body: { code: 'import_not_configured', message: `Import uchun .env da sozlang: ${missing.join(', ')}`, jobId: jid } };
    }
    db.prepare('INSERT INTO import_jobs (id, kind, status, created_by, created_at) VALUES (?,?,?,?,?)').run(jid, 'book', 'processing', user.id, nowIso());
    running = jid;
    const args = ['-I', path.join(rootDir, 'tools', 'import_content.py'), '--pdf', config.bookPdfPath, '--notes', config.notesDir, '--ui-topics', config.uiTopicsJson, '--out', config.contentDir];
    const p = spawn(config.pythonBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    p.stdout.on('data', (b) => { log += b; });
    p.stderr.on('data', (b) => { log += b; });
    p.on('close', (code) => {
      running = null;
      let status = code === 0 ? 'review_required' : 'failed';
      if (code === 0) { try { content.reload(); } catch (e) { status = 'failed'; log += `\nreload: ${e.message}`; } }
      db.prepare('UPDATE import_jobs SET status=?, detail=?, finished_at=? WHERE id=?').run(status, log.slice(-4000), nowIso(), jid);
    });
    audit(user, 'import.start', jid);
    return { status: 202, body: { jobId: jid, status: 'processing' } };
  });
}
