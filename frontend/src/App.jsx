import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext.jsx';
import AppShell from './layout/AppShell.jsx';
import AuthScreen from './screens/AuthScreen.jsx';

function AppGate() {
  const { session } = useWorkspace();
  return session.token ? <AppShell /> : <AuthScreen />;
}

export default function App() {
  return (
    <WorkspaceProvider>
      <AppGate />
    </WorkspaceProvider>
  );
}
