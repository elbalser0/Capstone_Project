import { useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ApiError } from '../../api/client';
import { useNotifyListsReady, useNotifySurvey, useSendDueReminders } from '../../api/hooks/committee';
import { sharedKeys, useCurrentCycle, useMe } from '../../api/hooks/shared';
import { Button, Card, ErrorNote, Modal } from '../../components/ui';
import { formatClock } from '../../lib/format';
import { errorText } from './DashboardSections';

// The three Assessment Committee sends: POST /api/cycles/{cycleId}/notifications/{due-reminders,lists-ready,survey}.
// Each answers 200 { sent } with the number of in-app notifications it wrote. None of them is idempotent, so
// every send asks first, ignores repeat clicks while it runs and is never retried automatically.

type ActionId = 'due-reminders' | 'lists-ready' | 'survey';

interface ActionCopy {
  title: string;
  button: string;
  /** What the action does, shown beside its button. */
  describe: string;
  /** The confirmation dialog: who gets it and what else happens. */
  confirm: ReactNode;
  confirmButton: string;
  /** The result line once the backend answers with { sent }. */
  sent: (n: number) => string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const ACTIONS: Record<ActionId, ActionCopy> = {
  'due-reminders': {
    title: 'Due reminders',
    button: 'Send due reminders',
    describe: 'Every active professor who is due or overdue and has not signed up this cycle. Also queues a reminder email to each one.',
    confirm: (
      <>
        <p>This sends an in-app reminder to <strong>every</strong> active professor who is due or overdue and has not signed up for this cycle.</p>
        <p className="mt-3">It also queues a reminder email to each of them. Whether an email is delivered depends on the server's email settings; this page cannot confirm delivery.</p>
        <p className="mt-3">Sending again later reminds the same professors again.</p>
      </>
    ),
    confirmButton: 'Send reminders to all',
    sent: (n) => (n === 0
      ? 'No reminders sent: no active professor who is due this cycle is still without a sign-up.'
      : `Sent ${plural(n, 'in-app reminder', 'in-app reminders')}. Reminder emails go out only when the server has email turned on; delivery is not confirmed here.`),
  },
  'lists-ready': {
    title: 'Observer lists ready',
    button: 'Notify lists ready',
    describe: 'Every professor in this cycle whose sign-up has an observer list.',
    confirm: (
      <>
        <p>This tells <strong>every</strong> professor in this cycle whose sign-up has an observer list that the list is ready to choose from.</p>
        <p className="mt-3">In-app notification only, no email. Sending again notifies the same professors again.</p>
      </>
    ),
    confirmButton: 'Notify observees',
    sent: (n) => (n === 0
      ? 'No notifications sent: no sign-up in this cycle has an observer list yet.'
      : `Sent ${plural(n, 'in-app notification', 'in-app notifications')}.`),
  },
  survey: {
    title: 'End-of-process survey',
    button: 'Send survey notification',
    describe: 'Every observee and observer in this cycle, once each.',
    confirm: (
      <>
        <p>This tells <strong>every</strong> observee and observer in this cycle, once each, that the end-of-process survey is open until the feedback deadline.</p>
        <p className="mt-3">In-app notification only, no email. Sending again notifies the same people again.</p>
      </>
    ),
    confirmButton: 'Send survey notification',
    sent: (n) => (n === 0
      ? 'No notifications sent: this cycle has no observees or observers yet.'
      : `Sent ${plural(n, 'in-app notification', 'in-app notifications')}.`),
  },
};

const ORDER: ActionId[] = ['due-reminders', 'lists-ready', 'survey'];

/**
 * A send the backend answered with its own error body did not happen. Anything else (no connection, a
 * proxy timeout, a reply that is not the API's) may have reached the database, so it is reported as unknown.
 */
function failure(error: unknown): { known: boolean; text: string } {
  if (error instanceof ApiError && error.status === 403) return { known: true, text: 'Not sent: only Assessment Committee members can send notifications.' };
  if (error instanceof ApiError && error.status === 404) return { known: true, text: 'Not sent: this cycle was not found. Reload the page and try again.' };
  if (error instanceof ApiError && error.code !== 'HTTP_ERROR') return { known: true, text: `Not sent: ${error.message} Nothing was retried automatically.` };
  return {
    known: false,
    text: `The result is unknown: ${errorText(error)} It may have been sent. Check with a recipient before sending again; nothing was retried automatically.`,
  };
}

/** One send: its button, the confirmation dialog and the result line. */
function SendAction({ id, cycleId, disabled }: { id: ActionId; cycleId: string; disabled: boolean }) {
  const copy = ACTIONS[id];
  const qc = useQueryClient();
  const reminders = useSendDueReminders(cycleId);
  const listsReady = useNotifyListsReady(cycleId);
  const survey = useNotifySurvey(cycleId);
  const mutation = { 'due-reminders': reminders, 'lists-ready': listsReady, survey }[id];
  const [confirming, setConfirming] = useState(false);
  // isPending reaches React a tick after mutate(), so a fast double click would send twice without this.
  const sending = useRef(false);
  const titleId = `notify-${id}`;

  const send = () => {
    if (sending.current || disabled) return;
    sending.current = true;
    setConfirming(false);
    const done = {
      onSettled: () => { sending.current = false; },
      // The sender may be one of the recipients, so their own inbox is refreshed.
      onSuccess: () => { void qc.invalidateQueries({ queryKey: sharedKeys.notifications }); },
    };
    // An empty body means "everyone due"; no netids are ever sent from here.
    if (id === 'due-reminders') reminders.mutate({}, done);
    else if (id === 'lists-ready') listsReady.mutate(undefined, done);
    else survey.mutate(undefined, done);
  };

  const pending = mutation.isPending;
  const failed = mutation.isError ? failure(mutation.error) : null;
  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col gap-3 px-5 py-4 @xl:flex-row @xl:items-start @xl:justify-between">
      <div className="min-w-0">
        <h3 id={titleId} className="text-sm font-bold text-gray-900">{copy.title}</h3>
        <p className="mt-1 text-[13px] text-gray-500">{copy.describe}</p>
        {/* Polite status for progress and results; the error box below announces itself. */}
        <p role="status" className="mt-1.5 text-[13px] wrap-anywhere text-gray-900 empty:hidden">
          {pending ? 'Sending…' : mutation.isSuccess ? `${copy.sent(mutation.data.sent)} (${formatClock(mutation.submittedAt)})` : ''}
        </p>
        {failed && !pending && <ErrorNote key={mutation.submittedAt} error={new Error(failed.text)} className="mt-2" />}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="compact"
        className="self-start"
        disabled={disabled}
        aria-disabled={pending || undefined}
        onClick={() => { if (!pending && !sending.current) setConfirming(true); }}
      >
        {pending ? 'Sending…' : failed?.known ? `Try again: ${copy.button.toLowerCase()}` : copy.button}
      </Button>
      {confirming && (
        <Modal
          title={`${copy.button}?`}
          onClose={() => setConfirming(false)}
          footer={(
            <>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button type="button" onClick={send}>{copy.confirmButton}</Button>
            </>
          )}
        >
          <div className="text-sm text-gray-700">
            {copy.confirm}
            {(mutation.isSuccess || (failed && !failed.known)) && (
              <p className="mt-3 font-bold text-gray-900">
                {mutation.isSuccess ? 'Sent' : 'Possibly sent'} from this page at {formatClock(mutation.submittedAt)}. Sending again creates duplicate notifications.
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * The committee's notification sends, under the dashboard lists. Shown only to AC members (the backend
 * checks again); off until the current cycle is known.
 */
export function NotificationControls() {
  const me = useMe();
  const cycle = useCurrentCycle();
  if (me.data?.role !== 'AC') return null;
  const cycleId = cycle.data?.cycleId;
  const note = cycle.isPending
    ? 'Checking the current cycle…'
    : cycle.data === null
      ? 'No evaluation cycle has started yet, so there is no one to notify.'
      : !cycleId
        ? `Couldn't read the current cycle, so sending is off: ${errorText(cycle.error)}`
        : null;
  return (
    <section aria-labelledby="send-notifications">
      <h2 id="send-notifications" className="mt-[30px] mb-3 w-fit text-base font-bold text-gray-900">Send notifications</h2>
      {note && <p className="mb-3 text-sm text-gray-500">{note}</p>}
      <Card className="divide-y divide-gray-200">
        {ORDER.map((id) => <SendAction key={`${cycleId ?? 'none'}-${id}`} id={id} cycleId={cycleId ?? ''} disabled={!cycleId} />)}
      </Card>
    </section>
  );
}
