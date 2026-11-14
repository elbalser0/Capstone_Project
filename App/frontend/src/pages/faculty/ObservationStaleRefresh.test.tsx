import { http, HttpResponse } from 'msw';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { observer, observation } from '../../test/fixtures';
import type { ObservationDetail } from '../../api/types';
import { ObservationFormPage } from './ObservationFormPage';
import { ObservationSignPage } from './ObservationSignPage';
import { clearDraft, draftKey } from './observationDraft';

const original: ObservationDetail = {
  ...observation, templateVersion: { versionId: 'historical', versionNo: 2 },
  lastSavedDate: '2026-09-22T10:00:00Z', otherComments: '', reasonNotCompleted: null,
  answers: [{ questionId: 'q1', title: 'Clarity', wording: 'Was it clear?', ratingMin: 0, ratingMax: 2,
    minLabel: 'Low', maxLabel: 'High', isRequired: true, rating: 0, comment: 'Original server answer' }],
};
const refreshed: ObservationDetail = {
  ...original, lastSavedDate: '2026-09-23T11:00:00Z',
  answers: [{ ...original.answers[0], rating: 2, comment: 'New saved server answer' }],
};
afterEach(() => clearDraft(observer.netid, original.observationId));

it.each(['save', 'edit'] as const)('keeps draft provenance after a mounted refresh followed by %s and requires review on signing', async (action) => {
  let current = original;
  let posts = 0;
  server.use(
    http.get('*/api/me', () => HttpResponse.json({ ...observer, role: 'faculty', email: 'test@example.edu', department: { deptId: '1', deptName: 'CS' } })),
    http.get('*/api/observations/30', () => HttpResponse.json(current)),
    http.post('*/api/observations/30/signed-form', () => { posts++; return HttpResponse.json(current); }),
  );
  const user = userEvent.setup();
  const view = renderRoutes([
    { path: '/faculty/observe/:observationId/form', element: <ObservationFormPage /> },
    { path: '/faculty/observe/:observationId/sign', element: <ObservationSignPage /> },
  ], '/faculty/observe/30/form');
  const comment = await screen.findByRole('textbox', { name: 'Comment on Clarity' });
  await user.clear(comment);
  await user.type(comment, 'My retained local edit');
  current = refreshed;
  await act(async () => { await view.queryClient.invalidateQueries(); });
  expect(comment).toHaveValue('My retained local edit');
  if (action === 'edit') await user.type(comment, ' after refresh');
  await user.click(screen.getByRole('button', { name: 'Save draft on this device' }));
  const saved = JSON.parse(localStorage.getItem(draftKey(observer.netid, '30'))!);
  expect(saved.lastSavedDate).toBe(original.lastSavedDate);
  expect(saved.answers.q1.comment).toBe(action === 'edit' ? 'My retained local edit after refresh' : 'My retained local edit');
  expect(screen.getByRole('alert')).toHaveTextContent(/server record has changed/i);
  await user.click(screen.getByRole('link', { name: 'Go to signatures' }));
  expect(await screen.findByText('New saved server answer')).toBeVisible();
  expect(screen.queryByText(/My retained local edit/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: /I confirm this observation took place/ }));
  await user.type(screen.getByRole('textbox', { name: /Type your full name/ }), `${observer.firstName} ${observer.lastName}`);
  expect(screen.getByRole('button', { name: 'Sign as observer' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /I reviewed the saved server responses/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign as observer' })).toBeEnabled());
  expect(posts).toBe(0);
});
