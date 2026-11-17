import { h, icon, mount, toast } from '../ui.js?v=mwkb5oci';
import { post, patch } from '../api.js?v=mwkb5oci';
import { loadMe, state } from '../main.js?v=mwkb5oci';

function layout(title, sub, form, which) {
  return h('div', { class: 'auth' },
    h('section', { class: 'auth-art', 'aria-hidden': 'true' },
      h('div', { class: 'row', style: { gap: '0' } }, h('img', { src: 'assets/drbek-mono-64.png', alt: '', width: 40, height: 40 }), h('img', { src: 'assets/drbek-wordmark.png', alt: '', style: { height: '30px', width: 'auto', marginLeft: '-4px' } })),
      h('h1', {}, 'Shifokorlik sari', h('br'), 'ishonchli qadam.'),
      h('p', { class: 'muted', style: { fontSize: '20px', margin: 0, maxWidth: '460px' } }, 'Tibbiyotni tushunib o’rganing, bilimlaringizni mustahkamlang va kelajak kasbingizga tayyorlaning.'),
      h('div', { class: 'feat' },
        h('div', {}, h('span', { class: 'ic' }, icon('layers')), 'Tizimli tibbiy bilimlar'),
        h('div', {}, h('span', { class: 'ic' }, icon('target')), 'Testlar bilan mustahkamlash'),
        h('div', {}, h('span', { class: 'ic' }, icon('sparkles')), 'AI yordamida o’rganish')),
      h('img', { class: 'art', src: 'assets/topics/topic_03.webp', alt: '' })),
    h('main', { class: 'auth-form', id: 'main' },
      h('div', { class: 'box stack' },
        which ? h('nav', { class: 'seg full', 'aria-label': 'Kirish yoki ro’yxatdan o’tish' }, h('a', { href: '/login', 'aria-current': which === 'login' ? 'page' : null }, 'Kirish'), h('a', { href: '/register', 'aria-current': which === 'register' ? 'page' : null }, 'Ro’yxatdan o’tish'))
          : h('div', { class: 'row', style: { gap: '0' } }, h('img', { src: 'assets/drbek-mono-64.png', alt: '', width: 40, height: 40 }), h('img', { src: 'assets/drbek-wordmark.png', alt: 'DrBek', style: { height: '28px', width: 'auto', marginLeft: '-4px' } })),
        h('h1', { style: { margin: '10px 0 0' } }, title), sub ? h('p', { class: 'muted', style: { margin: 0 } }, sub) : null, form)));
}

function field(name, label, attrs = {}) {
  const input = h('input', { id: `f-${name}`, name, ...attrs });
  const err = h('div', { class: 'err', id: `e-${name}`, role: 'alert' });
  input.setAttribute('aria-describedby', `e-${name}`);
  return { wrap: h('div', { class: 'field' }, h('label', { for: `f-${name}` }, label), input, err), input, err };
}

function bindForm(form, fields, submitBtn, action) {
  const general = h('div', { class: 'banner danger hidden', role: 'alert' });
  form.prepend(general);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    Object.values(fields).forEach((f) => { f.err.textContent = ''; f.input.removeAttribute('aria-invalid'); });
    general.classList.add('hidden');
    const label = submitBtn.textContent;
    submitBtn.disabled = true; submitBtn.textContent = 'Yuborilmoqda…';
    try { await action(Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.input.value]))); }
    catch (err) {
      if (err.fieldErrors) for (const [k, m] of Object.entries(err.fieldErrors)) if (fields[k]) { fields[k].err.textContent = m; fields[k].input.setAttribute('aria-invalid', 'true'); }
      general.textContent = err.message; general.classList.remove('hidden');
    } finally { submitBtn.disabled = false; submitBtn.textContent = label; }
  });
}

export function login({ el, query, navigate }) {
  const f = { email: field('email', 'Email', { type: 'email', autocomplete: 'email', required: true }), password: field('password', 'Parol', { type: 'password', autocomplete: 'current-password', required: true }) };
  const btn = h('button', { class: 'btn primary block lg', type: 'submit' }, 'Kirish');
  const form = h('form', { class: 'stack', novalidate: true }, f.email.wrap, f.password.wrap,
    h('div', { class: 'row between' }, h('a', { href: '/forgot-password', class: 'small' }, 'Parolni unutdingizmi?')), btn,
    h('div', { class: 'row', style: { flexWrap: 'nowrap', color: 'var(--text-2)' } }, h('hr', { class: 'grow', style: { border: 0, borderTop: '1px solid var(--border)' } }), 'yoki', h('hr', { class: 'grow', style: { border: 0, borderTop: '1px solid var(--border)' } })),
    h('button', { type: 'button', class: 'btn block lg', 'aria-disabled': 'true', title: 'Google orqali kirish hali ulanmagan', onclick: () => toast('Google orqali kirish hali ulanmagan. Email va parol bilan kiring.') }, h('b', { style: { color: '#4285F4', fontSize: '20px' } }, 'G'), 'Google bilan davom etish'),
    h('p', { style: { textAlign: 'center', margin: 0 } }, h('a', { href: '/register', style: { fontWeight: 800 } }, 'Yangi hisob ochish')));
  bindForm(form, f, btn, async (d) => {
    await post('/api/auth/login', d);
    await loadMe();
    navigate(query.next && query.next.startsWith('/') && !query.next.startsWith('//') ? query.next : '/dashboard', { replace: true });
  });
  mount(el, layout('Yana ko’rishganimizdan xursandmiz', null, form, 'login'));
}

export function register({ el, navigate }) {
  const f = {
    name: field('name', 'Ism', { autocomplete: 'name', required: true }),
    email: field('email', 'Email', { type: 'email', autocomplete: 'email', required: true }),
    password: field('password', 'Parol (kamida 8 belgi)', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 }),
  };
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Hisob yaratish');
  const form = h('form', { class: 'stack', novalidate: true }, f.name.wrap, f.email.wrap, f.password.wrap, btn,
    h('p', { class: 'small muted' }, 'Hisobingiz bormi? ', h('a', { href: '/login' }, 'Kirish')));
  bindForm(form, f, btn, async (d) => {
    await post('/api/auth/register', d);
    const me = await loadMe();
    if (me) navigate('/onboarding', { replace: true });
    else mount(el, layout('Emailingizni tekshiring', null, h('div', { class: 'stack' }, h('div', { class: 'banner info' }, 'Agar bu email bilan hisob yaratish mumkin bo’lsa, pochtangizga xat yuborildi. Keyin tizimga kiring.'), h('a', { class: 'btn primary', href: '/login' }, 'Kirish'))));
  });
  mount(el, layout('Yangi hisob', 'DrBek’da o’qishni boshlash uchun hisob yarating.', form, 'register'));
}

export function forgot({ el }) {
  const f = { email: field('email', 'Email', { type: 'email', autocomplete: 'email', required: true }) };
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Havola yuborish');
  const form = h('form', { class: 'stack', novalidate: true }, f.email.wrap, btn, h('a', { href: '/login', class: 'small' }, 'Kirish sahifasiga qaytish'));
  bindForm(form, f, btn, async (d) => {
    await post('/api/auth/forgot-password', d);
    mount(form, h('div', { class: 'banner ok' }, 'Agar bu email ro’yxatdan o’tgan bo’lsa, parolni tiklash havolasi yuborildi. Havola 1 soat amal qiladi.'), h('a', { href: '/login', class: 'btn' }, 'Kirish'));
  });
  mount(el, layout('Parolni tiklash', 'Hisobingiz emailini kiriting.', form));
}

export function reset({ el, query, navigate }) {
  if (!query.token) { mount(el, layout('Havola yaroqsiz', 'Parolni tiklash havolasi to’liq emas.', h('a', { class: 'btn primary', href: '/forgot-password' }, 'Yangi havola so’rash'))); return; }
  const f = { password: field('password', 'Yangi parol (kamida 8 belgi)', { type: 'password', autocomplete: 'new-password', required: true }) };
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Parolni saqlash');
  const form = h('form', { class: 'stack', novalidate: true }, f.password.wrap, btn);
  bindForm(form, f, btn, async (d) => {
    try { await post('/api/auth/reset-password', { token: query.token, ...d }); }
    catch (err) {
      if (['token_expired', 'validation_error'].includes(err.code) && err.fieldErrors?.token) {
        mount(form, h('div', { class: 'banner danger' }, err.message), h('a', { class: 'btn primary', href: '/forgot-password' }, 'Yangi havola so’rash'));
        return;
      }
      throw err;
    }
    await loadMe();
    toast('Parol yangilandi.');
    navigate('/dashboard', { replace: true });
  });
  mount(el, layout('Yangi parol', null, form));
}

export async function verify({ el, query }) {
  const box = h('div', { class: 'stack' }, h('p', {}, 'Tekshirilmoqda…'));
  mount(el, layout('Emailni tasdiqlash', null, box));
  try {
    await post('/api/auth/verify-email', { token: query.token || '' });
    await loadMe();
    mount(box, h('div', { class: 'banner ok' }, 'Email tasdiqlandi.'), h('a', { class: 'btn primary', href: state.me ? '/dashboard' : '/login' }, 'Davom etish'));
  } catch (err) {
    mount(box, h('div', { class: 'banner danger' }, err.message), h('a', { class: 'btn', href: '/dashboard' }, 'Bosh sahifa'));
  }
}

export function onboarding({ el, navigate }) {
  const p = state.me.profile;
  const name = h('input', { id: 'o-name', value: p.name || '', required: true, autocomplete: 'name' });
  const uni = h('input', { id: 'o-uni', value: p.university || '', placeholder: 'Ixtiyoriy' });
  const course = h('select', { id: 'o-course', required: true }, h('option', { value: '' }, 'Tanlang'), [1, 2, 3, 4, 5, 6, 7].map((c) => h('option', { value: c, selected: p.course === c }, `${c}-kurs`)));
  const dir = h('input', { id: 'o-dir', value: p.direction || '', placeholder: 'Masalan: davolash ishi' });
  const lang = h('select', { id: 'o-lang' }, [['uz', 'O’zbekcha'], ['ru', 'Ruscha'], ['en', 'Inglizcha']].map(([v, l]) => h('option', { value: v, selected: p.studyLang === v }, l)));
  let goal = p.dailyGoalMin || 30;
  const goalBtns = [15, 30, 45].map((g) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(g === goal), onclick: () => { goal = g; goalBtns.forEach((b, i) => b.setAttribute('aria-pressed', String([15, 30, 45][i] === g))); } }, `${g} daqiqa`));
  const tz = h('select', { id: 'o-tz' }, ['Asia/Tashkent', 'Asia/Samarkand', 'Asia/Almaty', 'Europe/Moscow', 'UTC'].map((z) => h('option', { value: z, selected: p.timezone === z }, z)));
  const err = h('div', { class: 'banner danger hidden', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Saqlash va boshlash');
  const fld = (id, label, input) => h('div', { class: 'field' }, h('label', { for: id }, label), input);
  const form = h('form', { class: 'stack', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.classList.add('hidden'); btn.disabled = true;
    try {
      await patch('/api/profile', { name: name.value, university: uni.value || undefined, course: course.value ? Number(course.value) : undefined, direction: dir.value || undefined, studyLang: lang.value, dailyGoalMin: goal, timezone: tz.value, completeOnboarding: true });
      await loadMe();
      navigate('/dashboard', { replace: true });
    } catch (ex) { err.textContent = ex.fieldErrors ? Object.values(ex.fieldErrors).join(' ') : ex.message; err.classList.remove('hidden'); }
    finally { btn.disabled = false; }
  } }, err,
    fld('o-name', 'Ism', name), fld('o-uni', 'Universitet', uni),
    h('div', { class: 'grid g2' }, fld('o-course', 'Kurs', course), fld('o-dir', 'Yo’nalish', dir)),
    fld('o-lang', 'Qo’shimcha o’qish tili', lang),
    h('div', { class: 'field' }, h('span', { style: { fontWeight: 700, fontSize: '14px' } }, 'Kunlik maqsad'), h('div', { class: 'row', role: 'group', 'aria-label': 'Kunlik maqsad' }, goalBtns)),
    fld('o-tz', 'Vaqt zonasi', tz), btn,
    h('p', { class: 'xs muted' }, 'Interfeys tili: o’zbekcha. Asl kitob matni inglizcha saqlanadi. Bu sozlamalarni keyin “Sozlamalar”dan o’zgartirish mumkin.'));
  mount(el, layout('Dastlabki sozlash', 'O’qish rejangizni moslaymiz.', form));
  void icon;
}
