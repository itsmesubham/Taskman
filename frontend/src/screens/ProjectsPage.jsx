import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { cx } from '../utils.js';

const VISIBILITY_LABELS = {
  EVERYONE: 'Everyone',
  SOME_USERS: 'Some users',
  PRIVATE: 'Private',
};

function ProjectCard({ project, isActive, isDefault, linkedRepoCount = 0, taskCount = 0, onSelect, onChangeVisibility, visibilityOptions, canManage }) {
  return (
    <article
      className={cx('project-card', isActive && 'active')}
      onClick={() => onSelect(project.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(project.id);
        }
      }}
    >
      <div className="project-card-head">
        <span className="project-key">{project.key}</span>
        <div className="project-card-badges">
          {isDefault && <span className="default-badge">Default</span>}
          <span className="visibility-badge">{VISIBILITY_LABELS[project.visibility] || 'Everyone'}</span>
        </div>
      </div>
      <h3>{project.name}</h3>
      <p>{project.description || 'No description yet.'}</p>
      <div className="project-card-meta">
        <span>{linkedRepoCount} linked repos</span>
        <span>{taskCount} tasks</span>
        <span>{project.updated_at ? `Updated ${new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(project.updated_at))}` : 'Recently updated'}</span>
      </div>
      <div className="project-card-foot">
        <small>{project.status}</small>
        {canManage ? (
          <select
            value={project.visibility || 'EVERYONE'}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onChangeVisibility(project.id, event.target.value)}
          >
            {visibilityOptions}
          </select>
        ) : null}
      </div>
    </article>
  );
}

function Modal({ title, description, onClose, children, action }) {
  return (
    <div className="settings-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="settings-dialog wide" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-dialog-head">
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">×</button>
        </div>
        {children}
        <div className="settings-modal-actions">
          {action}
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const {
    session,
    projects,
    createProject,
    updateProject,
    activeProjectId,
    setActiveProjectId,
    sprintSchedule,
    api,
    projectRepositories,
    githubIntegration,
    githubRepositories,
    issues,
    loadWorkspace,
    showError,
    showSuccess,
    connectGithub,
  } = useWorkspace();

  const [projectModalOpen, setProjectModalOpen] = useState(projects.length === 0);
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const [editingRepo, setEditingRepo] = useState(null);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('EVERYONE');
  const [repoName, setRepoName] = useState('');
  const [selectedGithubRepositoryId, setSelectedGithubRepositoryId] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [branchPrefix, setBranchPrefix] = useState('');
  const [repoIsDefault, setRepoIsDefault] = useState(false);
  const [repoDrafts, setRepoDrafts] = useState({});
  const isAdmin = String(session.user?.role || '').toUpperCase() === 'ADMIN';

  useEffect(() => {
    if (!activeProjectId && projects[0]?.id) {
      setActiveProjectId(projects[0].id);
    }
  }, [activeProjectId, projects, setActiveProjectId]);

  const activeProject = projects.find((project) => project.id === activeProjectId) || projects[0] || null;
  const activeProjectRepositories = useMemo(
    () => projectRepositories.filter((repository) => repository.project_id === activeProject?.id),
    [activeProject?.id, projectRepositories]
  );
  const syncedGithubRepos = useMemo(() => githubRepositories || [], [githubRepositories]);
  const selectedGithubRepository = useMemo(
    () => syncedGithubRepos.find((repository) => String(repository.id) === String(selectedGithubRepositoryId)) || syncedGithubRepos[0] || null,
    [selectedGithubRepositoryId, syncedGithubRepos]
  );
  const activeProjectTaskCount = useMemo(
    () => issues.filter((issue) => issue.project_id === activeProject?.id).length,
    [activeProject?.id, issues]
  );

  const visibilityOptions = useMemo(
    () => Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
      <option key={value} value={value}>{label}</option>
    )),
    []
  );

  const openNewProject = () => {
    setProjectModalOpen(true);
    setName('');
    setKey('');
    setDescription('');
    setVisibility('EVERYONE');
  };

  const submitProject = async (event) => {
    event.preventDefault();
    await createProject({ name, key, description, visibility });
    setProjectModalOpen(false);
    setName('');
    setKey('');
    setDescription('');
    setVisibility('EVERYONE');
  };

  const openAddRepository = () => {
    setRepoModalOpen(true);
    setRepoName('');
    setDefaultBranch('main');
    setBranchPrefix('');
    setRepoIsDefault(activeProjectRepositories.length === 0);
    setSelectedGithubRepositoryId(githubIntegration?.connected ? String(syncedGithubRepos[0]?.id || '') : '');
  };

  useEffect(() => {
    if (!repoModalOpen) return;
    if (selectedGithubRepository) {
      setRepoName(selectedGithubRepository.full_name || `${selectedGithubRepository.owner}/${selectedGithubRepository.repo}`);
      setDefaultBranch(selectedGithubRepository.default_branch || 'main');
    }
  }, [repoModalOpen, selectedGithubRepository]);

  const addRepository = async (event) => {
    event.preventDefault();
    if (!activeProject) return;
    try {
      const repositoryPayload = selectedGithubRepository ? {
        github_repository_id: selectedGithubRepository.id,
        repo: selectedGithubRepository.full_name || `${selectedGithubRepository.owner}/${selectedGithubRepository.repo}`,
        default_branch: defaultBranch.trim() || selectedGithubRepository.default_branch || 'main',
        branch_prefix: branchPrefix.trim(),
        is_default: repoIsDefault,
      } : {
        repo: repoName.trim(),
        default_branch: defaultBranch.trim() || 'main',
        branch_prefix: branchPrefix.trim(),
        is_default: repoIsDefault,
      };
      await api.post(`/projects/${activeProject.id}/repositories`, {
        provider: 'github',
        ...repositoryPayload,
      });
      setRepoModalOpen(false);
      setRepoName('');
      setSelectedGithubRepositoryId('');
      setDefaultBranch('main');
      setBranchPrefix('');
      setRepoIsDefault(false);
      showSuccess('Repository added');
      await loadWorkspace(true, true);
    } catch (error) {
      showError(error);
    }
  };

  const saveRepository = async (repositoryId) => {
    if (!activeProject) return;
    const draft = repoDrafts[repositoryId] || {};
    try {
      await api.patch(`/projects/${activeProject.id}/repositories/${repositoryId}`, {
        default_branch: draft.default_branch,
        branch_prefix: draft.branch_prefix,
        is_default: draft.is_default,
      });
      showSuccess('Repository updated');
      setEditingRepo(null);
      await loadWorkspace(true, true);
    } catch (error) {
      showError(error);
    }
  };

  const disableRepository = async (repositoryId) => {
    if (!activeProject) return;
    if (!window.confirm('Disable this repository for the project?')) return;
    try {
      await api.delete(`/projects/${activeProject.id}/repositories/${repositoryId}`);
      showSuccess('Repository disabled');
      await loadWorkspace(true, true);
    } catch (error) {
      showError(error);
    }
  };

  const repoCountForProject = (projectId) => projectRepositories.filter((repository) => repository.project_id === projectId).length;
  const taskCountForProject = (projectId) => issues.filter((issue) => issue.project_id === projectId).length;

  return (
    <div className="page-stack projects-page">
      <PageHeader
        eyebrow="Workspace setup"
        title="Projects"
        description="Organize work, link repositories, and control where AI agents can pick tasks."
        action={<button type="button" className="primary" onClick={openNewProject}>New project</button>}
      />

      <section className="panel projects-section">
        <div className="panel-head wrap">
          <div>
            <h3>Projects</h3>
            <span>Select a project to manage its repositories and agent scope.</span>
          </div>
          <span className="muted">{projects.length} projects</span>
        </div>
        <div className="project-grid compact">
          {projects.map((project) => {
            const isDefault = sprintSchedule?.defaultProject?.id === project.id || (!sprintSchedule?.defaultProject && projects[0]?.id === project.id);
            return (
              <ProjectCard
                key={project.id}
                project={project}
                isActive={activeProjectId === project.id}
                isDefault={isDefault}
                linkedRepoCount={repoCountForProject(project.id)}
                taskCount={taskCountForProject(project.id)}
                canManage={isAdmin || project.created_by === session.user?.id}
                visibilityOptions={visibilityOptions}
                onSelect={setActiveProjectId}
                onChangeVisibility={async (projectId, nextVisibility) => {
                  await updateProject(projectId, { visibility: nextVisibility });
                }}
              />
            );
          })}
        </div>
      </section>

      <section className="panel projects-section">
        <div className="panel-head wrap">
          <div>
            <h3>{activeProject ? `Repositories for ${activeProject.key}` : 'Repositories'}</h3>
            <span>Link GitHub repositories to this project so tasks, PRs, and agents stay scoped correctly.</span>
          </div>
          {githubIntegration?.connected ? (
            <button type="button" className="primary" onClick={openAddRepository} disabled={!activeProject}>
              Add repository
            </button>
          ) : (
            <button type="button" className="primary" onClick={async () => {
              try {
                await connectGithub();
              } catch (error) {
                showError(error);
              }
            }}>
              Connect GitHub
            </button>
          )}
        </div>
        <p className="projects-scope-copy">
          Repositories are scoped to the selected project. Agents can only claim tasks from repositories they are allowed to access.
        </p>

        {!githubIntegration?.connected ? (
          <div className="empty-inline compact">
            <h4>Connect GitHub to link repositories</h4>
            <p>Install the Taskman GitHub App to sync repositories and keep project scope clean.</p>
            <button type="button" className="ghost tiny" onClick={async () => {
              try {
                await connectGithub();
              } catch (error) {
                showError(error);
              }
            }}>Connect GitHub</button>
          </div>
        ) : null}

        {!activeProject ? (
          <div className="empty-inline">Select a project to manage repositories.</div>
        ) : activeProjectRepositories.length ? (
          <div className="repository-table">
            <div className="repository-table-head">
              <span>Repository</span>
              <span>Branch</span>
              <span>Prefix</span>
              <span>Status</span>
              <span>Default</span>
              <span>Actions</span>
            </div>
            {activeProjectRepositories.map((repository) => {
              const draft = repoDrafts[repository.id] || {
                default_branch: repository.default_branch,
                branch_prefix: repository.branch_prefix,
                is_default: repository.is_default,
              };
              const editing = editingRepo === repository.id;
              return (
                <div className={cx('repository-row', editing && 'editing')} key={repository.id}>
                  <div className="repository-row-main">
                    <strong>{repository.repo}</strong>
                    <span>{repository.provider}</span>
                  </div>
                  {editing ? (
                    <>
                      <label>
                        Branch
                        <input
                          value={draft.default_branch || ''}
                          onChange={(event) => setRepoDrafts((current) => ({
                            ...current,
                            [repository.id]: { ...draft, default_branch: event.target.value }
                          }))}
                        />
                      </label>
                      <label>
                        Prefix
                        <input
                          value={draft.branch_prefix || ''}
                          onChange={(event) => setRepoDrafts((current) => ({
                            ...current,
                            [repository.id]: { ...draft, branch_prefix: event.target.value }
                          }))}
                        />
                      </label>
                      <label className="toggle-row compact">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.is_default)}
                          onChange={(event) => setRepoDrafts((current) => ({
                            ...current,
                            [repository.id]: { ...draft, is_default: event.target.checked }
                          }))}
                        />
                        <span>
                          Default
                          <small>New coding tasks will prefer this repository.</small>
                        </span>
                      </label>
                    </>
                  ) : (
                    <>
                      <span>{repository.default_branch || 'main'}</span>
                      <span>{repository.branch_prefix || '—'}</span>
                      <span>
                        <span className={repository.status === 'ACTIVE' ? 'visibility-badge' : 'default-badge'}>
                          {repository.status === 'ACTIVE' ? 'Enabled' : 'Disabled'}
                        </span>
                      </span>
                      <span>{repository.is_default ? <span className="default-badge">Default</span> : <span className="muted">No</span>}</span>
                      <div className="repository-row-actions">
                        <button type="button" className="ghost tiny" onClick={() => setEditingRepo(repository.id)}>Edit</button>
                        <button type="button" className="ghost tiny" onClick={() => disableRepository(repository.id)}>
                          {repository.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </>
                  )}
                  <div className="repository-row-meta">
                    <span className="issue-meta-badge muted">{repository.linked_task_count || 0} tasks</span>
                    {editing ? (
                      <div className="repository-row-actions">
                        <button type="button" className="primary tiny" onClick={() => saveRepository(repository.id)}>Save</button>
                        <button type="button" className="ghost tiny" onClick={() => setEditingRepo(null)}>Cancel</button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-inline">
            <h4>No repositories linked yet.</h4>
            <p>Link a GitHub repository so AI agents can attach PRs and update task status.</p>
            <button type="button" className="ghost tiny" onClick={openAddRepository}>Add repository</button>
          </div>
        )}
      </section>

      {projectModalOpen && (
        <Modal
          title="Create project"
          description="Create a new workspace project for tasks, repos, and sprint planning."
          onClose={() => setProjectModalOpen(false)}
          action={<button type="submit" form="project-create-form" className="primary">Create project</button>}
        >
          <form id="project-create-form" className="form-grid" onSubmit={submitProject}>
            <label>
              Project name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer App" required />
            </label>
            <label>
              Project key
              <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="CAPP" />
            </label>
            <label>
              Visibility
              <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="wide">
              Description
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this project owns" />
            </label>
          </form>
        </Modal>
      )}

      {repoModalOpen && activeProject && (
        <Modal
          title={`Add repository to ${activeProject.key}`}
          description="Link a GitHub repository to this project so tasks, PRs, and agents stay scoped correctly."
          onClose={() => setRepoModalOpen(false)}
          action={<button type="submit" form="repository-create-form" className="primary">Add repository</button>}
        >
          <form id="repository-create-form" className="form-grid" onSubmit={addRepository}>
            {syncedGithubRepos.length ? (
              <label>
                GitHub repository
                <select value={selectedGithubRepositoryId || ''} onChange={(event) => setSelectedGithubRepositoryId(String(event.target.value || ''))}>
                  {syncedGithubRepos.map((repository) => (
                    <option key={repository.id} value={repository.id}>
                      {repository.full_name || `${repository.owner}/${repository.repo}`} · {repository.default_branch || 'main'}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                GitHub repository
                <input value={repoName} onChange={(event) => setRepoName(event.target.value)} placeholder="itsmesubham/Taskman" required />
              </label>
            )}
            <label>
              Default branch
              <input value={defaultBranch} onChange={(event) => setDefaultBranch(event.target.value)} placeholder="main" />
            </label>
            <label>
              Branch prefix
              <input value={branchPrefix} onChange={(event) => setBranchPrefix(event.target.value)} placeholder="taskman/" />
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={repoIsDefault} onChange={(event) => setRepoIsDefault(event.target.checked)} />
              <span>
                Mark as default
                <small>New coding tasks in this project will prefer this repository.</small>
              </span>
            </label>
            <div className="muted">Repositories are scoped to the selected project. Agents can only claim tasks from repositories they are allowed to access.</div>
          </form>
        </Modal>
      )}
    </div>
  );
}
