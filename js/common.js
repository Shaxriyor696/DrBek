// Shared client helpers: bookmark toggling, figure lightbox, status badges.
import { h, icon, inline, toast } from './ui.js?v=mwqeam7z';
import { get, post, del } from './api.js?v=mwqeam7z';

// Toggle a bookmark. POST is idempotent (returns the existing one), so removal = POST then DELETE.
export async function toggleBookmark(btn, { targetType, targetId, title, snippet, meta }, saved) {
  btn.disabled = true;
  try {
    const r = await post('/api/bookmarks', { targetType, targetId, title, snippet, meta });
    if (saved) {
      await del(`/api/bookmarks/${r.bookmark.id}`);
      setBookmarkBtn(btn, false);
      toast('Saqlanganlardan olib taşlandi.', { action: 'Qaytariş', onAction: async () => { await post(`/api/bookmarks/${r.bookmark.id}/restore`); setBookmarkBtn(btn, true); } });
      return false;
    }
    setBookmarkBtn(btn, true);
    toast('Saqlanganlarga qöşildi.');
    return true;
  } catch (err) { toast(err.message); return saved; } finally { btn.disabled = false; }
}
export function setBookmarkBtn(btn, on) {
  btn.setAttribute('aria-pressed', String(on));
  btn.replaceChildren(icon(on ? 'bookmarkFill' : 'bookmark'));
  btn.title = on ? 'Saqlangan (olib taşlaş)' : 'Saqlaş';
  btn.setAttribute('aria-label', btn.title);
}
export function bookmarkButton(target, saved, extraClass = '') {
  let on = !!saved;
  const btn = h('button', { type: 'button', class: `icon-btn ${extraClass}` });
  setBookmarkBtn(btn, on);
  btn.addEventListener('click', async (e) => { e.preventDefault(); e.stopPropagation(); on = await toggleBookmark(btn, target, on); });
  return btn;
}

export const STATUS_LABEL = { published: 'Tasdiqlangan', in_review: 'Tekşiruvda', draft: 'Qoralama', archived: 'Arxiv', needs_review: 'Tekşirilişi kerak', approved: 'Tasdiqlangan', rejected: 'Rad etilgan', not_found: 'Topilmadi' };
export function statusBadge(s) {
  const cls = s === 'published' || s === 'approved' ? 'ok' : s === 'archived' || s === 'rejected' ? 'gray' : 'warn';
  return h('span', { class: `badge ${cls}` }, STATUS_LABEL[s] || s);
}

// Book figure lightbox: zoom (buttons, wheel, pinch), caption, source page.
export async function openFigure(imageIdOrFigure, { onSave, onNote } = {}) {
  let f = imageIdOrFigure;
  if (typeof f === 'string') {
    try { f = (await get(`/api/figures/${encodeURIComponent(f)}`)).figure; } catch (err) { toast(err.message); return; }
  }
  let scale = 1;
  const img = f.url ? h('img', { src: f.url, alt: f.altTextUz || f.originalCaption || f.figureNumber, draggable: 'false' }) : null;
  const stage = h('div', { class: 'lb-stage' }, img || h('div', { class: 'empty' }, icon('image'), h('p', {}, 'Rasm hali kesib olinmagan. Kitob sahifasini oçing.')));
  const apply = () => { if (img) img.style.transform = `scale(${scale})`; zl.textContent = `${Math.round(scale * 100)}%`; };
  const zl = h('span', { class: 'small', 'aria-live': 'polite' }, '100%');
  const zoom = (d) => { scale = Math.min(4, Math.max(0.5, +(scale + d).toFixed(2))); apply(); };
  stage.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 0.2 : -0.2); } }, { passive: false });
  let pinch = null;
  stage.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { d: dist(e.touches), s: scale }; }, { passive: true });
  stage.addEventListener('touchmove', (e) => { if (pinch && e.touches.length === 2) { scale = Math.min(4, Math.max(0.5, pinch.s * (dist(e.touches) / pinch.d))); apply(); } }, { passive: true });
  stage.addEventListener('touchend', () => { pinch = null; });
  const pdfHref = `/source-pdf/${f.bookEditionId || 'guyton-hall-14'}#page=${f.pdfPage}`;
  const prev = document.activeElement;
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === '+' || e.key === '=') zoom(0.25); if (e.key === '-') zoom(-0.25); };
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', onclick: close, 'aria-label': 'Yopiş' }, icon('x'));
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': figLabel(f) },
    h('div', { class: 'lb-top' },
      h('b', { class: 'grow' }, figLabel(f)),
      h('button', { type: 'button', class: 'icon-btn', onclick: () => zoom(-0.25), 'aria-label': 'Kiçiklaştiriş' }, icon('zoomOut')), zl,
      h('button', { type: 'button', class: 'icon-btn', onclick: () => zoom(0.25), 'aria-label': 'Kattalaştiriş' }, icon('zoomIn')),
      h('button', { type: 'button', class: 'btn small', onclick: () => { scale = 1; apply(); } }, '100%'),
      onSave ? h('button', { type: 'button', class: 'btn small', onclick: () => onSave(f) }, icon('bookmark'), 'Saqlaş') : null,
      onNote ? h('button', { type: 'button', class: 'btn small', onclick: () => { close(); onNote(f); } }, icon('note'), 'Qayd') : null,
      window.DS_DEMO ? null : h('a', { class: 'btn small', href: pdfHref, target: '_blank', rel: 'noopener' }, icon('external'), 'Kitobdagi sahifani oçiş'),
      closeBtn),
    stage,
    h('div', { class: 'lb-cap' },
      h('p', { style: { margin: '0 0 6px' } }, h('b', {}, `${f.figureNumber}. `), (f.originalCaption || '').replace(/^(Figure|Table)\s*\d+-\d+\.?\s*/, '')),
      f.captionUz ? h('p', { style: { margin: '0 0 6px' } }, inline(f.captionUz)) : null,
      h('div', { class: 'row xs', style: { flexWrap: 'wrap', gap: '8px' } },
        h('span', {}, `Manba: Guyton & Hall, 14-naşr · kitob sahifasi ${f.printedPageLabel ?? '—'} (PDF ${f.pdfPage})`),
        statusBadge(f.reviewStatus),
        f.cropMethod === 'full_page_fallback' || !f.cropMethod ? h('span', { class: 'badge warn' }, 'Qölda kesiş kerak') : null)));
  document.body.appendChild(box);
  document.addEventListener('keydown', onKey);
  closeBtn.focus();
}
export const figLabel = (f) => (f.figureNumber || '').replace(/^Figure/, 'Rasm').replace(/^Table/, 'Jadval');
const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

export function figureBlock(f, onOpen) {
  if (!f) return null;
  return h('figure', { class: 'book-fig', id: `fig-${f.imageId}` },
    h('button', { type: 'button', class: 'fig-btn', onclick: () => onOpen(f), 'aria-label': `${figLabel(f)} — kattalaştiriş` },
      f.url ? h('img', { src: f.url, alt: f.altTextUz || f.originalCaption || figLabel(f), loading: 'lazy', width: f.dimensions?.[0], height: f.dimensions?.[1] }) : h('div', { class: 'empty small' }, icon('image'), 'Rasm kesib olinmagan — kitob sahifasini oçing')),
    h('figcaption', {}, h('b', {}, `${figLabel(f)}. `), f.captionUz ? inline(f.captionUz) : (f.originalCaption || '').replace(/^(Figure|Table)\s*\d+-\d+\.?\s*/, ''),
      h('span', { class: 'xs muted', style: { display: 'block' } }, `Kitob, ${f.printedPageLabel ?? '—'}-bet · `, f.reviewStatus === 'approved' ? 'tasdiqlangan' : 'tekşirilişi kerak')));
}
