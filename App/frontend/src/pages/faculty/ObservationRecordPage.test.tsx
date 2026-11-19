import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { course, cycle, faculty, observation, observer } from '../../test/fixtures';
import type { ObservationDetail } from '../../api/types';
import { AuthProvider } from '../../auth/AuthProvider';
import { AppShell } from '../../components/AppShell';
import { setTokenProvider } from '../../api/client';
import { ObservationRecordPage } from './ObservationRecordPage';

afterEach(() => vi.restoreAllMocks());

export const detail: ObservationDetail = {
  ...observation, templateVersion: { versionId: 'old', versionNo: 3 }, lastSavedDate: '2026-09-22T10:00:00Z',
  otherComments: 'Good pacing', reasonNotCompleted: null,
  answers: [{ questionId: 'q1', title: 'Clarity', wording: 'Was the explanation clear?', ratingMin: 0, ratingMax: 2, minLabel: 'Needs work', maxLabel: 'Excellent', isRequired: true, rating: 0, comment: 'Clear examples' }],
};
export function serveRecord(record: ObservationDetail = detail, netid = faculty.netid) {
  server.use(
    http.get('*/api/me', () => HttpResponse.json({ ...faculty, netid, email: 'test@example.edu', role: 'faculty', department: { deptId: '1', deptName: 'CS' } })),
    http.get('*/api/observations/30', () => HttpResponse.json(record)),
  );
}
export function openRecord(path = '/faculty/observe/30') {
  return renderRoutes([{ path: '/faculty/observe/:observationId', element: <ObservationRecordPage /> }], path);
}
it('shows loading until the observation arrives', async () => {
  serveRecord(); openRecord();
  expect(screen.getByRole('status')).toHaveTextContent('Loading observation record');
  expect(await screen.findByText('Clear examples')).toBeVisible();
});
it('reports a record failure without showing saved content', async () => {
  serveRecord();
  server.use(http.get('*/api/observations/30', () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Observation not found' } }, { status: 404 })));
  openRecord();
  expect(await screen.findByRole('alert')).toHaveTextContent('Observation not found');
  expect(screen.queryByText('Clear examples')).not.toBeInTheDocument();
});
it('loads the assigned record with its saved zero rating and no signing control', async () => {
  serveRecord(); openRecord();
  expect(await screen.findByText('Clear examples')).toBeVisible();
  expect(screen.getByRole('img', { name: 'Clarity: 0 of 2' })).toBeVisible();
  expect(screen.getByText('Good pacing')).toBeVisible();
  expect(screen.queryByRole('button', { name: /sign/i })).not.toBeInTheDocument();
});
it('calls the browser print dialog from the saved record', async () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  serveRecord({ ...detail, observerSignedDate: '2026-09-22', observeeSignedDate: null });
  const user = userEvent.setup();
  openRecord();
  expect(await screen.findByText('Clear examples')).toBeVisible();
  expect(screen.getByRole('heading', { level: 2, name: 'CS 1337.002 Computer Science I, Mon Sep 21, 2026, 8:30 AM' })).toBeVisible();
  expect(screen.getByText('Observation Template v3, observer Dr. Elena Ruiz')).toBeVisible();
  expect(screen.getByText('Was the explanation clear?')).toBeVisible();
  expect(screen.getByRole('img', { name: 'Clarity: 0 of 2' })).toBeVisible();
  expect(screen.getByText('Observer: Dr. Elena Ruiz')).toBeVisible();
  expect(screen.getByText('Observee: Dr. Maya Lin (you)')).toBeVisible();
  expect(screen.getByText('signed Sep 22, 2026')).toBeVisible();
  expect(screen.getByText('Not signed yet')).toBeVisible();
  expect(screen.getByText('Good pacing')).toBeVisible();
  const printButton = screen.getByRole('button', { name: 'Print record' });
  expect(printButton).toHaveClass('screen-only');
  await user.click(printButton);
  expect(print).toHaveBeenCalledOnce();
  expect(screen.getByText('Waiting for your signature')).toBeVisible();
});
it('keeps line breaks in saved comments', async () => {
  serveRecord({ ...detail, otherComments: 'First\nSecond', answers: [{ ...detail.answers[0], comment: 'Line one\n\nLine three' }] }); openRecord();
  const comment = await screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === 'Line one\n\nLine three');
  expect(comment).toHaveClass('whitespace-pre-line');
  expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'First\nSecond')).toHaveClass('whitespace-pre-line');
});
it('shows the contextual header, status badge, read-only badge and signatures with dates only', async () => {
  serveRecord({ ...detail, observerSignedDate: '2026-09-22' }); openRecord();
  expect(await screen.findByRole('heading', { level: 2, name: 'CS 1337.002 Computer Science I, Mon Sep 21, 2026, 8:30 AM' })).toBeVisible();
  expect(screen.getByText('Observation Template v3, observer Dr. Elena Ruiz')).toBeVisible();
  expect(screen.getByText('Waiting for your signature')).toBeVisible();
  expect(screen.getByText('Read only')).toBeVisible();
  expect(screen.getByText('Observer: Dr. Elena Ruiz')).toBeVisible();
  expect(screen.getByText('signed Sep 22, 2026')).toBeVisible();
  expect(screen.getByText('Observee: Dr. Maya Lin (you)')).toBeVisible();
  expect(screen.getByText('Not signed yet')).toBeVisible();
  expect(screen.queryByText(/\d{1,2}:\d{2} [AP]M.*signed|signed.*\d{1,2}:\d{2}/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign' })).toBeEnabled();
});
it('leaves the time out of the header when the section meets twice that weekday', async () => {
  const twice = { ...course, meetings: [course.meetings[0], { ...course.meetings[0], startTime: '14:00', endTime: '15:15' }] };
  serveRecord({ ...detail, section: twice }); openRecord();
  expect(await screen.findByRole('heading', { level: 2, name: 'CS 1337.002 Computer Science I, Mon Sep 21, 2026' })).toBeVisible();
});
it.each([
  ['the observee', faculty.netid, 'My evaluation'],
  ['the observer', observer.netid, 'Observe'],
])('highlights the sidebar item that led to the record for %s', async (_who, netid, item) => {
  sessionStorage.setItem('assessment-helper.session', JSON.stringify({ email: 'test@example.edu', token: 'demo:test' }));
  serveRecord({ ...detail, observer }, netid);
  server.use(http.get('*/api/cycles/current', () => HttpResponse.json(cycle)), http.get('*/api/me/requests/incoming', () => HttpResponse.json([])));
  renderRoutes([{ element: <AuthProvider mode="demo"><AppShell /></AuthProvider>, children: [
    { path: '/faculty/observe/:observationId', element: <ObservationRecordPage />, handle: { title: 'Observation record', nav: '/faculty/observe' } }] }], '/faculty/observe/30');
  await screen.findByText('Read only');
  expect(screen.getByRole('link', { name: item })).toHaveClass('font-bold');
  const other = item === 'My evaluation' ? 'Observe' : 'My evaluation';
  expect(screen.getByRole('link', { name: other })).not.toHaveClass('font-bold');
  sessionStorage.removeItem('assessment-helper.session');
});
it('highlights no sidebar item for a viewer who is neither participant', async () => {
  sessionStorage.setItem('assessment-helper.session', JSON.stringify({ email: 'test@example.edu', token: 'demo:test' }));
  serveRecord(detail, 'zz999');
  server.use(http.get('*/api/cycles/current', () => HttpResponse.json(cycle)), http.get('*/api/me/requests/incoming', () => HttpResponse.json([])));
  renderRoutes([{ element: <AuthProvider mode="demo"><AppShell /></AuthProvider>, children: [
    { path: '/faculty/observe/:observationId', element: <ObservationRecordPage />, handle: { title: 'Observation record', nav: '/faculty/observe' } }] }], '/faculty/observe/30');
  await screen.findByText('Read only');
  expect(screen.getByRole('link', { name: 'Observe' })).not.toHaveClass('font-bold');
  expect(screen.getByRole('link', { name: 'My evaluation' })).not.toHaveClass('font-bold');
  sessionStorage.removeItem('assessment-helper.session');
});

function committeeShell(role: 'AC' | 'faculty') {
  sessionStorage.setItem('assessment-helper.session', JSON.stringify({ email: 'test@example.edu', token: 'demo:test' }));
  serveRecord(detail, 'zz999');
  server.use(
    http.get('*/api/me', () => HttpResponse.json({ ...faculty, netid: 'zz999', email: 'test@example.edu', role, department: { deptId: '1', deptName: 'CS' } })),
    http.get('*/api/cycles/current', () => HttpResponse.json(cycle)),
    http.get('*/api/me/requests/incoming', () => HttpResponse.json([])),
  );
  renderRoutes([{ element: <AuthProvider mode="demo"><AppShell /></AuthProvider>, children: [
    { path: '/committee/observations', element: <p>Committee observations list</p>, handle: { title: 'Observations' } },
    { path: '/committee/observations/:observationId', element: <ObservationRecordPage />, handle: { title: 'Observation record', nav: '/committee/observations' } },
    { path: '/faculty/evaluation', element: <p>Faculty evaluation page</p>, handle: { title: 'My evaluation' } },
  ] }], '/committee/observations/30');
}
it('opens a record for a committee member who is neither party, read only, with a way back to Observations', async () => {
  committeeShell('AC');
  expect(await screen.findByText('Read-only record.')).toBeVisible();
  expect(screen.getByText('Clear examples')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Upload a file about the observation/ })).not.toBeInTheDocument();
  const back = screen.getByRole('link', { name: 'Back to observations' });
  expect(back).toHaveAttribute('href', '/committee/observations');
  expect(screen.queryByRole('link', { name: 'Back to evaluation' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Observations' })).toHaveClass('font-bold');
  sessionStorage.removeItem('assessment-helper.session');
});
it('sends a faculty-only account away from the committee record route', async () => {
  committeeShell('faculty');
  expect(await screen.findByText('Faculty evaluation page')).toBeVisible();
  expect(screen.queryByText('Read-only record.')).not.toBeInTheDocument();
  sessionStorage.removeItem('assessment-helper.session');
});

const lockedRecord: Partial<ObservationDetail> = { status: 'completed', observerSignedDate: '2026-09-22', observeeSignedDate: '2026-09-23' };
it.each([
  ['the observer', observer.netid, {}],
  ['the observee', faculty.netid, {}],
  ['a committee viewer', 'zz999', {}],
  ['the observer after locking', observer.netid, lockedRecord],
  ['the observee after locking', faculty.netid, lockedRecord],
  ['a committee viewer after locking', 'zz999', lockedRecord],
])('shows the attached file with a Download button to %s', async (_who, netid, extra) => {
  serveRecord({ ...detail, ...extra, issueFileName: 'notes.pdf' }, netid); openRecord();
  expect(await screen.findByRole('heading', { name: 'Attached file' })).toBeVisible();
  expect(screen.getByText('notes.pdf')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Download' })).toBeVisible();
});
it('shows no attached file card when the record has no file', async () => {
  serveRecord({ ...detail, issueFileName: null }); openRecord();
  await screen.findByText('Clear examples');
  expect(screen.queryByRole('heading', { name: 'Attached file' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
});
it('downloads the file with the bearer token and a cleaned file name, and revokes the object URL', async () => {
  setTokenProvider(async () => 'test-token');
  const auth = vi.fn();
  serveRecord({ ...detail, issueFileName: 'notes.pdf' });
  server.use(http.get('*/api/observations/30/issue-file', ({ request }) => {
    auth(request.headers.get('authorization'));
    return new HttpResponse(new Blob(['file']), { headers: { 'Content-Disposition': "attachment; filename*=UTF-8''..%2Fprivate%3Anotes.pdf" } });
  }));
  const create = vi.fn(() => 'blob:test'); const revoke = vi.fn();
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = create; URL.revokeObjectURL = revoke;
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('private_notes.pdf');
    expect(this.href).toBe('blob:test');
  });
  try {
    openRecord();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Download' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:test'));
    expect(auth).toHaveBeenCalledWith('Bearer test-token');
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; setTokenProvider(async () => null); }
});
it('shows Downloading and disables the button while the file is being fetched', async () => {
  setTokenProvider(async () => 'test-token');
  let finish!: () => void;
  const gate = new Promise<void>((r) => { finish = r; });
  serveRecord({ ...detail, issueFileName: 'notes.pdf' });
  server.use(http.get('*/api/observations/30/issue-file', async () => { await gate; return apiError(404, 'NO_FILE', 'This observation has no attached file.'); }));
  openRecord();
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Download' }));
  expect(await screen.findByRole('button', { name: 'Downloading…' })).toBeDisabled();
  finish();
  expect(await screen.findByRole('button', { name: 'Download' })).toBeEnabled();
  setTokenProvider(async () => null);
});
it('shows the error message when the download fails', async () => {
  setTokenProvider(async () => 'test-token');
  serveRecord({ ...detail, issueFileName: 'notes.pdf' });
  server.use(http.get('*/api/observations/30/issue-file', () => apiError(404, 'NO_FILE', 'This observation has no attached file.')));
  openRecord();
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Download' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This observation has no attached file.');
  setTokenProvider(async () => null);
});
it('lets only the observee sign after observer submission and sends the exact saved revision', async () => {
  let current: ObservationDetail = { ...detail, observerSignedDate: '2026-09-22', observeeSignedDate: null, status: 'scheduled' };
  let signBodies: unknown[] = [];
  serveRecord(current, faculty.netid);
  server.use(
    http.get('*/api/observations/30', () => HttpResponse.json(current)),
    http.post('*/api/observations/30/sign', async ({ request }) => {
      signBodies.push(await request.json());
      current = { ...current, observeeSignedDate: '2026-09-23', status: 'completed' };
      return HttpResponse.json(current);
    }),
  );
  const user = userEvent.setup();
  openRecord();
  await user.click(await screen.findByRole('button', { name: 'Sign' }));
  expect(await screen.findByText(/you signed the observation/i)).toBeVisible();
  expect(signBodies).toEqual([{ lastSavedDate: detail.lastSavedDate }]);
  expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
});

it('refetches a stale observation and requires a separate observee signing action', async () => {
  let current: ObservationDetail = { ...detail, observerSignedDate: '2026-09-22', observeeSignedDate: null, status: 'scheduled' };
  let postCount = 0;
  serveRecord(current, faculty.netid);
  server.use(
    http.get('*/api/observations/30', () => HttpResponse.json(current)),
    http.post('*/api/observations/30/sign', () => {
      postCount += 1;
      if (postCount === 1) {
        current = { ...current, lastSavedDate: '2026-09-23T11:00:00Z', answers: [{ ...detail.answers[0], rating: 2, comment: 'Updated by observer' }] };
        return HttpResponse.json({ error: { code: 'STALE_FORM', message: 'The observer changed the form after you opened it. Reload it and review it before signing.' } }, { status: 409 });
      }
      current = { ...current, observeeSignedDate: '2026-09-24', status: 'completed' };
      return HttpResponse.json(current);
    }),
  );
  const user = userEvent.setup();
  openRecord();
  await user.click(await screen.findByRole('button', { name: 'Sign' }));
  expect(screen.getByText(/latest record has been reloaded/i)).toBeVisible();
  expect(await screen.findByText('Updated by observer')).toBeVisible();
  const reviewed = screen.getByRole('checkbox', { name: /reviewed the updated responses before signing/i });
  expect(screen.getByRole('button', { name: 'Sign' })).toBeDisabled();
  await user.click(reviewed);
  expect(screen.getByRole('button', { name: 'Sign' })).toBeEnabled();
  expect(postCount).toBe(1);
  await user.click(screen.getByRole('button', { name: 'Sign' }));
  expect(await screen.findByText(/you signed the observation/i)).toBeVisible();
  expect(postCount).toBe(2);
});

it('reports a failed stale-record refresh and requires a successful retry before signing', async () => {
  let current: ObservationDetail = { ...detail, observerSignedDate: '2026-09-22', observeeSignedDate: null, status: 'scheduled' };
  let reads = 0;
  let posts = 0;
  serveRecord(current, faculty.netid);
  server.use(
    http.get('*/api/observations/30', () => {
      reads += 1;
      if (reads === 2) return HttpResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Could not load the latest observation.' } }, { status: 503 });
      if (reads >= 3) current = { ...current, lastSavedDate: '2026-09-23T11:00:00Z', answers: [{ ...detail.answers[0], rating: 2, comment: 'Latest response' }] };
      return HttpResponse.json(current);
    }),
    http.post('*/api/observations/30/sign', () => {
      posts += 1;
      return HttpResponse.json({ error: { code: 'STALE_FORM', message: 'The form changed after it was opened.' } }, { status: 409 });
    }),
  );
  const user = userEvent.setup();
  openRecord();
  await user.click(await screen.findByRole('button', { name: 'Sign' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not reload the latest record/i);
  expect(screen.getByRole('alert').closest('.screen-only')).not.toBeNull();
  expect(screen.getByRole('button', { name: /retry loading latest record/i }).closest('.screen-only')).not.toBeNull();

  expect(screen.queryByText(/latest record has been reloaded/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
  expect(posts).toBe(1);
  await user.click(screen.getByRole('button', { name: /retry loading latest record/i }));
  expect(await screen.findByText('Latest response')).toBeVisible();
  expect(screen.getByText(/latest record has been reloaded/i)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Sign' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /reviewed the updated responses before signing/i }));
  expect(screen.getByRole('button', { name: 'Sign' })).toBeEnabled();
  expect(posts).toBe(1);
});

it('does not offer observee signing to the observer', async () => {
  serveRecord({ ...detail, observer, observerSignedDate: '2026-09-22' }, observer.netid);
  openRecord();
  await screen.findByText('Read only');
  expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
});

it('offers the observer a change to the submitted form once they signed, and a local draft before', async () => {
  serveRecord({ ...detail, observer, observerSignedDate: '2026-09-22' }, observer.netid);
  openRecord();
  expect(await screen.findByRole('link', { name: /Change the submitted form/ })).toHaveAttribute('href', '/faculty/observe/30/form');
  expect(screen.queryByRole('link', { name: /Edit local draft/ })).not.toBeInTheDocument();
});

const lockNote = /Locked until your observer submits and signs the form/;
const reportLink = () => screen.queryByRole('button', { name: 'The observation could not be done' });
const uploadButton = () => screen.queryByRole('button', { name: 'Upload a file about the observation' });
const fileInput = () => screen.getByLabelText('File about the observation');
const apiError = (status: number, code: string, message: string) => HttpResponse.json({ error: { code, message } }, { status });

it('tells the observee why the record is locked and offers the report, with no Sign button', async () => {
  serveRecord(); openRecord();
  expect(await screen.findByText(lockNote)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Something went wrong?' })).toBeVisible();
  expect(reportLink()).toBeVisible();
  expect(uploadButton()).toBeVisible();
});
it('removes the lock note and the report once the observer has signed, and shows Sign', async () => {
  serveRecord({ ...detail, observerSignedDate: '2026-09-22' }); openRecord();
  expect(await screen.findByRole('button', { name: 'Sign' })).toBeVisible();
  expect(screen.queryByText(lockNote)).not.toBeInTheDocument();
  expect(reportLink()).not.toBeInTheDocument();
  expect(uploadButton()).toBeVisible();
});
it('shows the observer no lock note and no report, only the upload', async () => {
  serveRecord({ ...detail, observer }, observer.netid); openRecord();
  await screen.findByText('Read only');
  expect(screen.queryByText(lockNote)).not.toBeInTheDocument();
  expect(reportLink()).not.toBeInTheDocument();
  expect(uploadButton()).toBeVisible();
});
it('shows no problem card and no lock note on a locked record', async () => {
  serveRecord({ ...detail, status: 'completed', observerSignedDate: '2026-09-22', observeeSignedDate: '2026-09-23' }); openRecord();
  await screen.findByText('Read only');
  expect(screen.queryByRole('heading', { name: 'Something went wrong?' })).not.toBeInTheDocument();
  expect(screen.queryByText(lockNote)).not.toBeInTheDocument();
});
it('shows no lock note and no report when the observation did not happen, but still allows a file', async () => {
  serveRecord({ ...detail, status: 'not_completed', reasonNotCompleted: 'Class cancelled' }); openRecord();
  expect(await screen.findByRole('heading', { name: 'This observation did not happen' })).toBeVisible();
  expect(screen.getByText('Reason given: Class cancelled')).toBeVisible();
  expect(screen.queryByText(lockNote)).not.toBeInTheDocument();
  expect(screen.getByText('Reported as not done. Nobody signs this record.')).toBeVisible();
  expect(reportLink()).not.toBeInTheDocument();
  expect(uploadButton()).toBeVisible();
  // Nothing to rate or print.
  expect(screen.queryByRole('heading', { name: 'Ratings and comments' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Print record' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Edit local draft|Change the submitted form/ })).not.toBeInTheDocument();
});
it('shows nothing to a viewer who is neither participant', async () => {
  serveRecord(detail, 'zz999'); openRecord();
  await screen.findByText('Read only');
  expect(screen.queryByText(lockNote)).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Something went wrong?' })).not.toBeInTheDocument();
});

it('uploads a file as multipart field "file" and shows its name from the returned record', async () => {
  const bodies: string[] = [];
  serveRecord();
  server.use(http.post('*/api/observations/30/issue-file', async ({ request }) => {
    expect(request.headers.get('content-type')).toContain('multipart/form-data');
    bodies.push(await request.text());
    return HttpResponse.json({ ...detail, issueFileName: 'notes.txt' });
  }));
  // Node 24's fetch drops the contents of a jsdom File when it encodes the body, so the file itself is checked where the app adds it.
  const append = vi.spyOn(FormData.prototype, 'append');
  const user = userEvent.setup();
  openRecord();
  await screen.findByText(lockNote);
  const file = new File(['what happened'], 'notes.txt', { type: 'text/plain' });
  await user.upload(fileInput(), file);
  expect(await screen.findByText('notes.txt')).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toContain('name="file"');
  expect(append.mock.calls.filter(([name]) => name === 'file').map(([, value]) => value)).toEqual([file]);
  append.mockRestore();
});
it('sends nothing for a file over 10 MB and says so', async () => {
  const upload = vi.fn();
  serveRecord();
  server.use(http.post('*/api/observations/30/issue-file', () => { upload(); return HttpResponse.json(detail); }));
  const user = userEvent.setup();
  openRecord();
  await screen.findByText(lockNote);
  await user.upload(fileInput(), new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.bin'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Files can be up to 10 MB.');
  expect(upload).not.toHaveBeenCalled();
});
it('accepts a file of exactly 10 MB', async () => {
  const upload = vi.fn();
  serveRecord();
  server.use(http.post('*/api/observations/30/issue-file', () => { upload(); return HttpResponse.json({ ...detail, issueFileName: 'edge.bin' }); }));
  const user = userEvent.setup();
  openRecord();
  await screen.findByText(lockNote);
  await user.upload(fileInput(), new File([new Uint8Array(10 * 1024 * 1024)], 'edge.bin'));
  expect(await screen.findByText('edge.bin')).toBeVisible();
  expect(upload).toHaveBeenCalledOnce();
});
it('shows the server message when the upload is refused', async () => {
  serveRecord();
  server.use(http.post('*/api/observations/30/issue-file', () => apiError(400, 'FILE_REQUIRED', 'Choose a file to upload.')));
  const user = userEvent.setup();
  openRecord();
  await screen.findByText(lockNote);
  await user.upload(fileInput(), new File(['x'], 'a.txt'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a file to upload.');
  expect(screen.queryByText(/not available yet/)).not.toBeInTheDocument();
});
it('shows a missing-endpoint 404 from the upload as the normal error, not as unavailable', async () => {
  serveRecord();
  server.use(http.post('*/api/observations/30/issue-file', () => apiError(404, 'NOT_FOUND', 'The requested endpoint does not exist.')));
  const user = userEvent.setup();
  openRecord();
  await screen.findByText(lockNote);
  await user.upload(fileInput(), new File(['x'], 'a.txt'));
  expect(await screen.findByRole('alert')).toHaveTextContent('The requested endpoint does not exist.');
  expect(screen.queryByText(/not available yet/)).not.toBeInTheDocument();
  expect(screen.getByText('Read only')).toBeVisible();
});
it('shows another 404 from the upload as an ordinary error', async () => {
  serveRecord();
  server.use(http.post('*/api/observations/30/issue-file', () => apiError(404, 'NOT_FOUND', 'Observation not found.')));
  const user = userEvent.setup();
  openRecord();
  await screen.findByText(lockNote);
  await user.upload(fileInput(), new File(['x'], 'a.txt'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Observation not found.');
  expect(screen.queryByText(/not available yet/)).not.toBeInTheDocument();
});
it('disables the upload link while a file is being sent', async () => {
  const upload = vi.fn();
  let finish!: (response: Response) => void;
  serveRecord();
  server.use(http.post('*/api/observations/30/issue-file', () => { upload(); return new Promise<Response>((done) => { finish = done; }); }));
  const user = userEvent.setup();
  openRecord();
  await screen.findByText(lockNote);
  await user.upload(fileInput(), new File(['x'], 'a.txt'));
  await waitFor(() => expect(uploadButton()).toBeDisabled());
  await user.upload(fileInput(), new File(['y'], 'b.txt'));
  expect(upload).toHaveBeenCalledOnce();
  finish(HttpResponse.json({ ...detail, issueFileName: 'a.txt' }));
  expect(await screen.findByText('a.txt')).toBeVisible();
});

it('blocks an empty reason, then reports with exactly { reason } and shows the record as not done', async () => {
  let current: ObservationDetail = detail;
  const bodies: unknown[] = [];
  serveRecord();
  server.use(
    http.get('*/api/observations/30', () => HttpResponse.json(current)),
    http.post('*/api/observations/30/report-missed', async ({ request }) => {
      bodies.push(await request.json());
      current = { ...detail, status: 'not_completed', reasonNotCompleted: 'The class was cancelled' };
      return HttpResponse.json(current);
    }),
  );
  const user = userEvent.setup();
  openRecord();
  await user.click(await screen.findByRole('button', { name: 'The observation could not be done' }));
  const dialog = await screen.findByRole('dialog', { name: 'The observation could not be done' });
  expect(within(dialog).getByRole('button', { name: 'Report' })).toBeDisabled();
  await user.type(within(dialog).getByLabelText('What happened?'), '   ');
  expect(within(dialog).getByRole('button', { name: 'Report' })).toBeDisabled();
  await user.type(within(dialog).getByLabelText('What happened?'), 'The class was cancelled');
  await user.click(within(dialog).getByRole('button', { name: 'Report' }));
  expect(await screen.findByText('Observation did not happen')).toBeVisible();
  expect(bodies).toEqual([{ reason: 'The class was cancelled' }]);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(reportLink()).not.toBeInTheDocument();
  expect(screen.queryByText(lockNote)).not.toBeInTheDocument();
});
it.each([
  [403, 'FORBIDDEN', 'Only the observee can report this.'],
  [409, 'NOT_SCHEDULED', 'This observation is not scheduled.'],
  [409, 'FORM_SUBMITTED', 'The observer already submitted the form.'],
  [400, 'REASON_REQUIRED', 'Enter a reason.'],
])('shows the %s %s reply and keeps the typed reason', async (status, code, message) => {
  serveRecord();
  server.use(http.post('*/api/observations/30/report-missed', () => apiError(status, code, message)));
  const user = userEvent.setup();
  openRecord();
  await user.click(await screen.findByRole('button', { name: 'The observation could not be done' }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText('What happened?'), 'Room was locked');
  await user.click(within(dialog).getByRole('button', { name: 'Report' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
  expect(within(dialog).getByLabelText('What happened?')).toHaveValue('Room was locked');
});
it('sends the report once under repeated clicks', async () => {
  const report = vi.fn();
  serveRecord();
  server.use(http.post('*/api/observations/30/report-missed', () => { report(); return new Promise<never>(() => {}); }));
  const user = userEvent.setup();
  openRecord();
  await user.click(await screen.findByRole('button', { name: 'The observation could not be done' }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText('What happened?'), 'No show');
  const send = within(dialog).getByRole('button', { name: 'Report' });
  await user.dblClick(send);
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Reporting…' })).toBeDisabled());
  expect(report).toHaveBeenCalledOnce();
});
it('closes the report dialog without sending anything on Cancel', async () => {
  const report = vi.fn();
  serveRecord();
  server.use(http.post('*/api/observations/30/report-missed', () => { report(); return HttpResponse.json(detail); }));
  const user = userEvent.setup();
  openRecord();
  await user.click(await screen.findByRole('button', { name: 'The observation could not be done' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(report).not.toHaveBeenCalled();
});

it('clears the size message once a valid file is chosen', async () => {
  serveRecord();
  server.use(http.post('*/api/observations/30/issue-file', () => HttpResponse.json({ ...detail, issueFileName: 'ok.txt' })));
  const user = userEvent.setup();
  openRecord();
  await screen.findByText(lockNote);
  await user.upload(fileInput(), new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.bin'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Files can be up to 10 MB.');
  await user.upload(fileInput(), new File(['x'], 'ok.txt'));
  expect(await screen.findByText('ok.txt')).toBeVisible();
  expect(screen.queryByText('Files can be up to 10 MB.')).not.toBeInTheDocument();
});
it('closes the report dialog on Escape without sending anything', async () => {
  const report = vi.fn();
  serveRecord();
  server.use(http.post('*/api/observations/30/report-missed', () => { report(); return HttpResponse.json(detail); }));
  const user = userEvent.setup();
  openRecord();
  await user.click(await screen.findByRole('button', { name: 'The observation could not be done' }));
  await screen.findByRole('dialog');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(report).not.toHaveBeenCalled();
});
it('offers no report on a completed record the observer has signed', async () => {
  serveRecord({ ...detail, status: 'completed', observerSignedDate: '2026-09-22' });
  openRecord();
  await screen.findByText('Read only');
  expect(uploadButton()).toBeVisible();
  expect(reportLink()).not.toBeInTheDocument();
});
it('reloads the record when the report is refused because the observer signed meanwhile', async () => {
  let current: ObservationDetail = detail;
  serveRecord();
  server.use(
    http.get('*/api/observations/30', () => HttpResponse.json(current)),
    http.post('*/api/observations/30/report-missed', () => {
      current = { ...detail, observerSignedDate: '2026-09-22' };
      return apiError(409, 'FORM_SUBMITTED', 'The observer already submitted the form.');
    }),
  );
  const user = userEvent.setup();
  openRecord();
  await user.click(await screen.findByRole('button', { name: 'The observation could not be done' }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText('What happened?'), 'No show');
  await user.click(within(dialog).getByRole('button', { name: 'Report' }));
  expect(await screen.findByRole('button', { name: 'Sign' })).toBeVisible();
  expect(screen.queryByText(lockNote)).not.toBeInTheDocument();
  expect(reportLink()).not.toBeInTheDocument();
});

it('a fast double click on Report sends one report', async () => {
  const bodies: unknown[] = [];
  serveRecord();
  server.use(http.post('*/api/observations/30/report-missed', async ({ request }) => { bodies.push(await request.json()); return new Promise<never>(() => {}); }));
  const user = userEvent.setup();
  openRecord();
  await user.click(await screen.findByRole('button', { name: 'The observation could not be done' }));
  const dialog = await screen.findByRole('dialog', { name: 'The observation could not be done' });
  await user.type(within(dialog).getByLabelText('What happened?'), 'Room was locked');
  // Two clicks in one event-loop turn, before React re-renders with isPending.
  const report = within(dialog).getByRole('button', { name: 'Report' });
  act(() => { fireEvent.click(report); fireEvent.click(report); });
  await within(dialog).findByRole('button', { name: 'Reporting…' });
  expect(bodies).toHaveLength(1);
});
