import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cycle, MatchingRow, Me, ObservationDetail, OutstandingObservations, Signup } from '../../api/types';
import { AuthProvider } from '../../auth/AuthProvider';
import { AppShell } from '../../components/AppShell';
import { OUTSTANDING_TEXT } from '../../lib/statusTerms';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { course, cycle, faculty, observation, observer, signup } from '../../test/fixtures';
import { ObservationsPage } from './ObservationsPage';

const SESSION_KEY = 'assessment-helper.session';

const failure = (status: number, code: string, message: string) => HttpResponse.json({ error: { code, message } }, { status });
const never = () => new Promise<never>(() => {});

const person = (netid: string, name: string, rank: 'assistant' | 'associate' | 'full' = 'assistant') => ({ ...faculty, netid, displayName: name, rank, email: `${netid}@demo.edu` });

/** A sign-up row; pass the observation fields that exist. */
function row(id: string, name: string, obs: { status: 'scheduled' | 'completed' | 'not_completed'; scheduledDate?: string; observationId?: string; observer?: string } | null, rank: 'assistant' | 'associate' | 'full' = 'assistant'): Signup {
  return {
    ...signup, signupId: id, observee: person(`n${id}`, name, rank), section: { ...course, label: `CS 13${id}` },
    observation: obs && { observationId: obs.observationId ?? `o${id}`, observer: { ...observer, displayName: obs.observer ?? 'Dr. Elena Ruiz' }, status: obs.status, scheduledDate: obs.scheduledDate },
  };
}

const rows: Signup[] = [
  row('1', 'Dr. Ana Unpaired', null),
  row('2', 'Dr. Bo Nobody', null, 'full'),
  row('3', 'Dr. Cy Scheduled', { status: 'scheduled', scheduledDate: '2026-09-21' }),
  row('4', 'Dr. Di Waiting', { status: 'scheduled', scheduledDate: '2026-09-22' }),
  row('5', 'Dr. Ed Missed', { status: 'not_completed', scheduledDate: '2026-09-23' }),
  row('6', 'Dr. Flo Done', { status: 'completed', scheduledDate: '2026-09-18', observer: 'Dr. Gus Observer' }),
  row('7', 'Dr. Hal Done', { status: 'completed', scheduledDate: '2026-09-10' }),
];
const alerts: MatchingRow[] = [
  { signupId: '2', observee: person('n2', 'Dr. Bo Nobody'), section: course, candidates: [], alert: { alertId: 'a1', alertType: 'no_observer', createdDate: '2026-09-16T10:00:00Z' } },
];
const byRank = { assistant: 3, associate: 1, full: 1 };

const record = (extra: Partial<ObservationDetail>): ObservationDetail => ({
  ...observation, templateVersion: { versionId: '1', versionNo: 1 }, lastSavedDate: '2026-09-22T10:00:00Z', answers: [], otherComments: '', reasonNotCompleted: null, ...extra,
});

interface Serve { current?: Cycle | null; signups?: Signup[]; matching?: () => Response; outstanding?: () => Response; records?: Record<string, () => Response> }
interface Log { recordReads: string[]; forwards: unknown[] }

function serve({ current = cycle, signups = rows, matching = () => HttpResponse.json(alerts), outstanding = () => HttpResponse.json({ cycleId: '1', total: 5, byRank } satisfies OutstandingObservations), records = {} }: Serve = {}) {
  const log: Log = { recordReads: [], forwards: [] };
  server.use(
    http.get('*/api/cycles/current', () => HttpResponse.json(current)),
    http.get('*/api/cycles/1/signups', () => HttpResponse.json(signups)),
    http.get('*/api/cycles/1/matching', matching),
    http.get('*/api/dashboard/outstanding-observations', outstanding),
    http.get('*/api/observations/:id', ({ params }) => {
      const id = String(params.id);
      log.recordReads.push(id);
      return records[id]?.() ?? HttpResponse.json(record({ observationId: id }));
    }),
  );
  return log;
}

const open = () => renderRoutes([{ path: '/committee/observations', element: <ObservationsPage /> }], '/committee/observations');
const user = () => userEvent.setup();
const rowOf = (name: string) => screen.getAllByRole('row').find((r) => r.textContent?.includes(name))!;

afterEach(() => { sessionStorage.removeItem(SESSION_KEY); });

describe('outstanding tab (A6)', () => {
  it('counts both tabs and explains outstanding', async () => {
    serve(); open();
    expect(await screen.findByRole('tab', { name: 'Outstanding (5)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Completed (2)' })).toBeVisible();
    expect(screen.getByText(OUTSTANDING_TEXT)).toBeVisible();
    expect(await screen.findByText('By hire level: Assistant 3, Associate 1, Full 1')).toBeVisible();
  });
  it('lists the sign-ups that are not completed with the right status', async () => {
    serve({ records: { o4: () => HttpResponse.json(record({ observationId: 'o4', observerSignedDate: '2026-09-22' })) } });
    open();
    await screen.findByRole('table', { name: 'Outstanding observations' });
    expect(within(rowOf('Dr. Ana Unpaired')).getByText('Not paired yet')).toBeVisible();
    expect(within(rowOf('Dr. Ana Unpaired')).getByText('None yet')).toBeVisible();
    expect(within(rowOf('Dr. Bo Nobody')).getByText('No observer, see Sign-ups')).toBeVisible();
    expect(within(rowOf('Dr. Bo Nobody')).getByText('Full')).toBeVisible();
    expect(await within(rowOf('Dr. Di Waiting')).findByText('Waiting for the observee to sign')).toBeVisible();
    expect(within(rowOf('Dr. Cy Scheduled')).getByText('Scheduled')).toBeVisible();
    expect(within(rowOf('Dr. Cy Scheduled')).getByText('Sep 21, 2026')).toBeVisible();
    expect(within(rowOf('Dr. Ed Missed')).getByText('Reported as not done')).toBeVisible();
    expect(screen.queryByText('Dr. Flo Done')).not.toBeInTheDocument();
  });
  it('shows Scheduled when the observer has not signed, or when only the observee has', async () => {
    serve({ records: {
      o3: () => HttpResponse.json(record({ observationId: 'o3', observerSignedDate: null })),
      o4: () => HttpResponse.json(record({ observationId: 'o4', observerSignedDate: null, observeeSignedDate: '2026-09-22' })),
    } });
    open();
    await screen.findByRole('table', { name: 'Outstanding observations' });
    await waitFor(() => expect(within(rowOf('Dr. Di Waiting')).getByText('Scheduled')).toBeVisible());
    expect(screen.queryByText('Waiting for the observee to sign')).not.toBeInTheDocument();
  });
  it('keeps Scheduled and shows no page error when a record cannot be read', async () => {
    const log = serve({ records: { o4: () => failure(500, 'FAILED', 'Record unavailable') } });
    open();
    await screen.findByRole('table', { name: 'Outstanding observations' });
    await waitFor(() => expect(log.recordReads).toContain('o4'));
    expect(within(rowOf('Dr. Di Waiting')).getByText('Scheduled')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Record unavailable')).not.toBeInTheDocument();
  });
  it('reads records only for the scheduled rows on the current page', async () => {
    const many = [
      ...Array.from({ length: 9 }, (_, i) => row(`${10 + i}`, `Dr. Sched ${10 + i}`, { status: 'scheduled', scheduledDate: '2026-09-21' })),
      row('30', 'Dr. Unpaired Late', null),
      row('31', 'Dr. Finished', { status: 'completed', scheduledDate: '2026-09-01' }),
    ];
    const log = serve({ signups: many, matching: () => HttpResponse.json([]) });
    open();
    await screen.findByRole('table', { name: 'Outstanding observations' });
    await waitFor(() => expect(log.recordReads).toHaveLength(7));
    expect([...log.recordReads].sort()).toEqual(['o10', 'o11', 'o12', 'o13', 'o14', 'o15', 'o16']);
    await user().click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(log.recordReads).toContain('o17'));
    expect(log.recordReads).not.toContain('o31');
    expect(log.recordReads).not.toContain('o30');
  });
  it('still lists the sign-ups when the matching and count reads fail', async () => {
    serve({ matching: () => failure(500, 'FAILED', 'Matching down'), outstanding: () => failure(500, 'FAILED', 'Count down') });
    open();
    expect(await screen.findByRole('table', { name: 'Outstanding observations' })).toBeVisible();
    expect(within(rowOf('Dr. Bo Nobody')).getByText('Not paired yet')).toBeVisible();
    expect(screen.queryByText(/By hire level/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('has no Forward a link button', async () => {
    serve(); open();
    await screen.findByRole('table', { name: 'Outstanding observations' });
    expect(screen.queryByRole('button', { name: /Forward a link/ })).not.toBeInTheDocument();
  });
  it('says when nothing is outstanding and when nobody has signed up', async () => {
    serve({ signups: [rows[5]] });
    const first = open();
    expect(await screen.findByText('Nothing outstanding.')).toBeVisible();
    first.unmount();
    serve({ signups: [] });
    open();
    expect(await screen.findByText('No one has signed up yet this cycle.')).toBeVisible();
  });
});

describe('states', () => {
  it('shows loading, then an error with Try again that recovers', async () => {
    let attempts = 0;
    server.use(
      http.get('*/api/cycles/current', () => HttpResponse.json(cycle)),
      http.get('*/api/cycles/1/signups', () => (++attempts === 1 ? failure(503, 'DOWN', 'Sign-ups unavailable') : HttpResponse.json(rows))),
      http.get('*/api/cycles/1/matching', () => HttpResponse.json([])),
      http.get('*/api/dashboard/outstanding-observations', () => HttpResponse.json({ cycleId: '1', total: 5, byRank })),
      http.get('*/api/observations/:id', () => HttpResponse.json(record({}))),
    );
    open();
    expect(screen.getByRole('status')).toHaveTextContent('Loading observations');
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-ups unavailable');
    await user().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Outstanding observations' })).toBeVisible();
  });
  it('says so before the first cycle starts', async () => {
    serve({ current: null }); open();
    expect(await screen.findByText('No evaluation cycle has started yet.')).toBeVisible();
  });
});

describe('completed tab (A6a)', () => {
  it('lists the signed and locked observations, oldest first, each with Forward a link', async () => {
    serve(); open();
    await user().click(await screen.findByRole('tab', { name: 'Completed (2)' }));
    const table = screen.getByRole('table', { name: 'Completed observations' });
    expect(within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Dr. Hal Done', 'Dr. Flo Done']);
    expect(within(rowOf('Dr. Flo Done')).getByText('Dr. Gus Observer')).toBeVisible();
    expect(within(rowOf('Dr. Flo Done')).getByText('Sep 18, 2026')).toBeVisible();
    expect(within(rowOf('Dr. Flo Done')).getByText('Signed and locked')).toBeVisible();
    expect(within(table).getAllByRole('button', { name: /Forward a link/ })).toHaveLength(2);
    expect(screen.queryByText(OUTSTANDING_TEXT)).not.toBeInTheDocument();
  });
  it('shows the empty state', async () => {
    serve({ signups: [rows[2]] }); open();
    await user().click(await screen.findByRole('tab', { name: 'Completed (0)' }));
    expect(screen.getByText('No signed observations yet.')).toBeVisible();
  });
});

describe('forward a link (A6b)', () => {
  async function openForward(u = user()) {
    const log = serve();
    open();
    await u.click(await screen.findByRole('tab', { name: 'Completed (2)' }));
    await u.click(screen.getByRole('button', { name: "Forward a link to Dr. Flo Done's observation" }));
    return { log, u, dialog: within(await screen.findByRole('dialog', { name: 'Forward a link to this observation' })) };
  }
  function forwardsTo(log: Log, respond: () => Response | Promise<Response> = () => HttpResponse.json({ forwardId: 'f1', sharedDate: '2026-09-25T10:00:00Z' }, { status: 201 })) {
    server.use(http.post('*/api/observations/:id/forward', async ({ request, params }) => {
      log.forwards.push({ id: params.id, body: await request.json() });
      return respond();
    }));
  }

  it('names the record, keeps Send disabled until an address is typed, and sends exactly { email } trimmed', async () => {
    const { log, u, dialog } = await openForward();
    forwardsTo(log);
    expect(dialog.getByText(/Dr. Flo Done, observed by Dr. Gus Observer, Sep 18, 2026/)).toBeVisible();
    expect(dialog.getByRole('button', { name: 'Send link' })).toBeDisabled();
    await u.type(dialog.getByLabelText('Email'), '  chair@demo.edu ');
    await u.click(dialog.getByRole('button', { name: 'Send link' }));
    expect(await screen.findByText('Link sent to chair@demo.edu. The forward is recorded.')).toBeVisible();
    expect(log.forwards).toEqual([{ id: 'o6', body: { email: 'chair@demo.edu' } }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('sends once under repeated clicks', async () => {
    const { log, u, dialog } = await openForward();
    forwardsTo(log, never);
    await u.type(dialog.getByLabelText('Email'), 'chair@demo.edu');
    await u.dblClick(dialog.getByRole('button', { name: 'Send link' }));
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Sending…' })).toBeDisabled());
    expect(log.forwards).toHaveLength(1);
  });
  it.each([
    ['INVALID_EMAIL', 400, 'Enter a valid email address.'],
    ['NOT_LOCKED', 409, 'Only a signed and locked record can be forwarded.'],
  ])('shows the %s message and keeps the typed address', async (code, status, message) => {
    const { log, u, dialog } = await openForward();
    forwardsTo(log, () => failure(status, code, message));
    await u.type(dialog.getByLabelText('Email'), 'chair@demo');
    await u.click(dialog.getByRole('button', { name: 'Send link' }));
    expect(await dialog.findByText(message)).toHaveAttribute('role', 'alert');
    expect(dialog.getByLabelText('Email')).toHaveValue('chair@demo');
    expect(screen.queryByText(/Link sent to/)).not.toBeInTheDocument();
  });
  it('says forwarding is not available yet when the backend has no such route', async () => {
    const { log, u, dialog } = await openForward();
    forwardsTo(log, () => failure(404, 'NOT_FOUND', 'The requested endpoint does not exist.'));
    await u.type(dialog.getByLabelText('Email'), 'chair@demo.edu');
    await u.click(dialog.getByRole('button', { name: 'Send link' }));
    expect(await dialog.findByText('Forwarding a link is not available yet. Nothing was sent.')).toBeVisible();
    expect(dialog.queryByText('The requested endpoint does not exist.')).not.toBeInTheDocument();
    expect(dialog.getByLabelText('Email')).toHaveValue('chair@demo.edu');
    expect(screen.getByRole('tab', { name: 'Completed (2)' })).toBeVisible();
  });
  it('shows another 404 as an ordinary error', async () => {
    const { log, u, dialog } = await openForward();
    forwardsTo(log, () => failure(404, 'NOT_FOUND', 'Observation not found.'));
    await u.type(dialog.getByLabelText('Email'), 'chair@demo.edu');
    await u.click(dialog.getByRole('button', { name: 'Send link' }));
    expect(await dialog.findByText('Observation not found.')).toHaveAttribute('role', 'alert');
    expect(dialog.queryByText(/not available yet/)).not.toBeInTheDocument();
  });
  it('closes without sending on Cancel', async () => {
    const { log, u, dialog } = await openForward();
    forwardsTo(log);
    await u.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(log.forwards).toHaveLength(0);
  });
});

describe('permission', () => {
  it('sends a faculty-only user to My evaluation without asking for any list', async () => {
    const list = vi.fn();
    serve();
    server.use(
      http.get('*/api/cycles/1/signups', () => { list(); return HttpResponse.json(rows); }),
      http.get('*/api/me', () => HttpResponse.json({ ...faculty, email: 'maya.lin@demo.edu', department: { deptId: '1', deptName: 'Computer Science' }, role: 'faculty' } satisfies Me)),
    );
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: 'maya.lin@demo.edu', token: 'demo:test' }));
    const { router } = renderRoutes([{
      element: <AuthProvider mode="demo"><AppShell /></AuthProvider>,
      children: [
        { path: '/committee/observations', element: <ObservationsPage />, handle: { title: 'Observations' } },
        { path: '/faculty/evaluation', element: <p>My evaluation page</p>, handle: { title: 'My evaluation' } },
      ],
    }], '/committee/observations');
    expect(await screen.findByText('My evaluation page')).toBeVisible();
    expect(router.state.location.pathname).toBe('/faculty/evaluation');
    expect(list).not.toHaveBeenCalled();
  });
});

describe('review follow-ups', () => {
  it('ignores Escape while a link is being sent', async () => {
    const u = user();
    serve(); open();
    await u.click(await screen.findByRole('tab', { name: 'Completed (2)' }));
    await u.click(screen.getByRole('button', { name: "Forward a link to Dr. Flo Done's observation" }));
    server.use(http.post('*/api/observations/:id/forward', () => never()));
    const dialog = within(await screen.findByRole('dialog'));
    await u.type(dialog.getByLabelText('Email'), 'chair@demo.edu');
    await u.click(dialog.getByRole('button', { name: 'Send link' }));
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Sending…' })).toBeDisabled());
    await u.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
  it('clears the "Link sent" note when the tab changes', async () => {
    const u = user();
    serve(); open();
    await u.click(await screen.findByRole('tab', { name: 'Completed (2)' }));
    await u.click(screen.getByRole('button', { name: "Forward a link to Dr. Flo Done's observation" }));
    server.use(http.post('*/api/observations/:id/forward', () => HttpResponse.json({ forwardId: 'f1', sharedDate: '2026-09-25T10:00:00Z' }, { status: 201 })));
    await u.type(within(screen.getByRole('dialog')).getByLabelText('Email'), 'chair@demo.edu');
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send link' }));
    expect(await screen.findByText(/Link sent to chair@demo.edu/)).toBeVisible();
    await u.click(screen.getByRole('tab', { name: /Outstanding/ }));
    await u.click(screen.getByRole('tab', { name: 'Completed (2)' }));
    expect(screen.queryByText(/Link sent to/)).not.toBeInTheDocument();
  });
});
