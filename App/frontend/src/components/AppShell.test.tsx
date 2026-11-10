import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { expect, it } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { cycle, faculty } from '../test/fixtures';
import { renderRoutes } from '../test/render';
import { server } from '../test/setup';
import { AppShell } from './AppShell';

const longTitle = 'A very long page title that has to wrap on a narrow screen';

function renderShell() {
  server.use(
    http.get('/api/me', () => HttpResponse.json({ ...faculty, email: 'maya.lin@demo.edu', role: 'faculty', department: { deptId: '1', deptName: 'Computer Science' } })),
    http.get('/api/cycles/current', () => HttpResponse.json(cycle)),
    http.get('/api/me/requests/incoming', () => HttpResponse.json([])),
    http.get('/api/me/assignments', () => HttpResponse.json([])),
  );
  sessionStorage.setItem('assessment-helper.session', JSON.stringify({ email: 'maya.lin@demo.edu', token: 'demo:maya.lin@demo.edu' }));
  return renderRoutes([{
    element: <AuthProvider mode="demo"><AppShell /></AuthProvider>,
    children: [{ path: '/faculty/evaluation', element: <p>Evaluation</p>, handle: { title: longTitle } }],
  }], '/faculty/evaluation');
}

it('shows the full page title in the top bar', async () => {
  renderShell();
  expect(await screen.findByRole('heading', { level: 1, name: longTitle })).toBeVisible();
});

it('lets the top bar grow and wrap instead of keeping a fixed height', async () => {
  renderShell();
  const heading = await screen.findByRole('heading', { level: 1 });
  const banner = screen.getByRole('banner');
  await within(banner).findByText(faculty.displayName);
  expect(banner).toHaveClass('min-h-14', 'flex-wrap');
  expect(banner).not.toHaveClass('h-14');
  expect(heading).toHaveClass('min-w-0', 'wrap-anywhere');
  const name = within(banner).getByText(faculty.displayName);
  expect(name.parentElement).toHaveClass('min-w-0', 'wrap-anywhere');
  expect(name.closest('div')).toHaveClass('min-w-0');
});

it('keeps the term and the signed-in name inside the top bar', async () => {
  renderShell();
  const banner = await screen.findByRole('banner');
  expect(await within(banner).findByText(faculty.displayName)).toBeVisible();
  expect(within(banner).getByText(cycle.term.label)).toBeVisible();
});
