import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth-context';
import { Toaster } from './components/ui/sonner';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AssetsPage from './pages/AssetsPage';
import InspectionPage from './pages/InspectionPage';
import OrangeListPage from './pages/OrangeListPage';
import AdminPage from './pages/AdminPage';
import InspectionHistoryPage from './pages/InspectionHistoryPage';
import SchedulesPage from './pages/SchedulesPage';
import NotificationsPage from './pages/NotificationsPage';
import ProfilePage from './pages/ProfilePage';
import ReportsPage from './pages/ReportsPage';
import PerformanceSheetPage from './pages/PerformanceSheetPage';
import AppLayout from './components/AppLayout';
import './App.css';

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  if (adminOnly && !['superadmin', 'admin'].includes(user.role)) return <Navigate to="/" />;
  
  return children;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  
  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }
  
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/" element={
        <ProtectedRoute>
          <AppLayout>
            <DashboardPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/assets" element={
        <ProtectedRoute>
          <AppLayout>
            <AssetsPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/inspection" element={
        <ProtectedRoute>
          <AppLayout>
            <InspectionPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/inspection-history" element={
        <ProtectedRoute>
          <AppLayout>
            <InspectionHistoryPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/orange-list" element={
        <ProtectedRoute>
          <AppLayout>
            <OrangeListPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/schedules" element={
        <ProtectedRoute>
          <AppLayout>
            <SchedulesPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/notifications" element={
        <ProtectedRoute>
          <AppLayout>
            <NotificationsPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/admin" element={
        <ProtectedRoute adminOnly>
          <AppLayout>
            <AdminPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/profile" element={
        <ProtectedRoute>
          <AppLayout>
            <ProfilePage />
          </AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/reports" element={
        <ProtectedRoute>
          <AppLayout>
            <ReportsPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/performance/:userId" element={
        <ProtectedRoute>
          <AppLayout>
            <PerformanceSheetPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
        <Toaster position="top-right" />
      </AuthProvider>
    </Router>
  );
}

export default App;
