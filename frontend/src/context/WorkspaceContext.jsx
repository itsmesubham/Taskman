import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, DEFAULT_API_BASE, isSecureApiBase, normalizeApiBase } from '../api/client.js';
import { extractInviteCodeFromPath } from '../utils/invite.js';
import { readJson, saveJson } from '../utils.js';
import { buildActiveWorkspaceContext } from '../utils/workspaceSession.js';
import { getBoardWorkflowStatus } from '../utils/taskWorkflow.js';
import { parseTaskRoute } from '../utils/taskRoutes.js';

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const [session, setSession] = useState(() => {
    const persisted = readJson('taskman_session', {
      token: null,
      user: null,
      tenant: null,
      memberships: [],
      apiBase: DEFAULT_API_BASE
    });
    return {
      ...persisted,
      memberships: persisted.memberships || []
    };
  });
  const [page, setPageState] = useState('board');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [eventStatus, setEventStatus] = useState('syncing');

  const [projects, setProjects] = useState([]);
  const [projectRepositories, setProjectRepositories] = useState([]);
  const [issues, setIssues] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [members, setMembers] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [sprintSchedule, setSprintSchedule] = useState(null);
  const [activeProjectId, setActiveProjectIdState] = useState(() => localStorage.getItem('taskman_active_project') || '');
  const activeProjectIdRef = useRef(activeProjectId);
  const [boardSprintId, setBoardSprintId] = useState('active');
  const [query, setQuery] = useState('');
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [comments, setComments] = useState([]);
  const [agentActivity, setAgentActivity] = useState([]);
  const [issueActivity, setIssueActivity] = useState([]);
  const [draggedIssueId, setDraggedIssueId] = useState(null);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [taskDrawerDefaultStatus, setTaskDrawerDefaultStatus] = useState('TODO');
  const [boardFilter, setBoardFilter] = useState('ALL');
  const [boardQuickFilter, setBoardQuickFilter] = useState('ALL');
  const [memberships, setMemberships] = useState([]);
  const [authStatus, setAuthStatus] = useState(session.token ? 'loading' : 'signed_out');
  const [route, setRoute] = useState(() => parseTaskRoute(window.location.pathname));
  const [inviteCode, setInviteCode] = useState(() => {
    return extractInviteCodeFromPath(window.location.pathname);
  });
  const [inviteDetails, setInviteDetails] = useState(null);
  const [inviteError, setInviteError] = useState('');
  const [bootstrapReady, setBootstrapReady] = useState(!session.token);
  const refreshTimer = useRef(null);
  const bootstrappingRef = useRef(false);
  const workspaceLoadRef = useRef(false);
  const workspaceLoadedTenantRef = useRef('');
  const routeRef = useRef(route);

  const updateSession = useCallback((next) => {
    setSession(next);
    saveJson('taskman_session', next);
  }, []);

  const showToast = useCallback((type, text) => setToast({ type, text }), []);
  const showError = useCallback((error) => showToast('error', error?.message || 'Something went wrong'), [showToast]);
  const showSuccess = useCallback((text) => showToast('success', text), [showToast]);

  const getApiState = useCallback(() => ({ token: session.token, apiBase: session.apiBase || DEFAULT_API_BASE }), [session.apiBase, session.token]);
  const handleUnauthorized = useCallback(() => {
    showToast('error', 'Session expired. Please login again.');
    updateSession({ ...session, token: null, user: null, tenant: null, memberships: [] });
    localStorage.removeItem('taskman_active_tenant');
    setMemberships([]);
    setAuthStatus('signed_out');
    setBootstrapReady(true);
    setEventStatus('offline');
    workspaceLoadedTenantRef.current = '';
    workspaceLoadRef.current = false;
  }, [session, showToast, updateSession]);
  const api = useMemo(() => new ApiClient(getApiState, handleUnauthorized), [getApiState, handleUnauthorized]);
  const publicApi = useMemo(() => new ApiClient(() => ({ token: null, apiBase: session.apiBase || DEFAULT_API_BASE })), [session.apiBase]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  const setPage = useCallback((nextPage) => {
    setPageState(nextPage);
    if (routeRef.current.kind === 'task') {
      window.history.pushState({}, '', '/');
      setRoute({ kind: 'app' });
      setInviteCode('');
      setSelectedIssue(null);
    }
  }, []);

  useEffect(() => {
    const syncRoute = () => {
      setRoute(parseTaskRoute(window.location.pathname));
    };
    syncRoute();
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  useEffect(() => {
    const syncInviteCode = () => {
      setInviteCode(extractInviteCodeFromPath(window.location.pathname));
    };
    syncInviteCode();
    window.addEventListener('popstate', syncInviteCode);
    return () => window.removeEventListener('popstate', syncInviteCode);
  }, []);

  useEffect(() => {
    if (!inviteCode) {
      setInviteDetails(null);
      setInviteError('');
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await publicApi.get(`/invites/${inviteCode}`);
        if (!cancelled) {
          setInviteDetails(result);
          setInviteError('');
        }
      } catch (error) {
        if (!cancelled) {
          setInviteDetails(null);
          setInviteError(error.message);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [inviteCode, publicApi]);

  const setActiveProjectId = useCallback((id) => {
    setActiveProjectIdState(id);
    activeProjectIdRef.current = id;
    localStorage.setItem('taskman_active_project', id || '');
  }, []);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  const navigate = useCallback((path) => {
    window.history.pushState({}, '', path);
    setInviteCode(extractInviteCodeFromPath(path));
    const nextRoute = parseTaskRoute(path);
    setRoute(nextRoute);
    if (nextRoute.kind !== 'task') {
      setSelectedIssue(null);
    }
  }, []);

  const setActiveTenant = useCallback(async (tenantId, { silent = false, userOverride = null } = {}) => {
    const result = await api.patch('/users/me/active-tenant', { tenant_id: tenantId });
    const nextTenant = result.tenant || null;
    const nextUser = {
      ...(session.user || {}),
      ...(userOverride || {}),
      role: result.membership?.role || session.user?.role,
      active_tenant_id: result.active_tenant_id || tenantId
    };
    const nextSession = {
      ...session,
      token: result.access_token || session.token,
      user: nextUser,
      tenant: nextTenant,
      memberships: result.memberships || memberships,
      apiBase: session.apiBase || DEFAULT_API_BASE
    };
    localStorage.setItem('taskman_active_tenant', tenantId || '');
    updateSession(nextSession);
    setMemberships(result.memberships || memberships);
    if (!silent) showSuccess(`Workspace switched to ${nextTenant?.name || 'workspace'}`);
    setAuthStatus('ready');
    return result;
  }, [api, memberships, session, showSuccess, updateSession]);

  const createWorkspace = useCallback(async (payload) => {
    const result = await api.post('/tenants', payload);
    const nextTenant = result.tenant || null;
    const nextUser = {
      ...(session.user || {}),
      role: result.membership?.role || 'OWNER',
      active_tenant_id: nextTenant?.id || null
    };
    localStorage.setItem('taskman_active_tenant', nextTenant?.id || '');
    updateSession({
      ...session,
      token: result.access_token || session.token,
      user: nextUser,
      tenant: nextTenant,
      memberships: result.memberships || (result.membership ? [result.membership] : memberships),
      apiBase: session.apiBase || DEFAULT_API_BASE
    });
    setMemberships(result.memberships || (result.membership ? [result.membership] : memberships));
    setAuthStatus('ready');
    return result;
  }, [api, memberships, session, updateSession]);

  const acceptInvite = useCallback(async (code) => {
    const result = await api.post(`/invites/${code}/accept`, {});
    const nextTenant = result.tenant || null;
    const nextUser = {
      ...(session.user || {}),
      role: result.membership?.role || 'MEMBER',
      active_tenant_id: result.active_tenant_id || nextTenant?.id || null
    };
    localStorage.setItem('taskman_active_tenant', nextTenant?.id || '');
    updateSession({
      ...session,
      token: result.access_token || session.token,
      user: nextUser,
      tenant: nextTenant,
      memberships: result.memberships || memberships,
      apiBase: session.apiBase || DEFAULT_API_BASE
    });
    setMemberships(result.memberships || memberships);
    setAuthStatus('ready');
    navigate('/');
    return result;
  }, [api, memberships, navigate, session, updateSession]);

  const openCreateTaskDrawer = useCallback((status = 'TODO') => {
    setTaskDrawerDefaultStatus(status);
    setTaskDrawerOpen(true);
  }, []);

  const closeCreateTaskDrawer = useCallback(() => {
    setTaskDrawerOpen(false);
  }, []);

  const loadWorkspace = useCallback(async (silent = false, force = false) => {
    const tenantId = session.tenant?.id || '';
    if (!session.token || !tenantId) return;
    if (!isSecureApiBase(session.apiBase || DEFAULT_API_BASE)) {
      showError(new Error('Backend API URL must use HTTPS unless it is localhost.'));
      return;
    }
    if (!force && workspaceLoadedTenantRef.current === tenantId) return;
    if (workspaceLoadRef.current) return;
    workspaceLoadRef.current = true;
    workspaceLoadedTenantRef.current = tenantId;
    if (!silent) setLoading(true);
    try {
      const [defaultsRes, scheduleRes, projectRes, repoRes, sprintRes, issueRes, reportRes] = await Promise.all([
        api.get('/workspaces/board'),
        api.get('/sprints/schedule'),
        api.get('/projects'),
        api.get('/projects/repositories'),
        api.get('/sprints'),
        api.get('/issues'),
        api.get('/reports/dashboard')
      ]);

      setSprintSchedule(scheduleRes || defaultsRes || null);
      setEventStatus('live');

      const nextProjects = projectRes.projects || [];
      setProjects(nextProjects);
      setProjectRepositories(repoRes.repositories || []);
      setSprints(sprintRes.sprints || []);
      setIssues(issueRes.issues || []);
      setDashboard(reportRes || null);

      if (!activeProjectIdRef.current || !nextProjects.some((project) => project.id === activeProjectIdRef.current)) {
        setActiveProjectId(nextProjects[0]?.id || '');
      }

    } catch (error) {
      showError(error);
      setEventStatus(session.token ? 'live' : 'offline');
    } finally {
      workspaceLoadRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [api, session.apiBase, session.tenant?.id, session.token, setActiveProjectId, showError]);

  const loadMembers = useCallback(async () => {
    const tenantId = session.tenant?.id || '';
    if (!session.token || !tenantId) {
      setMembers([]);
      return;
    }
    try {
      const memberRes = await api.get(`/tenants/${tenantId}/members`);
      setMembers(memberRes.members || []);
    } catch {
      setMembers([]);
    }
  }, [api, session.tenant?.id, session.token]);

  const loadIssueByKey = useCallback(async (workspaceSlug, taskKey) => {
    if (!taskKey) {
      throw new Error('Task key is required');
    }
    const routePrefix = workspaceSlug ? `/workspaces/${encodeURIComponent(workspaceSlug)}/tasks/${encodeURIComponent(taskKey)}` : `/issues/key/${encodeURIComponent(taskKey)}`;
    const result = await api.get(routePrefix);
    return result.issue || null;
  }, [api]);

  useEffect(() => {
    if (!session.token || !session.tenant?.id) return;
    loadWorkspace();
  }, [loadWorkspace, session.token, session.tenant?.id]);

  useEffect(() => {
    if (!session.token || !session.tenant?.id) {
      setMembers([]);
      return;
    }
    loadMembers();
  }, [loadMembers, session.token, session.tenant?.id]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      if (!session.token) {
        setAuthStatus('signed_out');
        setBootstrapReady(true);
        setMemberships([]);
        return;
      }
      if (bootstrappingRef.current) return;
      bootstrappingRef.current = true;
      setBootstrapReady(false);
      try {
        const pathRoute = parseTaskRoute(window.location.pathname);
        if (session.tenant?.id && Array.isArray(session.memberships) && session.memberships.length > 0) {
          const preferredTenantId = pathRoute.workspaceSlug
            ? (session.memberships.find((membership) => membership.tenant_slug === pathRoute.workspaceSlug)?.tenant_id || session.tenant.id)
            : session.tenant.id;
          const workspace = buildActiveWorkspaceContext({
            user: session.user,
            memberships: session.memberships,
            preferredTenantId
          });
          setMemberships(workspace.memberships);
          if (workspace.user && (!session.user?.role || !session.user?.active_tenant_id)) {
            updateSession({
              ...session,
              user: workspace.user,
              tenant: workspace.tenant || session.tenant,
              memberships: workspace.memberships
            });
          }
          setAuthStatus(inviteCode ? 'invite' : 'ready');
          return;
        }
        const [meRes, myRes] = await Promise.all([
          api.get('/users/me'),
          api.get('/tenants/my')
        ]);
        if (cancelled) return;
        const nextUser = meRes.user || session.user || null;
        const nextMemberships = myRes.tenants || meRes.memberships || [];
        setMemberships(nextMemberships);
        updateSession({
          ...session,
          user: nextUser || session.user,
          tenant: session.tenant || null,
          memberships: nextMemberships,
          apiBase: session.apiBase || DEFAULT_API_BASE
        });

        if (inviteCode) {
          setAuthStatus('invite');
          return;
        }

        if (!nextMemberships.length) {
          setAuthStatus('onboarding');
          return;
        }

        const preferredMembership = pathRoute.workspaceSlug ? nextMemberships.find((membership) => membership.tenant_slug === pathRoute.workspaceSlug) : null;
        const preferredTenantId = preferredMembership?.tenant_id || localStorage.getItem('taskman_active_tenant') || nextUser?.active_tenant_id || '';
        const workspace = buildActiveWorkspaceContext({
          user: nextUser || session.user || null,
          memberships: nextMemberships,
          preferredTenantId: preferredTenantId || null
        });
        if (workspace.tenant) {
          localStorage.setItem('taskman_active_tenant', workspace.tenant.id || '');
          updateSession({
            ...session,
            user: workspace.user,
            tenant: workspace.tenant,
            memberships: workspace.memberships,
            apiBase: session.apiBase || DEFAULT_API_BASE
          });
          setMemberships(workspace.memberships);
          setAuthStatus('ready');
          return;
        }

        setAuthStatus('picker');
      } catch (error) {
        if (!cancelled) {
          showError(error);
          setAuthStatus('ready');
        }
      } finally {
        if (!cancelled) {
          setBootstrapReady(true);
          bootstrappingRef.current = false;
        }
      }
    };

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [api, inviteCode, session.apiBase, session.token, showError, updateSession]);

  useEffect(() => {
    if (!session.token || !session.tenant?.id || !isSecureApiBase(session.apiBase || DEFAULT_API_BASE)) return undefined;

    const url = `${normalizeApiBase(session.apiBase)}/events/stream?token=${encodeURIComponent(session.token)}`;
    const source = new EventSource(url);
    setEventStatus('syncing');

    source.addEventListener('connected', () => setEventStatus('live'));
    source.addEventListener('heartbeat', () => setEventStatus('live'));
    source.onerror = () => setEventStatus('live');

    return () => {
      window.clearTimeout(refreshTimer.current);
      source.close();
      setEventStatus('live');
    };
  }, [session.apiBase, session.token]);

  const activeProject = projects.find((project) => project.id === activeProjectId) || null;
  const projectSprints = sprints.filter((sprint) => !activeProjectId || sprint.project_id === activeProjectId);
  const activeSprint = projectSprints.find((sprint) => sprint.status === 'ACTIVE') || null;
  const selectedBoardSprintId = boardSprintId === 'active' ? activeSprint?.id || '' : boardSprintId;

  const projectIssues = issues.filter((issue) => !activeProjectId || issue.project_id === activeProjectId);
  const githubRepos = useMemo(() => {
    const repos = new Set();
    projectRepositories.forEach((repository) => {
      if (repository.repo) repos.add(repository.repo);
    });
    return Array.from(repos).sort();
  }, [projectRepositories]);
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
    const sprintMatch = issue.sprint_id === selectedBoardSprintId;
    if (!sprintMatch) return false;
    if (boardFilter === 'ALL') return true;
    if (boardFilter === 'REVIEW') {
      const workflowStatus = getBoardWorkflowStatus(issue);
      return workflowStatus === 'IN_REVIEW' || issue.status === 'CHANGES_REQUESTED';
    }
    return getBoardWorkflowStatus(issue) === boardFilter;
  });
  const filteredBoardIssues = boardIssues.filter((issue) => {
    if (boardQuickFilter === 'ALL') return true;
    if (boardQuickFilter === 'ME') return issue.assignee_id === session.user?.id;
    if (boardQuickFilter === 'UNASSIGNED') return !issue.assignee_id;
    if (boardQuickFilter === 'HIGH') return ['HIGH', 'URGENT'].includes(issue.priority);
    if (boardQuickFilter === 'DUE_WEEK') {
      if (!issue.due_date) return false;
      const today = new Date();
      const weekAhead = new Date();
      weekAhead.setDate(today.getDate() + 7);
      const due = new Date(issue.due_date);
      return due >= new Date(today.toDateString()) && due <= weekAhead;
    }
    if (boardQuickFilter === 'BLOCKED') return issue.status === 'BLOCKED';
    if (boardQuickFilter === 'AI_WORKING') return ['CLAIMED', 'WORKING'].includes(issue.agent_status) || Boolean(issue.claimed_by_agent);
    if (boardQuickFilter === 'PR_OPEN') return String(issue.github_pr_status || '').toUpperCase() === 'OPEN';
    if (boardQuickFilter === 'CHANGES_REQUESTED') return issue.status === 'CHANGES_REQUESTED' || String(issue.github_pr_status || '').toUpperCase() === 'CHANGES_REQUESTED';
    return true;
  });

  const logout = useCallback(() => {
    updateSession({ token: null, user: null, tenant: null, memberships: [], apiBase: session.apiBase || DEFAULT_API_BASE });
    localStorage.removeItem('taskman_active_tenant');
    setProjects([]);
    setIssues([]);
    setSprints([]);
    setMembers([]);
    setDashboard(null);
    setSprintSchedule(null);
    setSelectedIssue(null);
    setTaskDrawerOpen(false);
    setBoardFilter('ALL');
    setBoardQuickFilter('ALL');
    setMemberships([]);
    setAuthStatus('signed_out');
    setBootstrapReady(true);
    setEventStatus('offline');
    workspaceLoadedTenantRef.current = '';
    workspaceLoadRef.current = false;
  }, [session.apiBase, updateSession]);

  const createProject = async (payload) => {
    try {
      const result = await api.post('/projects', payload);
      showSuccess('Project created');
      await loadWorkspace(true, true);
      if (result.project?.id) setActiveProjectId(result.project.id);
      return result;
    } catch (error) { showError(error); }
  };

  const updateProject = async (projectId, payload) => {
    try {
      const result = await api.patch(`/projects/${projectId}`, payload);
      setProjects((current) => current.map((project) => project.id === projectId ? { ...project, ...result.project } : project));
      if (activeProjectId === projectId && result.project?.id) {
        setActiveProjectId(projectId);
      }
      showSuccess('Project updated');
      await loadWorkspace(true, true);
      return result;
    } catch (error) { showError(error); }
  };

  const createIssue = async (payload) => {
    try {
      const status = payload.status || 'TODO';
      const result = await api.post('/issues', {
        ...payload,
        project_id: payload.project_id || null,
        sprint_id: payload.sprint_id || null,
        status,
        title: payload.title?.trim() || ''
      });
      if (result?.issue) {
        setIssues((current) => [result.issue, ...current.filter((issue) => issue.id !== result.issue.id)]);
        setSelectedIssue((current) => current?.id === result.issue.id ? { ...current, ...result.issue } : current);
      }
      showSuccess('Issue created');
      await loadWorkspace(true, true);
      return result;
    } catch (error) { showError(error); }
  };

  const updateIssue = async (issueId, payload, { silent = false } = {}) => {
    try {
      const result = await api.patch(`/issues/${issueId}`, payload);
      setIssues((current) => current.map((issue) => issue.id === issueId ? { ...issue, ...result.issue } : issue));
      setSelectedIssue((current) => current?.id === issueId ? { ...current, ...result.issue } : current);
      if (!silent) showSuccess('Issue updated');
      await loadWorkspace(true, true);
    } catch (error) { showError(error); }
  };

  const deleteIssue = async (issueId) => {
    if (!window.confirm('Delete this issue?')) return;
    try {
      await api.delete(`/issues/${issueId}`);
      setSelectedIssue(null);
      showSuccess('Issue deleted');
      await loadWorkspace(true, true);
    } catch (error) { showError(error); }
  };

  const moveIssueStatus = async (issueId, status) => {
    const previous = issues;
    const position = Date.now();
    setIssues((current) => current.map((issue) => issue.id === issueId ? { ...issue, status, position } : issue));
    try {
      await api.patch(`/issues/${issueId}/status`, { status, position });
      await loadWorkspace(true, true);
    } catch (error) {
      setIssues(previous);
      showError(error);
    }
  };

  const createSprint = async (payload) => {
    try {
      const result = await api.post('/sprints', payload);
      showSuccess('Sprint created');
      await loadWorkspace(true, true);
      return result;
    } catch (error) { showError(error); }
  };

  const startSprint = async (sprintId) => {
    try {
      await api.post(`/sprints/${sprintId}/start`, {});
      showSuccess('Sprint started');
      await loadWorkspace(true, true);
    } catch (error) { showError(error); }
  };

  const completeSprint = async (sprintId) => {
    try {
      await api.post(`/sprints/${sprintId}/complete`, { incomplete_strategy: 'BACKLOG' });
      showSuccess('Sprint completed');
      await loadWorkspace(true, true);
    } catch (error) { showError(error); }
  };

  const addIssuesToSprint = async (sprintId, issueIds) => {
    if (!sprintId || !issueIds?.length) return;
    try {
      await api.post(`/sprints/${sprintId}/issues`, { issue_ids: issueIds });
      showSuccess('Issues added to sprint');
      await loadWorkspace(true, true);
    } catch (error) { showError(error); }
  };

  const loadComments = useCallback(async (issueId) => {
    try {
      const result = await api.get(`/issues/${issueId}/comments`);
      setComments(result.comments || []);
    } catch (error) { showError(error); }
  }, [api, showError]);

  const loadAgentActivity = useCallback(async (issueId) => {
    try {
      const result = await api.get(`/issues/${issueId}/agent-activity`);
      setAgentActivity(result.timeline || []);
    } catch {
      setAgentActivity([]);
    }
  }, [api]);

  const loadIssueActivity = useCallback(async (issueId) => {
    try {
      const result = await api.get(`/issues/${issueId}/activity`);
      setIssueActivity(result.activity || []);
    } catch {
      setIssueActivity([]);
    }
  }, [api]);

  useEffect(() => {
    if (!selectedIssue?.id) {
      setAgentActivity([]);
      return;
    }
    loadComments(selectedIssue.id);
    loadAgentActivity(selectedIssue.id);
    loadIssueActivity(selectedIssue.id);
  }, [loadAgentActivity, loadComments, loadIssueActivity, selectedIssue?.id]);

  const addComment = async (issueId, body) => {
    try {
      await api.post(`/issues/${issueId}/comments`, { body });
      await loadComments(issueId);
      showSuccess('Comment added');
    } catch (error) { showError(error); }
  };

  const value = {
    session, updateSession, api,
    memberships, authStatus, bootstrapReady,
    inviteCode, inviteDetails, inviteError,
    page, setPage, mobileNavOpen, setMobileNavOpen,
    toast, loading, eventStatus,
    projects, issues, sprints, members, dashboard,
    projectRepositories,
    activeProject, activeProjectId, setActiveProjectId,
    activeSprint, projectSprints, selectedBoardSprintId,
    boardSprintId, setBoardSprintId,
    boardFilter, setBoardFilter,
    boardQuickFilter, setBoardQuickFilter,
    sprintSchedule,
    taskDrawerOpen, taskDrawerDefaultStatus, openCreateTaskDrawer, closeCreateTaskDrawer,
    query, setQuery,
    backlogIssues, boardIssues, filteredBoardIssues, visibleIssues,
    navigate, setActiveTenant, createWorkspace, acceptInvite,
    route, loadIssueByKey,
    loadWorkspace, createProject, updateProject, createIssue, updateIssue, deleteIssue, moveIssueStatus,
    createSprint, startSprint, completeSprint, addIssuesToSprint,
    selectedIssue, setSelectedIssue, comments, agentActivity, issueActivity, addComment,
    draggedIssueId, setDraggedIssueId,
    githubRepos,
    showError, showSuccess, logout
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}
