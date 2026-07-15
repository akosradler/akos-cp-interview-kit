import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authSlice';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Analytics from './pages/Analytics';
import Billing from './pages/Billing';
import Team from './pages/Team';
import Layout from './components/Common/Layout';
import OrganizationSettings from './pages/OrganizationSettings';
import Webhooks from './pages/Webhooks';
import AuditLogs from './pages/AuditLogs';
import SharedDashboard from './pages/SharedDashboard';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  return <>{children}</>;
}

function App() {
  const checkAuth = useAuthStore((state) => state.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Public shared dashboard route - no auth required */}
      <Route path="/shared/:shareId" element={<SharedDashboard />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="dashboard/:dashboardId" element={<Dashboard />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="settings" element={<Settings />} />
        <Route path="billing" element={<Billing />} />
        <Route path="team" element={<Team />} />
        <Route path="organization" element={<OrganizationSettings />} />
        <Route path="webhooks" element={<Webhooks />} />
        <Route path="webhooks/:webhookId" element={<Webhooks />} />
        <Route path="audit" element={<AuditLogs />} />
      </Route>
    </Routes>
  );
}

export default App;
