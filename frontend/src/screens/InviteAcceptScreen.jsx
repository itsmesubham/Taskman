import { useMemo } from 'react';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { initials } from '../utils.js';

export default function InviteAcceptScreen() {
  const { inviteDetails, inviteError, inviteCode, memberships, acceptInvite, setActiveTenant, navigate } = useWorkspace();

  const alreadyMember = useMemo(() => {
    const tenantId = inviteDetails?.tenant?.id;
    return tenantId ? memberships.some((membership) => membership.tenant_id === tenantId) : false;
  }, [inviteDetails?.tenant?.id, memberships]);

  const workspace = inviteDetails?.tenant;

  const handleJoin = async () => {
    if (!inviteCode) return;
    if (alreadyMember && workspace?.id) {
      await setActiveTenant(workspace.id);
      navigate('/');
      return;
    }
    await acceptInvite(inviteCode);
  };

  return (
    <div className="workspace-setup-screen">
      <section className="workspace-setup-card panel">
        <p className="eyebrow">TASKMAN INVITE</p>
        <h1>Join workspace</h1>
        <p className="muted">You’ve been invited to collaborate in this workspace.</p>

        {inviteError && <div className="inline-error">{inviteError}</div>}

        {workspace && !inviteError && (
          <div className="invite-card">
            <div className="avatar large">{initials(workspace.name)}</div>
            <div>
              <strong>{workspace.name}</strong>
              <span>{workspace.slug}</span>
            </div>
            <span className="visibility-badge">Role: MEMBER</span>
          </div>
        )}

        {alreadyMember && (
          <div className="invite-preview">
            <strong>You’re already a member of this workspace.</strong>
            <span>You can open it directly.</span>
          </div>
        )}

        <div className="form-actions">
          <button className="primary" onClick={handleJoin} disabled={!workspace || !!inviteError}>
            {alreadyMember ? 'Open workspace' : 'Join workspace'}
          </button>
          <button type="button" className="ghost" onClick={() => navigate('/')}>Cancel</button>
        </div>
      </section>
    </div>
  );
}
