import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_API_BASE, ApiClient } from '../api/client.js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';

export default function AuthScreen() {
  const { updateSession, inviteCode } = useWorkspace();
  const [mode, setMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const emailRef = useRef(null);
  const nameRef = useRef(null);
  const authClient = useRef(new ApiClient(() => ({ token: null, apiBase: DEFAULT_API_BASE }))).current;

  useEffect(() => {
    window.requestAnimationFrame(() => {
      if (mode === 'login') {
        emailRef.current?.focus();
      } else {
        nameRef.current?.focus();
      }
    });
  }, [mode]);

  const submit = useCallback(async (event) => {
    event.preventDefault();
    setError('');
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      const payload = mode === 'login'
        ? { email, password }
        : { name: fullName, email, password };
      const result = await authClient.post(mode === 'login' ? '/auth/login' : '/auth/signup', payload);
      const memberships = result.memberships || [];
      const preferredTenantId = result.user?.active_tenant_id || memberships[0]?.tenant_id || null;
      const preferredMembership = memberships.find((membership) => membership.tenant_id === preferredTenantId) || memberships[0] || null;
      const activeTenant = preferredMembership ? {
        id: preferredMembership.tenant_id,
        name: preferredMembership.tenant_name || 'Workspace',
        slug: preferredMembership.tenant_slug || ''
      } : null;
      updateSession({
        apiBase: DEFAULT_API_BASE,
        token: result.access_token,
        user: result.user,
        tenant: activeTenant,
        memberships
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [authClient, confirmPassword, email, fullName, mode, password, updateSession]);

  return (
    <div className="auth-layout">
      <section className="auth-hero">
        <div className="auth-hero-grid" />
        <div className="hero-orb hero-orb-a" />
        <div className="hero-orb hero-orb-b" />
        <div className="hero-gridline" />
        <div className="auth-hero-content">
          <div className="brand-mark">T</div>
          <p className="eyebrow">TASKMAN FOR MODERN TEAMS</p>
          <h1>Plan work. Ship faster. Stay in sync.</h1>
          <p className="hero-copy">Taskman helps teams manage tasks, sprints, priorities, and ownership without Jira complexity.</p>
          <div className="hero-pills">
            <span>Realtime board sync</span>
            <span>Monthly auto-sprints</span>
            <span>Tenant-isolated workspaces</span>
            <span>Fast task creation</span>
            <span>Team assignments</span>
            <span>Reports & tracking</span>
          </div>
        </div>
        <div className="floating-stack">
          <div className="floating-card floating-card-a">
            <strong>Q2 Launch</strong>
            <span>12 tasks moved today</span>
          </div>
          <div className="floating-card floating-card-b">
            <strong>June Sprint</strong>
            <span>On track · 84% complete</span>
          </div>
          <div className="floating-card floating-card-c">
            <strong>Design Review</strong>
            <span>3 items waiting for approval</span>
          </div>
        </div>
      </section>

      <section className="auth-card">
        <div className="auth-card-glow" />
        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setConfirmPassword(''); }}>Login</button>
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setConfirmPassword(''); }}>Signup</button>
        </div>

        {inviteCode && (
          <div className="invite-preview auth-invite-note">
            <strong>Invite link detected</strong>
            <span>Sign in to continue joining your workspace.</span>
          </div>
        )}

        <form onSubmit={submit} className="form-stack">
          {mode === 'signup' && (
            <label>
              Full name
              <input
                ref={nameRef}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Your name"
                autoComplete="name"
                required
              />
            </label>
          )}
          <label>
            Email
            <input
              ref={emailRef}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Minimum 6 characters"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={6}
            />
          </label>
          {mode === 'signup' && (
            <label>
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repeat your password"
                autoComplete="new-password"
                required
                minLength={6}
              />
            </label>
          )}
          {error && <div className="inline-error">{error}</div>}
          <button className="primary full auth-submit" disabled={busy}>{busy ? 'Please wait...' : mode === 'login' ? 'Login to workspace' : 'Create account'}</button>
        </form>
      </section>
    </div>
  );
}
