import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { cycle, observer } from '../../test/fixtures';
import type { Cycle, Me, Notification } from '../../api/types';
import { NotificationControls } from './NotificationControls';
import { NotificationInbox } from './NotificationInbox';

const member = (role: Me['role']): Me => ({
  netid: 'ic1', firstName: 'Isabel', lastName: 'Nakamura', displayName: 'Dr. Isabel Nakamura', email: 'ic1@example.edu',
  rank: 'full', department: { deptId: '1', deptName: 'Computer Science' }, role,
});

const PATHS = {
  'due-reminders': '*/api/cycles/1/notifications/due-reminders',
  'lists-ready': '*/api/cycles/1/notifications/lists-ready',
  survey: '*/api/cycles/1/notifications/survey',
} as const;

const never = () => new Promise<never>(() => {});
const failure = (message: string, status = 500, code = 'FAILED') => HttpResponse.json({ error: { code, message } }, { status });

/** Records every POST to the three send endpoints, with its body. */
function serve({ role = 'AC' as Me['role'], currentCycle = cycle as Cycle | null, sent = 3, inbox = [] as Notification[] } = {}) {
  const calls: { path: string; body: unknown }[] = [];
  server.use(
    http.get('*/api/me', () => HttpResponse.json(member(role))),
    http.get('*/api/cycles/current', () => HttpResponse.json(currentCycle)),
    http.get('*/api/me/notifications', () => HttpResponse.json(inbox)),
    ...Object.entries(PATHS).map(([name, path]) => http.post(path, async ({ request }) => {
      const text = await request.text();
      calls.push({ path: name, body: text ? JSON.parse(text) : undefined });
      return HttpResponse.json({ sent });
    })),
  );
  return calls;
}

function openControls() {
  return renderRoutes([{ path: '/', element: <><NotificationControls /><NotificationInbox /></> }], '/');
}

const group = (name: RegExp) => screen.getByRole('group', { name });
const user = () => userEvent.setup();

async function confirmSend(name: RegExp, button: RegExp, confirm: RegExp) {
  const u = user();
  await u.click(await within(await screen.findByRole('group', { name })).findByRole('button', { name: button }));
  const dialog = await screen.findByRole('dialog');
  await u.click(within(dialog).getByRole('button', { name: confirm }));
  return u;
}

describe('Committee notification sends', () => {
  it('asks before sending due reminders, warns about the email, and sends to everyone due with an empty body', async () => {
    const calls = serve({ sent: 12 });
    openControls();
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Send due reminders' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send due reminders?' });
    expect(dialog).toHaveTextContent(/every active professor who is due or overdue/i);
    expect(dialog).toHaveTextContent(/queues a reminder email/i);
    expect(dialog).toHaveTextContent(/cannot confirm delivery/i);
    expect(calls).toHaveLength(0);
    await u.click(within(dialog).getByRole('button', { name: 'Send reminders to all' }));
    expect(await within(group(/Due reminders/)).findByText(/Sent 12 in-app reminders\. Reminder emails go out only when the server has email turned on; delivery is not confirmed here\./)).toBeVisible();
    // An empty object, never { netids: [] }: the API reads both as "everyone due".
    expect(calls).toEqual([{ path: 'due-reminders', body: {} }]);
  });

  it('sends nothing when the confirmation is cancelled or dismissed with Escape', async () => {
    const calls = serve();
    openControls();
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Notify lists ready' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await u.click(screen.getByRole('button', { name: 'Send survey notification' }));
    await screen.findByRole('dialog');
    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls).toHaveLength(0);
  });

  it('sends lists ready and the survey notification to their own endpoints with no body, each reporting its count', async () => {
    const calls = serve({ sent: 1 });
    openControls();
    await confirmSend(/Observer lists ready/, /Notify lists ready/, /Notify observees/);
    expect(await within(group(/Observer lists ready/)).findByText(/Sent 1 in-app notification\./)).toBeVisible();
    await confirmSend(/End-of-process survey/, /Send survey notification/, /Send survey notification/);
    expect(await within(group(/End-of-process survey/)).findByText(/Sent 1 in-app notification\./)).toBeVisible();
    expect(calls).toEqual([{ path: 'lists-ready', body: undefined }, { path: 'survey', body: undefined }]);
  });

  it('says plainly when a send reached no one', async () => {
    serve({ sent: 0 });
    openControls();
    await confirmSend(/Due reminders/, /Send due reminders/, /Send reminders to all/);
    expect(await within(group(/Due reminders/)).findByText(/No reminders sent: no active professor who is due this cycle is still without a sign-up\./)).toBeVisible();
    await confirmSend(/Observer lists ready/, /Notify lists ready/, /Notify observees/);
    expect(await within(group(/Observer lists ready/)).findByText(/No notifications sent: no sign-up in this cycle has an observer list yet\./)).toBeVisible();
    await confirmSend(/End-of-process survey/, /Send survey notification/, /Send survey notification/);
    expect(await within(group(/End-of-process survey/)).findByText(/No notifications sent: this cycle has no observees or observers yet\./)).toBeVisible();
  });

  it('sends once while a send is pending, however often the button is clicked', async () => {
    let posts = 0;
    serve();
    server.use(http.post(PATHS['due-reminders'], () => { posts += 1; return never(); }));
    openControls();
    const u = await confirmSend(/Due reminders/, /Send due reminders/, /Send reminders to all/);
    const button = await within(group(/Due reminders/)).findByRole('button', { name: 'Sending…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await u.click(button);
    await u.dblClick(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(group(/Due reminders/)).getByRole('status')).toHaveTextContent('Sending…');
    // The other sends stay available.
    expect(within(group(/Observer lists ready/)).getByRole('button', { name: 'Notify lists ready' })).toBeEnabled();
    expect(posts).toBe(1);
  });

  it('sends once when the confirm button is clicked twice before React re-renders', async () => {
    let posts = 0;
    serve();
    server.use(http.post(PATHS.survey, () => { posts += 1; return HttpResponse.json({ sent: 4 }); }));
    openControls();
    await user().click(await screen.findByRole('button', { name: 'Send survey notification' }));
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send survey notification' });
    // Both clicks land in one batch, before the dialog closes, so only the in-flight guard stops the second.
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    expect(await within(group(/End-of-process survey/)).findByText(/Sent 4 in-app notifications\./)).toBeVisible();
    expect(posts).toBe(1);
  });

  it('shows a failed send without retrying it, and sends again only after a new confirmation', async () => {
    let posts = 0;
    serve();
    server.use(http.post(PATHS['lists-ready'], () => { posts += 1; return posts === 1 ? failure('Database unavailable.') : HttpResponse.json({ sent: 2 }); }));
    openControls();
    await confirmSend(/Observer lists ready/, /Notify lists ready/, /Notify observees/);
    expect(await within(group(/Observer lists ready/)).findByRole('alert')).toHaveTextContent('Not sent: Database unavailable. Nothing was retried automatically.');
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toBe(1);
    await confirmSend(/Observer lists ready/, /Try again: notify lists ready/, /Notify observees/);
    expect(await within(group(/Observer lists ready/)).findByText(/Sent 2 in-app notifications\./)).toBeVisible();
    expect(within(group(/Observer lists ready/)).queryByRole('alert')).not.toBeInTheDocument();
    expect(posts).toBe(2);
  });

  it('explains a 403 as a committee-only action', async () => {
    serve();
    server.use(http.post(PATHS.survey, () => failure('Assessment Committee only.', 403, 'FORBIDDEN')));
    openControls();
    await confirmSend(/End-of-process survey/, /Send survey notification/, /Send survey notification/);
    expect(await within(group(/End-of-process survey/)).findByRole('alert')).toHaveTextContent('Not sent: only Assessment Committee members can send notifications.');
  });

  it('explains a 404 as a missing cycle', async () => {
    serve();
    server.use(http.post(PATHS['lists-ready'], () => failure('Cycle not found.', 404, 'NOT_FOUND')));
    openControls();
    await confirmSend(/Observer lists ready/, /Notify lists ready/, /Notify observees/);
    expect(await within(group(/Observer lists ready/)).findByRole('alert')).toHaveTextContent('Not sent: this cycle was not found. Reload the page and try again.');
  });

  it('calls the result unknown, not "not sent", when the request fails without an API answer', async () => {
    serve();
    server.use(http.post(PATHS['due-reminders'], () => HttpResponse.error()));
    openControls();
    const u = await confirmSend(/Due reminders/, /Send due reminders/, /Send reminders to all/);
    const alert = await within(group(/Due reminders/)).findByRole('alert');
    expect(alert).toHaveTextContent(/The result is unknown: .* It may have been sent\. Check with a recipient before sending again; nothing was retried automatically\./);
    expect(alert).not.toHaveTextContent('Not sent');
    // No "Try again" invitation, and sending again warns about duplicates.
    const button = within(group(/Due reminders/)).getByRole('button', { name: 'Send due reminders' });
    await u.click(button);
    expect(await screen.findByRole('dialog')).toHaveTextContent(/Possibly sent from this page at .*\. Sending again creates duplicate notifications\./);
  });

  it('shows no sends until the user is known to be on the committee', async () => {
    serve();
    server.use(http.get('*/api/me', () => new Promise<never>(() => {})));
    openControls();
    await screen.findByText('No notifications yet.');
    expect(screen.queryByRole('heading', { name: 'Send notifications' })).not.toBeInTheDocument();
  });

  it('warns about duplicates when sending again after a success', async () => {
    serve({ sent: 5 });
    openControls();
    const u = await confirmSend(/Due reminders/, /Send due reminders/, /Send reminders to all/);
    await within(group(/Due reminders/)).findByText(/Sent 5/);
    await u.click(within(group(/Due reminders/)).getByRole('button', { name: 'Send due reminders' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(/Sent from this page at .*\. Sending again creates duplicate notifications\./);
  });

  it('keeps every send off when no cycle has started', async () => {
    const calls = serve({ currentCycle: null });
    openControls();
    expect(await screen.findByText(/No evaluation cycle has started yet, so there is no one to notify\./)).toBeVisible();
    for (const name of ['Send due reminders', 'Notify lists ready', 'Send survey notification']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(calls).toHaveLength(0);
  });

  it('keeps every send off when the current cycle cannot be read', async () => {
    serve();
    server.use(http.get('*/api/cycles/current', () => failure('Server error.')));
    openControls();
    expect(await screen.findByText(/Couldn't read the current cycle, so sending is off: Server error\./)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send due reminders' })).toBeDisabled();
  });

  it('shows no sends to a faculty-only user', async () => {
    serve({ role: 'faculty' });
    openControls();
    expect(await screen.findByRole('heading', { name: 'Your notifications' })).toBeVisible();
    await screen.findByText('No notifications yet.');
    expect(screen.queryByRole('heading', { name: 'Send notifications' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send|Notify/ })).not.toBeInTheDocument();
  });
});

describe('Notification inbox', () => {
  const note = (id: string, notifType: Notification['notifType'], subject: string, sentDate: string): Notification => ({
    notificationId: id, notifType, subject, sentDate, sentBy: observer,
  });

  it('lists my notifications newest first, with type, time and sender', async () => {
    serve({ inbox: [note('2', 'reminder', 'Reminder: you are due for a classroom observation.', '2026-11-03T20:00:00Z'), note('1', 'survey_open', 'The survey is open.', '2026-11-02T15:00:00Z')] });
    openControls();
    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/Due reminder.*Nov 3, 2:00 PM.*from Dr\. Elena Ruiz/);
    expect(items[0]).toHaveTextContent('Reminder: you are due for a classroom observation.');
    expect(items[1]).toHaveTextContent(/Survey open/);
  });

  it('refreshes the inbox after a send, since the sender may be a recipient', async () => {
    let inboxReads = 0;
    serve();
    server.use(http.get('*/api/me/notifications', () => { inboxReads += 1; return HttpResponse.json([]); }));
    openControls();
    await screen.findByText('No notifications yet.');
    expect(inboxReads).toBe(1);
    await confirmSend(/Due reminders/, /Send due reminders/, /Send reminders to all/);
    await waitFor(() => expect(inboxReads).toBe(2));
  });

  it('pages a long inbox five at a time', async () => {
    const inbox = Array.from({ length: 7 }, (_, i) => note(String(i), 'matches_ready', `Note ${i}`, '2026-11-01T15:00:00Z'));
    serve({ inbox });
    openControls();
    expect(await screen.findAllByRole('listitem')).toHaveLength(5);
    await user().click(screen.getByRole('button', { name: 'Page 2' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows a failed inbox with Try again', async () => {
    let reads = 0;
    serve();
    server.use(http.get('*/api/me/notifications', () => { reads += 1; return reads === 1 ? failure('Inbox down.') : HttpResponse.json([]); }));
    openControls();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your notifications: Inbox down.");
    await user().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No notifications yet.')).toBeVisible();
  });
});
