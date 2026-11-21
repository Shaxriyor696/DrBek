// iMedu server entry point.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { Router, readJson, parseCookies, sendJson, sendError, serveFile, id, nowIso } from './http.js';
import { authRoutes } from './auth.js';
import { apiRoutes } from './api.js';
import { aiRoutes } from './ai.js';
import { adminRoutes } from './admin.js';
import { ContentStore } from './content.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function makeConfig(env = process.env) {
  const port = parseInt(env.PORT || '3000', 10);
  return {
    port,
    publicUrl: env.PUBLIC_URL || `http://localhost:${port}`,
    dbFile: env.DATABASE_FILE || path.join(rootDir, 'data', 'drstudy.db'),
    contentDir: env.CONTENT_DIR || path.join(rootDir, 'content'),
    libraryDir: env.LIBRARY_DIR || path.join(rootDir, 'data', 'library'),
    contentAccess: env.CONTENT_ACCESS === 'published_only' ? 'published_only' : 'review_preview',
    bookPdfPath: env.BOOK_PDF_PATH || '',
    notesDir: env.GUYTON_NOTES_DIR || '',
    uiTopicsJson: env.UI_TOPICS_JSON || '',
    pythonBin: env.PYTHON_BIN || 'python3',
    secureCookies: env.SECURE_COOKIES === '1' || (env.PUBLIC_URL || '').startsWith('https://'),
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    aiModel: env.AI_MODEL || 'claude-opus-5-5',
    geminiApiKey: env.GEMINI_API_KEY || '',
    geminiThinking: ['minimal', 'low', 'medium', 'high'].includes(env.GEMINI_THINKING) ? env.GEMINI_THINKING : 'low',
    geminiVoiceModel: env.GEMINI_VOICE_MODEL || 'gemini-3-flash-preview,gemini-3.1-flash-lite',
    geminiModel: env.GEMINI_MODEL || 'gemini-3-flash-preview,gemini-3.5-flash-lite,gemini-3.1-flash-lite',
    grokApiKey: env.XAI_API_KEY || '',
    grokModel: env.GROK_MODEL || 'grok-4.7',
    // AI_PROVIDER=gemini|grok|anthropic; unset → Claude if its key is set, else Gemini, else Grok.
    aiProvider: ['gemini', 'grok', 'anthropic'].includes(env.AI_PROVIDER) ? env.AI_PROVIDER
      : env.ANTHROPIC_API_KEY ? 'anthropic' : env.GEMINI_API_KEY ? 'gemini' : env.XAI_API_KEY ? 'grok' : 'anthropic',
    aiEffort: ['low', 'medium', 'high'].includes(env.AI_EFFORT) ? env.AI_EFFORT : 'medium',
    aiFallbacks: env.AI_FALLBACKS !== 'off',
    aiDailyLimit: parseInt(env.AI_DAILY_LIMIT || '50', 10),
    aiPerMinute: parseInt(env.AI_PER_MINUTE || '6', 10),
    mailOutbox: env.MAIL_OUTBOX || path.join(rootDir, 'data', 'outbox.log'),
  };
}

// No SMTP provider is wired yet: messages go to a local outbox file (dev).
function makeMailer(config) {
  return {
    send(to, subject, text) {
      fs.mkdirSync(path.dirname(config.mailOutbox), { recursive: true });
      fs.appendFileSync(config.mailOutbox, `--- ${nowIso()}\nTo: ${to}\nSubject: ${subject}\n\n${text}\n\n`);
      if (process.env.NODE_ENV !== 'test') console.log(`[mail→outbox] ${subject} → ${to.replace(/(.).+@/, '$1***@')}`);
    },
  };
}

const SPA_ROUTES = /^\/(|login|register|forgot-password|reset-password|verify-email|onboarding|dashboard|topics(\/.*)?|library(\/.*)?|practice(\/.*)?|saved|analytics|assistant|settings|admin(\/.*)?|search)$/;

export function createApp(config) {
  const db = openDb(config.dbFile);
  const content = new ContentStore(config.contentDir, db, { access: config.contentAccess });
  const router = new Router();
  const mailer = makeMailer(config);
  const auth = authRoutes(router, { db, config, mailer });
  apiRoutes(router, { db, content, config });
  aiRoutes(router, { db, content, config });
  adminRoutes(router, { db, content, config, rootDir });
  router.get('/api/health', () => ({ body: { ok: true, contentVersion: content.contentVersion } }));

  const securityHeaders = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'x-frame-options': 'SAMEORIGIN',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'self'",
  };

  const server = http.createServer(async (req, res) => {
    const requestId = id('req_');
    for (const [k, val] of Object.entries(securityHeaders)) res.setHeader(k, val);
    res.setHeader('x-request-id', requestId);
    const url = new URL(req.url, 'http://x');
    const pathname = url.pathname;
    const cookies = parseCookies(req);
    const user = auth.userFromCookies(cookies);
    try {
      if (pathname.startsWith('/api/')) {
        // CSRF: state-changing API calls must come from our own pages
        if (!['GET', 'HEAD'].includes(req.method)) {
          const origin = req.headers.origin;
          const host = req.headers.host;
          if (origin && new URL(origin).host !== host) return sendJson(res, 403, { code: 'bad_origin', message: 'Sörov manbasi ruxsat etilmagan.', requestId });
          if (req.headers['x-requested-with'] !== 'drstudy') return sendJson(res, 403, { code: 'csrf', message: 'Sörov rad etildi.', requestId });
        }
        const m = router.match(req.method, pathname);
        if (!m) return sendJson(res, 404, { code: 'not_found', message: 'API manzili topilmadi.', requestId });
        // voice questions carry base64 audio, so that one route gets a larger body limit
        const body = await readJson(req, pathname === '/api/chat/transcribe' ? 4 * 1024 * 1024 : undefined);
        const query = Object.fromEntries(url.searchParams);
        const ip = req.socket.remoteAddress || 'local';
        const out = await m.handler({ req, res, user, body, query, params: m.params, cookies, ip, requestId });
        if (res.headersSent || res.writableEnded) return undefined;
        return sendJson(res, out?.status || 200, out?.body ?? {});
      }
      if (pathname.startsWith('/media/figures/img/')) {
        if (!user) return sendJson(res, 401, { code: 'unauthenticated', message: 'Avval tizimga kiring.', requestId });
        if (serveFile(req, res, path.join(config.contentDir, 'figures', 'img'), pathname.slice('/media/figures/img/'.length), { cache: 'private, max-age=86400' })) return undefined;
        return sendJson(res, 404, { code: 'not_found', message: 'Rasm fayli topilmadi.', requestId });
      }
      if (pathname.startsWith('/library-files/')) {
        if (!user) return sendJson(res, 401, { code: 'unauthenticated', message: 'Avval tizimga kiring.', requestId });
        if (serveFile(req, res, config.libraryDir, decodeURIComponent(pathname.slice('/library-files/'.length)), { cache: 'private, max-age=86400' })) return undefined;
        return sendJson(res, 404, { code: 'not_found', message: 'Kitob fayli topilmadi.', requestId });
      }
      if (pathname.startsWith('/source-pdf/')) {
        if (!user) return sendJson(res, 401, { code: 'unauthenticated', message: 'Avval tizimga kiring.', requestId });
        const bookId = pathname.split('/')[2];
        if (!content.books.some((b) => b.id === bookId) || !config.bookPdfPath || !fs.existsSync(config.bookPdfPath)) {
          return sendJson(res, 404, { code: 'source_unavailable', message: 'Asl PDF serverga ulanmagan (BOOK_PDF_PATH).', requestId });
        }
        if (serveFile(req, res, path.dirname(config.bookPdfPath), path.basename(config.bookPdfPath), { cache: 'private, max-age=86400' })) return undefined;
      }
      const pub = path.join(rootDir, 'public');
      if (pathname !== '/' && serveFile(req, res, pub, pathname, { cache: pathname.startsWith('/assets/') ? 'public, max-age=604800' : 'no-cache' })) return undefined;
      if (SPA_ROUTES.test(pathname)) return serveFile(req, res, pub, 'index.html', { cache: 'no-cache' });
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta charset="utf-8"><title>Topilmadi</title><p>Sahifa topilmadi. <a href="/dashboard">Boş sahifaga qaytiş</a></p>');
    } catch (err) {
      if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return undefined; }
      return sendError(res, err, requestId);
    }
  });
  return { server, db, content, config };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnvFile(path.join(rootDir, '.env'));
  const config = makeConfig();
  const { server, content } = createApp(config);
  server.listen(config.port, () => {
    console.log(`iMedu: ${config.publicUrl}  (content ${content.contentVersion}, access=${config.contentAccess}, AI=${({ gemini: config.geminiApiKey && config.geminiModel, grok: config.grokApiKey && `grok: ${config.grokModel}`, anthropic: config.anthropicApiKey && config.aiModel })[config.aiProvider] || 'ulanmagan'}, PDF=${config.bookPdfPath ? 'ulangan' : 'ulanmagan'})`);
  });
}
