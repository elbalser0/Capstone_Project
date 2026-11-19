import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { renderRoutes } from '../test/render';
import { LoginPage } from './LoginPage';

// The page reads the build's sign-in mode; here the build is a real (Firebase) sign-in build.
vi.mock('../auth/AuthProvider', async (importOriginal) => ({ ...(await importOriginal<typeof import('../auth/AuthProvider')>()), AUTH_MODE: 'firebase' }));

describe('Login page with the real sign-in', () => {
  it('does not call the app a proof of concept and lists no demo accounts', () => {
    renderRoutes([{ path: '/login', element: <AuthProvider mode="demo"><LoginPage /></AuthProvider> }], '/login');
    expect(screen.getByText('CS 4485 capstone, Team 06')).toBeVisible();
    expect(screen.queryByText(/proof of concept/i)).not.toBeInTheDocument();
    expect(screen.queryByText('linda.chen@demo.edu')).not.toBeInTheDocument();
  });
});
