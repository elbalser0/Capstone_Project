import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { SignUpPage } from './SignUpPage';
import { MyEvaluationPage } from './MyEvaluationPage';
import { course, evaluationStatus, otherCourse, signup } from '../../test/fixtures';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';

function renderSignup() {
  return renderRoutes([
    { path: '/faculty/sign-up', element: <SignUpPage /> },
    { path: '/faculty/evaluation', element: <p>Evaluation overview</p> },
  ], '/faculty/sign-up');
}

beforeEach(() => {
  server.use(http.get('*/api/me/evaluation-status', () => HttpResponse.json(evaluationStatus)));
});

test('explains a failed course load instead of leaving the sign-up screen blank', async () => {
  server.use(http.get('*/api/me/courses', () => HttpResponse.json(
    { error: { code: 'COURSES_UNAVAILABLE', message: 'Courses could not be loaded.' } }, { status: 503 },
  )));
  renderSignup();
  expect(await screen.findByRole('alert')).toHaveTextContent('Courses could not be loaded.');
});

test('returns to evaluation when there is no active cycle without waiting for a disabled courses query', async () => {
  server.use(http.get('*/api/me/evaluation-status', () => HttpResponse.json({ ...evaluationStatus, cycle: null, canSignUp: false })));
  renderSignup();
  expect(await screen.findByText('Evaluation overview')).toBeVisible();
});

test('explains when no courses are available and prevents sign-up', async () => {
  server.use(http.get('*/api/me/courses', () => HttpResponse.json([])));
  renderSignup();
  expect(await screen.findByText(/No courses are available for sign-up/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Submit sign-up' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add a time' })).toBeDisabled();
});

test('explains when a section has no eligible class meetings in the observation window', async () => {
  server.use(http.get('*/api/me/courses', () => HttpResponse.json([{ ...course, classMode: 'online', meetings: [] }])));
  const user = userEvent.setup();
  renderSignup();
  await user.click(await screen.findByRole('button', { name: 'Add a time' }));
  const dialog = screen.getByRole('dialog', { name: 'Add a time' });
  expect(within(dialog).getByText(/No class meetings are available/)).toBeVisible();
  expect(within(dialog).getByRole('button', { name: 'Add times' })).toBeDisabled();
});

async function selectMonday(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Add a time' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Add a time' }));
  await user.click(dialog.getByRole('button', { name: 'Mon Sep 21, 8:30 AM' }));
  await user.click(dialog.getByRole('button', { name: 'Add times' }));
}

test('shows progress, sends exact course/date input once, and returns to evaluation after success', async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((r) => { resolve = r; });
  const bodies: unknown[] = [];
  server.use(
    http.get('*/api/me/courses', () => HttpResponse.json([course])),
    http.post('*/api/signups', async ({ request }) => {
      bodies.push(await request.json());
      await pending;
      return HttpResponse.json(signup, { status: 201 });
    }),
  );
  const user = userEvent.setup();
  renderSignup();
  await selectMonday(user);
  await user.click(screen.getByRole('button', { name: 'Submit sign-up' }));
  try {
    const submitting = await screen.findByRole('button', { name: 'Submitting sign-up…' });
    expect(submitting).toBeDisabled();
    await user.click(submitting);
    expect(bodies).toEqual([{ sectionId: '10', proposedDates: ['2026-09-21'] }]);
  } finally {
    resolve();
  }
  expect(await screen.findByText('Evaluation overview')).toBeVisible();
});

test('keeps course and dates after a failed submission and allows retry', async () => {
  let attempts = 0;
  server.use(
    http.get('*/api/me/courses', () => HttpResponse.json([course])),
    http.post('*/api/signups', () => {
      attempts += 1;
      return attempts === 1
        ? HttpResponse.json({ error: { code: 'TEMPORARY_FAILURE', message: 'Please try again.' } }, { status: 503 })
        : HttpResponse.json(signup, { status: 201 });
    }),
  );
  const user = userEvent.setup();
  renderSignup();
  await selectMonday(user);
  await user.click(screen.getByRole('button', { name: 'Submit sign-up' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.');
  expect(screen.getByRole('radio', { name: /CS 1337.002/ })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Remove Mon Sep 21, 8:30 AM' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Submit sign-up' }));
  expect(await screen.findByText('Evaluation overview')).toBeVisible();
  expect(attempts).toBe(2);
});

test('clears dates when changing sections and supports removing and cancelling date choices', async () => {
  server.use(http.get('*/api/me/courses', () => HttpResponse.json([course, otherCourse])));
  const user = userEvent.setup();
  renderSignup();
  await selectMonday(user);
  expect(screen.getByRole('button', { name: 'Submit sign-up' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Remove Mon Sep 21, 8:30 AM' }));
  expect(screen.getByRole('button', { name: 'Submit sign-up' })).toBeDisabled();
  await selectMonday(user);
  await user.click(screen.getByRole('radio', { name: /CS 2336.001/ }));
  expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Submit sign-up' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Add a time' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.click(dialog.getByRole('button', { name: 'Wed Sep 16, 10:00 AM' }));
  await user.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Submit sign-up' })).toBeDisabled();
});

test('shows loading feedback and requests courses for the active cycle term', async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((r) => { resolve = r; });
  let requestedTerm: string | null = null;
  server.use(http.get('*/api/me/courses', async ({ request }) => {
    requestedTerm = new URL(request.url).searchParams.get('termId');
    await pending;
    return HttpResponse.json([course]);
  }));
  renderSignup();
  try {
    expect(screen.getByRole('status')).toHaveTextContent('Loading sign-up details');
    expect(await screen.findByText('Loading your courses…')).toBeVisible();
  } finally {
    resolve();
  }
  expect(await screen.findByRole('radio', { name: /CS 1337.002/ })).toBeChecked();
  expect(requestedTerm).toBe('1');
});

test('surfaces evaluation-status failures without fetching courses', async () => {
  let courseRequests = 0;
  server.use(
    http.get('*/api/me/evaluation-status', () => HttpResponse.json({ error: { code: 'UNAVAILABLE', message: 'Evaluation status is unavailable.' } }, { status: 503 })),
    http.get('*/api/me/courses', () => { courseRequests += 1; return HttpResponse.json([]); }),
  );
  renderSignup();
  expect(await screen.findByRole('alert')).toHaveTextContent('Evaluation status is unavailable.');
  expect(courseRequests).toBe(0);
});

test.each([
  { startDate: '2026-09-22', endDate: '2026-12-12' },
  { startDate: '2026-08-24', endDate: '2026-09-20' },
])('excludes class meetings outside the course term $startDate to $endDate', async ({ startDate, endDate }) => {
  server.use(http.get('*/api/me/courses', () => HttpResponse.json([{ ...course, term: { ...course.term, startDate, endDate } }])));
  const user = userEvent.setup();
  renderSignup();
  await user.click(await screen.findByRole('button', { name: 'Add a time' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.queryByRole('button', { name: 'Mon Sep 21, 8:30 AM' })).not.toBeInTheDocument();
  expect(dialog.getByText(/No class meetings are available/)).toBeVisible();
});

test('returns to the real evaluation screen with refreshed signup/course data', async () => {
  let submitted = false;
  server.use(
    http.get('*/api/me/evaluation-status', () => HttpResponse.json({ ...evaluationStatus, canSignUp: !submitted, signupId: submitted ? '20' : null })),
    http.get('*/api/me/signup', () => HttpResponse.json(submitted ? signup : null)),
    http.get('*/api/me/observations', () => HttpResponse.json([])),
    http.get('*/api/me/courses', () => HttpResponse.json([course])),
    http.post('*/api/signups', () => { submitted = true; return HttpResponse.json(signup, { status: 201 }); }),
  );
  const user = userEvent.setup();
  renderRoutes([
    { path: '/faculty/sign-up', element: <SignUpPage /> },
    { path: '/faculty/evaluation', element: <MyEvaluationPage /> },
  ], '/faculty/evaluation');
  expect(await screen.findByText('Not signed up yet')).toBeVisible();
  await user.click(screen.getByRole('link', { name: 'Sign up to be observed' }));
  await selectMonday(user);
  await user.click(screen.getByRole('button', { name: 'Submit sign-up' }));
  expect(await screen.findByRole('heading', { name: 'My observations' })).toBeVisible();
  expect(await screen.findByText('CS 1337.002', { exact: true })).toBeVisible();
  expect(screen.queryByText('Not signed up yet')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Sign up to be observed' })).not.toBeInTheDocument();
});
