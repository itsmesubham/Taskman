import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext.jsx';
import AppShell from './layout/AppShell.jsx';
import AuthScreen from './screens/AuthScreen.jsx';
import TenantOnboarding from './screens/TenantOnboarding.jsx';
import WorkspacePicker from './screens/WorkspacePicker.jsx';
import InviteAcceptScreen from './screens/InviteAcceptScreen.jsx';

function AppGate() {
  const { session, authStatus, bootstrapReady } = useWorkspace();

  if (!session.token) return <AuthScreen />;
  if (!bootstrapReady || authStatus === 'loading') {
    return (
      <div className="workspace-setup-screen">
        <section className="workspace-setup-card panel">
          <p className="eyebrow">TASKMAN</p>
          <h1>Loading workspace</h1>
          <p className="muted">Checking your memberships and workspace access.</p>
        </section>
      </div>
    );
  }
  if (authStatus === 'invite') return <InviteAcceptScreen />;
  if (authStatus === 'onboarding') return <TenantOnboarding />;
  if (authStatus === 'picker') return <WorkspacePicker />;
  return <AppShell />;
}

export default function App() {
  return (
    <WorkspaceProvider>
      <AppGate />
    </WorkspaceProvider>
  );
}
