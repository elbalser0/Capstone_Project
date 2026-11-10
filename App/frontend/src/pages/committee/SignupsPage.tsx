import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { useCycleSignups, useMatching, useNotifyListsReady, useRunMatching } from '../../api/hooks/committee';
import { sharedKeys, useCurrentCycle } from '../../api/hooks/shared';
import type { AlertType, MatchingRow } from '../../api/types';
import { usePageTitle } from '../../components/AppShell';
import { AlertIcon, CheckIcon, MailIcon } from '../../components/icons';
import { Banner, Button, Cell, EmptyRow, ErrorNote, Modal, Pagination, Row, Table, Tag, linkClass, usePages, type TagTone } from '../../components/ui';
import { todayIso } from '../../lib/dates';
import { countSummary, dayLetters, formatClock, formatDateTime, formatShort, formatTime } from '../../lib/format';
import { UNMATCHED_TEXT } from '../../lib/statusTerms';

// A4. After the sign-up deadline the committee runs observer selection (POST /api/cycles/{cycleId}/matching),
// checks the sign-ups that need attention, then tells observees their lists are ready.

const PAGE_SIZE = 7;
/** Observer selection lists up to this many observers per sign-up (MAX_CANDIDATES in the backend). */
const LIST_SIZE = 5;
/** Fewer usable observers than this raises an insufficient_observers alert (INSUFFICIENT_BELOW in the backend). */
const ENOUGH = 3;
const ALERT_TAG: Record<AlertType, [TagTone, string]> = {
  no_observer: ['overdue', 'No observer'],
  insufficient_observers: ['due', 'Insufficient'],
  no_acceptance: ['overdue', 'Nobody accepted'],
};

const observers = (n: number) => `${n} observer${n === 1 ? '' : 's'}`;

function attentionText(rows: MatchingRow[]) {
  const none = rows.filter((r) => r.alert?.alertType === 'no_observer').length;
  const few = rows.filter((r) => r.alert?.alertType === 'insufficient_observers');
  const nobody = rows.filter((r) => r.alert?.alertType === 'no_acceptance').length;
  const parts = countSummary([
    [none, 'with no observer'],
    [few.length, few.length === 1 ? `with only ${observers(few[0].candidates.length)}` : `with fewer than ${ENOUGH} observers`],
    [nobody, 'where nobody accepted'],
  ]);
  const n = rows.length;
  return `${n} sign-up${n === 1 ? ' needs' : 's need'} attention: ${parts}.`;
}

function ObserversFound({ row, ran }: { row: MatchingRow; ran: boolean }) {
  const n = row.candidates.length;
  const type = row.alert?.alertType;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {ran ? <span className="font-bold">{n === 0 ? '0' : `${n} of ${LIST_SIZE}`}</span> : <span className="text-gray-500">Not run yet</span>}
      {type && <Tag tone={ALERT_TAG[type][0]} icon={<AlertIcon width={10.5} height={9.5} />}>{ALERT_TAG[type][1]}</Tag>}
    </span>
  );
}

/**
 * Same rules as the dashboard sends: a send the backend answered with its own error body did not happen;
 * anything else (no connection, a proxy timeout, a reply that is not the API's) may have, so it is unknown.
 */
function sendFailure(error: unknown): { known: boolean; text: string } {
  if (error instanceof ApiError && error.status === 403) return { known: true, text: 'Not sent: only Assessment Committee members can send notifications.' };
  if (error instanceof ApiError && error.status === 404) return { known: true, text: 'Not sent: this cycle was not found. Reload the page and try again.' };
  if (error instanceof ApiError && error.code !== 'HTTP_ERROR') return { known: true, text: `Not sent: ${error.message} Nothing was retried automatically.` };
  const detail = error instanceof Error ? error.message : 'Something went wrong.';
  return {
    known: false,
    text: `The result is unknown: ${detail} It may have been sent. Check with a recipient before sending again; nothing was retried automatically.`,
  };
}

const sentText = (n: number) => (n === 0
  ? 'No notifications sent: no sign-up in this cycle has an observer list yet.'
  : `Sent ${n} in-app notification${n === 1 ? '' : 's'}.`);

/**
 * POST /api/cycles/{cycleId}/notifications/lists-ready, answered with { sent }. It is not idempotent, so it
 * asks first, ignores repeat clicks while it runs and is never retried automatically.
 */
function NotifyListsReady({ cycleId, disabled }: { cycleId: string; disabled: boolean }) {
  const qc = useQueryClient();
  const notify = useNotifyListsReady(cycleId);
  const [confirming, setConfirming] = useState(false);
  const sending = useRef(false);
  const pending = notify.isPending;
  const failed = notify.isError ? sendFailure(notify.error) : null;

  const send = () => {
    if (sending.current || disabled) return;
    sending.current = true;
    setConfirming(false);
    notify.mutate(undefined, {
      onSettled: () => { sending.current = false; },
      // The sender may be one of the recipients, so their own inbox is refreshed.
      onSuccess: () => { void qc.invalidateQueries({ queryKey: sharedKeys.notifications }); },
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        aria-disabled={pending || undefined}
        aria-describedby={disabled ? 'notify-lists-hint' : undefined}
        onClick={() => { if (!pending && !sending.current) setConfirming(true); }}
      >
        <MailIcon /> {pending ? 'Sending…' : failed?.known ? 'Try again: notify observees' : 'Notify observees: lists are ready'}
      </Button>
      <p role="status" className="text-xs text-gray-500 empty:hidden">
        {pending ? 'Sending…' : notify.isSuccess ? `${sentText(notify.data.sent)} (${formatClock(notify.submittedAt)})` : ''}
      </p>
      {disabled && <p id="notify-lists-hint" className="text-xs text-gray-500">Available once observer selection has made lists.</p>}
      {failed && !pending && <ErrorNote key={notify.submittedAt} error={new Error(failed.text)} />}
      {confirming && (
        <Modal
          title="Notify observees: lists are ready?"
          onClose={() => setConfirming(false)}
          footer={(
            <>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button type="button" onClick={send}>Notify observees</Button>
            </>
          )}
        >
          <div className="text-sm text-gray-700">
            <p>This tells <strong>every</strong> professor in this cycle whose sign-up has an observer list that the list is ready to choose from.</p>
            <p className="mt-3">In-app notification only, no email. Sending again notifies the same professors again.</p>
            {(notify.isSuccess || (failed && !failed.known)) && (
              <p className="mt-3 font-bold text-gray-900">
                {notify.isSuccess ? 'Sent' : 'Possibly sent'} from this page at {formatClock(notify.submittedAt)}. Sending again creates duplicate notifications.
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** "CS 1337" from "CS 1337.002"; the backend writes the department's full name ("Computer Science 1337.002"). */
const courseOf = ({ label, sectionNum }: MatchingRow['section']) =>
  (label.endsWith(`.${sectionNum}`) ? label.slice(0, -(sectionNum.length + 1)) : label);

const classTime = (row: MatchingRow) =>
  row.section.meetings[0] ? `${dayLetters(row.section.meetings)} ${formatTime(row.section.meetings[0].startTime)}` : 'Online';

export function SignupsPage() {
  const cycle = useCurrentCycle();
  const c = cycle.data;
  const matching = useMatching(c?.cycleId);
  const signups = useCycleSignups(c?.cycleId);
  const run = useRunMatching(c?.cycleId ?? '');
  // isPending reaches React a tick after mutate(), so a fast double click would run twice without this.
  const running = useRef(false);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const passed = c ? todayIso() > c.signupDeadline : false;
  usePageTitle(c ? `Sign-up requests (deadline ${passed ? 'passed ' : ''}${formatShort(c.signupDeadline)})` : null);

  const all = matching.data ?? [];
  const attention = all.filter((r) => r.alert);
  // Once nothing needs attention any more (for example after an observer is added), the full list is shown.
  const filtered = onlyAttention && attention.length > 0;
  const rows = filtered ? attention : all;
  const pager = usePages(rows, PAGE_SIZE);
  const email = new Map(signups.data?.map((s) => [s.signupId, s.observee.email]));
  const ranOn = all.reduce<string | null>((latest, r) => (r.ranAt && (!latest || r.ranAt > latest) ? r.ranAt : latest), null);
  const full = all.filter((r) => r.candidates.length >= LIST_SIZE).length;
  // A run that found no observer for anyone leaves every ranAt empty, but it does raise alerts.
  const ran = ranOn !== null || all.some((r) => r.alert);

  // The sign-ups read only fills the Email column, so its failure leaves that column empty.
  const failed = [cycle, matching].filter((q) => q.error);
  if (failed.length) {
    const busy = failed.some((q) => q.isFetching);
    return (
      <div className="flex flex-col items-start gap-3 pt-8">
        <ErrorNote error={failed[0].error} className="self-stretch" />
        <Button type="button" variant="secondary" size="sm" aria-disabled={busy || undefined} onClick={() => { if (!busy) failed.forEach((q) => void q.refetch()); }}>
          {busy ? 'Trying again…' : 'Try again'}
        </Button>
      </div>
    );
  }
  if (c === null) return <p className="pt-8 text-sm text-gray-500">No evaluation cycle has started yet.</p>;
  if (!c || matching.isPending) return <p role="status" className="pt-8 text-sm text-gray-500">Loading sign-ups…</p>;

  const runSelection = () => {
    if (running.current || !passed) return;
    running.current = true;
    run.mutate(undefined, { onSettled: () => { running.current = false; } });
  };

  return (
    <div className="flex flex-col pt-8">
      {attention.length > 0 && (
        <div className="mb-5">
          <Banner
            tone="danger"
            action={
              <button
                type="button"
                className={linkClass}
                onClick={() => {
                  setOnlyAttention(!filtered);
                  pager.setPage(1);
                }}
              >
                {filtered ? 'Show all' : 'Show only these'}
              </button>
            }
          >
            {attentionText(attention)}
          </Banner>
          <p className="mt-2 text-[13px] text-gray-500">{UNMATCHED_TEXT}</p>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <Button
            type="button"
            variant={ran ? 'done' : 'primary'}
            disabled={!passed}
            aria-disabled={run.isPending || undefined}
            onClick={runSelection}
            aria-describedby="run-selection-status"
          >
            {ran && <CheckIcon width={10} height={8} />}
            {run.isPending ? 'Running…' : 'Run observer selection'}
          </Button>
          <div id="run-selection-status" role="status" className="text-xs">
            {ran ? (
              <>
                <p className="font-bold text-gray-700">{ranOn ? `Ran ${formatDateTime(ranOn)}` : 'Observer selection has run'}</p>
                <p className="mt-[3px] text-gray-500">{full} of {all.length} sign-ups have {LIST_SIZE} observers</p>
              </>
            ) : (
              <p className="text-gray-500">{passed ? `${all.length} sign-up${all.length === 1 ? '' : 's'}, not run yet` : `Available after ${formatShort(c.signupDeadline)}`}</p>
            )}
          </div>
        </div>
        <NotifyListsReady key={c.cycleId} cycleId={c.cycleId} disabled={!ranOn} />
      </div>
      <ErrorNote error={run.error} className="mt-4" />

      <div className="mt-4 max-w-full overflow-x-auto rounded-lg">
        <div className="min-w-[900px]">
          <Table label="Sign-up requests" columns="minmax(96px,150px) 88px 120px 172px 200px 1fr" head={['Course #', 'Section #', 'Days and time', 'Observee', 'Email', 'Observers found']}>
            {pager.rows.map((r) => (
              <Row key={r.signupId}>
                <Cell className="font-bold">{courseOf(r.section)}</Cell>
                <Cell>{r.section.sectionNum}</Cell>
                <Cell>{classTime(r)}</Cell>
                <Cell>{r.observee.displayName}</Cell>
                <Cell className="truncate text-gray-500">{email.get(r.signupId)}</Cell>
                <Cell><ObserversFound row={r} ran={ran} /></Cell>
              </Row>
            ))}
            {rows.length === 0 && <EmptyRow>No sign-ups yet.</EmptyRow>}
          </Table>
        </div>
      </div>
      <div className="mt-[11px]"><Pagination pager={pager} label="Sign-up pages" /></div>
    </div>
  );
}
