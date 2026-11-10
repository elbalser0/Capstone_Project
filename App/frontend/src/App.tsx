import { Navigate, createBrowserRouter } from 'react-router';
import { AppShell, type RouteHandle } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/committee/DashboardPage';
import { CyclePage } from './pages/committee/CyclePage';
import { FacultyPage } from './pages/committee/FacultyPage';
import { RequestsPage } from './pages/faculty/RequestsPage';
import { MyEvaluationPage } from './pages/faculty/MyEvaluationPage';
import { SignUpPage } from './pages/faculty/SignUpPage';
import { ObserveRequestsPage, ConfirmationsPage } from './pages/faculty/ObservePage';
import { ObservationRecordPage } from './pages/faculty/ObservationRecordPage';
import { ObservationFormPage } from './pages/faculty/ObservationFormPage';
import { ObservationSignPage } from './pages/faculty/ObservationSignPage';
import { SurveyPage } from './pages/faculty/SurveyPage';
import { SurveyResponsesPage } from './pages/committee/SurveyResponsesPage';
import { SignupsPage } from './pages/committee/SignupsPage';
import { ProcessGuidePage } from './pages/ProcessGuidePage';
import { ObservationsPage } from './pages/committee/ObservationsPage';
import { DraftPage, PreviewPage, TemplatesLayout, TemplatesPage, VersionPage } from './pages/committee/TemplatesPages';

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
      { path: '/committee/cycle', element: <CyclePage />, handle: { title: 'Start the evaluation cycle' } satisfies RouteHandle },
      { path: '/committee/faculty', element: <FacultyPage />, handle: { title: 'Faculty' } satisfies RouteHandle },
      { path: '/committee/signups', element: <SignupsPage />, handle: { title: 'Sign-up requests' } satisfies RouteHandle },
      {
        path: '/committee/templates',
        element: <TemplatesLayout />,
        children: [
          { index: true, element: <TemplatesPage />, handle: { title: 'Observation templates' } satisfies RouteHandle },
          { path: 'draft', element: <DraftPage />, handle: { title: 'Edit draft', nav: '/committee/templates' } satisfies RouteHandle },
          { path: 'draft/preview', element: <PreviewPage />, handle: { title: 'Preview', nav: '/committee/templates' } satisfies RouteHandle },
          { path: ':versionId', element: <VersionPage />, handle: { title: 'Template version', nav: '/committee/templates' } satisfies RouteHandle },
        ],
      },
      { path: '/committee/observations', element: <ObservationsPage />, handle: { title: 'Observations' } satisfies RouteHandle },
      { path: '/faculty/survey', element: <SurveyPage />, handle: { title: 'End-of-process survey' } satisfies RouteHandle },
      { path: '/committee/survey-responses', element: <SurveyResponsesPage />, handle: { title: 'Survey responses' } satisfies RouteHandle },
      {
        path: '/faculty/requests',
        element: <RequestsPage />,
        handle: { title: 'My requests' } satisfies RouteHandle,
      },
      { path: '/faculty/observe', element: <ObserveRequestsPage />, handle: { title: 'Observation requests' } satisfies RouteHandle },
      { path: '/faculty/observe/confirmations', element: <ConfirmationsPage />, handle: { title: 'My confirmations', nav: '/faculty/observe' } satisfies RouteHandle },
      { path: '/faculty/assignments', element: <Navigate to="/faculty/observe/confirmations" replace /> },
      { path: '/faculty/observe/:observationId', element: <ObservationRecordPage />, handle: { title: 'Observation record', nav: '/faculty/observe' } satisfies RouteHandle },
      { path: '/faculty/observe/:observationId/form', element: <ObservationFormPage />, handle: { title: 'Observation form', nav: '/faculty/observe' } satisfies RouteHandle },
      { path: '/faculty/observe/:observationId/sign', element: <ObservationSignPage />, handle: { title: 'Review and sign observation', nav: '/faculty/observe' } satisfies RouteHandle },
      { path: '/guide', element: <ProcessGuidePage />, handle: { title: 'Process guide' } satisfies RouteHandle },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
