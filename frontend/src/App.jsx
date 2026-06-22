import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar as ProSidebar, Menu, MenuItem, sidebarClasses, menuClasses } from 'react-pro-sidebar';
import { ApiClient, DEFAULT_API_BASE, isSecureApiBase, normalizeApiBase } from './api.js';

const STATUSES = [
  { key: 'TODO', label: 'To do' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'IN_REVIEW', label: 'In review' },
  { key: 'BLOCKED', label: 'Blocked' },
  { key: 'DONE', label: 'Done' }
];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const TYPES = ['TASK', 'BUG', 'STORY', 'EPIC', 'IMPROVEMENT'];
const SPRINT_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED'];

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatDate(value) {
  if (!value) return 'No date';
  try {
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
  } catch {
    return value;
  }
}

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';
}

function cx(...values) {
  return values.filter(Boolean).join(' ');
}

function priorityClass(priority) {
  return `priority priority-${String(priority || 'MEDIUM').toLowerCase()}`;
}

function statusLabel(status) {
  return STATUSES.find((item) => item.key === status)?.label || status;
}

function metricValue(value) {
  if (value === null || value === undefined) return 0;
  return Number(value) || 0;
}

function App() {
  const [session, setSession] = useState(() => readJson('taskman_session', {
    token: null,
    user: null,
    tenant: null,
    apiBase: DEFAULT_API_BASE
  }));
  const [page, setPage] = useState('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readJson('taskman_sidebar_collapsed', false));
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [eventStatus, setEventStatus] = useState('offline');

  const [projects, setProjects] = useState([]);
  const [issues, setIssues] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [members, setMembers] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [activeProjectId, setActiveProjectId] = useState(() => localStorage.getItem('taskman_active_project') || '');
  const [boardSprintId, setBoardSprintId] = useState('active');
  const [query, setQuery] = useState('');
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [comments, setComments] = useState([]);
  const [draggedIssueId, setDraggedIssueId] = useState(null);
  const refreshTimer = useRef(null);

  const getApiState = useCallback(() => ({ token: session.token, apiBase: session.apiBase || DEFAULT_API_BASE }), [session]);
  const handleUnauthorized = useCallback(() => {
    setToast({ type: 'error', text: 'Session expired. Please login again.' });
    setSession((current) => ({ ...current, token: null, user: null, tenant: null }));
  }, []);
  const api = useMemo(() => new ApiClient(getApiState, handleUnauthorized), [getApiState, handleUnauthorized]);

  const updateSession = useCallback((next) => {
    setSession(next);
    saveJson('taskman_session', next);
  }, []);

  const showError = useCallback((error) => {
    setToast({ type: 'error', text: error?.message || 'Something went wrong' });
  }, []);

  const showSuccess = useCallback((text) => {
    setToast({ type: 'success', text });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const loadWorkspace = useCallback(async (silent = false) => {
    if (!session.token) return;
    if (!isSecureApiBase(session.apiBase || DEFAULT_API_BASE)) {
      showError(new Error('Backend API URL must use HTTPS unless it is localhost.'));
      return;
    }
    if (!silent) setLoading(true);
    try {
      const [projectRes, sprintRes, issueRes, reportRes] = await Promise.all([
        api.get('/projects'),
        api.get('/sprints'),
        api.get('/issues'),
        api.get('/reports/dashboard')
      ]);
      const nextProjects = projectRes.projects || [];
      setProjects(nextProjects);
      setSprints(sprintRes.sprints || []);
      setIssues(issueRes.issues || []);
      setDashboard(reportRes || null);

      const currentProjectStillExists = nextProjects.some((project) => project.id === activeProjectId);
      if (!activeProjectId || !currentProjectStillExists) {
        const first = nextProjects[0]?.id || '';
        setActiveProjectId(first);
        if (first) localStorage.setItem('taskman_active_project', first);
      }

      if (session.tenant?.id) {
        try {
          const memberRes = await api.get(`/tenants/${session.tenant.id}/members`);
          setMembers(memberRes.members || []);
        } catch {
          setMembers([]);
        }
      }
    } catch (error) {
      showError(error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeProjectId, api, session.token, session.tenant?.id, showError]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!session.token) return undefined;
    if (!isSecureApiBase(session.apiBase || DEFAULT_API_BASE)) return undefined;
    const streamUrl = `${normalizeApiBase(session.apiBase)}/events/stream?token=${encodeURIComponent(session.token)}`;
    const source = new EventSource(streamUrl);
    setEventStatus('connecting');

    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => loadWorkspace(true), 300);
    };

    source.addEventListener('connected', () => setEventStatus('live'));
    source.addEventListener('heartbeat', () => setEventStatus('live'));
    source.onerror = () => setEventStatus('reconnecting');

    [
      'project_created', 'project_updated', 'project_archived',
      'issue_created', 'issue_updated', 'issue_deleted', 'issues_reordered',
      'sprint_created', 'sprint_updated', 'sprint_started', 'sprint_completed',
      'issues_added_to_sprint', 'comment_created', 'member_added'
    ].forEach((eventName) => {
      source.addEventListener(eventName, scheduleRefresh);
    });

    return () => {
      window.clearTimeout(refreshTimer.current);
      source.close();
      setEventStatus('offline');
    };
  }, [loadWorkspace, session.apiBase, session.token]);

  const activeProject = projects.find((project) => project.id === activeProjectId) || null;
  const projectSprints = sprints.filter((sprint) => !activeProjectId || sprint.project_id === activeProjectId);
  const activeSprint = projectSprints.find((sprint) => sprint.status === 'ACTIVE') || null;
  const selectedBoardSprintId = boardSprintId === 'active' ? activeSprint?.id || '' : boardSprintId;

  const projectIssues = issues.filter((issue) => !activeProjectId || issue.project_id === activeProjectId);
  const visibleIssues = projectIssues.filter((issue) => {
    const search = query.trim().toLowerCase();
    if (!search) return true;
    return [issue.title, issue.issue_key, issue.description, issue.priority, issue.status, issue.assignee_name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
  });
  const backlogIssues = visibleIssues.filter((issue) => issue.status === 'BACKLOG' || !issue.sprint_id);
  const boardIssues = visibleIssues.filter((issue) => {
    if (issue.status === 'BACKLOG') return false;
    if (!selectedBoardSprintId || selectedBoardSprintId === 'all') return true;
    return issue.sprint_id === selectedBoardSprintId;
  });

  const logout = () => {
    updateSession({ token: null, user: null, tenant: null, apiBase: session.apiBase || DEFAULT_API_BASE });
    setProjects([]);
    setIssues([]);
    setSprints([]);
    setMembers([]);
    setDashboard(null);
    setSelectedIssue(null);
  };

  useEffect(() => {
    saveJson('taskman_sidebar_collapsed', sidebarCollapsed);
  }, [sidebarCollapsed]);

  const createProject = async (payload) => {
    try {
      const result = await api.post('/projects', payload);
      showSuccess('Project created');
      await loadWorkspace(true);
      if (result.project?.id) {
        setActiveProjectId(result.project.id);
        localStorage.setItem('taskman_active_project', result.project.id);
      }
    } catch (error) {
      showError(error);
    }
  };

  const createIssue = async (payload) => {
    try {
      await api.post('/issues', payload);
      showSuccess('Issue created');
      await loadWorkspace(true);
    } catch (error) {
      showError(error);
    }
  };

  const updateIssue = async (issueId, payload) => {
    try {
      const result = await api.patch(`/issues/${issueId}`, payload);
      setIssues((current) => current.map((issue) => issue.id === issueId ? { ...issue, ...result.issue } : issue));
      if (selectedIssue?.id === issueId) setSelectedIssue((current) => ({ ...current, ...result.issue }));
      showSuccess('Issue updated');
      await loadWorkspace(true);
    } catch (error) {
      showError(error);
    }
  };

  const deleteIssue = async (issueId) => {
    if (!window.confirm('Delete this issue?')) return;
    try {
      await api.delete(`/issues/${issueId}`);
      setSelectedIssue(null);
      showSuccess('Issue deleted');
      await loadWorkspace(true);
    } catch (error) {
      showError(error);
    }
  };

  const moveIssueStatus = async (issueId, status) => {
    const previous = issues;
    setIssues((current) => current.map((issue) => issue.id === issueId ? { ...issue, status, position: Date.now() } : issue));
    try {
      await api.patch(`/issues/${issueId}/status`, { status, position: Date.now() });
      await loadWorkspace(true);
    } catch (error) {
      setIssues(previous);
      showError(error);
    }
  };

  const createSprint = async (payload) => {
    try {
      await api.post('/sprints', payload);
      showSuccess('Sprint created');
      await loadWorkspace(true);
    } catch (error) {
      showError(error);
    }
  };

  const startSprint = async (sprintId) => {
    try {
      await api.post(`/sprints/${sprintId}/start`, {});
      showSuccess('Sprint started');
      await loadWorkspace(true);
    } catch (error) {
      showError(error);
    }
  };

  const completeSprint = async (sprintId) => {
    try {
      await api.post(`/sprints/${sprintId}/complete`, { incomplete_strategy: 'BACKLOG' });
      showSuccess('Sprint completed');
      await loadWorkspace(true);
    } catch (error) {
      showError(error);
    }
  };

  const addIssuesToSprint = async (sprintId, issueIds) => {
    if (!sprintId || issueIds.length === 0) return;
    try {
      await api.post(`/sprints/${sprintId}/issues`, { issue_ids: issueIds });
      showSuccess('Issues added to sprint');
      await loadWorkspace(true);
    } catch (error) {
      showError(error);
    }
  };

  const loadComments = async (issueId) => {
    try {
      const result = await api.get(`/issues/${issueId}/comments`);
      setComments(result.comments || []);
    } catch (error) {
      showError(error);
    }
  };

  useEffect(() => {
    if (selectedIssue?.id) loadComments(selectedIssue.id);
  }, [selectedIssue?.id]);

  const addComment = async (issueId, body) => {
    try {
      await api.post(`/issues/${issueId}/comments`, { body });
      await loadComments(issueId);
      showSuccess('Comment added');
    } catch (error) {
      showError(error);
    }
  };

  const value = {
    session,
    updateSession,
    api,
    page,
    setPage,
    projects,
    issues,
    sprints,
    members,
    dashboard,
    activeProject,
    activeProjectId,
    setActiveProjectId: (id) => {
      setActiveProjectId(id);
      localStorage.setItem('taskman_active_project', id || '');
    },
    activeSprint,
    projectSprints,
    selectedBoardSprintId,
    boardSprintId,
    setBoardSprintId,
    query,
    setQuery,
    backlogIssues,
    boardIssues,
    visibleIssues,
    loading,
    eventStatus,
    loadWorkspace,
    createProject,
    createIssue,
    updateIssue,
    deleteIssue,
    moveIssueStatus,
    createSprint,
    startSprint,
    completeSprint,
    addIssuesToSprint,
    selectedIssue,
    setSelectedIssue,
    comments,
    addComment,
    draggedIssueId,
    setDraggedIssueId,
    showError,
    showSuccess,
    logout
  };

  if (!session.token) {
    return <AuthScreen session={session} updateSession={updateSession} />;
  }

  return (
    <AppContext.Provider value={value}>
      <div className="app-shell" style={{ '--sidebar-width': sidebarCollapsed ? '92px' : '280px' }}>
        <WorkspaceSidebar
          open={mobileNavOpen}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
          onClose={() => setMobileNavOpen(false)}
        />
        <main className="main-area">
          <Topbar onMenu={() => setMobileNavOpen(true)} />
          <div className="content-wrap">
            <WorkspaceGate>
              {page === 'dashboard' && <Dashboard />}
              {page === 'projects' && <ProjectsPage />}
              {page === 'backlog' && <BacklogPage />}
              {page === 'board' && <BoardPage />}
              {page === 'sprints' && <SprintsPage />}
              {page === 'reports' && <ReportsPage />}
              {page === 'ai' && <AiPage />}
              {page === 'settings' && <SettingsPage />}
            </WorkspaceGate>
          </div>
        </main>
        <MobileBottomNav />
        {selectedIssue && <IssueDrawer />}
        {toast && <div className={cx('toast', toast.type)}>{toast.text}</div>}
      </div>
    </AppContext.Provider>
  );
}

const AppContext = createContext(null);

function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppContext.Provider');
  return value;
}

function AuthScreen({ session, updateSession }) {
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
    if (!isSecureApiBase(apiBase)) {
      throw new Error('Backend API URL must use HTTPS unless it is localhost.');
    }
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
        : {
            name,
            email,
            password,
            ...(tenantMode === 'new' ? { tenant_name: tenantName } : { tenant_id: tenantId })
          };
      const result = await request(mode === 'login' ? '/auth/login' : '/auth/signup', {
        method: 'POST',
        body: payload
      });
      updateSession({
        apiBase: normalizeApiBase(apiBase),
        token: result.access_token,
        user: result.user,
        tenant: result.tenant
      });
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
        <h1>Plan sprints, manage delivery, and keep every tenant isolated.</h1>
        <p className="hero-copy">A clean Jira-like workspace for founders, engineering, operations, and product teams. Built for multi-tenant SaaS workflows.</p>
        <div className="hero-grid">
          <div><strong>Realtime</strong><span>SSE updates</span></div>
          <div><strong>Agile</strong><span>Backlog + sprints</span></div>
          <div><strong>Secure</strong><span>Tenant isolation</span></div>
        </div>
        <div className="hero-band">
          <div>
            <strong>24/7</strong>
            <span>Live workspace sync</span>
          </div>
          <div>
            <strong>Fast</strong>
            <span>Planning to delivery flow</span>
          </div>
          <div>
            <strong>Focused</strong>
            <span>One project, one sprint at a time</span>
          </div>
        </div>
      </section>

      <section className="auth-card">
        <div className="auth-card-glow" />
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Signup</button>
        </div>

        <form onSubmit={submit} className="form-stack">
          <label>
            Backend API URL
            <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="http://localhost:8080/api" />
          </label>

          <label>
            Find tenant
            <input value={tenantSearch} onChange={(event) => setTenantSearch(event.target.value)} placeholder="Search tenant" />
          </label>

          {mode === 'signup' && (
            <div className="segmented">
              <button type="button" className={tenantMode === 'existing' ? 'active' : ''} onClick={() => setTenantMode('existing')}>Join existing</button>
              <button type="button" className={tenantMode === 'new' ? 'active' : ''} onClick={() => setTenantMode('new')}>Create tenant</button>
            </div>
          )}

          {(mode === 'login' || tenantMode === 'existing') && (
            <label>
              Tenant
              <select value={tenantId} onChange={(event) => setTenantId(event.target.value)} required>
                <option value="">Select tenant</option>
                {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
              </select>
            </label>
          )}

          {mode === 'signup' && tenantMode === 'new' && (
            <label>
              New tenant name
              <input value={tenantName} onChange={(event) => setTenantName(event.target.value)} placeholder="Acme Operations" required />
            </label>
          )}

          {mode === 'signup' && (
            <label>
              Full name
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" required />
            </label>
          )}

          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Minimum 6 characters" required minLength={6} />
          </label>

          {error && <div className="inline-error">{error}</div>}
          <button className="primary full" disabled={busy}>{busy ? 'Please wait...' : mode === 'login' ? 'Login to workspace' : 'Create account'}</button>
        </form>
      </section>
    </div>
  );
}

function WorkspaceSidebar({ open, collapsed, onClose, onToggleCollapsed }) {
  const { page, setPage, session, logout } = useApp();
  const items = [
    ['sprints', 'Sprint Planning', '◷'],
    ['dashboard', 'Dashboard', '▦'],
    ['projects', 'Projects', '□'],
    ['backlog', 'Backlog', '☰'],
    ['board', 'Board', '⇄'],
    ['reports', 'Reports', '◌'],
    ['ai', 'AI Planner', '✦'],
    ['settings', 'Settings', '⚙']
  ];

  const menuItemStyles = {
    root: {
      margin: '0 0 6px'
    },
    button: ({ active }) => ({
      backgroundColor: active ? 'rgba(96,165,250,.16)' : 'transparent',
      color: active ? '#ffffff' : '#d7e2f0',
      borderRadius: '14px',
      padding: '12px 14px',
      fontWeight: 800,
      border: active ? '1px solid rgba(96,165,250,.18)' : '1px solid transparent',
      boxShadow: active ? '0 10px 24px rgba(59,130,246,.14)' : 'none',
      transition: 'background-color 160ms ease, color 160ms ease',
      '&:hover': {
        backgroundColor: 'rgba(255,255,255,.08)',
        color: '#fff'
      }
    }),
    icon: {
      color: '#7dd3fc'
    },
    label: {
      fontWeight: 800
    }
  };

  return (
    <ProSidebar
      collapsed={collapsed}
      toggled={open}
      breakPoint="md"
      width="280px"
      collapsedWidth="92px"
      transitionDuration={220}
      onBackdropClick={onClose}
      rootStyles={{
        background: 'linear-gradient(180deg, #0b1220 0%, #111827 100%)',
        color: '#fff',
        borderRight: '1px solid rgba(148,163,184,.14)',
        height: '100vh',
        overflow: 'hidden',
        [`& .${sidebarClasses.container}`]: {
          background: 'linear-gradient(180deg, #0b1220 0%, #111827 100%)',
          color: '#fff'
        }
      }}
    >
      <div className="sidebar-shell">
        <div className="sidebar-brand">
          <div className="brand-mark small">T</div>
          {!collapsed && (
            <div className="sidebar-brand-copy">
              <strong>Taskman</strong>
              <span>{session.tenant?.name || 'Workspace'}</span>
            </div>
          )}
          <button type="button" className="icon-btn mobile-only sidebar-mobile-close" onClick={onClose}>×</button>
        </div>
        <Menu
          closeOnClick
          menuItemStyles={menuItemStyles}
          rootStyles={{
            padding: '8px 10px 0',
            flex: 1,
            overflowY: 'auto',
            background: 'transparent',
            [`& .${menuClasses.root}`]: {
              background: 'transparent'
            },
            [`& .${menuClasses.button}`]: {
              background: 'transparent'
            }
          }}
        >
          {items.map(([key, label, icon]) => (
            <MenuItem
              key={key}
              active={page === key}
              icon={<span className="sidebar-menu-icon">{icon}</span>}
              onClick={() => { setPage(key); onClose?.(); }}
            >
              {label}
            </MenuItem>
          ))}
        </Menu>
        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">{initials(session.user?.name)}</div>
            {!collapsed && (
              <div className="user-chip-copy"><strong>{session.user?.name}</strong><span>{session.user?.role}</span></div>
            )}
          </div>
          <div className="sidebar-footer-actions">
            <button
              type="button"
              className="ghost full sidebar-toggle-btn desktop-only"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <span>{collapsed ? '»' : '«'}</span>
              {!collapsed && <span className="sidebar-toggle-label">{collapsed ? 'Expand menu' : 'Collapse menu'}</span>}
            </button>
            <button type="button" className="ghost full" onClick={logout}>Logout</button>
          </div>
        </div>
      </div>
    </ProSidebar>
  );
}

function Topbar({ onMenu }) {
  const { activeProjectId, setActiveProjectId, projects, activeProject, query, setQuery, eventStatus, loading, loadWorkspace } = useApp();
  return (
    <header className="topbar">
      <button className="icon-btn mobile-only" onClick={onMenu}>☰</button>
      <div className="project-switcher">
        <span>Project</span>
        <select value={activeProjectId} onChange={(event) => setActiveProjectId(event.target.value)}>
          <option value="">All projects</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}
        </select>
      </div>
      <div className="global-search">
        <span>⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${activeProject?.key || 'workspace'} issues`} />
      </div>
      <button className="ghost" onClick={() => loadWorkspace()}>{loading ? 'Syncing...' : 'Refresh'}</button>
      <span className={cx('realtime-pill', eventStatus)}>{eventStatus}</span>
    </header>
  );
}

function WorkspaceGate({ children }) {
  const { projects, page, setPage } = useApp();
  if (projects.length || page === 'projects' || page === 'settings') return children;
  return (
    <div className="empty-state full-height">
      <div className="empty-illustration">□</div>
      <h2>Create your first project</h2>
      <p>Projects organize backlog, sprints, board, reports, and delivery activity for a tenant.</p>
      <button className="primary" onClick={() => setPage('projects')}>Create project</button>
    </div>
  );
}

function Dashboard() {
  const { dashboard, activeSprint, backlogIssues, boardIssues, activeProject } = useApp();
  const summary = dashboard?.summary || {};
  const cards = [
    ['Projects', metricValue(summary.total_projects), 'Active workspaces inside this tenant'],
    ['Open issues', Math.max(metricValue(summary.total_issues) - metricValue(summary.done_issues), 0), 'Everything not done'],
    ['Blocked', metricValue(summary.blocked_issues), 'Needs management attention'],
    ['High priority', metricValue(summary.high_priority_issues), 'High and urgent issues'],
    ['Done points', `${metricValue(summary.done_points)}/${metricValue(summary.total_points)}`, 'Story point progress'],
    ['Backlog', backlogIssues.length, 'Unplanned work']
  ];
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Command center"
        title={activeProject ? `${activeProject.name} dashboard` : 'Tenant dashboard'}
        description="Track delivery health, sprint execution, workload, blockers, and recent activity."
      />
      <div className="metric-grid">
        {cards.map(([label, value, helper]) => <MetricCard key={label} label={label} value={value} helper={helper} />)}
      </div>
      <div className="two-col">
        <section className="panel">
          <div className="panel-head"><h3>Active sprint</h3><span>{activeSprint?.name || 'No active sprint'}</span></div>
          {activeSprint ? (
            <div>
              <div className="progress-line"><span style={{ width: `${activeSprint.issue_count ? Math.round((activeSprint.done_count / activeSprint.issue_count) * 100) : 0}%` }} /></div>
              <div className="sprint-summary-row"><strong>{activeSprint.done_count || 0}/{activeSprint.issue_count || 0}</strong><span>issues done</span></div>
              <p className="muted">{activeSprint.goal || 'No goal added yet.'}</p>
            </div>
          ) : <p className="muted">Create and start a sprint from the Sprints page.</p>}
        </section>
        <section className="panel">
          <div className="panel-head"><h3>Recent activity</h3><span>{dashboard?.recent_activity?.length || 0} events</span></div>
          <ActivityList items={dashboard?.recent_activity || []} />
        </section>
      </div>
      <section className="panel">
        <div className="panel-head"><h3>Current board snapshot</h3><span>{boardIssues.length} board issues</span></div>
        <MiniDistribution />
      </section>
    </div>
  );
}

function ProjectsPage() {
  const { projects, createProject, activeProjectId, setActiveProjectId } = useApp();
  const [formOpen, setFormOpen] = useState(projects.length === 0);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    await createProject({ name, key, description });
    setName('');
    setKey('');
    setDescription('');
    setFormOpen(false);
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Workspace setup" title="Projects" description="Create business projects and switch between them from the top bar." action={<button className="primary" onClick={() => setFormOpen(!formOpen)}>{formOpen ? 'Close' : 'New project'}</button>} />
      {formOpen && (
        <section className="panel form-panel">
          <form className="form-grid" onSubmit={submit}>
            <label>Project name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer App" required /></label>
            <label>Key<input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="CAPP" /></label>
            <label className="wide">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this project owns" /></label>
            <div className="form-actions wide"><button className="primary">Create project</button></div>
          </form>
        </section>
      )}
      <div className="project-grid">
        {projects.map((project) => (
          <button key={project.id} className={cx('project-card', activeProjectId === project.id && 'active')} onClick={() => setActiveProjectId(project.id)}>
            <span className="project-key">{project.key}</span>
            <h3>{project.name}</h3>
            <p>{project.description || 'No description'}</p>
            <small>{project.status}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function BacklogPage() {
  const { activeProject, backlogIssues, projectSprints, createIssue, addIssuesToSprint, setSelectedIssue } = useApp();
  const [selected, setSelected] = useState([]);
  const [targetSprint, setTargetSprint] = useState('');
  const plannedSprints = projectSprints.filter((sprint) => sprint.status !== 'COMPLETED');

  useEffect(() => {
    if (!targetSprint && plannedSprints[0]) setTargetSprint(plannedSprints[0].id);
  }, [plannedSprints, targetSprint]);

  const toggle = (issueId) => {
    setSelected((current) => current.includes(issueId) ? current.filter((id) => id !== issueId) : [...current, issueId]);
  };

  const addSelected = async () => {
    await addIssuesToSprint(targetSprint, selected);
    setSelected([]);
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Planning" title="Backlog" description="Capture ideas, bugs, and improvements before assigning them to a sprint." />
      <CreateIssuePanel defaultStatus="BACKLOG" onCreate={createIssue} projectId={activeProject?.id} />
      <section className="panel">
        <div className="panel-head wrap">
          <div><h3>Backlog items</h3><span>{backlogIssues.length} issues</span></div>
          <div className="inline-controls">
            <select value={targetSprint} onChange={(e) => setTargetSprint(e.target.value)}>
              <option value="">Select sprint</option>
              {plannedSprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>)}
            </select>
            <button className="primary" disabled={!selected.length || !targetSprint} onClick={addSelected}>Add {selected.length || ''} to sprint</button>
          </div>
        </div>
        <div className="issue-list">
          {backlogIssues.map((issue) => (
            <div className="issue-row" key={issue.id}>
              <input type="checkbox" checked={selected.includes(issue.id)} onChange={() => toggle(issue.id)} />
              <button className="issue-row-main" onClick={() => setSelectedIssue(issue)}>
                <strong>{issue.issue_key}</strong>
                <span>{issue.title}</span>
              </button>
              <span className={priorityClass(issue.priority)}>{issue.priority}</span>
              <span className="points">{issue.story_points || 0} pts</span>
            </div>
          ))}
          {!backlogIssues.length && <EmptyInline title="No backlog issues" text="Create an issue above or generate tasks from AI Planner." />}
        </div>
      </section>
    </div>
  );
}

function BoardPage() {
  const { activeProject, boardIssues, projectSprints, boardSprintId, setBoardSprintId, draggedIssueId, setDraggedIssueId, moveIssueStatus, setSelectedIssue } = useApp();
  const activeSprint = projectSprints.find((sprint) => sprint.status === 'ACTIVE');
  const columns = STATUSES.map((status) => ({ ...status, issues: boardIssues.filter((issue) => issue.status === status.key) }));

  return (
    <div className="page-stack board-page">
      <PageHeader
        eyebrow="Execution"
        title={activeProject ? `${activeProject.name} board` : 'Board'}
        description="Drag cards between columns. Changes are persisted and broadcast through SSE."
        action={(
          <select value={boardSprintId} onChange={(e) => setBoardSprintId(e.target.value)}>
            <option value="active">Active sprint{activeSprint ? ` · ${activeSprint.name}` : ''}</option>
            <option value="all">All non-backlog issues</option>
            {projectSprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>)}
          </select>
        )}
      />
      <div className="board-scroll">
        <div className="kanban-board">
          {columns.map((column) => (
            <section
              className="kanban-column"
              key={column.key}
              onDragOver={(event) => event.preventDefault()}
              onDrop={async () => {
                if (draggedIssueId) await moveIssueStatus(draggedIssueId, column.key);
                setDraggedIssueId(null);
              }}
            >
              <div className="column-head"><h3>{column.label}</h3><span>{column.issues.length}</span></div>
              <div className="column-body">
                {column.issues.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    draggable
                    onDragStart={() => setDraggedIssueId(issue.id)}
                    onClick={() => setSelectedIssue(issue)}
                  />
                ))}
                {!column.issues.length && <div className="drop-hint">Drop issue here</div>}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function SprintsPage() {
  const { activeProject, projectSprints, backlogIssues, createSprint, startSprint, completeSprint, addIssuesToSprint, setSelectedIssue } = useApp();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedBacklog, setSelectedBacklog] = useState([]);

  const submit = async (event) => {
    event.preventDefault();
    if (!activeProject?.id) return;
    await createSprint({ project_id: activeProject.id, name, goal, start_date: startDate || null, end_date: endDate || null });
    setName('');
    setGoal('');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Agile delivery" title="Sprint planning" description="Create sprints, pull in backlog, start execution, and complete work cleanly." />
      <section className="panel form-panel">
        <form className="form-grid" onSubmit={submit}>
          <label>Sprint name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 1" required /></label>
          <label>Start date<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label>End date<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          <label className="wide">Goal<textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What business outcome should this sprint deliver?" /></label>
          <div className="form-actions wide"><button className="primary" disabled={!activeProject}>Create sprint</button></div>
        </form>
      </section>
      <div className="sprint-grid">
        {projectSprints.map((sprint) => {
          const sprintIssues = backlogIssues.filter((issue) => selectedBacklog.includes(issue.id));
          return (
            <section className="panel sprint-card" key={sprint.id}>
              <div className="panel-head wrap">
                <div><h3>{sprint.name}</h3><span>{sprint.status} · {sprint.project_key}</span></div>
                <span className={cx('sprint-status', sprint.status.toLowerCase())}>{sprint.status}</span>
              </div>
              <p className="muted">{sprint.goal || 'No sprint goal.'}</p>
              <div className="sprint-meta">
                <span>{formatDate(sprint.start_date)}</span><span>→</span><span>{formatDate(sprint.end_date)}</span>
              </div>
              <div className="progress-line"><span style={{ width: `${sprint.issue_count ? Math.round((sprint.done_count / sprint.issue_count) * 100) : 0}%` }} /></div>
              <div className="sprint-actions">
                {sprint.status === 'PLANNED' && <button className="primary" onClick={() => startSprint(sprint.id)}>Start</button>}
                {sprint.status === 'ACTIVE' && <button className="danger" onClick={() => completeSprint(sprint.id)}>Complete</button>}
                {sprint.status !== 'COMPLETED' && <button className="ghost" disabled={!sprintIssues.length} onClick={() => addIssuesToSprint(sprint.id, selectedBacklog)}>Add selected backlog</button>}
              </div>
            </section>
          );
        })}
        {!projectSprints.length && <EmptyInline title="No sprints yet" text="Create a sprint above for the selected project." />}
      </div>
      <section className="panel">
        <div className="panel-head"><h3>Backlog available for sprint</h3><span>{selectedBacklog.length} selected</span></div>
        <div className="issue-list compact">
          {backlogIssues.slice(0, 20).map((issue) => (
            <div className="issue-row" key={issue.id}>
              <input type="checkbox" checked={selectedBacklog.includes(issue.id)} onChange={() => setSelectedBacklog((current) => current.includes(issue.id) ? current.filter((id) => id !== issue.id) : [...current, issue.id])} />
              <button className="issue-row-main" onClick={() => setSelectedIssue(issue)}><strong>{issue.issue_key}</strong><span>{issue.title}</span></button>
              <span className="points">{issue.story_points || 0} pts</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReportsPage() {
  const { dashboard, projectSprints, api, showError } = useApp();
  const [sprintId, setSprintId] = useState('');
  const [sprintReport, setSprintReport] = useState(null);

  useEffect(() => {
    if (!sprintId) {
      setSprintReport(null);
      return;
    }
    api.get(`/reports/sprint/${sprintId}`).then(setSprintReport).catch(showError);
  }, [api, showError, sprintId]);

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Management view" title="Reports" description="Simple reporting for status, priority, workload, and sprint execution." />
      <div className="two-col">
        <section className="panel">
          <div className="panel-head"><h3>Status distribution</h3></div>
          <Distribution items={dashboard?.status_distribution || []} labelKey="status" />
        </section>
        <section className="panel">
          <div className="panel-head"><h3>Priority distribution</h3></div>
          <Distribution items={dashboard?.priority_distribution || []} labelKey="priority" />
        </section>
      </div>
      <section className="panel">
        <div className="panel-head wrap">
          <div><h3>Sprint report</h3><span>Select a sprint</span></div>
          <select value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
            <option value="">Choose sprint</option>
            {projectSprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>)}
          </select>
        </div>
        {sprintReport ? (
          <div className="metric-grid small">
            <MetricCard label="Issues" value={sprintReport.summary?.total_issues || 0} helper="Total sprint scope" />
            <MetricCard label="Done" value={sprintReport.summary?.done_issues || 0} helper="Completed items" />
            <MetricCard label="Blocked" value={sprintReport.summary?.blocked_issues || 0} helper="Blocked scope" />
            <MetricCard label="Points" value={`${sprintReport.summary?.done_points || 0}/${sprintReport.summary?.total_points || 0}`} helper="Done / total" />
          </div>
        ) : <p className="muted">Choose a sprint to see report.</p>}
      </section>
      <section className="panel">
        <div className="panel-head"><h3>Assignee workload</h3></div>
        <div className="workload-list">
          {(dashboard?.assignee_workload || []).map((item, index) => (
            <div className="workload-row" key={item.id || index}>
              <span>{item.name || 'Unassigned'}</span>
              <strong>{item.issue_count} issues</strong>
              <small>{item.story_points} pts</small>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AiPage() {
  const { activeProject, projectSprints, api, createIssue, addIssuesToSprint, showError, showSuccess } = useApp();
  const [prompt, setPrompt] = useState('');
  const [breakdown, setBreakdown] = useState(null);
  const [capacity, setCapacity] = useState(30);
  const [plan, setPlan] = useState(null);
  const [insights, setInsights] = useState(null);
  const [sprintId, setSprintId] = useState('');
  const [busy, setBusy] = useState(false);

  const runBreakdown = async () => {
    setBusy(true);
    try {
      const result = await api.post('/ai/breakdown', { prompt, project_id: activeProject?.id });
      setBreakdown(result);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const createGenerated = async (task) => {
    if (!activeProject?.id) return;
    await createIssue({
      project_id: activeProject.id,
      title: task.title,
      description: (task.acceptance_criteria || []).map((item) => `- ${item}`).join('\n'),
      issue_type: task.issue_type || 'TASK',
      priority: task.priority || 'MEDIUM',
      story_points: task.story_points || 0,
      status: 'BACKLOG'
    });
  };

  const runSprintPlan = async () => {
    if (!activeProject?.id) return;
    try {
      const result = await api.post('/ai/sprint-plan', { project_id: activeProject.id, sprint_id: sprintId || null, capacity_points: Number(capacity) || 30 });
      setPlan(result);
    } catch (error) {
      showError(error);
    }
  };

  const addPlanToSprint = async () => {
    if (!sprintId || !plan?.selected_issues?.length) return;
    await addIssuesToSprint(sprintId, plan.selected_issues.map((issue) => issue.id));
    showSuccess('AI-selected issues added to sprint');
  };

  const runInsights = async () => {
    try {
      const result = await api.post('/ai/sprint-insights', { project_id: activeProject?.id, sprint_id: sprintId || null, capacity_points: Number(capacity) || 30 });
      setInsights(result);
    } catch (error) {
      showError(error);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="AI assistant" title="AI Planner" description="Generate implementation tasks, acceptance criteria, sprint scope, and delivery insights." />
      <section className="panel">
        <div className="panel-head"><h3>Break down work</h3><span>{activeProject?.key || 'Select project'}</span></div>
        <textarea className="big-textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Example: Build referral coupon system with validation, one coupon per cart, usage tracking, and admin reports." />
        <div className="form-actions"><button className="primary" disabled={!prompt.trim() || busy} onClick={runBreakdown}>{busy ? 'Thinking...' : 'Generate tasks'}</button></div>
        {breakdown && (
          <div className="ai-output">
            <h4>Suggested tasks</h4>
            <div className="generated-task-list">
              {breakdown.tasks?.map((task, index) => (
                <article className="generated-task" key={`${task.title}-${index}`}>
                  <strong>{task.title}</strong>
                  <div className="card-meta"><span>{task.issue_type}</span><span>{task.priority}</span><span>{task.story_points} pts</span></div>
                  <ul>{task.acceptance_criteria?.map((item) => <li key={item}>{item}</li>)}</ul>
                  <button className="ghost" onClick={() => createGenerated(task)}>Create in backlog</button>
                </article>
              ))}
            </div>
            <h4>Risks</h4>
            <ul className="risk-list">{breakdown.risks?.map((risk) => <li key={risk}>{risk}</li>)}</ul>
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head wrap"><div><h3>Sprint planning AI</h3><span>Use backlog priority + capacity</span></div></div>
        <div className="inline-controls wrap">
          <select value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
            <option value="">Select sprint</option>
            {projectSprints.filter((s) => s.status !== 'COMPLETED').map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>)}
          </select>
          <input type="number" min="1" max="300" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          <button className="primary" onClick={runSprintPlan}>Suggest scope</button>
          <button className="ghost" onClick={runInsights}>Sprint insights</button>
        </div>
        {plan && (
          <div className="ai-output">
            <p><strong>{plan.planned_points || 0}</strong> of <strong>{plan.capacity_points}</strong> capacity points selected.</p>
            <div className="issue-list compact">
              {plan.selected_issues?.map((issue) => <IssueCompact key={issue.id} issue={issue} />)}
            </div>
            <button className="primary" disabled={!sprintId || !plan.selected_issues?.length} onClick={addPlanToSprint}>Add selected scope to sprint</button>
          </div>
        )}
        {insights && <div className="insight-box">{insights.insights?.map((item) => <p key={item}>{item}</p>)}</div>}
      </section>
    </div>
  );
}

function SettingsPage() {
  const { session, updateSession, members, api, showError, showSuccess } = useApp();
  const [apiBase, setApiBase] = useState(session.apiBase || DEFAULT_API_BASE);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MEMBER');

  const saveApi = () => {
    if (!isSecureApiBase(apiBase)) {
      showError(new Error('Backend API URL must use HTTPS unless it is localhost.'));
      return;
    }
    updateSession({ ...session, apiBase: normalizeApiBase(apiBase) });
    showSuccess('API URL saved');
  };

  const addMember = async (event) => {
    event.preventDefault();
    try {
      await api.post(`/tenants/${session.tenant.id}/members`, { email, role });
      setEmail('');
      showSuccess('Member added');
    } catch (error) {
      showError(error);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Administration" title="Settings" description="Manage API connection, tenant members, and current user context." />
      <div className="two-col">
        <section className="panel">
          <div className="panel-head"><h3>Workspace</h3></div>
          <div className="detail-list">
            <span>Tenant</span><strong>{session.tenant?.name}</strong>
            <span>Slug</span><strong>{session.tenant?.slug}</strong>
            <span>User</span><strong>{session.user?.name}</strong>
            <span>Role</span><strong>{session.user?.role}</strong>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h3>API connection</h3></div>
          <label>Backend API URL<input value={apiBase} onChange={(e) => setApiBase(e.target.value)} /></label>
          <button className="primary" onClick={saveApi}>Save API URL</button>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head"><h3>Members</h3><span>{members.length}</span></div>
        <form className="inline-controls wrap" onSubmit={addMember}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="existing.user@company.com" />
          <select value={role} onChange={(e) => setRole(e.target.value)}><option>ADMIN</option><option>MEMBER</option><option>VIEWER</option></select>
          <button className="primary">Add member</button>
        </form>
        <div className="member-grid">
          {members.map((member) => (
            <div className="member-card" key={member.id}>
              <div className="avatar">{initials(member.name)}</div>
              <div><strong>{member.name}</strong><span>{member.email}</span></div>
              <em>{member.role}</em>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CreateIssuePanel({ defaultStatus = 'BACKLOG', projectId, onCreate }) {
  const [open, setOpen] = useState(true);
  const [title, setTitle] = useState('');
  const [issueType, setIssueType] = useState('TASK');
  const [priority, setPriority] = useState('MEDIUM');
  const [points, setPoints] = useState(3);
  const [description, setDescription] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!projectId) return;
    await onCreate({ project_id: projectId, title, description, issue_type: issueType, priority, story_points: Number(points) || 0, status: defaultStatus });
    setTitle('');
    setDescription('');
    setPoints(3);
  };

  return (
    <section className="panel form-panel">
      <div className="panel-head"><h3>Create issue</h3><button className="ghost" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button></div>
      {open && <form className="form-grid" onSubmit={submit}>
        <label className="wide">Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short business-focused task title" required /></label>
        <label>Type<select value={issueType} onChange={(e) => setIssueType(e.target.value)}>{TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label>Priority<select value={priority} onChange={(e) => setPriority(e.target.value)}>{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Story points<input type="number" min="0" max="100" value={points} onChange={(e) => setPoints(e.target.value)} /></label>
        <label className="wide">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details, acceptance criteria, dependencies" /></label>
        <div className="form-actions wide"><button className="primary" disabled={!projectId}>Create issue</button></div>
      </form>}
    </section>
  );
}

function IssueDrawer() {
  const { selectedIssue, setSelectedIssue, comments, addComment, updateIssue, deleteIssue } = useApp();
  const [draft, setDraft] = useState(selectedIssue);
  const [comment, setComment] = useState('');

  useEffect(() => setDraft(selectedIssue), [selectedIssue]);
  if (!selectedIssue || !draft) return null;

  const save = async () => {
    await updateIssue(selectedIssue.id, {
      title: draft.title,
      description: draft.description || '',
      issue_type: draft.issue_type,
      priority: draft.priority,
      status: draft.status,
      story_points: Number(draft.story_points) || 0,
      due_date: draft.due_date || null,
      labels: Array.isArray(draft.labels) ? draft.labels : []
    });
  };

  return (
    <div className="drawer-backdrop" onMouseDown={() => setSelectedIssue(null)}>
      <aside className="issue-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div><span className="issue-key-big">{selectedIssue.issue_key}</span><h2>{selectedIssue.title}</h2></div>
          <button className="icon-btn" onClick={() => setSelectedIssue(null)}>×</button>
        </div>
        <div className="form-stack">
          <label>Title<input value={draft.title || ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>Description<textarea value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
          <div className="form-grid compact-grid">
            <label>Status<select value={draft.status || 'TODO'} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>{['BACKLOG', ...STATUSES.map((s) => s.key)].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Priority<select value={draft.priority || 'MEDIUM'} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></label>
            <label>Type<select value={draft.issue_type || 'TASK'} onChange={(e) => setDraft({ ...draft, issue_type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label>Points<input type="number" value={draft.story_points || 0} onChange={(e) => setDraft({ ...draft, story_points: e.target.value })} /></label>
            <label>Due date<input type="date" value={draft.due_date || ''} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} /></label>
          </div>
          <div className="form-actions"><button className="primary" onClick={save}>Save changes</button><button className="danger" onClick={() => deleteIssue(selectedIssue.id)}>Delete</button></div>
        </div>
        <section className="comments-section">
          <h3>Comments</h3>
          <div className="comment-list">
            {comments.map((item) => <div className="comment" key={item.id}><strong>{item.author_name || 'User'}</strong><p>{item.body}</p><small>{formatDate(item.created_at)}</small></div>)}
            {!comments.length && <p className="muted">No comments yet.</p>}
          </div>
          <form onSubmit={async (event) => { event.preventDefault(); if (comment.trim()) { await addComment(selectedIssue.id, comment); setComment(''); } }}>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a useful update for the team" />
            <button className="primary">Add comment</button>
          </form>
        </section>
      </aside>
    </div>
  );
}

function IssueCard({ issue, draggable = false, onDragStart, onClick }) {
  return (
    <article className="issue-card" draggable={draggable} onDragStart={onDragStart} onClick={onClick}>
      <div className="issue-card-head"><strong>{issue.issue_key}</strong><span className={priorityClass(issue.priority)}>{issue.priority}</span></div>
      <h4>{issue.title}</h4>
      <p>{issue.description || 'No description'}</p>
      <div className="card-meta"><span>{issue.issue_type}</span><span>{issue.story_points || 0} pts</span><span>{issue.assignee_name || 'Unassigned'}</span></div>
    </article>
  );
}

function IssueCompact({ issue }) {
  return <div className="issue-row"><span className="issue-row-main"><strong>{issue.issue_key}</strong><span>{issue.title}</span></span><span className={priorityClass(issue.priority)}>{issue.priority}</span><span className="points">{issue.story_points || 0} pts</span></div>;
}

function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="page-header">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      {action && <div className="page-action">{action}</div>}
    </div>
  );
}

function MetricCard({ label, value, helper }) {
  return <section className="metric-card"><span>{label}</span><strong>{value}</strong><p>{helper}</p></section>;
}

function ActivityList({ items }) {
  if (!items.length) return <p className="muted">No activity yet.</p>;
  return <div className="activity-list">{items.map((item) => <div className="activity-item" key={item.id}><div className="dot" /><div><strong>{item.actor_name || 'System'}</strong><p>{item.message}</p><small>{formatDate(item.created_at)}</small></div></div>)}</div>;
}

function Distribution({ items, labelKey }) {
  const max = Math.max(...items.map((item) => Number(item.count) || 0), 1);
  if (!items.length) return <p className="muted">No data yet.</p>;
  return <div className="distribution">{items.map((item) => <div className="dist-row" key={item[labelKey]}><span>{item[labelKey]}</span><div><b style={{ width: `${((Number(item.count) || 0) / max) * 100}%` }} /></div><strong>{item.count}</strong></div>)}</div>;
}

function MiniDistribution() {
  const { boardIssues } = useApp();
  const items = STATUSES.map((status) => ({ status: status.label, count: boardIssues.filter((issue) => issue.status === status.key).length }));
  return <Distribution items={items} labelKey="status" />;
}

function EmptyInline({ title, text }) {
  return <div className="empty-inline"><strong>{title}</strong><p>{text}</p></div>;
}

function MobileBottomNav() {
  const { page, setPage } = useApp();
  const items = [['dashboard', 'Home'], ['backlog', 'Backlog'], ['board', 'Board'], ['sprints', 'Sprints'], ['ai', 'AI']];
  return <nav className="bottom-nav">{items.map(([key, label]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}>{label}</button>)}</nav>;
}

export default App;
