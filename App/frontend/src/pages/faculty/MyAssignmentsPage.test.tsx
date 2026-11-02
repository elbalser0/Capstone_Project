import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { observation } from '../../test/fixtures';
import { MyAssignmentsPage } from './MyAssignmentsPage';

it('distinguishes an empty assignment list from a failed request', async () => {
  server.use(http.get('*/api/me/assignments', () => HttpResponse.json([])));
  renderRoutes([{ path: '/faculty/assignments', element: <MyAssignmentsPage /> }], '/faculty/assignments');
  expect(await screen.findByText('No assigned observations yet.')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('shows an assignment error rather than an empty list', async () => {
  server.use(http.get('*/api/me/assignments', () => HttpResponse.json({ error: { code: 'FAILED', message: 'Assignments unavailable' } }, { status: 500 })));
  renderRoutes([{ path: '/faculty/assignments', element: <MyAssignmentsPage /> }], '/faculty/assignments');
  expect(await screen.findByRole('alert')).toHaveTextContent('Assignments unavailable');
  expect(screen.queryByText('No assigned observations yet.')).not.toBeInTheDocument();
});
it('lists assigned observations with normal links to the record and editable form', async () => {
  server.use(http.get('*/api/me/assignments', () => HttpResponse.json([observation])));
  renderRoutes([{ path: '/faculty/assignments', element: <MyAssignmentsPage /> }], '/faculty/assignments');
  expect(await screen.findByRole('link', { name: 'View record' })).toHaveAttribute('href', '/faculty/observe/30');
  expect(screen.getByRole('link', { name: 'Open form' })).toHaveAttribute('href', '/faculty/observe/30/form');
});
