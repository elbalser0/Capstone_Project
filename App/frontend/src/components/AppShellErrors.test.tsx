import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Me } from '../api/types';
import { AuthProvider } from '../auth/AuthProvider';
import { renderRoutes } from '../test/render';
import { server } from '../test/setup';
import { cycle, faculty } from '../test/fixtures';
import { AppShell } from './AppShell';

const SESSION_KEY = 'assessment-helper.session';
const committeeMe: Me = { ...faculty, email: 'maya.lin@demo.edu', department: { deptId: '1', deptName: 'Computer Science' }, role: 'AC' };

function openApp(meReply: () => Response) {
  let meCalls = 0;
  server.use(
    http.get('*/api/me', () => { meCalls += 1; return meReply(); }),
    http.get('*/api/cycles/current', () => HttpResponse.json(cycle)),
    http.get('*/api/me/requests/incoming', () => HttpResponse.json([])),
  );
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: 'maya.lin@demo.edu', token: 'demo:test' }));
  renderRoutes([
    { path: '/login', element: <p>Login page</p> },
    {
      element: <AuthProvider mode="demo"><AppShell /></AuthProvider>,
      children: [{ path: '/committee/dashboard', element: <p>Dashboard page</p>, handle: { title: 'Dashboard' } }],
    },
  ], '/committee/dashboard');
  return { meCalls: () => meCalls };
}

afterEach(() => sessionStorage.removeItem(SESSION_KEY));

describe('A committee page when the account check fails', () => {
  it('shows an error with Try again instead of a blank page, and loads once the check works', async () => {
    let fail = true;
    const calls = openApp(() => (fail
      ? HttpResponse.json({ error: { code: 'DB_DOWN', message: 'The database is not reachable.' } }, { status: 500 })
      : HttpResponse.json(committeeMe)));
    expect(await screen.findByRole('heading', { name: 'This page could not load' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('We could not check your account. The database is not reachable.');
    expect(screen.queryByText('Dashboard page')).not.toBeInTheDocument();

    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Dashboard page')).toBeVisible();
    expect(calls.meCalls()).toBe(2);
  });

  it('offers Sign out, which goes to the login page', async () => {
    openApp(() => HttpResponse.json({ error: { code: 'X', message: 'Nope.' } }, { status: 500 }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Login page')).toBeVisible();
  });

  it('shows a loading note while the check runs', async () => {
    openApp(() => HttpResponse.json(committeeMe));
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(await screen.findByText('Dashboard page')).toBeVisible();
  });
});
