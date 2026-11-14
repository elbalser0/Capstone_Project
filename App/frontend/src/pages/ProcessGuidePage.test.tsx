import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Me } from '../api/types';
import { AuthProvider } from '../auth/AuthProvider';
import { AppShell } from '../components/AppShell';
import { DUE_STATUS_TEXT } from '../lib/statusTerms';
import { renderRoutes } from '../test/render';
import { server } from '../test/setup';
import { cycle, faculty } from '../test/fixtures';
import { ProcessGuidePage } from './ProcessGuidePage';

const SESSION_KEY = 'assessment-helper.session';
const facultyMe: Me = { ...faculty, email: 'maya.lin@demo.edu', department: { deptId: '1', deptName: 'Computer Science' }, role: 'faculty' };
const committeeMe: Me = { ...facultyMe, role: 'AC' };

const never = () => new Promise<never>(() => {});
const failure = (message: string) => HttpResponse.json({ error: { code: 'FAILED', message } }, { status: 500 });

function serve(me: Me = facultyMe, current: () => Response | Promise<never> = () => HttpResponse.json(cycle)) {
  server.use(
    http.get('*/api/me', () => HttpResponse.json(me)),
    http.get('*/api/cycles/current', current),
    // The sidebar badge for new observation requests asks for these once it is added.
    http.get('*/api/me/requests/incoming', () => HttpResponse.json([])),
  );
}

/** The guide inside the signed-in layout, so the sidebar and the top bar are there too. */
function openApp(path: string) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: 'maya.lin@demo.edu', token: 'demo:test' }));
  return renderRoutes([{
    element: <AuthProvider mode="demo"><AppShell /></AuthProvider>,
    children: [
      { path: '/guide', element: <ProcessGuidePage />, handle: { title: 'Process guide' } },
      { path: '/faculty/evaluation', element: <p>My evaluation page</p>, handle: { title: 'My evaluation' } },
      { path: '/committee/dashboard', element: <p>Dashboard page</p>, handle: { title: 'Cycle results (KPIs)' } },
    ],
  }], path);
}

afterEach(() => sessionStorage.removeItem(SESSION_KEY));

describe('Process guide', () => {
  it("shows the current cycle's three deadlines in the cycle card only", async () => {
    serve();
    openApp('/guide');
    expect(await screen.findByRole('heading', { level: 1, name: 'Process guide' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Fall 2026 cycle' })).toBeVisible();
    expect(screen.getByText('Sign-up deadline').nextElementSibling).toHaveTextContent('Sep 15, 2026');
    expect(screen.getByText('Observation period deadline').nextElementSibling).toHaveTextContent('Sep 21, 2026');
    expect(screen.getByText('Survey window').nextElementSibling).toHaveTextContent(/Sep 22.*Oct 1, 2026/);
    // The steps stay general: no dates from the cycle.
    expect(screen.getByText(/sign up before the sign-up deadline:/)).toBeVisible();
    expect(screen.queryByText(/Sep 15:|by Sep 21|From Sep 22/)).not.toBeInTheDocument();
  });

  it('says no cycle has started and still explains the steps', async () => {
    serve(facultyMe, () => HttpResponse.json(null));
    openApp('/guide');
    expect(await screen.findByText(/No evaluation cycle has started yet/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Current cycle' })).toBeVisible();
    expect(screen.queryByText('Sign-up deadline')).not.toBeInTheDocument();
    expect(screen.getByText(/sign up before the sign-up deadline:/)).toBeVisible();
  });

  it('says the cycle is loading, with the rest of the guide already shown', async () => {
    serve(facultyMe, never);
    openApp('/guide');
    expect(await screen.findByText('Loading the current cycle…')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'How a semester works' })).toBeVisible();
    expect(screen.getByText(/sign up before the sign-up deadline:/)).toBeVisible();
  });

  it('shows a failed cycle read as an error with Try again, and loads it again', async () => {
    let calls = 0;
    serve(facultyMe, () => (++calls === 1 ? failure('The cycle could not be read.') : HttpResponse.json(cycle)));
    const user = userEvent.setup();
    openApp('/guide');
    expect(await screen.findByText("Couldn't load the current cycle: The cycle could not be read.")).toBeVisible();
    expect(screen.getByRole('heading', { name: 'How a semester works' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Fall 2026 cycle' })).toBeVisible();
    expect(screen.queryByText(/Couldn't load the current cycle/)).not.toBeInTheDocument();
  });

  it('explains every due status with the shared wording', async () => {
    serve();
    openApp('/guide');
    const heading = await screen.findByRole('heading', { name: 'Who is due' });
    const list = heading.nextElementSibling;
    if (!(list instanceof HTMLElement)) throw new Error('No list under the heading.');
    for (const text of Object.values(DUE_STATUS_TEXT)) expect(within(list).getByText(text)).toBeVisible();
  });
});

describe('Process guide link in the sidebar', () => {
  it('shows in Faculty mode and opens the guide', async () => {
    serve();
    const user = userEvent.setup();
    const { router } = openApp('/faculty/evaluation');
    expect(await screen.findByText('My evaluation page')).toBeVisible();
    const link = screen.getByRole('link', { name: 'Process guide' });
    expect(link).toHaveAttribute('href', '/guide');
    await user.click(link);
    expect(router.state.location.pathname).toBe('/guide');
    expect(await screen.findByRole('heading', { name: 'How a semester works' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Process guide' })).toHaveClass('font-bold');
  });

  it('shows in Committee mode and opens the guide', async () => {
    serve(committeeMe);
    const user = userEvent.setup();
    const { router } = openApp('/committee/dashboard');
    expect(await screen.findByText('Dashboard page')).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Assessment Committee' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Process guide' }));
    expect(router.state.location.pathname).toBe('/guide');
    expect(await screen.findByRole('heading', { name: 'How a semester works' })).toBeVisible();
  });

  it('lets a faculty-only account open the guide but not the dashboard', async () => {
    serve();
    const { router } = openApp('/committee/dashboard');
    expect(await screen.findByText('My evaluation page')).toBeVisible();
    expect(router.state.location.pathname).toBe('/faculty/evaluation');
    expect(screen.queryByText('Dashboard page')).not.toBeInTheDocument();
  });
});
