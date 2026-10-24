import { Navigate, createBrowserRouter } from 'react-router';
import { AppShell, type RouteHandle } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/committee/DashboardPage';
import { RequestsPage } from './pages/faculty/RequestsPage';
import { MyEvaluationPage } from './pages/faculty/MyEvaluationPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/faculty/evaluation" replace /> },
      {
        path: '/faculty/evaluation',
        element: <MyEvaluationPage />,
        handle: { title: 'My evaluation' } satisfies RouteHandle,
      },
      {
        path: '/committee/dashboard',
        element: <DashboardPage />,
        handle: { title: 'Cycle results (KPIs)' } satisfies RouteHandle,
      },
      {
        path: '/faculty/requests',
        element: <RequestsPage />,
        handle: { title: 'My requests' } satisfies RouteHandle,
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
