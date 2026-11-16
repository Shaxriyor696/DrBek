// Email/password auth: scrypt hashes, opaque session tokens (only their SHA-256
// is stored), email verification and password reset tokens, rate limiting.
import crypto from 'node:crypto';
import { ApiError, E, id, nowIso, v } from './http.js';

const SESSION_DAYS = 30;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(want, got);
}

// fixed-window limiter stored in SQLite so it survives restarts
export function rateLimit(db, key, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const w = now - (now % windowSec);
  const row = db.prepare('SELECT window_start, count FROM rate_limits WHERE key=?').get(key);
  if (!row || row.window_start !== w) {
    db.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start, count=1').run(key, w);
    return;
  }
  if (row.count >= limit) throw E.rate();
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key=?').run(key);
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function authRoutes(router, { db, config, mailer }) {
  const cookie = (token, maxAge) => `ds_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secureCookies ? '; Secure' : ''}`;

  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(sha(token), userId, nowIso(), exp);
    return token;
  }

  function issueToken(userId, kind, hours) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM auth_tokens WHERE user_id=? AND kind=? AND used_at IS NULL').run(userId, kind);
    db.prepare('INSERT INTO auth_tokens (token_hash, user_id, kind, expires_at) VALUES (?,?,?,?)')
      .run(sha(token), userId, kind, new Date(Date.now() + hours * 36e5).toISOString());
    return token;
  }

  function consumeToken(token, kind) {
    const row = db.prepare('SELECT * FROM auth_tokens WHERE token_hash=? AND kind=?').get(sha(String(token || '')), kind);
    if (!row || row.used_at) throw new Error('invalid_token');
    if (row.expires_at < nowIso()) {
      const e = E.invalid({ token: 'Havola muddati tugagan.' }, 'Havola muddati tugagan. Yangisini so’rang.');
      e.code = 'token_expired';
      throw e;
    }
    db.prepare('UPDATE auth_tokens SET used_at=? WHERE token_hash=?').run(nowIso(), row.token_hash);
    return row.user_id;
  }

  router.post('/api/auth/register', async ({ body, ip, res }) => {
    rateLimit(db, `register:${ip}`, 10, 3600);
    const d = v(body, {
      email: { type: 'string', required: true, re: EMAIL_RE, max: 254, msg: 'Email manzil noto’g’ri.' },
      password: { type: 'string', required: true, min: 8, max: 200, msg: 'Parol kamida 8 belgidan iborat bo’lsin.' },
      name: { type: 'string', required: true, min: 2, max: 80, msg: 'Ismingizni kiriting.' },
    });
    const email = d.email.toLowerCase();
    const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (exists) {
      // do not reveal that the account exists: same response, notify by email instead
      mailer.send(email, 'DrBek: hisob allaqachon mavjud', 'Bu email bilan hisob mavjud. Kirish yoki parolni tiklashdan foydalaning.');
      return { status: 202, body: { ok: true, verificationRequired: true } };
    }
    const uid = id('u_');
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO users (id, email, password_hash, roles, created_at) VALUES (?,?,?,?,?)')
        .run(uid, email, hashPassword(d.password), JSON.stringify(['student']), nowIso());
      db.prepare('INSERT INTO profiles (user_id, name, timezone, updated_at) VALUES (?,?,?,?)').run(uid, d.name, 'Asia/Tashkent', nowIso());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const t = issueToken(uid, 'verify', 48);
    mailer.send(email, 'DrBek: emailni tasdiqlang', `Tasdiqlash havolasi: ${config.publicUrl}/verify-email?token=${t}`);
    // Login right away; unverified accounts can study, a banner asks to verify.
    res.setHeader('set-cookie', cookie(createSession(uid), SESSION_DAYS * 86400));
    return { status: 201, body: { ok: true, verificationRequired: true } };
  });

  router.post('/api/auth/login', async ({ body, ip, res }) => {
    const d = v(body, { email: { type: 'string', required: true, max: 254 }, password: { type: 'string', required: true, max: 200 } });
    const email = d.email.toLowerCase();
    rateLimit(db, `login:${ip}`, 20, 900);
    rateLimit(db, `login:${email}`, 8, 900);
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    const ok = u ? verifyPassword(d.password, u.password_hash) : (verifyPassword(d.password, hashPassword('timing-dummy')), false);
    if (!ok) throw new ApiError(401, 'invalid_credentials', 'Email yoki parol noto’g’ri.');
    res.setHeader('set-cookie', cookie(createSession(u.id), SESSION_DAYS * 86400));
    return { body: { ok: true } };
  });

  router.post('/api/auth/logout', async ({ req, res, cookies }) => {
    if (cookies.ds_session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(cookies.ds_session));
    res.setHeader('set-cookie', cookie('', 0));
    void req;
    return { body: { ok: true } };
  });

  router.post('/api/auth/verify-email', async ({ body }) => {
    let uid;
    try { uid = consumeToken(body.token, 'verify'); } catch (e) {
      if (e.code === 'token_expired') throw e;
      throw E.invalid({ token: 'Havola yaroqsiz.' }, 'Tasdiqlash havolasi yaroqsiz yoki ishlatilgan.');
    }
    db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(nowIso(), uid);
    return { body: { ok: true } };
  });

  router.post('/api/auth/resend-verification', async ({ user }) => {
    if (!user) throw E.unauth();
    rateLimit(db, `verify:${user.id}`, 3, 3600);
    if (user.emailVerified) return { body: { ok: true } };
    const t = issueToken(user.id, 'verify', 48);
    mailer.send(user.email, 'DrBek: emailni tasdiqlang', `Tasdiqlash havolasi: ${config.publicUrl}/verify-email?token=${t}`);
    return { body: { ok: true } };
  });

  router.post('/api/auth/forgot-password', async ({ body, ip }) => {
    rateLimit(db, `forgot:${ip}`, 5, 3600);
    const d = v(body, { email: { type: 'string', required: true, re: EMAIL_RE, msg: 'Email manzil noto’g’ri.' } });
    const u = db.prepare('SELECT id, email FROM users WHERE email=?').get(d.email.toLowerCase());
    if (u) {
      const t = issueToken(u.id, 'reset', 1);
      mailer.send(u.email, 'DrBek: parolni tiklash', `Yangi parol o’rnatish havolasi (1 soat amal qiladi): ${config.publicUrl}/reset-password?token=${t}`);
    }
    return { status: 202, body: { ok: true } }; // same answer whether or not the account exists
  });

  router.post('/api/auth/reset-password', async ({ body, res }) => {
    const d = v(body, {
      token: { type: 'string', required: true },
      password: { type: 'string', required: true, min: 8, max: 200, msg: 'Parol kamida 8 belgidan iborat bo’lsin.' },
    });
    let uid;
    try { uid = consumeToken(d.token, 'reset'); } catch (e) {
      if (e.code === 'token_expired') throw e;
      throw E.invalid({ token: 'Havola yaroqsiz.' }, 'Tiklash havolasi yaroqsiz yoki ishlatilgan.');
    }
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(d.password), uid);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(uid);
    res.setHeader('set-cookie', cookie(createSession(uid), SESSION_DAYS * 86400));
    return { body: { ok: true } };
  });

  return {
    userFromCookies(cookies) {
      const t = cookies.ds_session;
      if (!t) return null;
      const row = db.prepare(`SELECT u.id, u.email, u.roles, u.email_verified_at, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(sha(t));
      if (!row || row.expires_at < nowIso()) return null;
      return { id: row.id, email: row.email, roles: JSON.parse(row.roles), emailVerified: !!row.email_verified_at };
    },
  };
}
