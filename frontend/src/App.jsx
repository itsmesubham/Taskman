import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import AppShell from './layout/AppShell.jsx';
import AuthScreen from './screens/AuthScreen.jsx';
import TenantOnboarding from './screens/TenantOnboarding.jsx';
import WorkspacePicker from './screens/WorkspacePicker.jsx';
import InviteAcceptScreen from './screens/InviteAcceptScreen.jsx';

function AppGate() {
  const { session, authStatus } = useWorkspace();

  if (authStatus === 'loading') return <div className="app-loading">Loading Taskman…</div>;
  if (authStatus === 'signed_out' && !session.user) return <AuthScreen />;
  if (authStatus === 'signed_out' && session.user && session.tenant?.id) return <AppShell />;
  if (authStatus === 'invite') return <InviteAcceptScreen />;
  if (authStatus === 'onboarding') return <TenantOnboarding />;
  if (authStatus === 'picker') return <WorkspacePicker />;
  return <AppShell />;
}

export default function App() {
  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <AppGate />
      </WorkspaceProvider>
    </ThemeProvider>
  );
}
