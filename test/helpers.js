import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createApp, makeConfig } from '../server/index.js';

process.env.NODE_ENV = 'test';

export async function startApp(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drstudy-test-'));
  const config = makeConfig({ PORT: '0', DATABASE_FILE: path.join(dir, 'db.sqlite'), MAIL_OUTBOX: path.join(dir, 'outbox.log'), ...extra });
  const app = createApp(config);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, base, dir, close: () => new Promise((r) => app.server.close(r)) };
}

// Minimal cookie-keeping client.
export function client(base) {
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'x-requested-with': 'drstudy', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, res };
  };
  return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p), raw: call, get cookie() { return cookie; } };
}

export async function newUser(base, name = 'Test Talaba') {
  const c = client(base);
  const email = `u${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`;
  const r = await c.post('/api/auth/register', { name, email, password: 'parol12345' });
  if (r.status >= 300) throw new Error(`register failed ${r.status} ${JSON.stringify(r.data)}`);
  if (!c.cookie) await c.post('/api/auth/login', { email, password: 'parol12345' });
  await c.patch('/api/profile', { course: 2, completeOnboarding: true });
  return { c, email };
}
