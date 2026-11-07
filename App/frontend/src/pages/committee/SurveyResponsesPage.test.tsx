import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { setTokenProvider } from '../../api/client';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { SurveyResponsesPage } from './SurveyResponsesPage';

const cycle = { cycleId: '4', term: { label: 'Fall 2026' } };
const row = { responseId: '9', respondent: { displayName: 'Dr. Lin' }, respondentRole: 'observee', processOk: false, difficulties: 'Issue', additionalFeedback: '', submittedDate: '2026-11-02', troubleFileKey: '87' };
const route = () => renderRoutes([{ path: '/committee/survey-responses', element: <SurveyResponsesPage /> }], '/committee/survey-responses');
function setup(role = 'AC') {
  server.use(http.get('*/api/me', () => HttpResponse.json({ role })), http.get('*/api/cycles/current', () => HttpResponse.json(cycle)));
}

it('does not issue the protected list request for faculty', async () => {
  const list = vi.fn(); setup('faculty');
  server.use(http.get('*/api/cycles/4/survey-responses', () => { list(); return HttpResponse.json([]); }));
  route(); expect(await screen.findByText('Assessment Committee access required.')).toBeVisible();
  expect(list).not.toHaveBeenCalled();
});
it('shows loading, error and retry separately from an empty result', async () => {
  setup(); let attempts = 0;
  server.use(http.get('*/api/cycles/4/survey-responses', () => ++attempts === 1
    ? HttpResponse.json({ error: { code: 'FAIL', message: 'List unavailable' } }, { status: 500 }) : HttpResponse.json([])));
  route(); expect(await screen.findByRole('alert')).toHaveTextContent('List unavailable');
  expect(screen.queryByText('No survey responses yet.')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('No survey responses yet.')).toBeVisible();
});
it('lists responses and downloads the scoped file with bearer auth and safe filename', async () => {
  setup(); setTokenProvider(async () => 'test-token');
  const request = vi.fn();
  server.use(http.get('*/api/cycles/4/survey-responses', () => HttpResponse.json([row])),
    http.get('*/api/cycles/4/survey-responses/9/trouble-file', ({ request: req }) => {
      request(req.headers.get('authorization'));
      return new HttpResponse(new Blob(['file']), { headers: { 'Content-Disposition': "attachment; filename*=UTF-8''..%2Fprivate%3Afile.txt" } });
    }));
  const create = vi.fn(() => 'blob:test'); const revoke = vi.fn();
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = create; URL.revokeObjectURL = revoke;
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('private_file.txt');
    expect(this.href).toBe('blob:test');
  });
  try {
    route(); expect(await screen.findByText('Dr. Lin')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download trouble file' }));
    await screen.findByRole('button', { name: 'Download trouble file' });
    expect(request).toHaveBeenCalledWith('Bearer test-token');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:test');
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; click.mockRestore(); }
});
it('surfaces download errors without creating a blob or losing the response', async () => {
  setup(); setTokenProvider(async () => 'test-token');
  server.use(http.get('*/api/cycles/4/survey-responses', () => HttpResponse.json([row])),
    http.get('*/api/cycles/4/survey-responses/9/trouble-file', () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'File missing' } }, { status: 404 })));
  route(); await userEvent.setup().click(await screen.findByRole('button', { name: 'Download trouble file' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('File missing');
  expect(screen.getByText('Dr. Lin')).toBeVisible();
});
