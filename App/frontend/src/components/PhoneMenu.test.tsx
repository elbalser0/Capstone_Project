import { http, HttpResponse } from 'msw';
import { act, screen, within } from '@testing-library/react';
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

function openApp(path = '/committee/dashboard') {
  server.use(
    http.get('*/api/me', () => HttpResponse.json(committeeMe)),
    http.get('*/api/cycles/current', () => HttpResponse.json(cycle)),
    http.get('*/api/me/requests/incoming', () => HttpResponse.json([])),
  );
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: 'maya.lin@demo.edu', token: 'demo:test' }));
  return renderRoutes([{
    element: <AuthProvider mode="demo"><AppShell /></AuthProvider>,
    children: [
      { path: '/committee/dashboard', element: <p>Dashboard page</p>, handle: { title: 'Dashboard' } },
      { path: '/committee/cycle', element: <p>Cycle page</p>, handle: { title: 'Cycle' } },
      { path: '/faculty/evaluation', element: <p>Evaluation page</p>, handle: { title: 'My evaluation' } },
      { path: '/guide', element: <p>Guide page</p>, handle: { title: 'Process guide' } },
    ],
  }], path);
}

afterEach(() => sessionStorage.removeItem(SESSION_KEY));

const sidebar = () => document.getElementById('app-sidebar')!;
const isClosed = () => sidebar().classList.contains('max-md:-translate-x-full') && sidebar().classList.contains('max-md:invisible');

describe('Phone menu', () => {
  it('hides the sidebar below md behind a menu button that opens it', async () => {
    openApp();
    expect(await screen.findByText('Dashboard page')).toBeVisible();
    const open = screen.getByRole('button', { name: 'Open menu' });
    expect(open).toHaveClass('md:hidden');
    expect(open).toHaveAttribute('aria-controls', 'app-sidebar');
    expect(open).toHaveAttribute('aria-expanded', 'false');
    expect(isClosed()).toBe(true);
    // From md up the sidebar stays beside the page as before.
    expect(sidebar()).toHaveClass('sticky', 'w-[220px]', 'max-md:fixed');

    await userEvent.click(open);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(isClosed()).toBe(false);
  });

  it('closes on the close button, on Escape and when a link opens another page', async () => {
    openApp();
    await screen.findByText('Dashboard page');
    const open = screen.getByRole('button', { name: 'Open menu' });

    await userEvent.click(open);
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(isClosed()).toBe(true);

    await userEvent.click(open);
    await userEvent.keyboard('{Escape}');
    expect(isClosed()).toBe(true);

    await userEvent.click(open);
    await userEvent.click(within(sidebar()).getByRole('link', { name: 'Cycle' }));
    expect(await screen.findByText('Cycle page')).toBeVisible();
    expect(isClosed()).toBe(true);
  });

  it('closes when the link to the page already open is tapped, and hands focus back to the menu button', async () => {
    openApp('/committee/cycle');
    await screen.findByText('Cycle page');
    const open = screen.getByRole('button', { name: 'Open menu' });
    await userEvent.click(open);
    expect(isClosed()).toBe(false);
    await userEvent.click(within(sidebar()).getByRole('link', { name: 'Cycle' }));
    expect(screen.getByText('Cycle page')).toBeVisible();
    expect(isClosed()).toBe(true);
    expect(open).toHaveFocus();
  });

  it('moves focus into the open menu, keeps the page out of reach, and hands focus back on close', async () => {
    openApp();
    await screen.findByText('Dashboard page');
    const open = screen.getByRole('button', { name: 'Open menu' });
    await userEvent.click(open);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus();
    expect(screen.getByRole('main').closest('.app-shell-content')).toHaveAttribute('inert');
    await userEvent.keyboard('{Escape}');
    expect(open).toHaveFocus();
    expect(screen.getByRole('main').closest('.app-shell-content')).not.toHaveAttribute('inert');
  });

  it('keeps the view the Process guide was opened from', async () => {
    const { router } = openApp('/committee/cycle');
    await screen.findByText('Cycle page');
    await userEvent.click(within(sidebar()).getByRole('link', { name: 'Process guide' }));
    expect(await screen.findByText('Guide page')).toBeVisible();
    expect(within(sidebar()).getByRole('navigation', { name: 'Assessment Committee' })).toBeInTheDocument();
    await act(() => router.navigate('/faculty/evaluation'));
    await screen.findByText('Evaluation page');
    await act(() => router.navigate('/guide'));
    await screen.findByText('Guide page');
    expect(within(sidebar()).getByRole('navigation', { name: 'Faculty' })).toBeInTheDocument();
  });

  it('uses narrower page padding on small screens', async () => {
    openApp();
    await screen.findByText('Dashboard page');
    expect(screen.getByRole('main')).toHaveClass('px-4', 'md:px-8');
    expect(screen.getByRole('main')).not.toHaveClass('px-8');
  });
});
