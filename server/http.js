// Minimal HTTP toolkit: router, JSON bodies, uniform errors, cookies, static files.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class ApiError extends Error {
  constructor(status, code, message, fieldErrors) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}
export const E = {
  unauth: () => new ApiError(401, 'unauthenticated', 'Avval tizimga kiring.'),
  forbidden: () => new ApiError(403, 'forbidden', 'Bu amal uchun ruxsat yo’q.'),
  notFound: (what = 'Manba') => new ApiError(404, 'not_found', `${what} topilmadi.`),
  conflict: (m) => new ApiError(409, 'conflict', m),
  invalid: (fieldErrors, m = 'Maʼlumotlarni tekshiring.') => new ApiError(422, 'validation_error', m, fieldErrors),
  rate: (m = 'Juda ko’p urinish. Birozdan so’ng qayta urinib ko’ring.') => new ApiError(429, 'rate_limited', m),
};

export const id = (p = '') => p + crypto.randomBytes(12).toString('base64url');
export const nowIso = () => new Date().toISOString();

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler });
  }
  get(p, h) { this.add('GET', p, h); }
  post(p, h) { this.add('POST', p, h); }
  put(p, h) { this.add('PUT', p, h); }
  patch(p, h) { this.add('PATCH', p, h); }
  delete(p, h) { this.add('DELETE', p, h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handler: r.handler, params };
      }
    }
    return null;
  }
}

export async function readJson(req, limit = 256 * 1024) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return {};
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new ApiError(413, 'payload_too_large', 'So’rov hajmi juda katta.');
    chunks.push(c);
  }
  if (!size) return {};
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('application/json')) throw new ApiError(415, 'unsupported_media_type', 'JSON kutilmoqda.');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400, 'bad_json', 'JSON noto’g’ri.'); }
}

export function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

export function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

export function sendError(res, err, requestId) {
  if (err instanceof ApiError) {
    return sendJson(res, err.status, { code: err.code, message: err.message, fieldErrors: err.fieldErrors, requestId });
  }
  console.error(`[${requestId}]`, err);
  return sendJson(res, 500, { code: 'internal', message: 'Serverda kutilmagan xato. Qayta urinib ko’ring.', requestId });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.jpg': 'image/jpeg',
};

// Serves a file from `root` without letting `rel` escape it (path traversal guard).
export function serveFile(req, res, root, rel, { cache = 'public, max-age=3600' } = {}) {
  const base = path.resolve(root);
  const full = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  if (!full.startsWith(base + path.sep) && full !== base) return false;
  let st;
  try { st = fs.statSync(full); } catch { return false; }
  if (!st.isFile()) return false;
  const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  const etag = `"${st.size}-${st.mtimeMs}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return true; }
  const headers = { 'content-type': type, 'cache-control': cache, etag, 'content-length': st.size, 'x-content-type-options': 'nosniff' };
  // Range support (PDF viewer)
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    const start = range[1] ? parseInt(range[1], 10) : 0;
    const end = range[2] ? Math.min(parseInt(range[2], 10), st.size - 1) : st.size - 1;
    if (start <= end) {
      res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes' });
      fs.createReadStream(full, { start, end }).pipe(res);
      return true;
    }
  }
  res.writeHead(200, { ...headers, 'accept-ranges': 'bytes' });
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(full).pipe(res);
  return true;
}

// --- tiny schema validation --------------------------------------------------
export function v(obj, spec) {
  const errs = {};
  const out = {};
  for (const [k, rule] of Object.entries(spec)) {
    let val = obj?.[k];
    if (val === undefined || val === null || val === '') {
      if (rule.required) errs[k] = rule.msg || 'Majburiy maydon.';
      else if ('default' in rule) out[k] = rule.default;
      continue;
    }
    if (rule.type === 'string') {
      if (typeof val !== 'string') { errs[k] = 'Matn kutilmoqda.'; continue; }
      val = val.trim();
      if (rule.min && val.length < rule.min) { errs[k] = rule.msg || `Kamida ${rule.min} belgi.`; continue; }
      if (rule.max && val.length > rule.max) { errs[k] = `Ko’pi bilan ${rule.max} belgi.`; continue; }
      if (rule.re && !rule.re.test(val)) { errs[k] = rule.msg || 'Format noto’g’ri.'; continue; }
      if (rule.oneOf && !rule.oneOf.includes(val)) { errs[k] = 'Ruxsat etilmagan qiymat.'; continue; }
    } else if (rule.type === 'int') {
      val = Number(val);
      if (!Number.isInteger(val)) { errs[k] = 'Butun son kutilmoqda.'; continue; }
      if (rule.min !== undefined && val < rule.min) { errs[k] = `Kamida ${rule.min}.`; continue; }
      if (rule.max !== undefined && val > rule.max) { errs[k] = `Ko’pi bilan ${rule.max}.`; continue; }
      if (rule.oneOf && !rule.oneOf.includes(val)) { errs[k] = 'Ruxsat etilmagan qiymat.'; continue; }
    } else if (rule.type === 'number') {
      val = Number(val);
      if (!Number.isFinite(val)) { errs[k] = 'Son kutilmoqda.'; continue; }
      if (rule.min !== undefined && val < rule.min) { errs[k] = `Kamida ${rule.min}.`; continue; }
      if (rule.max !== undefined && val > rule.max) { errs[k] = `Ko’pi bilan ${rule.max}.`; continue; }
    } else if (rule.type === 'bool') {
      val = !!val;
    }
    out[k] = val;
  }
  if (Object.keys(errs).length) throw E.invalid(errs);
  return out;
}
