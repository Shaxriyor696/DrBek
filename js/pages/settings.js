import { h, icon, mount, toast } from '../ui.js?v=mwkaouz8';
import { patch, post } from '../api.js?v=mwkaouz8';
import { loadMe, logout, navigate } from '../main.js?v=mwkaouz8';

const DIRS = ['Davolash ishi', 'Pediatriya', 'Stomatologiya', 'Tibbiy profilaktika', 'Farmatsiya', 'Hamshiralik ishi', 'Boshqa'];
const TZS = ['Asia/Tashkent', 'Asia/Samarkand', 'Asia/Almaty', 'Asia/Bishkek', 'Asia/Dushanbe', 'Europe/Moscow', 'Europe/Istanbul', 'UTC'];
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* */ } };

export function settings({ el, state }) {
  const p = state.me.profile;
  let tab = 'profile';
  const save = async (body, msg = 'Saqlandi.') => { try { await patch('/api/profile', body); await loadMe(); toast(msg); return true; } catch (e) { toast(e.fieldErrors ? Object.values(e.fieldErrors).join(' ') : e.message); return false; } };

  // ---------- left: profile form
  const name = h('input', { id: 's-name', value: p.name || '', autocomplete: 'name', required: true });
  const email = h('input', { id: 's-email', value: state.me.email, readonly: true, title: 'Email hozircha o’zgartirilmaydi' });
  const uni = h('input', { id: 's-uni', value: p.university || '', placeholder: 'Universitetingizni kiriting' });
  const course = h('select', { id: 's-course' }, [1, 2, 3, 4, 5, 6, 7].map((c) => h('option', { value: c, selected: p.course === c }, `${c}-kurs`)));
  const dirOpts = [...new Set([...(p.direction ? [p.direction] : []), ...DIRS])];
  const dir = h('select', { id: 's-dir' }, dirOpts.map((d) => h('option', { value: d, selected: p.direction === d }, d)));
  let lang = p.studyLang || 'uz';
  const langBtns = [['uz', 'O’zbekcha'], ['ru', 'Русский'], ['en', 'English']].map(([v, l]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(v === lang), style: { flex: 1, justifyContent: 'center' }, onclick: () => { lang = v; langBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['uz', 'ru', 'en'][i] === v))); } }, l));
  const row = (ic, label, id, input, req) => h('div', { class: 'form-row' }, h('label', { for: id }, icon(ic), h('span', {}, label, req ? h('span', { style: { color: 'var(--danger)' } }, ' *') : null)), input);
  const profileForm = h('form', { class: 'stack', style: { gap: '4px' }, novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (name.value.trim().length < 2) { toast('Ismingizni kiriting.'); name.focus(); return; }
    await save({ name: name.value.trim(), university: uni.value.trim() || undefined, course: Number(course.value), direction: dir.value, studyLang: lang }, 'Profil saqlandi.');
  } },
    h('h2', { style: { margin: 0, fontSize: '26px' } }, 'Profil ma’lumotlari'), h('p', { class: 'muted', style: { margin: '0 0 10px' } }, 'Hisobingiz haqidagi asosiy ma’lumotlar.'),
    h('div', { class: 'row', style: { justifyContent: 'center', margin: '6px 0 14px', gap: '20px' } },
      h('span', { class: 'avatar', style: { width: '120px', height: '120px', fontSize: '58px', boxShadow: '0 0 0 8px #E2F4F1' } }, (p.name || state.me.email).trim().slice(0, 1).toUpperCase()),
      h('span', { class: 'xs muted', style: { maxWidth: '200px' } }, 'Profil rasmi ismingizning bosh harfidan yasaladi.')),
    row('user', 'Ism', 's-name', name, true),
    row('mail', 'Email', 's-email', email, true),
    row('cap', 'Universitet', 's-uni', uni),
    row('layers', 'Kurs', 's-course', course, true),
    row('steth', 'Yo’nalish', 's-dir', dir, true),
    h('div', { class: 'form-row' }, h('span', { class: 'l' }, icon('globe'), h('span', {}, 'O’qish tili', h('span', { style: { color: 'var(--danger)' } }, ' *'))), h('div', { class: 'row', role: 'group', 'aria-label': 'O’qish tili', style: { flexWrap: 'nowrap', gap: '8px' } }, langBtns)),
    h('p', { class: 'xs muted', style: { margin: '4px 0 0' } }, 'Interfeys hozircha o’zbekcha (lotin). Tanlangan til AI javoblari va qo’shimcha materiallar uchun saqlanadi.'),
    h('div', { class: 'grid g2', style: { marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)' } },
      h('button', { type: 'submit', class: 'btn primary lg' }, icon('check'), 'O’zgarishlarni saqlash'),
      h('button', { type: 'button', class: 'btn lg', onclick: () => { settings({ el, state }); } }, 'Bekor qilish')));

  const fontPrev = h('p', { class: 'prose', style: { margin: 0, fontSize: `${p.readerFont || 18}px` } }, 'Yurak sikli — yurakning bir urishidan keyingi urishigacha bo’lgan jarayonlar ketma-ketligi.');
  const readingTab = h('div', { class: 'stack' }, h('h2', { style: { margin: 0, fontSize: '26px' } }, 'O’qish sozlamalari'),
    h('p', { class: 'muted', style: { margin: 0 } }, 'Shrift o’lchami barcha darslarda qo’llanadi; darsdagi A− / A+ tugmalari ham shu sozlamani o’zgartiradi.'),
    h('div', { class: 'card pad', style: { background: '#F7FBFA' } }, fontPrev),
    h('p', { class: 'small muted', style: { margin: 0 } }, 'Oxirgi o’qilgan joy avtomatik eslab qolinadi. Faqat faol o’qish vaqti statistikaga yoziladi.'));
  const toggle = (key, def, title, text, ic) => {
    let on = lsGet(key, def);
    const sw = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(on), 'aria-label': title, onclick: () => { on = !on; lsSet(key, on); sw.setAttribute('aria-checked', String(on)); } });
    return h('div', { class: 'row', style: { flexWrap: 'nowrap', padding: '10px 0', borderTop: '1px solid #EDF3F2' } }, h('span', { style: { color: 'var(--primary)' } }, icon(ic)), h('div', { class: 'grow' }, h('b', {}, title), h('div', { class: 'small muted' }, text)), sw);
  };
  const notifTab = h('div', { class: 'stack' }, h('h2', { style: { margin: 0, fontSize: '26px' } }, 'Bildirishnomalar'),
    toggle('ds-n-daily', true, 'Kunlik eslatma', 'Tanlagan vaqtda o’qish eslatmasini yuborish.', 'calendar'),
    toggle('ds-n-review', true, 'Takrorlash tavsiyasi', 'O’rgangan mavzularni takrorlash haqida eslatish.', 'refresh'),
    h('p', { class: 'xs muted', style: { margin: 0 } }, 'Eslatmalar email orqali yuboriladi — SMTP hali ulanmagan, shuning uchun tanlov hozircha shu brauzerda saqlanadi.'));

  const left = h('section', { class: 'card pad' });
  const tabsDef = [['profile', 'Profil', 'user'], ['reading', 'O’qish', 'book'], ['notif', 'Bildirishnomalar', 'bell']];
  const tabBtns = tabsDef.map(([k, l, ic]) => h('button', { type: 'button', role: 'tab', class: 'btn', style: { flex: 1 }, onclick: () => { tab = k; drawTab(); } }, icon(ic), l));
  const drawTab = () => {
    tabBtns.forEach((b, i) => { const on = tabsDef[i][0] === tab; b.setAttribute('aria-selected', String(on)); b.className = `btn ${on ? 'primary' : ''}`; });
    mount(left, tab === 'profile' ? profileForm : tab === 'reading' ? readingTab : notifTab);
  };

  // ---------- right column
  let goal = p.dailyGoalMin || 30;
  const goalBtns = [15, 30, 45].map((g) => h('button', { type: 'button', 'aria-pressed': String(g === goal), onclick: async () => { if (await save({ dailyGoalMin: g }, `Kunlik maqsad: ${g} daqiqa.`)) { goal = g; goalBtns.forEach((b, i) => b.setAttribute('aria-pressed', String([15, 30, 45][i] === g))); } } }, h('span', { style: { color: 'var(--primary)' } }, icon('clock')), `${g} min`));
  const tz = h('select', { 'aria-label': 'Vaqt zonasi', style: { width: '100%', minHeight: '48px', padding: '0 12px', border: '1px solid #D5E2E1', borderRadius: '12px', background: '#fff' }, onchange: (e) => save({ timezone: e.target.value }, 'Vaqt zonasi saqlandi.') },
    [...new Set([p.timezone || 'Asia/Tashkent', ...TZS])].map((z) => h('option', { value: z, selected: (p.timezone || 'Asia/Tashkent') === z }, z)));
  let ft;
  const font = h('input', { type: 'range', min: 15, max: 24, step: 1, value: p.readerFont || 18, 'aria-label': 'O’qish shrift o’lchami', class: 'grow', style: { accentColor: 'var(--primary)' }, oninput: (e) => { fontPrev.style.fontSize = `${e.target.value}px`; clearTimeout(ft); ft = setTimeout(() => save({ readerFont: Number(e.target.value) }, `Shrift: ${e.target.value}px`), 500); } });
  const card = (ic, title, sub, ...body) => h('section', { class: 'card pad set-card stack', style: { gap: '12px' } }, h('div', {}, h('h3', {}, icon(ic), title), sub ? h('p', { class: 'small muted', style: { margin: '2px 0 0 40px' } }, sub) : null), ...body);
  const right = h('div', { class: 'stack', style: { gap: '16px' } },
    card('target', 'Kunlik maqsad', 'Har kuni nechcha daqiqa o’qishni rejalashtiryapsiz?', h('div', { class: 'goal-opts' }, goalBtns)),
    card('globe', 'Vaqt zonasi', 'Eslatma va o’qish statistikasi uchun.', tz),
    card('type', 'O’qish shrift o’lchami', 'Matnni o’qish uchun qulay hajmni tanlang.', h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('b', {}, 'A−'), font, h('b', { style: { fontSize: '20px' } }, 'A+'))),
    card('bell', 'Bildirishnoma sozlamalari', 'O’qishni muntazam qilishda yordam beradi.',
      toggle('ds-n-daily', true, 'Kunlik eslatma', 'Tanlagan vaqtda o’qish eslatmasi.', 'calendar'),
      toggle('ds-n-review', true, 'Takrorlash tavsiyasi', 'Takrorlash haqida eslatish.', 'refresh')),
    card('shield', 'Xavfsizlik', 'Hisobingiz xavfsizligi va kirish boshqaruvi.',
      h('a', { class: 'link-row', href: '/forgot-password' }, icon('lock'), h('span', { class: 'grow' }, 'Parolni o’zgartirish'), icon('right')),
      window.DS_DEMO ? h('button', { type: 'button', class: 'link-row', onclick: async () => { await post('/api/demo/reset'); await loadMe(); toast('Namuna ma’lumotlar tozalandi.'); navigate('/'); } }, icon('refresh'), h('span', { class: 'grow', style: { textAlign: 'left' } }, 'Web ko’rinish ma’lumotlarini tozalash'), icon('right')) : null,
      h('button', { type: 'button', class: 'link-row danger', onclick: () => logout() }, icon('logout'), h('span', { class: 'grow', style: { textAlign: 'left' } }, 'Hisobdan chiqish'), icon('right'))));

  mount(el,
    h('h1', { style: { margin: 0 } }, 'Profil va o’qish sozlamalari'),
    h('p', { class: 'sub', style: { marginTop: '4px' } }, 'Shaxsiy ma’lumotlaringiz, o’qish afzalliklari va bildirishnoma sozlamalarini boshqaring.'),
    h('div', { class: 'set-layout' },
      h('div', { class: 'stack', style: { gap: '14px' } }, h('div', { class: 'row', role: 'tablist', style: { flexWrap: 'wrap', gap: '10px' } }, tabBtns), left),
      right));
  drawTab();
}
