export const DEFAULT_API_BASE = 'http://localhost:8080/api';

function isLocalhostHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function normalizeApiBase(value) {
  const trimmed = (value || DEFAULT_API_BASE).trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/api')) return trimmed;
  return `${trimmed}/api`;
}

export function isSecureApiBase(value) {
  try {
    const url = new URL(normalizeApiBase(value));
    return url.protocol === 'https:' || isLocalhostHost(url.hostname);
  } catch {
    return false;
  }
}

export class ApiClient {
  constructor(getState, onUnauthorized) {
    this.getState = getState;
    this.onUnauthorized = onUnauthorized;
  }

  url(path) {
    const { apiBase } = this.getState();
    const base = normalizeApiBase(apiBase);
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async request(path, options = {}) {
    const { token } = this.getState();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(this.url(path), {
      ...options,
      headers,
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      if (response.status === 401 && this.onUnauthorized) this.onUnauthorized();
      const message = data?.detail || data?.message || response.statusText || 'Request failed';
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }
    return data || {};
  }

  get(path) {
    return this.request(path);
  }

  post(path, body) {
    return this.request(path, { method: 'POST', body });
  }

  patch(path, body) {
    return this.request(path, { method: 'PATCH', body });
  }

  delete(path) {
    return this.request(path, { method: 'DELETE' });
  }
}
