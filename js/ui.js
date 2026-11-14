// DOM helpers, icons, toasts, modals, safe inline-markup rendering.

export function h(tag, attrs = {}, ...children) {
  const el = tag === 'frag' ? document.createDocumentFragment() : document.createElement(tag);
  if (attrs && tag !== 'frag') {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') throw new Error('raw html not allowed');
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...children) => { clear(el); append(el, children); return el; };

// Lucide-style outline icons (24x24, stroke).
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  book: '<path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2Z"/><path d="M22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8Z"/>',
  test: '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 2h6v4H9z"/><path d="m9 14 2 2 4-4"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
  bookmarkFill: '<path d="M6 3h12v18l-6-4-6 4Z" fill="currentColor"/>',
  chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  right: '<path d="m9 18 6-6-6-6"/>', left: '<path d="m15 18-6-6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
  play: '<path d="M7 4v16l13-8Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  flag: '<path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  flame: '<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7Z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M2 14v2M22 14v2"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9Z"/>',
  lightbulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2Z"/>',
  note: '<path d="M4 4h16v12l-4 4H4Z"/><path d="M16 20v-4h4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  move: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>', chevUp: '<path d="m18 15-6-6-6 6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  cap: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>',
  thumb: '<path d="M7 10v12"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.4 22H7V10l4-8a3 3 0 0 1 4 3.9Z"/>',
  flask: '<path d="M9 3h6M10 3v6l-6 10a2 2 0 0 0 1.7 3h12.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7 15h10"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"/><path d="m9 14 2 2 4-4"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/>',
  steth: '<path d="M4 3v5a5 5 0 0 0 10 0V3"/><path d="M9 13v2a6 6 0 0 0 12 0v-3"/><circle cx="21" cy="10" r="2"/>',
};
export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[name] || P.info}</svg>`;
  return span.firstChild;
}

// Content text uses a tiny safe markup: **bold**, _italic_. Everything is
// created as text nodes; Figure/Table references become buttons when known.
export function inline(text, { onFigure, knownFigures } = {}) {
  const frag = document.createDocumentFragment();
  const parts = String(text || '').split(/(\*\*[^*]+\*\*|(?<![\p{L}\p{N}])_[^_]+_(?![\p{L}\p{N}]))/u);
  for (const part of parts) {
    if (!part) continue;
    let node;
    if (/^\*\*[^*]+\*\*$/.test(part)) { node = document.createElement('strong'); figurize(node, part.slice(2, -2), onFigure, knownFigures); }
    else if (/^_[^_]+_$/.test(part)) { node = document.createElement('em'); node.textContent = part.slice(1, -1); }
    else { node = document.createDocumentFragment(); figurize(node, part, onFigure, knownFigures); }
    frag.appendChild(node);
  }
  return frag;
}
function figurize(parent, text, onFigure, known) {
  if (!onFigure) { parent.appendChild(document.createTextNode(text)); return; }
  const re = /\b(Figure|Fig\.|Table|Jadval|Rasm)\s*(\d{1,2})\s*[-–]\s*(\d{1,2})/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    const kind = /^Table|Jadval/.test(m[1]) ? 'tab' : 'fig';
    const imageId = `gh14-${kind}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (known && !known.has(imageId)) continue;
    parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'figref'; b.textContent = m[0];
    b.addEventListener('click', () => onFigure(imageId));
    parent.appendChild(b);
    last = m.index + m[0].length;
  }
  parent.appendChild(document.createTextNode(text.slice(last)));
}

export function toast(message, { action, onAction, timeout = 5000 } = {}) {
  const wrap = document.getElementById('toasts');
  const t = h('div', { class: 'toast', role: 'status' }, h('span', {}, message));
  if (action) t.appendChild(h('button', { type: 'button', onclick: () => { onAction?.(); t.remove(); } }, action));
  wrap.appendChild(t);
  setTimeout(() => t.remove(), timeout);
}

export function modal({ title, body, actions = [] }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const close = (val) => { back.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mdl-title' },
      h('h2', { id: 'mdl-title' }, title),
      typeof body === 'string' ? h('p', { class: 'muted' }, body) : body,
      h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '18px' } },
        actions.map((a) => h('button', { type: 'button', class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`, onclick: () => close(a.value) }, a.label))));
    const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(null); } }, box);
    document.body.appendChild(back);
    document.addEventListener('keydown', onKey);
    (box.querySelector('input,textarea,button.primary') || box.querySelector('button'))?.focus();
  });
}
export const confirmBox = (title, body, okLabel = 'Ha', danger = false) => modal({ title, body, actions: [{ label: 'Bekor qilish', value: false }, { label: okLabel, value: true, primary: !danger, danger }] });

export function promptBox(title, label, value = '') {
  const input = h('input', { id: 'pb', value, maxlength: 60 });
  return modal({ title, body: h('div', { class: 'field' }, h('label', { for: 'pb' }, label), input), actions: [{ label: 'Bekor qilish', value: null }, { label: 'Saqlash', value: 'ok', primary: true }] })
    .then((r) => (r === 'ok' ? input.value.trim() : null));
}

export function skeleton(lines = 4) {
  return h('div', { class: 'stack', 'aria-busy': 'true', role: 'status' }, h('span', { class: 'sr-only' }, 'Yuklanmoqda…'), Array.from({ length: lines }, (_, i) => h('div', { class: 'skeleton', style: { height: i === 0 ? '36px' : '80px' } })));
}

export function errorBox(err, retry) {
  return h('div', { class: 'card pad empty', role: 'alert' }, icon('alert'),
    h('p', {}, err?.message || 'Xato yuz berdi.'),
    err?.status === 0 ? h('p', { class: 'small' }, 'Internet aloqasini tekshiring.') : null,
    retry ? h('button', { class: 'btn primary', type: 'button', onclick: retry }, icon('refresh'), 'Qayta urinish') : null);
}

export function emptyBox(iconName, title, text, action) {
  return h('div', { class: 'card pad empty' }, icon(iconName), h('h3', {}, title), text ? h('p', {}, text) : null, action || null);
}

export function ring(percent, size = 120, label) {
  const r = 50; const c = 2 * Math.PI * r; const p = Math.max(0, Math.min(100, percent || 0));
  const wrap = document.createElement('div');
  wrap.style.width = size + 'px';
  wrap.innerHTML = `<svg viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label=""><circle cx="60" cy="60" r="${r}" fill="none" stroke="#E3ECEB" stroke-width="12"/><circle cx="60" cy="60" r="${r}" fill="none" stroke="#008C95" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(c * p) / 100} ${c}" transform="rotate(-90 60 60)"/></svg>`;
  wrap.firstChild.setAttribute('aria-label', label || `${p}%`);
  return wrap;
}

export function fmtMin(m) {
  if (m === null || m === undefined) return '—';
  if (m < 60) return `${Math.round(m)} daqiqa`;
  return `${Math.floor(m / 60)} soat ${Math.round(m % 60)} daq`;
}
const UZ_MON = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
export function fmtDate(iso, tz) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
    return `${parts.day}-${UZ_MON[+parts.month - 1]}, ${parts.hour}:${parts.minute}`;
  } catch { return iso; }
}
export const rid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36));
