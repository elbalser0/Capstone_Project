import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useConfirmRequest, useDeclineRequest, useIncomingRequests, useMyAssignments } from '../../api/hooks/faculty';
import { useCurrentCycle } from '../../api/hooks/shared';
import type { ObservationRequest } from '../../api/types';
import { usePageTitle } from '../../components/AppShell';
import { ClockIcon } from '../../components/icons';
import { Button, Card, Cell, EmptyRow, ErrorNote, InfoLine, Note, Radio, Row, StatCard, Table, Tag, buttonClass, linkClass } from '../../components/ui';
import { hoursUntil } from '../../lib/dates';
import { classStart, formatSlot, isLocked, RANK_LABEL } from '../../lib/format';

const LIMIT = 3;

function useThisSemester() {
  const cycle = useCurrentCycle();
  const assignments = useMyAssignments();
  const termId = cycle.data?.term.termId;
  const allAssignments = assignments.data ?? [];
  const accepted = termId ? allAssignments.filter((assignment) => assignment.term.termId === termId) : [];
  return { cycle, assignments, accepted, allAssignments };
}

function RequestCard({ request, limitReached }: { request: ObservationRequest; limitReached: boolean }) {
  const [date, setDate] = useState<string | null>(null);
  const confirm = useConfirmRequest();
  const decline = useDeclineRequest();
  const submitting = useRef(false);
  const busy = confirm.isPending || decline.isPending || confirm.isSuccess || decline.isSuccess;
  const requestTarget = { signupId: request.signupId, observerNetId: request.observer.netid };

  const accept = () => {
    if (!date || limitReached || busy || submitting.current) return;
    submitting.current = true;
    confirm.mutate({ ...requestTarget, date }, { onError: () => { submitting.current = false; } });
  };
  const declineRequest = () => {
    if (busy || submitting.current) return;
    submitting.current = true;
    decline.mutate(requestTarget, { onError: () => { submitting.current = false; } });
  };
  const hours = hoursUntil(request.expiresAt);

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
          {request.proposedDates.map((proposed) => (
            <label key={proposed.date} className={`flex cursor-pointer items-center gap-2.5 text-sm text-gray-900 ${date === proposed.date ? 'font-bold' : ''}`}>
              <Radio name={`slot-${request.signupId}`} checked={date === proposed.date} disabled={busy || limitReached} onChange={() => setDate(proposed.date)} />
              {formatSlot(proposed.date, proposed.startTime)}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-4 lg:min-h-full lg:flex-col lg:items-end">
          <Tag tone="due" icon={<ClockIcon width={11} height={11} />}>
            {hours > 0 ? `Expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}` : 'Expiring now'}
          </Tag>
          <div className="flex gap-3">
            <Button className="w-[88px]" disabled={!date || busy || limitReached} aria-busy={confirm.isPending} onClick={accept}>
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
        {pending.map((request) => <RequestCard key={request.signupId} request={request} limitReached={limitReached} />)}
        {pending.length === 0 && <p className="text-sm text-gray-500">No new requests.</p>}
      </div>

      <InfoLine className="mt-[34px]">Requests expire 48 hours after they are sent. You can confirm up to 3 observations per semester.</InfoLine>
      <Note className="mt-4" title="The first colleague to accept is paired automatically.">
        If someone accepts before you, this request is cancelled and you get an email. It does not count toward your 3.
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

  return (
    <div className="flex flex-col pt-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Accepted this semester" value={`${accepted.length} of ${LIMIT}`} />
        <StatCard label="You are the observer" value={accepted.length} />
        <StatCard label="Cancelled, someone else accepted first" value={cancelled.length} />
      </div>

      <h2 className="mb-[13px] mt-6 text-base font-bold text-gray-900">My confirmations</h2>
      <Table label="My confirmations" columns="minmax(120px, 1.1fr) minmax(100px, .8fr) minmax(145px, 1.2fr) minmax(120px, 1fr) 112px" head={['Observee', 'Course', 'Date and time', 'Status', '']}>
        {allAssignments.map((assignment) => {
          const closed = isLocked(assignment) || assignment.status === 'not_completed';
          return (
            <Row key={assignment.observationId}>
              <Cell className="font-bold">{assignment.observee.displayName}</Cell>
              <Cell>{assignment.section.label}</Cell>
              <Cell>{formatSlot(assignment.scheduledDate, classStart(assignment.section, assignment.scheduledDate))}</Cell>
              <Cell><Tag tone="signed">You are the observer</Tag></Cell>
              <Cell className="pr-0">
                <Link to={`/faculty/observe/${assignment.observationId}${closed ? '' : '/form'}`} className={buttonClass('secondary', 'w-28', 'sm')}>
                  {closed ? 'View' : 'Open form'}
                </Link>
              </Cell>
            </Row>
          );
        })}
        {cancelled.map((request) => (
          <Row key={request.signupId}>
            <Cell className="font-bold">{request.observee.displayName}</Cell>
            <Cell>{request.section.label}</Cell>
            <Cell />
            <Cell><Tag tone="neutral">Cancelled: another colleague accepted first</Tag></Cell>
            <Cell />
          </Row>
        ))}
        {!assignments.isPending && allAssignments.length + cancelled.length === 0 && <EmptyRow>No confirmations yet this semester.</EmptyRow>}
      </Table>
      <InfoLine className="mt-[18px]">If you accept first, you are paired right away. If another colleague accepted first, the request shows as cancelled.</InfoLine>
    </div>
  );
}
