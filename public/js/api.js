// Fetch wrapper: JSON in/out, CSRF header, uniform errors.
export class ApiErr extends Error {
  constructor(status, body) {
    super(body?.message || (status === 0 ? 'Tarmoq xatosi: serverga ulanib bo‘lmadi.' : 'Xato yuz berdi.'));
    this.status = status; this.code = body?.code; this.fieldErrors = body?.fieldErrors; this.body = body;
  }
}

const demo = () => (typeof window !== 'undefined' && window.DS_DEMO ? import('./demo-api.js') : null);

export async function api(path, { method = 'GET', body, signal } = {}) {
  const d = demo();
  if (d) return (await d).demoApi(path, { method, body });
  let res;
  try {
    res = await fetch(path, {
      method, signal, credentials: 'same-origin',
      headers: { 'x-requested-with': 'drstudy', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiErr(0, null);
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new CustomEvent('ds:unauth'));
    throw new ApiErr(res.status, data);
  }
  return data;
}
export const get = (p, o) => api(p, o);
export const post = (p, body, o) => api(p, { ...o, method: 'POST', body: body ?? {} });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });

// Server-sent events over POST (fetch streaming).
export async function streamPost(path, body, { onEvent, signal }) {
  const d = demo();
  if (d) return (await d).demoStream(path, body, { onEvent, signal });
  const res = await fetch(path, { method: 'POST', signal, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-requested-with': 'drstudy' }, body: JSON.stringify(body) });
  if (!res.ok) {
    let data = null; try { data = await res.json(); } catch { /* */ }
    throw new ApiErr(res.status, data);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(chunk)?.[1];
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (ev && data) onEvent(ev, JSON.parse(data));
    }
  }
}
