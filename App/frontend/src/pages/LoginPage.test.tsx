import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Me } from '../api/types';
import { AuthProvider } from '../auth/AuthProvider';
import { renderRoutes } from '../test/render';
import { server } from '../test/setup';
import { faculty } from '../test/fixtures';
import { LoginPage } from './LoginPage';

const me: Me = { ...faculty, email: 'maya.lin@demo.edu', department: { deptId: '1', deptName: 'Computer Science' }, role: 'faculty' };

function openLogin() {
  const seen: string[] = [];
  server.use(http.get('*/api/me', ({ request }) => {
    seen.push(request.headers.get('Authorization') ?? '');
    return HttpResponse.json(me);
  }));
  renderRoutes([
    { path: '/login', element: <AuthProvider mode="demo"><LoginPage /></AuthProvider> },
    { path: '/faculty/evaluation', element: <p>Evaluation page</p> },
  ], '/login');
  return seen;
}

async function submit(email: string, password = 'secret') {
  if (email) await userEvent.type(screen.getByLabelText('Email'), email);
  if (password) await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

afterEach(() => sessionStorage.clear());

describe('Login page footer', () => {
  it('calls the demo build a proof of concept', () => {
    openLogin();
    expect(screen.getByText('CS 4485 capstone, Team 06, proof of concept')).toBeVisible();
  });
});

describe('Login email check', () => {
  it.each(['not-an-email', 'maya@', 'maya lin@demo.edu', '@demo.edu', 'maya@demo'])('stops "%s" before it reaches the server', async (typed) => {
    const seen = openLogin();
    await submit(typed);
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address, like name@utdallas.edu.');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Enter a valid email address, like name@utdallas.edu.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(seen).toEqual([]);
  });

  it('clears the mark when the email is edited, then signs in with a valid address', async () => {
    const seen = openLogin();
    await submit('maya.lin');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(screen.getByLabelText('Email'), '@demo.edu');
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Evaluation page')).toBeVisible();
    expect(seen).toEqual(['Bearer demo:maya.lin@demo.edu']);
  });

  it('still asks for both fields when the email is empty', async () => {
    const seen = openLogin();
    await submit('', 'secret');
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your email and password.');
    expect(seen).toEqual([]);
  });
});
