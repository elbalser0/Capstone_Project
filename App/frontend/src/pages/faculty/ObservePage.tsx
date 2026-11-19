import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../api/client';
import { requestClosed, useConfirmRequest, useDeclineRequest, useIncomingRequests, useMyAssignments, useMyCourses } from '../../api/hooks/faculty';
import { useCurrentCycle } from '../../api/hooks/shared';
import type { CourseSection, ObservationRequest, ObservationSummary, ProposedDate } from '../../api/types';
import { usePageTitle } from '../../components/AppShell';
import { ClockIcon } from '../../components/icons';
import { Button, Card, Cell, EmptyRow, ErrorNote, InfoLine, Note, Radio, Row, StatCard, Table, Tag, buttonClass, linkClass } from '../../components/ui';
import { campusTodayIso, hoursUntil } from '../../lib/dates';
import { classStart, formatShort, formatSlot, isLocked, RANK_LABEL, weekday } from '../../lib/format';
import { recordStatus } from './observationDisplay';

const LIMIT = 3;

function useThisSemester() {
  const cycle = useCurrentCycle();
  const assignments = useMyAssignments();
  const termId = cycle.data?.term.termId;
  const allAssignments = assignments.data ?? [];
  const accepted = termId ? allAssignments.filter((assignment) => assignment.term.termId === termId) : [];
  return { cycle, assignments, accepted, allAssignments };
}

/** What the observer sees for one of their observations: the real record state, not a fixed label. */
function confirmationStatus(assignment: ObservationSummary) {
  if (assignment.status === 'scheduled' && !assignment.observerSignedDate && !assignment.observeeSignedDate) return { tone: 'neutral' as const, text: 'Scheduled' };
  return recordStatus(assignment, assignment.observer.netid);
}

/** The form opens on the observation date: the backend refuses an earlier submit with NOT_YET_OBSERVED. */
function FormAction({ assignment }: { assignment: ObservationSummary }) {
  const view = isLocked(assignment) || assignment.status === 'not_completed' || Boolean(assignment.observerSignedDate);
  if (view) return <Link to={`/faculty/observe/${assignment.observationId}`} className={buttonClass('secondary', 'w-28', 'sm')}>View</Link>;
  if (assignment.scheduledDate > campusTodayIso()) return <span className="text-xs text-gray-500">Form opens {formatShort(assignment.scheduledDate)}</span>;
  return <Link to={`/faculty/observe/${assignment.observationId}/form`} className={buttonClass('secondary', 'w-28', 'sm')}>Open form</Link>;
}

function ConfirmationRow({ assignment }: { assignment: ObservationSummary }) {
  const status = confirmationStatus(assignment);
  return (
    <Row>
      <Cell className="font-bold">{assignment.observee.displayName}</Cell>
      <Cell>{assignment.section.label}</Cell>
      <Cell>{formatSlot(assignment.scheduledDate, classStart(assignment.section, assignment.scheduledDate))}</Cell>
      <Cell><Tag tone={status.tone}>{status.text}</Tag></Cell>
      <Cell className="pr-0"><FormAction assignment={assignment} /></Cell>
    </Row>
  );
}

/**
 * The observer's own class that meets while the observed class meets on that date, if any. The server refuses
 * such a date (SCHEDULE_CONFLICT), so the card marks it instead of letting every pick fail.
 */
function clashOn(proposed: ProposedDate, request: ObservationRequest, mine: CourseSection[]) {
  const day = weekday(proposed.date);
  const observed = request.section.meetings.filter((m) => m.dayOfWeek === day);
  return mine.find((own) => own.meetings.some((m) => m.dayOfWeek === day && observed.some((o) => m.startTime < o.endTime && o.startTime < m.endTime)));
}

function RequestCard({ request, limitReached, mine, onClosed }: { request: ObservationRequest; limitReached: boolean; mine: CourseSection[]; onClosed: (message: string) => void }) {
  const [date, setDate] = useState<string | null>(null);
  const confirm = useConfirmRequest();
  const decline = useDeclineRequest();
  const submitting = useRef(false);
  const busy = confirm.isPending || decline.isPending || confirm.isSuccess || decline.isSuccess;
  const requestTarget = { signupId: request.signupId, observerNetId: request.observer.netid };

  const accept = () => {
    if (!date || limitReached || busy || submitting.current) return;
    submitting.current = true;
    confirm.mutate({ ...requestTarget, date }, { onError: failed });
  };
  const declineRequest = () => {
    if (busy || submitting.current) return;
    submitting.current = true;
    decline.mutate(requestTarget, { onError: failed });
  };
  // A request answered elsewhere leaves the list when it is read again, so the page keeps the reason after the card goes.
  function failed(error: Error) {
    submitting.current = false;
    // At the limit the request stays open for others, so the card stays (with Accept off) and its own error explains it.
    if (requestClosed(error) && !(error instanceof ApiError && error.code === 'LIMIT_REACHED')) onClosed(`${request.observee.displayName}, ${request.section.label}: ${error.message}`);
  }
  const hours = hoursUntil(request.expiresAt);
  // The backend refuses a date that has passed (DATE_PASSED), so only offer today and later.
  const today = campusTodayIso();
  const upcoming = request.proposedDates.filter((proposed) => proposed.date >= today);

  return (
    <Card className="space-y-4 p-5 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(14rem,1fr)_minmax(15rem,1.2fr)_auto] lg:gap-6">
        <div>
          <h3 className="text-base font-bold text-gray-900">{request.observee.displayName}</h3>
          <p className="mt-1 text-xs text-gray-500">{RANK_LABEL[request.observee.rank]}</p>
          <p className="mt-4 text-sm text-gray-900">{request.section.label} {request.section.title}</p>
        </div>
        <fieldset className="space-y-3">
          <legend className="text-xs text-gray-500">Proposed times, pick the one you can attend</legend>
          {upcoming.length === 0 && <p className="text-sm text-gray-700">All proposed times have passed.</p>}
          {upcoming.map((proposed) => {
            const clash = clashOn(proposed, request, mine);
            return (
              <label key={proposed.date} className={`flex items-center gap-2.5 text-sm ${clash ? 'text-gray-500' : 'cursor-pointer text-gray-900'} ${date === proposed.date ? 'font-bold' : ''}`}>
                <Radio name={`slot-${request.signupId}`} checked={date === proposed.date} disabled={busy || limitReached || Boolean(clash)} onChange={() => setDate(proposed.date)} />
                <span>
                  {formatSlot(proposed.date, proposed.startTime)}
                  {clash && <span className="block text-xs font-normal">You teach {clash.label} at this time</span>}
                </span>
              </label>
            );
          })}
          {upcoming.length > 0 && upcoming.every((proposed) => clashOn(proposed, request, mine)) && (
            <p className="text-sm text-gray-700">You teach at every proposed time, so you can only decline this request.</p>
          )}
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-4 lg:min-h-full lg:flex-col lg:items-end">
          <Tag tone="due" icon={<ClockIcon width={11} height={11} />}>
            {hours > 0 ? `Expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}` : 'Expiring now'}
          </Tag>
          <div className="flex gap-3">
            <Button className="w-[88px]" disabled={!date || busy || limitReached || upcoming.length === 0} aria-busy={confirm.isPending} onClick={accept}>
              {confirm.isPending ? 'Accepting…' : confirm.isSuccess ? 'Accepted' : 'Accept'}
            </Button>
            <Button className="w-[88px]" variant="secondary" disabled={busy} aria-busy={decline.isPending} onClick={declineRequest}>
              {decline.isPending ? 'Declining…' : decline.isSuccess ? 'Declined' : 'Decline'}
            </Button>
          </div>
        </div>
      </div>
      <ErrorNote error={confirm.error ?? decline.error} />
    </Card>
  );
}

export function ObserveRequestsPage() {
  usePageTitle('Observation requests');
  const incoming = useIncomingRequests();
  const { cycle, assignments, accepted } = useThisSemester();
  // Only used to mark proposed times that clash with the observer's own classes; without it the server still refuses them.
  const mine = useMyCourses(cycle.data?.term.termId).data ?? [];
  const [closed, setClosed] = useState<string[]>([]);
  const errors = [incoming.error, assignments.error, cycle.error];
  const error = errors.find(Boolean);
  const retry = () => void Promise.all([incoming.refetch(), assignments.refetch(), cycle.refetch()]);

  if (error) {
    return <div className="space-y-4 pt-8"><ErrorNote error={error} /><Button variant="secondary" onClick={retry}>Try again</Button></div>;
  }
  if (!incoming.data || !assignments.data || cycle.data === undefined) {
    return <p role="status" className="pt-8 text-sm text-gray-500">Loading observation requests…</p>;
  }

  const pending = incoming.data.filter((request) => request.status === 'pending');
  const count = accepted.length;
  const limitReached = count >= LIMIT;

  return (
    <div className="flex flex-col pt-8">
      <Card className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <p className="text-base font-bold text-gray-900">You have accepted {count} of {LIMIT} observations this semester</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-gray-200" role="progressbar" aria-valuemin={0} aria-valuemax={LIMIT} aria-valuenow={count} aria-label="Observations accepted">
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(count, LIMIT) / LIMIT * 100}%` }} />
            </div>
            <span className="text-xs text-gray-500">{Math.max(0, LIMIT - count)} left</span>
          </div>
        </div>
        <Link to="/faculty/observe/confirmations" className={linkClass}>See my confirmations</Link>
      </Card>

      <h2 className="mb-[13px] mt-6 text-base font-bold text-gray-900">New requests ({pending.length})</h2>
      <div className="flex flex-col gap-4">
        {closed.map((message) => <p key={message} role="status" className="text-sm text-gray-700">No longer open: {message}</p>)}
        {pending.map((request) => (
          <RequestCard key={request.signupId} request={request} limitReached={limitReached} mine={mine} onClosed={(message) => setClosed((list) => (list.includes(message) ? list : [...list, message]))} />
        ))}
        {pending.length === 0 && <p className="text-sm text-gray-500">No new requests.</p>}
      </div>

      <InfoLine className="mt-[34px]">Requests expire 48 hours after they are sent. You can confirm up to 3 observations per semester.</InfoLine>
      <Note className="mt-4" title="The first colleague to accept is paired automatically.">
        If someone accepts before you, this request is cancelled. It does not count toward your 3.
      </Note>
    </div>
  );
}

export function ConfirmationsPage() {
  usePageTitle('My confirmations');
  const incoming = useIncomingRequests();
  const { cycle, assignments, accepted, allAssignments } = useThisSemester();
  const error = incoming.error ?? assignments.error ?? cycle.error;
  const retry = () => void Promise.all([incoming.refetch(), assignments.refetch(), cycle.refetch()]);

  if (error) {
    return <div className="space-y-4 pt-8"><ErrorNote error={error} /><Button variant="secondary" onClick={retry}>Try again</Button></div>;
  }
  if (!incoming.data || !assignments.data || cycle.data === undefined) {
    return <p role="status" className="pt-8 text-sm text-gray-500">Loading your confirmations…</p>;
  }

  const cancelled = incoming.data.filter((request) => request.status === 'cancelled');
  const earlier = allAssignments.filter((a) => !accepted.includes(a));
  const waitingForForm = accepted.filter((a) => a.status === 'scheduled' && !a.observerSignedDate).length;

  return (
    <div className="flex flex-col pt-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Accepted this semester" value={`${accepted.length} of ${LIMIT}`} />
        <StatCard label="Waiting for your form" value={waitingForForm} />
        <StatCard label="Cancelled" value={cancelled.length} />
      </div>

      <h2 className="mb-[13px] mt-6 text-base font-bold text-gray-900">My confirmations</h2>
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <Table label="My confirmations" columns="minmax(120px, 1.1fr) minmax(100px, .8fr) minmax(145px, 1.2fr) minmax(150px, 1fr) 130px" head={['Observee', 'Course', 'Date and time', 'Status', '']}>
            {accepted.map((assignment) => <ConfirmationRow key={assignment.observationId} assignment={assignment} />)}
            {cancelled.map((request) => (
              <Row key={request.signupId}>
                <Cell className="font-bold">{request.observee.displayName}</Cell>
                <Cell>{request.section.label}</Cell>
                <Cell />
                <Cell><Tag tone="neutral">Cancelled</Tag></Cell>
                <Cell />
              </Row>
            ))}
            {!assignments.isPending && cycle.data && accepted.length + cancelled.length === 0 && <EmptyRow>No confirmations yet this semester.</EmptyRow>}
          </Table>
        </div>
      </div>
      {earlier.length > 0 && (
        <>
          <h2 className="mb-[13px] mt-8 text-base font-bold text-gray-900">Earlier semesters</h2>
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <Table label="Earlier confirmations" columns="minmax(120px, 1.1fr) minmax(100px, .8fr) minmax(145px, 1.2fr) minmax(150px, 1fr) 130px" head={['Observee', 'Course', 'Date and time', 'Status', '']}>
                {earlier.map((assignment) => <ConfirmationRow key={assignment.observationId} assignment={assignment} />)}
              </Table>
            </div>
          </div>
        </>
      )}
      <InfoLine className="mt-[18px]">If you accept first, you are paired right away. A request shows as cancelled when another colleague accepted first, or when you reached 3 observations.</InfoLine>
    </div>
  );
}
