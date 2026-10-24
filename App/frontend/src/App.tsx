import { Navigate, createBrowserRouter } from 'react-router';
import { AppShell, type RouteHandle } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/committee/DashboardPage';
import { MyEvaluationPage } from './pages/faculty/MyEvaluationPage';
import { SignUpPage } from './pages/faculty/SignUpPage';

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
        path: '/faculty/sign-up',
        element: <SignUpPage />,
        handle: { title: 'Sign up: choose one course', nav: '/faculty/evaluation' } satisfies RouteHandle,
      },
      {
        path: '/committee/dashboard',
        element: <DashboardPage />,
        handle: { title: 'Cycle results (KPIs)' } satisfies RouteHandle,
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
