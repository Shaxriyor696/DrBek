import { h, icon, mount, toast, modal } from '../ui.js?v=mwv0pg5k';
import { get, post } from '../api.js?v=mwv0pg5k';
import { statusBadge, openFigure, figLabel } from '../common.js?v=mwv0pg5k';

export async function admin({ el, state }) {
  const d = await get('/api/admin/overview');
  const T = d.totals;
  const isAdmin = state.me.roles.includes('admin');
  let f = 'all';
  const tbody = h('tbody');
  const draw = () => mount(tbody, d.lessons.filter((l) => f === 'all' || l.status === f).map((l) => h('tr', {},
    h('td', {}, l.id), h('td', {}, h('a', { href: `/admin/lessons/${l.id}` }, l.titleUz), h('div', { class: 'xs muted' }, l.titleOriginal)),
    h('td', {}, l.topicId), h('td', {}, statusBadge(l.status)), h('td', { class: 'small' }, `${l.counts.figuresIncluded}/${l.counts.figures}`), h('td', { class: 'small' }, l.counts.terms))));
  const statuses = ['all', ...Object.keys(T.lessonsByStatus)];
  mount(el, h('h1', {}, 'Kontent boşqaruvi'),
    h('p', { class: 'muted small' }, `Kontent versiyasi ${d.contentVersion} · rejim: ${d.access === 'review_preview' ? 'oldindan köriş (tekşiruvdagi darslar ham körinadi)' : 'faqat naşr etilganlar'}`),
    h('div', { class: 'grid g4' }, [['Darslar', `${T.lessons}`], ['Rasm/jadval kesilgan', `${T.figuresIncluded}/${T.figures}`], ['Rasm tasdiqlangan', `${T.figuresApproved}`], ['Savollar (tasdiqlangan)', `${T.questions} (${T.questionsApproved})`]].map(([l, v]) => h('div', { class: 'card pad stat' }, h('div', {}, h('b', {}, v), h('span', { class: 'small muted' }, l))))),
    h('section', { class: 'card pad', style: { marginTop: '18px' } },
      h('div', { class: 'row between', style: { flexWrap: 'wrap' } }, h('h2', { style: { margin: 0 } }, 'Darslar'),
        h('div', { class: 'row', style: { flexWrap: 'wrap' } }, statuses.map((s) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(s === f), onclick: (e) => { f = s; e.target.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.target))); draw(); } }, s === 'all' ? 'Hammasi' : `${s} (${T.lessonsByStatus[s]})`)))),
      h('div', { class: 'table-wrap', style: { marginTop: '10px' } }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['ID', 'Dars', 'Mavzu', 'Holat', 'Rasmlar', 'Atamalar'].map((x) => h('th', {}, x)))), tbody))),
    isAdmin ? h('section', { class: 'card pad stack', style: { marginTop: '18px' } }, h('h2', { style: { margin: 0 } }, 'Import va rollar'),
      h('p', { class: 'small muted', style: { margin: 0 } }, 'Qayta import kitob PDF va eslatmalardan kontentni qayta yiğadi (idempotent).'),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } },
        h('button', { type: 'button', class: 'btn', onclick: async () => { try { const r = await post('/api/admin/imports'); toast(`Import boşlandi: ${r.jobId}`); } catch (e) { toast(e.message); } } }, icon('refresh'), 'Qayta import'),
        h('button', { type: 'button', class: 'btn', onclick: async () => {
          const em = h('input', { id: 'r-em', type: 'email' }); const ro = h('input', { id: 'r-ro', value: 'student,reviewer' });
          const ok = await modal({ title: 'Rollarni özgartiriş', body: h('div', { class: 'stack' }, h('div', { class: 'field' }, h('label', { for: 'r-em' }, 'Email'), em), h('div', { class: 'field' }, h('label', { for: 'r-ro' }, 'Rollar (vergul bilan)'), ro)), actions: [{ label: 'Bekor', value: false }, { label: 'Saqlaş', value: true, primary: true }] });
          if (ok) { try { await post('/api/admin/users/roles', { email: em.value, roles: ro.value }); toast('Saqlandi.'); } catch (e) { toast(e.message); } }
        } }, icon('user'), 'Rollar')),
      d.jobs.length ? h('ul', { class: 'small' }, d.jobs.map((j) => h('li', {}, `${j.created_at} · ${j.status}${j.error ? ` · ${j.error}` : ''}`))) : null) : null);
  draw();
}

export async function lesson({ el, params, state }) {
  const d = await get(`/api/admin/lessons/${params.lessonId}`);
  const L = d.lesson;
  const roles = state.me.roles;
  const canReview = roles.includes('reviewer') || roles.includes('admin');
  const review = async (targetType, targetId, decision) => {
    let reason;
    if (decision !== 'approve') {
      const ta = h('textarea', { id: 'rv-r', rows: 3, style: { width: '100%' } });
      const ok = await modal({ title: 'Sabab', body: h('div', { class: 'field' }, h('label', { for: 'rv-r' }, 'Nimani tuzatiş kerak?'), ta), actions: [{ label: 'Bekor', value: false }, { label: 'Yuboriş', value: true, primary: true }] });
      if (!ok) return; reason = ta.value.trim();
    }
    try { await post('/api/admin/reviews', { targetType, targetId, decision, reason }); toast('Saqlandi.'); lesson({ el, params, state }); } catch (e) { toast(e.message); }
  };
  mount(el, h('nav', { class: 'crumbs' }, h('a', { href: '/admin' }, 'Kontent boşqaruvi'), icon('right', 'sm'), h('span', {}, L.id)),
    h('h1', {}, L.titleUz), h('p', { class: 'muted small' }, `${L.titleOriginal} · versiya ${L.contentVersion} · tarjima: ${L.translationStatus}`),
    h('div', { class: 'row', style: { flexWrap: 'wrap' } }, statusBadge(L.status),
      canReview ? h('button', { type: 'button', class: 'btn small primary', onclick: () => review('lesson', L.id, 'approve') }, 'Darsni tasdiqlaş') : null,
      canReview ? h('button', { type: 'button', class: 'btn small', onclick: () => review('lesson', L.id, 'request_changes') }, 'Qaytariş') : null,
      roles.includes('admin') ? h('button', { type: 'button', class: 'btn small', onclick: async () => { try { const r = await post('/api/admin/publish', { lessonId: L.id }); toast(`Naşr etildi${r.warnings.length ? ' (ogohlantirişlar bor)' : ''}.`); lesson({ el, params, state }); } catch (e) { toast(e.body?.missing ? e.body.missing.join(' ') : e.message); } } }, 'Naşr etiş') : null,
      roles.includes('admin') ? h('button', { type: 'button', class: 'btn small danger', onclick: async () => { try { await post('/api/admin/archive', { lessonId: L.id }); toast('Arxivlandi.'); lesson({ el, params, state }); } catch (e) { toast(e.message); } } }, 'Arxivlaş') : null),
    h('section', { class: 'card pad', style: { marginTop: '16px' } }, h('h2', { style: { marginTop: 0 } }, 'Naşr şartlari'),
      d.gate.missing.length ? h('ul', { class: 'small' }, d.gate.missing.map((m) => h('li', {}, m))) : h('p', { class: 'small' }, 'Barça şartlar bajarilgan.')),
    h('section', { class: 'card pad', style: { marginTop: '16px' } }, h('h2', { style: { marginTop: 0 } }, `Rasmlar (${d.figures.length})`),
      h('div', { class: 'grid g3' }, d.figures.map((f) => h('div', { class: 'card', style: { padding: '8px' } },
        h('button', { type: 'button', style: { border: 0, background: '#fff', width: '100%', cursor: 'zoom-in' }, onclick: () => openFigure(f.imageId) }, f.assetPath ? h('img', { src: `/media/${f.assetPath}`, alt: '', loading: 'lazy', style: { width: '100%', height: '150px', objectFit: 'contain' } }) : h('div', { class: 'empty small' }, 'Kesilmagan')),
        h('div', { class: 'xs', style: { margin: '6px 0' } }, h('b', {}, figLabel(f)), ` · PDF ${f.pdfPage} · ${f.cropMethod || 'yöq'}`),
        h('div', { class: 'row', style: { gap: '4px', flexWrap: 'wrap' } }, statusBadge(f.reviewStatus),
          canReview ? h('button', { type: 'button', class: 'btn small', onclick: () => review('figure', f.imageId, 'approve') }, 'OK') : null,
          canReview ? h('button', { type: 'button', class: 'btn small', onclick: () => review('figure', f.imageId, 'reject') }, 'Rad') : null))))),
    d.reviews.length ? h('section', { class: 'card pad', style: { marginTop: '16px' } }, h('h2', { style: { marginTop: 0 } }, 'Tekşiruv tarixi'), h('ul', { class: 'small' }, d.reviews.map((r) => h('li', {}, `${r.at} · ${r.target_type}:${r.target_id} · ${r.decision}${r.reason ? ` — ${r.reason}` : ''}`)))) : null);
}
