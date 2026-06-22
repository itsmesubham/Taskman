import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, DEFAULT_API_BASE, isSecureApiBase, normalizeApiBase } from '../api/client.js';
import { readJson, saveJson } from '../utils.js';

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const [session, setSession] = useState(() => readJson('taskman_session', {
    token: null,
    user: null,
    tenant: null,
    apiBase: DEFAULT_API_BASE
  }));
  const [page, setPage] = useState('board');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [eventStatus, setEventStatus] = useState('offline');

  const [projects, setProjects] = useState([]);
  const [issues, setIssues] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [members, setMembers] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [sprintSchedule, setSprintSchedule] = useState(null);
  const [activeProjectId, setActiveProjectIdState] = useState(() => localStorage.getItem('taskman_active_project') || '');
  const [boardSprintId, setBoardSprintId] = useState('active');
  const [query, setQuery] = useState('');
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [comments, setComments] = useState([]);
  const [draggedIssueId, setDraggedIssueId] = useState(null);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [taskDrawerDefaultStatus, setTaskDrawerDefaultStatus] = useState('TODO');
  const [boardFilter, setBoardFilter] = useState('ALL');
  const [boardQuickFilter, setBoardQuickFilter] = useState('ALL');
  const refreshTimer = useRef(null);

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
    updateSession({ ...session, token: null, user: null, tenant: null });
  }, [session, showToast, updateSession]);
  const api = useMemo(() => new ApiClient(getApiState, handleUnauthorized), [getApiState, handleUnauthorized]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const setActiveProjectId = useCallback((id) => {
    setActiveProjectIdState(id);
    localStorage.setItem('taskman_active_project', id || '');
  }, []);

  const openCreateTaskDrawer = useCallback((status = 'TODO') => {
    setTaskDrawerDefaultStatus(status);
    setTaskDrawerOpen(true);
  }, []);

  const closeCreateTaskDrawer = useCallback(() => {
    setTaskDrawerOpen(false);
  }, []);

  const loadWorkspace = useCallback(async (silent = false) => {
    if (!session.token) return;
    if (!isSecureApiBase(session.apiBase || DEFAULT_API_BASE)) {
      showError(new Error('Backend API URL must use HTTPS unless it is localhost.'));
      return;
    }
    if (!silent) setLoading(true);
    try {
      const [defaultsRes, scheduleRes, projectRes, sprintRes, issueRes, reportRes] = await Promise.all([
        api.get('/workspaces/board'),
        api.get('/sprints/schedule'),
        api.get('/projects'),
        api.get('/sprints'),
        api.get('/issues'),
        api.get('/reports/dashboard')
      ]);

      setSprintSchedule(scheduleRes || defaultsRes || null);

      const nextProjects = projectRes.projects || [];
      setProjects(nextProjects);
      setSprints(sprintRes.sprints || []);
      setIssues(issueRes.issues || []);
      setDashboard(reportRes || null);

      if (!activeProjectId || !nextProjects.some((project) => project.id === activeProjectId)) {
        setActiveProjectId(nextProjects[0]?.id || '');
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
  }, [activeProjectId, api, session.apiBase, session.tenant?.id, session.token, setActiveProjectId, showError]);

  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);

  useEffect(() => {
    if (!session.token || !isSecureApiBase(session.apiBase || DEFAULT_API_BASE)) return undefined;

    const url = `${normalizeApiBase(session.apiBase)}/events/stream?token=${encodeURIComponent(session.token)}`;
    const source = new EventSource(url);
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
    ].forEach((eventName) => source.addEventListener(eventName, scheduleRefresh));

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
    const sprintMatch = issue.sprint_id === selectedBoardSprintId;
    if (!sprintMatch) return false;
    if (boardFilter === 'ALL') return true;
    if (boardFilter === 'REVIEW') return issue.status === 'IN_REVIEW';
    return issue.status === boardFilter;
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
    return true;
  });

  const logout = useCallback(() => {
    updateSession({ token: null, user: null, tenant: null, apiBase: session.apiBase || DEFAULT_API_BASE });
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
  }, [session.apiBase, updateSession]);

  const createProject = async (payload) => {
    try {
      const result = await api.post('/projects', payload);
      showSuccess('Project created');
      await loadWorkspace(true);
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
      await loadWorkspace(true);
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
      await loadWorkspace(true);
      return result;
    } catch (error) { showError(error); }
  };

  const updateIssue = async (issueId, payload) => {
    try {
      const result = await api.patch(`/issues/${issueId}`, payload);
      setIssues((current) => current.map((issue) => issue.id === issueId ? { ...issue, ...result.issue } : issue));
      setSelectedIssue((current) => current?.id === issueId ? { ...current, ...result.issue } : current);
      showSuccess('Issue updated');
      await loadWorkspace(true);
    } catch (error) { showError(error); }
  };

  const deleteIssue = async (issueId) => {
    if (!window.confirm('Delete this issue?')) return;
    try {
      await api.delete(`/issues/${issueId}`);
      setSelectedIssue(null);
      showSuccess('Issue deleted');
      await loadWorkspace(true);
    } catch (error) { showError(error); }
  };

  const moveIssueStatus = async (issueId, status) => {
    const previous = issues;
    const position = Date.now();
    setIssues((current) => current.map((issue) => issue.id === issueId ? { ...issue, status, position } : issue));
    try {
      await api.patch(`/issues/${issueId}/status`, { status, position });
      await loadWorkspace(true);
    } catch (error) {
      setIssues(previous);
      showError(error);
    }
  };

  const createSprint = async (payload) => {
    try {
      const result = await api.post('/sprints', payload);
      showSuccess('Sprint created');
      await loadWorkspace(true);
      return result;
    } catch (error) { showError(error); }
  };

  const startSprint = async (sprintId) => {
    try {
      await api.post(`/sprints/${sprintId}/start`, {});
      showSuccess('Sprint started');
      await loadWorkspace(true);
    } catch (error) { showError(error); }
  };

  const completeSprint = async (sprintId) => {
    try {
      await api.post(`/sprints/${sprintId}/complete`, { incomplete_strategy: 'BACKLOG' });
      showSuccess('Sprint completed');
      await loadWorkspace(true);
    } catch (error) { showError(error); }
  };

  const addIssuesToSprint = async (sprintId, issueIds) => {
    if (!sprintId || !issueIds?.length) return;
    try {
      await api.post(`/sprints/${sprintId}/issues`, { issue_ids: issueIds });
      showSuccess('Issues added to sprint');
      await loadWorkspace(true);
    } catch (error) { showError(error); }
  };

  const loadComments = useCallback(async (issueId) => {
    try {
      const result = await api.get(`/issues/${issueId}/comments`);
      setComments(result.comments || []);
    } catch (error) { showError(error); }
  }, [api, showError]);

  useEffect(() => {
    if (selectedIssue?.id) loadComments(selectedIssue.id);
  }, [loadComments, selectedIssue?.id]);

  const addComment = async (issueId, body) => {
    try {
      await api.post(`/issues/${issueId}/comments`, { body });
      await loadComments(issueId);
      showSuccess('Comment added');
    } catch (error) { showError(error); }
  };

  const value = {
    session, updateSession, api,
    page, setPage, mobileNavOpen, setMobileNavOpen,
    toast, loading, eventStatus,
    projects, issues, sprints, members, dashboard,
    activeProject, activeProjectId, setActiveProjectId,
    activeSprint, projectSprints, selectedBoardSprintId,
    boardSprintId, setBoardSprintId,
    boardFilter, setBoardFilter,
    boardQuickFilter, setBoardQuickFilter,
    sprintSchedule,
    taskDrawerOpen, taskDrawerDefaultStatus, openCreateTaskDrawer, closeCreateTaskDrawer,
    query, setQuery,
    backlogIssues, boardIssues, filteredBoardIssues, visibleIssues,
    loadWorkspace, createProject, updateProject, createIssue, updateIssue, deleteIssue, moveIssueStatus,
    createSprint, startSprint, completeSprint, addIssuesToSprint,
    selectedIssue, setSelectedIssue, comments, addComment,
    draggedIssueId, setDraggedIssueId,
    showError, showSuccess, logout
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}
