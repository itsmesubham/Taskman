import { useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { cx } from '../utils.js';

const VISIBILITY_LABELS = {
  EVERYONE: 'Everyone',
  SOME_USERS: 'Some users',
  PRIVATE: 'Private'
};

export default function ProjectsPage() {
  const { session, projects, createProject, updateProject, activeProjectId, setActiveProjectId, sprintSchedule, api, projectRepositories, loadWorkspace, showError, showSuccess } = useWorkspace();
  const [formOpen, setFormOpen] = useState(projects.length === 0);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('EVERYONE');
  const [repoName, setRepoName] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [branchPrefix, setBranchPrefix] = useState('');
  const [repoIsDefault, setRepoIsDefault] = useState(false);
  const [repoDrafts, setRepoDrafts] = useState({});
  const isAdmin = String(session.user?.role || '').toUpperCase() === 'ADMIN';
  const activeProject = projects.find((project) => project.id === activeProjectId) || projects[0] || null;
  const activeProjectRepositories = useMemo(
    () => projectRepositories.filter((repository) => repository.project_id === activeProject?.id),
    [activeProject?.id, projectRepositories]
  );

  const submit = async (event) => {
    event.preventDefault();
    await createProject({ name, key, description, visibility });
    setName('');
    setKey('');
    setDescription('');
    setVisibility('EVERYONE');
    setFormOpen(false);
  };

  const addRepository = async (event) => {
    event.preventDefault();
    if (!activeProject) return;
    try {
      await api.post(`/projects/${activeProject.id}/repositories`, {
        repo: repoName.trim(),
        default_branch: defaultBranch.trim() || 'main',
        branch_prefix: branchPrefix.trim(),
        is_default: repoIsDefault
      });
      setRepoName('');
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
        is_default: draft.is_default
      });
      showSuccess('Repository updated');
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

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Workspace setup"
        title="Projects"
        description="Projects stay available for organization and reporting, but they are no longer the first thing users must think about."
        action={(
          <button type="button" className="primary" onClick={() => setFormOpen((current) => !current)}>
            {formOpen ? 'Close' : 'New project'}
          </button>
        )}
      />

      {formOpen && (
        <section className="panel form-panel">
          <form className="form-grid" onSubmit={submit}>
            <label>
              Project name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer App" required />
            </label>
            <label>
              Key
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
            <div className="form-actions wide">
              <button type="submit" className="primary">Create project</button>
            </div>
          </form>
        </section>
      )}

      <div className="project-grid">
        {projects.map((project) => {
          const isDefault = sprintSchedule?.defaultProject?.id === project.id || (!sprintSchedule?.defaultProject && projects[0]?.id === project.id);
          return (
            <article
              key={project.id}
              className={cx('project-card', activeProjectId === project.id && 'active')}
              onClick={() => setActiveProjectId(project.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setActiveProjectId(project.id);
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
              <p>{project.description || 'No description'}</p>
              <div className="project-card-foot">
                <small>{project.status}</small>
                {(isAdmin || project.created_by === session.user?.id) && (
                  <select
                    value={project.visibility || 'EVERYONE'}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => updateProject(project.id, { visibility: event.target.value })}
                  >
                    {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {activeProject && (
        <section className="panel">
          <div className="panel-head wrap">
            <div>
              <h3>Repositories</h3>
              <span>{activeProject.key} · {activeProjectRepositories.length} linked repositories</span>
            </div>
            <span>Project scoped</span>
          </div>
          <form className="form-grid repo-form" onSubmit={addRepository}>
            <label>
              GitHub repo
              <input value={repoName} onChange={(event) => setRepoName(event.target.value)} placeholder="itsmesubham/Taskman" required />
            </label>
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
                <small>New coding tasks will prefer this repo.</small>
              </span>
            </label>
            <div className="form-actions wide">
              <button type="submit" className="primary">Add repository</button>
            </div>
          </form>

          <div className="repo-list">
            {activeProjectRepositories.map((repository) => {
              const draft = repoDrafts[repository.id] || {
                default_branch: repository.default_branch,
                branch_prefix: repository.branch_prefix,
                is_default: repository.is_default
              };
              return (
                <article className="repo-row" key={repository.id}>
                  <div className="repo-row-main">
                    <strong>{repository.repo}</strong>
                    <span>{repository.provider}</span>
                  </div>
                  <div className="repo-row-grid">
                    <label>
                      Default branch
                      <input
                        value={draft.default_branch || ''}
                        onChange={(event) => setRepoDrafts((current) => ({
                          ...current,
                          [repository.id]: { ...draft, default_branch: event.target.value }
                        }))}
                      />
                    </label>
                    <label>
                      Branch prefix
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
                        <small>{repository.is_default ? 'Currently default' : 'Select for new coding tasks'}</small>
                      </span>
                    </label>
                  </div>
                  <div className="repo-row-meta">
                    <span className="visibility-badge">{repository.status}</span>
                    <span className="issue-meta-badge muted">{repository.linked_task_count || 0} tasks</span>
                  </div>
                  <div className="repo-row-actions">
                    <button type="button" className="ghost tiny" onClick={() => saveRepository(repository.id)}>Save</button>
                    <button type="button" className="danger tiny" onClick={() => disableRepository(repository.id)}>Disable</button>
                  </div>
                </article>
              );
            })}
            {!activeProjectRepositories.length && <div className="empty-inline">No repositories linked to this project yet.</div>}
          </div>
        </section>
      )}
    </div>
  );
}
