export const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE_URL || "https://taskman.fnetrix.com/api";

export function normalizeApiBase(value) {
  const raw = (value || DEFAULT_API_BASE).trim();
  return raw.replace(/\/+$/, '');
}

export function isSecureApiBase(value) {
  const base = normalizeApiBase(value);
  return base.startsWith('https://') || base.startsWith('http://localhost') || base.startsWith('http://127.0.0.1');
}

export class ApiClient {
  constructor(getState, onUnauthorized) {
    this.getState = getState;
    this.onUnauthorized = onUnauthorized;
  }

  async request(path, options = {}) {
    const { token, apiBase } = this.getState();
    const response = await fetch(`${normalizeApiBase(apiBase)}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (response.status === 401 && this.onUnauthorized) {
      this.onUnauthorized();
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || data.message || 'Request failed');
    return data;
  }

  get(path) { return this.request(path); }
  post(path, body) { return this.request(path, { method: 'POST', body }); }
  patch(path, body) { return this.request(path, { method: 'PATCH', body }); }
  delete(path) { return this.request(path, { method: 'DELETE' }); }
}
