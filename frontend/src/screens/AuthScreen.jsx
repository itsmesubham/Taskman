import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_API_BASE, isSecureApiBase, normalizeApiBase } from '../api/client.js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';

export default function AuthScreen() {
  const { session, updateSession } = useWorkspace();
  const [mode, setMode] = useState('login');
  const [tenantMode, setTenantMode] = useState('existing');
  const [apiBase, setApiBase] = useState(session.apiBase || DEFAULT_API_BASE);
  const [tenants, setTenants] = useState([]);
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const request = async (path, options = {}) => {
    if (!isSecureApiBase(apiBase)) throw new Error('Backend API URL must use HTTPS unless it is localhost.');
    const response = await fetch(`${normalizeApiBase(apiBase)}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Request failed');
    return data;
  };

  const loadTenants = useCallback(async () => {
    try {
      const suffix = tenantSearch.trim() ? `?search=${encodeURIComponent(tenantSearch.trim())}` : '';
      const result = await request(`/tenants${suffix}`);
      setTenants(result.tenants || []);
      if (!tenantId && result.tenants?.[0]) setTenantId(result.tenants[0].id);
    } catch (err) {
      setError(err.message);
    }
  }, [apiBase, tenantSearch, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(loadTenants, 250);
    return () => window.clearTimeout(timer);
  }, [loadTenants]);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = mode === 'login'
        ? { tenant_id: tenantId, email, password }
        : { name, email, password, ...(tenantMode === 'new' ? { tenant_name: tenantName } : { tenant_id: tenantId }) };
      const result = await request(mode === 'login' ? '/auth/login' : '/auth/signup', { method: 'POST', body: payload });
      updateSession({ apiBase: normalizeApiBase(apiBase), token: result.access_token, user: result.user, tenant: result.tenant });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-layout">
      <section className="auth-hero">
        <div className="hero-orb hero-orb-a" />
        <div className="hero-orb hero-orb-b" />
        <div className="hero-gridline" />
        <div className="brand-mark">T</div>
        <p className="eyebrow">Taskman for business teams</p>
        <h1>Plan work, manage sprints, and keep every tenant isolated.</h1>
        <p className="hero-copy">An enterprise workspace for product, engineering, operations, and leadership teams that need delivery clarity without Jira complexity.</p>
        <div className="hero-grid">
          <div><strong>Realtime</strong><span>SSE workspace sync</span></div>
          <div><strong>Agile</strong><span>Backlog + sprints</span></div>
          <div><strong>Secure</strong><span>Tenant isolation</span></div>
        </div>
      </section>

      <section className="auth-card">
        <div className="auth-card-glow" />
        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button>
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Signup</button>
        </div>

        <form onSubmit={submit} className="form-stack">
          <label>Backend API URL<input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="http://localhost:8080/api" /></label>
          <label>Find tenant<input value={tenantSearch} onChange={(event) => setTenantSearch(event.target.value)} placeholder="Search tenant" /></label>

          {mode === 'signup' && (
            <div className="segmented">
              <button type="button" className={tenantMode === 'existing' ? 'active' : ''} onClick={() => setTenantMode('existing')}>Join existing</button>
              <button type="button" className={tenantMode === 'new' ? 'active' : ''} onClick={() => setTenantMode('new')}>Create tenant</button>
            </div>
          )}

          {(mode === 'login' || tenantMode === 'existing') && (
            <label>Tenant<select value={tenantId} onChange={(event) => setTenantId(event.target.value)} required><option value="">Select tenant</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>
          )}
          {mode === 'signup' && tenantMode === 'new' && <label>New tenant name<input value={tenantName} onChange={(event) => setTenantName(event.target.value)} placeholder="Acme Operations" required /></label>}
          {mode === 'signup' && <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" required /></label>}
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Minimum 6 characters" required minLength={6} /></label>
          {error && <div className="inline-error">{error}</div>}
          <button className="primary full" disabled={busy}>{busy ? 'Please wait...' : mode === 'login' ? 'Login to workspace' : 'Create account'}</button>
        </form>
      </section>
    </div>
  );
}
