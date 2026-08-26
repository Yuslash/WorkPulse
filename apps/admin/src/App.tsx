import { Navigate, Route, Routes } from 'react-router-dom';
import { Role } from '@workpulse/shared';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/layouts/AppShell';
import { LoadingBlock } from '@/components/ui';

import { WelcomePage } from '@/pages/WelcomePage';
import { RegisterPage } from '@/pages/RegisterPage';
import { LoginPage } from '@/pages/LoginPage';
import { OverviewPage } from '@/pages/OverviewPage';
import { EmployeesPage } from '@/pages/EmployeesPage';
import { EmployeeDetailPage } from '@/pages/EmployeeDetailPage';
import { LiveActivityPage } from '@/pages/LiveActivityPage';
import { AttendancePage } from '@/pages/AttendancePage';
import { TeamsPage } from '@/pages/TeamsPage';
import { ApplicationsPage } from '@/pages/ApplicationsPage';
import { DevicesPage } from '@/pages/DevicesPage';
import { AgentHealthPage } from '@/pages/AgentHealthPage';
import { PoliciesPage } from '@/pages/PoliciesPage';
import { AuditLogsPage } from '@/pages/AuditLogsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ClientDownloadsPage } from '@/pages/ClientDownloadsPage';

/**
 * Routes are guarded twice: here for navigation, and again on the server for
 * every request. The client-side check is a courtesy that hides dead ends —
 * it is never the thing that keeps data safe.
 *
 * `/` is the pre-session welcome screen (create a company, sign in, or
 * leave); the dashboard itself lives under `/dashboard` so it never competes
 * with that landing page for the root path.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  // Waiting for the silent refresh to settle, so a reload does not bounce a
  // signed-in admin to the login screen for a moment.
  if (loading) return <LoadingBlock label="Restoring session" />;
  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

function RequireRole({ role, children }: { role: Role; children: React.ReactNode }) {
  const { can, loading } = useAuth();

  if (loading) return <LoadingBlock />;
  if (!can(role)) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}

export function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      <Route path="/" element={<WelcomePage />} />

      <Route
        path="/register"
        element={loading ? <LoadingBlock /> : user ? <Navigate to="/dashboard" replace /> : <RegisterPage />}
      />

      <Route
        path="/login"
        element={
          loading ? <LoadingBlock /> : user ? <Navigate to="/dashboard" replace /> : <LoginPage />
        }
      />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<OverviewPage />} />
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/employees/:id" element={<EmployeeDetailPage />} />
        <Route path="/live" element={<LiveActivityPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/agent-health" element={<AgentHealthPage />} />
        <Route path="/policies" element={<PoliciesPage />} />
        <Route
          path="/audit"
          element={
            <RequireRole role={Role.HrAdmin}>
              <AuditLogsPage />
            </RequireRole>
          }
        />
        <Route path="/client-downloads" element={<ClientDownloadsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/'} replace />} />
    </Routes>
  );
}
