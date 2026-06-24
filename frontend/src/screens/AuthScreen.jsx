import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_API_BASE, ApiClient } from '../api/client.js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { buildAuthSessionFromResult, buildInviteAcceptedSession } from '../utils/workspaceSession.js';

export default function AuthScreen() {
  const { updateSession, inviteCode, navigate } = useWorkspace();
  const { themePreference, setThemePreference, resolvedTheme } = useTheme();
  const [mode, setMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const emailRef = useRef(null);
  const nameRef = useRef(null);
  const themeMenuRef = useRef(null);
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

  useEffect(() => {
    const onDown = (event) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(event.target)) {
        setThemeMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  const submit = useCallback(async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = mode === 'login'
        ? { email, password }
        : { name: fullName, email, password };
      const result = await authClient.post(mode === 'login' ? '/auth/login' : '/auth/signup', payload);
      const baseSession = buildAuthSessionFromResult(result, DEFAULT_API_BASE);

      if (inviteCode) {
        const inviteClient = new ApiClient(() => ({ token: result.access_token, apiBase: DEFAULT_API_BASE }));
        const inviteResult = await inviteClient.post(`/invites/${inviteCode}/accept`, {});
        updateSession(buildInviteAcceptedSession(baseSession, inviteResult));
        navigate('/');
        return;
      }

      updateSession(baseSession);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [authClient, email, fullName, mode, password, updateSession]);

  const themeLabel = useMemo(() => {
    if (themePreference === 'system') return `System · ${resolvedTheme === 'dark' ? 'Dark' : 'Light'}`;
    return themePreference === 'dark' ? 'Dark' : 'Light';
  }, [resolvedTheme, themePreference]);

  const heroPills = [
    'AI-pickable tasks',
    'GitHub PR tracking',
    'Human review flow',
    'Sprint planning',
    'Agent activity logs'
  ];

  const queueRows = [
    { key: 'TASK-124', title: 'Fix sprint issue count bug', actor: 'Codex', status: 'PR Open', badges: ['AI working', 'PR open'] },
    { key: 'TASK-125', title: 'Polish backlog UI', actor: 'AI Designer', status: 'Review', badges: ['Changes requested', 'Needs review'] },
    { key: 'TASK-126', title: 'Add GitHub webhook', actor: 'Unassigned', status: 'Ready', badges: ['Ready'] }
  ];

  const boardCols = ['Todo', 'In Progress', 'Review', 'Done'];

  return (
    <div className="auth-page">
      <header className="auth-topbar">
        <div className="brand-lockup">
          <div className="brand-mark">T</div>
          <div>
            <strong>Taskman</strong>
            <span>AI-native work execution</span>
          </div>
        </div>
        <div className="theme-switcher" ref={themeMenuRef}>
          <button
            type="button"
            className="theme-switcher-trigger"
            aria-haspopup="menu"
            aria-expanded={themeMenuOpen}
            onClick={() => setThemeMenuOpen((current) => !current)}
          >
            <span>{themeLabel}</span>
            <span aria-hidden="true">⌄</span>
          </button>
          {themeMenuOpen && (
            <div className="theme-switcher-menu" role="menu" aria-label="Theme selection">
              {[
                ['system', 'System'],
                ['light', 'Light'],
                ['dark', 'Dark']
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={themePreference === key ? 'active' : ''}
                  onClick={() => {
                    setThemePreference(key);
                    setThemeMenuOpen(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="auth-shell">
        <section className="auth-hero">
          <div className="auth-grid" />
          <div className="aurora-orb aurora-orb-a" />
          <div className="aurora-orb aurora-orb-b" />
          <div className="aurora-orb aurora-orb-c" />
          <div className="auth-hero-content">
            <p className="eyebrow">AI-NATIVE WORK EXECUTION</p>
            <h1>Plan work. Let AI agents pick tasks. Review the output.</h1>
            <p className="hero-copy">Taskman helps teams manage tasks, sprints, PRs, and AI-agent execution in one focused workspace.</p>
            <div className="hero-pills">
              {heroPills.map((pill) => <span key={pill}>{pill}</span>)}
            </div>
          </div>

          <div className="floating-stack">
            <div className="floating-card metric-card-elevated">
              <strong>Taskman signal</strong>
              <span>AI and humans collaborating in one reviewable workflow</span>
            </div>
            <div className="preview-panel">
              <div className="preview-header">
                <div>
                  <span>AI Agent Queue</span>
                  <strong>Live execution preview</strong>
                </div>
                <div className="status-pill in_review">Active</div>
              </div>
              <div className="preview-list">
                {queueRows.map((row) => (
                  <div className="preview-row" key={row.key}>
                    <div className="preview-row-main">
                      <strong>{row.key}</strong>
                      <span>{row.title}</span>
                    </div>
                    <div className="preview-row-badges">
                      {row.badges.map((badge) => (
                        <span key={badge} className={`preview-chip ${badge.toLowerCase().replace(/\s+/g, '-')}`}>{badge}</span>
                      ))}
                    </div>
                    <div className="preview-row-meta">
                      <span>{row.actor}</span>
                      <span className={`preview-chip ${row.status.toLowerCase().replace(/\s+/g, '-')}`}>{row.status}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mini-board">
                {boardCols.map((col) => (
                  <div key={col}>
                    <span>{col}</span>
                    <b />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="auth-card">
          <div className="auth-card-glow" />
          <div className="auth-card-head">
            <div className="auth-badge">Taskman</div>
            <div>
              <h2>{mode === 'login' ? 'Welcome back' : 'Create your workspace account'}</h2>
              <p>{mode === 'login' ? 'Continue building with your team and AI agents.' : 'Start managing human and AI work in one place.'}</p>
            </div>
          </div>

          <div className="auth-tabs">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button>
            <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Signup</button>
          </div>

          {inviteCode && (
            <div className="invite-preview auth-invite-note">
              <strong>Invite link detected</strong>
              <span>Sign in to continue joining your workspace.</span>
            </div>
          )}

          <form onSubmit={submit} className="form-stack auth-form">
            {mode === 'signup' && (
              <label>
                Name
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
                placeholder={mode === 'login' ? 'Enter your password' : 'Create a password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={6}
              />
            </label>
            {error && <div className="inline-error">{error}</div>}
            <button className="primary full auth-submit" disabled={busy}>{busy ? 'Please wait...' : mode === 'login' ? 'Login to workspace' : 'Create account'}</button>
          </form>
          <p className="auth-switch-copy">
            {mode === 'login' ? 'Need an account?' : 'Already have an account?'}
            <button type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
              {mode === 'login' ? 'Switch to signup' : 'Switch to login'}
            </button>
          </p>
        </section>
      </main>
    </div>
  );
}
