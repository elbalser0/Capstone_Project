import { Navigate, createBrowserRouter } from 'react-router';
import { AppShell, type RouteHandle } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/committee/DashboardPage';
import { ObservationFormPage, SignPage } from './pages/faculty/ObservationFormPage';
import { ObservationRecordPage } from './pages/faculty/ObservationRecordPage';
import { ConfirmationsPage, ObserveRequestsPage } from './pages/faculty/ObservePage';
import { RequestsPage } from './pages/faculty/RequestsPage';
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
      {
        path: '/faculty/requests',
        element: <RequestsPage />,
        handle: { title: 'My requests' } satisfies RouteHandle,
      },
      {
        path: '/faculty/observations/:observationId',
        element: <ObservationRecordPage />,
        handle: { title: 'Observation record', nav: '/faculty/evaluation' } satisfies RouteHandle,
      },
      {
        path: '/faculty/observe',
        element: <ObserveRequestsPage />,
        handle: { title: 'Observation requests' } satisfies RouteHandle,
      },
      {
        path: '/faculty/observe/confirmations',
        element: <ConfirmationsPage />,
        handle: { title: 'My confirmations' } satisfies RouteHandle,
      },
      {
        path: '/faculty/observe/:observationId',
        element: <ObservationRecordPage />,
        handle: { title: 'Observation record' } satisfies RouteHandle,
      },
      {
        path: '/faculty/observe/:observationId/form',
        element: <ObservationFormPage />,
        handle: { title: 'Observation form' } satisfies RouteHandle,
      },
      {
        path: '/faculty/observe/:observationId/sign',
        element: <SignPage />,
        handle: { title: 'Sign and submit' } satisfies RouteHandle,
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
