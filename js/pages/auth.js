import { h, icon, mount, toast } from '../ui.js?v=mwqeam7z';
import { post, patch } from '../api.js?v=mwqeam7z';
import { loadMe, state } from '../main.js?v=mwqeam7z';

function layout(title, sub, form, which) {
  return h('div', { class: 'auth' },
    h('section', { class: 'auth-art', 'aria-hidden': 'true' },
      h('div', { class: 'row', style: { gap: '0' } }, h('img', { src: 'assets/imedu-mono-64.png', alt: '', width: 40, height: 40 }), h('img', { src: 'assets/imedu-wordmark.png?v=2', alt: '', style: { height: '26px', width: 'auto', marginLeft: '10px' } })),
      h('h1', {}, 'Şifokorlik sari', h('br'), 'işonçli qadam.'),
      h('p', { class: 'muted', style: { fontSize: '20px', margin: 0, maxWidth: '460px' } }, 'Tibbiyotni tuşunib örganing, bilimlaringizni mustahkamlang va kelajak kasbingizga tayyorlaning.'),
      h('div', { class: 'feat' },
        h('div', {}, h('span', { class: 'ic' }, icon('layers')), 'Tizimli tibbiy bilimlar'),
        h('div', {}, h('span', { class: 'ic' }, icon('target')), 'Testlar bilan mustahkamlaş'),
        h('div', {}, h('span', { class: 'ic' }, icon('sparkles')), 'AI yordamida örganiş')),
      h('img', { class: 'art', src: 'assets/topics/topic_03.webp', alt: '' })),
    h('main', { class: 'auth-form', id: 'main' },
      h('div', { class: 'box stack' },
        which ? h('nav', { class: 'seg full', 'aria-label': 'Kiriş yoki röyxatdan ötiş' }, h('a', { href: '/login', 'aria-current': which === 'login' ? 'page' : null }, 'Kiriş'), h('a', { href: '/register', 'aria-current': which === 'register' ? 'page' : null }, 'Röyxatdan ötiş'))
          : h('div', { class: 'row', style: { gap: '0' } }, h('img', { src: 'assets/imedu-mono-64.png', alt: '', width: 40, height: 40 }), h('img', { src: 'assets/imedu-wordmark.png?v=2', alt: 'iMedu', style: { height: '24px', width: 'auto', marginLeft: '10px' } })),
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
  const btn = h('button', { class: 'btn primary block lg', type: 'submit' }, 'Kiriş');
  const form = h('form', { class: 'stack', novalidate: true }, f.email.wrap, f.password.wrap,
    h('div', { class: 'row between' }, h('a', { href: '/forgot-password', class: 'small' }, 'Parolni unutdingizmi?')), btn,
    h('div', { class: 'row', style: { flexWrap: 'nowrap', color: 'var(--text-2)' } }, h('hr', { class: 'grow', style: { border: 0, borderTop: '1px solid var(--border)' } }), 'yoki', h('hr', { class: 'grow', style: { border: 0, borderTop: '1px solid var(--border)' } })),
    h('button', { type: 'button', class: 'btn block lg', 'aria-disabled': 'true', title: 'Google orqali kiriş hali ulanmagan', onclick: () => toast('Google orqali kiriş hali ulanmagan. Email va parol bilan kiring.') }, h('b', { style: { color: '#4285F4', fontSize: '20px' } }, 'G'), 'Google bilan davom etiş'),
    h('p', { style: { textAlign: 'center', margin: 0 } }, h('a', { href: '/register', style: { fontWeight: 800 } }, 'Yangi hisob oçiş')));
  bindForm(form, f, btn, async (d) => {
    await post('/api/auth/login', d);
    await loadMe();
    navigate(query.next && query.next.startsWith('/') && !query.next.startsWith('//') ? query.next : '/dashboard', { replace: true });
  });
  mount(el, layout('Yana körişganimizdan xursandmiz', null, form, 'login'));
}

export function register({ el, navigate }) {
  const f = {
    name: field('name', 'Ism', { autocomplete: 'name', required: true }),
    email: field('email', 'Email', { type: 'email', autocomplete: 'email', required: true }),
    password: field('password', 'Parol (kamida 8 belgi)', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 }),
  };
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Hisob yaratiş');
  const form = h('form', { class: 'stack', novalidate: true }, f.name.wrap, f.email.wrap, f.password.wrap, btn,
    h('p', { class: 'small muted' }, 'Hisobingiz bormi? ', h('a', { href: '/login' }, 'Kiriş')));
  bindForm(form, f, btn, async (d) => {
    await post('/api/auth/register', d);
    const me = await loadMe();
    if (me) navigate('/onboarding', { replace: true });
    else mount(el, layout('Emailingizni tekşiring', null, h('div', { class: 'stack' }, h('div', { class: 'banner info' }, 'Agar bu email bilan hisob yaratiş mumkin bölsa, poçtangizga xat yuborildi. Keyin tizimga kiring.'), h('a', { class: 'btn primary', href: '/login' }, 'Kiriş'))));
  });
  mount(el, layout('Yangi hisob', 'iMedu’da öqişni boşlaş uçun hisob yarating.', form, 'register'));
}

export function forgot({ el }) {
  const f = { email: field('email', 'Email', { type: 'email', autocomplete: 'email', required: true }) };
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Havola yuboriş');
  const form = h('form', { class: 'stack', novalidate: true }, f.email.wrap, btn, h('a', { href: '/login', class: 'small' }, 'Kiriş sahifasiga qaytiş'));
  bindForm(form, f, btn, async (d) => {
    await post('/api/auth/forgot-password', d);
    mount(form, h('div', { class: 'banner ok' }, 'Agar bu email röyxatdan ötgan bölsa, parolni tiklaş havolasi yuborildi. Havola 1 soat amal qiladi.'), h('a', { href: '/login', class: 'btn' }, 'Kiriş'));
  });
  mount(el, layout('Parolni tiklaş', 'Hisobingiz emailini kiriting.', form));
}

export function reset({ el, query, navigate }) {
  if (!query.token) { mount(el, layout('Havola yaroqsiz', 'Parolni tiklaş havolasi töliq emas.', h('a', { class: 'btn primary', href: '/forgot-password' }, 'Yangi havola söraş'))); return; }
  const f = { password: field('password', 'Yangi parol (kamida 8 belgi)', { type: 'password', autocomplete: 'new-password', required: true }) };
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Parolni saqlaş');
  const form = h('form', { class: 'stack', novalidate: true }, f.password.wrap, btn);
  bindForm(form, f, btn, async (d) => {
    try { await post('/api/auth/reset-password', { token: query.token, ...d }); }
    catch (err) {
      if (['token_expired', 'validation_error'].includes(err.code) && err.fieldErrors?.token) {
        mount(form, h('div', { class: 'banner danger' }, err.message), h('a', { class: 'btn primary', href: '/forgot-password' }, 'Yangi havola söraş'));
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
  mount(el, layout('Emailni tasdiqlaş', null, box));
  try {
    await post('/api/auth/verify-email', { token: query.token || '' });
    await loadMe();
    mount(box, h('div', { class: 'banner ok' }, 'Email tasdiqlandi.'), h('a', { class: 'btn primary', href: state.me ? '/dashboard' : '/login' }, 'Davom etiş'));
  } catch (err) {
    mount(box, h('div', { class: 'banner danger' }, err.message), h('a', { class: 'btn', href: '/dashboard' }, 'Boş sahifa'));
  }
}

export function onboarding({ el, navigate }) {
  const p = state.me.profile;
  const name = h('input', { id: 'o-name', value: p.name || '', required: true, autocomplete: 'name' });
  const uni = h('input', { id: 'o-uni', value: p.university || '', placeholder: 'Ixtiyoriy' });
  const course = h('select', { id: 'o-course', required: true }, h('option', { value: '' }, 'Tanlang'), [1, 2, 3, 4, 5, 6, 7].map((c) => h('option', { value: c, selected: p.course === c }, `${c}-kurs`)));
  const dir = h('input', { id: 'o-dir', value: p.direction || '', placeholder: 'Masalan: davolaş işi' });
  const lang = h('select', { id: 'o-lang' }, [['uz', 'Özbekça'], ['ru', 'Rusça'], ['en', 'Inglizça']].map(([v, l]) => h('option', { value: v, selected: p.studyLang === v }, l)));
  let goal = p.dailyGoalMin || 30;
  const goalBtns = [15, 30, 45].map((g) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(g === goal), onclick: () => { goal = g; goalBtns.forEach((b, i) => b.setAttribute('aria-pressed', String([15, 30, 45][i] === g))); } }, `${g} daqiqa`));
  const tz = h('select', { id: 'o-tz' }, ['Asia/Tashkent', 'Asia/Samarkand', 'Asia/Almaty', 'Europe/Moscow', 'UTC'].map((z) => h('option', { value: z, selected: p.timezone === z }, z)));
  const err = h('div', { class: 'banner danger hidden', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Saqlaş va boşlaş');
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
    h('div', { class: 'grid g2' }, fld('o-course', 'Kurs', course), fld('o-dir', 'Yönaliş', dir)),
    fld('o-lang', 'Qöşimça öqiş tili', lang),
    h('div', { class: 'field' }, h('span', { style: { fontWeight: 700, fontSize: '14px' } }, 'Kunlik maqsad'), h('div', { class: 'row', role: 'group', 'aria-label': 'Kunlik maqsad' }, goalBtns)),
    fld('o-tz', 'Vaqt zonasi', tz), btn,
    h('p', { class: 'xs muted' }, 'Interfeys tili: özbekça. Asl kitob matni inglizça saqlanadi. Bu sozlamalarni keyin “Sozlamalar”dan özgartiriş mumkin.'));
  mount(el, layout('Dastlabki sozlaş', 'Öqiş rejangizni moslaymiz.', form));
  void icon;
}
