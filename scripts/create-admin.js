// Create (or promote) an admin account:  npm run create-admin -- email@example.com "Ism"   (parol so’raladi)
import path from 'node:path';
import readline from 'node:readline';
import { openDb } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { loadEnvFile, makeConfig } from '../server/index.js';
import { id, nowIso } from '../server/http.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
loadEnvFile(path.join(root, '.env'));
const config = makeConfig();
const [email, name = 'Administrator'] = process.argv.slice(2);
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('Foydalanish: npm run create-admin -- email@example.com "Ism"'); process.exit(2); }
const db = openDb(config.dbFile);
const ex = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase());
if (ex) {
  const roles = [...new Set([...JSON.parse(ex.roles), 'admin'])];
  db.prepare('UPDATE users SET roles=? WHERE id=?').run(JSON.stringify(roles), ex.id);
  console.log(`Mavjud foydalanuvchiga admin roli berildi: ${email} (${roles.join(', ')})`);
  process.exit(0);
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pw = process.env.ADMIN_PASSWORD || await new Promise((r) => rl.question('Parol (kamida 8 belgi): ', r));
rl.close();
if (!pw || pw.length < 8) { console.error('Parol kamida 8 belgi bo’lishi kerak.'); process.exit(2); }
const uid = id('u_'); const now = nowIso();
db.prepare('INSERT INTO users (id, email, password_hash, roles, email_verified_at, created_at) VALUES (?,?,?,?,?,?)').run(uid, email.toLowerCase(), hashPassword(pw), JSON.stringify(['student', 'admin', 'reviewer', 'editor']), now, now);
db.prepare('INSERT INTO profiles (user_id, name, timezone, updated_at) VALUES (?,?,?,?)').run(uid, name, 'Asia/Tashkent', now);
console.log(`Admin yaratildi: ${email}`);
