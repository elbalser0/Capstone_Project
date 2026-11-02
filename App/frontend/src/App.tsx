import { Navigate, createBrowserRouter } from 'react-router';
import { AppShell, type RouteHandle } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/committee/DashboardPage';
import { RequestsPage } from './pages/faculty/RequestsPage';
import { MyEvaluationPage } from './pages/faculty/MyEvaluationPage';
import { SignUpPage } from './pages/faculty/SignUpPage';
import { MyAssignmentsPage } from './pages/faculty/MyAssignmentsPage';
import { ObservationRecordPage } from './pages/faculty/ObservationRecordPage';
import { ObservationFormPage } from './pages/faculty/ObservationFormPage';
import { ObservationSignPage } from './pages/faculty/ObservationSignPage';

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
      { path: '/faculty/assignments', element: <MyAssignmentsPage />, handle: { title: 'My assignments' } satisfies RouteHandle },
      { path: '/faculty/observe/:observationId', element: <ObservationRecordPage />, handle: { title: 'Observation record', nav: '/faculty/assignments' } satisfies RouteHandle },
      { path: '/faculty/observe/:observationId/form', element: <ObservationFormPage />, handle: { title: 'Observation form', nav: '/faculty/assignments' } satisfies RouteHandle },
      { path: '/faculty/observe/:observationId/sign', element: <ObservationSignPage />, handle: { title: 'Review and sign observation', nav: '/faculty/assignments' } satisfies RouteHandle },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
