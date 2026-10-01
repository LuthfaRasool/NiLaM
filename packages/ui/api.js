/**
 * NiLaM API client.
 *
 * No DOM dependency, so the same module serves both the dashboard and the mobile
 * app. Holds the bearer token in memory with a sessionStorage fallback so a
 * refresh does not sign the user out.
 */

const TOKEN_KEY = 'nilam.token';

let token = null;
try {
  token = sessionStorage.getItem(TOKEN_KEY);
} catch {
  token = null;
}

export function getToken() {
  return token;
}

export function setToken(value) {
  token = value;
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the token simply lives in memory for this session */
  }
}

export class ApiError extends Error {
  constructor(status, payload) {
    const err = payload?.error || {};
    super(err.message || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = err.code || 'ERROR';
    this.details = err.details ?? null;
  }
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (networkError) {
    // A dropped connection is the normal case on a field handset, so it gets a
    // message that says what to do rather than a raw TypeError.
    throw new ApiError(0, {
      error: { code: 'NETWORK', message: 'Could not reach NiLaM. Check the connection; queued field work is not lost.' }
    });
  }

  let payload = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  del: (path) => request('DELETE', path),

  /* Auth */
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  logout: () => request('POST', '/api/auth/logout', {}),
  session: () => request('GET', '/api/auth/session'),

  /* Meta */
  meta: () => request('GET', '/api/meta'),
  reference: () => request('GET', '/api/reference'),
  health: () => request('GET', '/api/health'),

  /* Officer */
  queue: () => request('GET', '/api/queue'),
  caseDetail: (id) => request('GET', `/api/cases/${id}`),
  transition: (id, to, reason) => request('POST', `/api/cases/${id}/transition`, { to, reason }),
  search: (q) => request('GET', `/api/search?q=${encodeURIComponent(q)}`),
  runModels: (id) => request('POST', `/api/cases/${id}/models/run`, {}),

  /* Documents */
  documents: (id) => request('GET', `/api/cases/${id}/documents`),
  verifyDocument: (id) => request('GET', `/api/documents/${id}/verify`),
  issueDocument: (id) => request('POST', `/api/documents/${id}/issue`, {}),

  /* Government */
  overview: () => request('GET', '/api/government/overview'),

  /* Notifications and audit */
  notifications: () => request('GET', '/api/notifications'),
  audit: (limit = 100) => request('GET', `/api/audit?limit=${limit}`),
  verifyAudit: () => request('GET', '/api/audit/verify'),

  /* Citizen */
  myCases: () => request('GET', '/api/my/cases'),
  myCase: (id) => request('GET', `/api/my/cases/${id}`),
  consent: (id, decision, note) => request('POST', `/api/my/cases/${id}/consent`, { decision, note }),
  createRequest: (payload) => request('POST', '/api/requests', payload),

  /* Field verifier */
  assignments: () => request('GET', '/api/field/assignments'),
  submitCapture: (caseId, payload) => request('POST', `/api/cases/${caseId}/capture`, payload),
  sync: (clientId, items) => request('POST', '/api/field/sync', { clientId, items }),

  /* Models */
  models: () => request('GET', '/api/models')
};

/* ------------------------------------------------------------------ *
 * Offline queue
 *
 * The field app must survive having no signal. Captures are written to
 * localStorage immediately and replayed when the server is reachable. A queued
 * capture is never discarded on a failed send: only a 2xx or a 4xx that means
 * "this will never be accepted" removes it.
 * ------------------------------------------------------------------ */

const QUEUE_KEY = 'nilam.field.queue';

export const queue = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    } catch {
      return [];
    }
  },
  write(items) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    } catch {
      /* storage full or unavailable: the in-memory list still holds this session */
    }
    return items;
  },
  add(item) {
    const items = queue.read();
    items.push({ ...item, clientId: item.clientId || `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, queuedAt: new Date().toISOString() });
    return queue.write(items);
  },
  remove(clientIds) {
    const drop = new Set(clientIds);
    return queue.write(queue.read().filter((i) => !drop.has(i.clientId)));
  }
};
