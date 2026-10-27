import { useState } from 'react';
import { Link } from 'react-router';
import { useConfirmRequest, useDeclineRequest, useIncomingRequests, useMyAssignments } from '../../api/hooks/faculty';
import { useCurrentCycle, useMe } from '../../api/hooks/shared';
import type { ObservationRequest } from '../../api/types';
import { ClockIcon } from '../../components/icons';
import { Button, Card, Cell, EmptyRow, ErrorNote, InfoLine, Note, PageError, Radio, Row, StatCard, Table, Tag, buttonClass, linkClass } from '../../components/ui';
import { hoursUntil, todayIso } from '../../lib/dates';
import { RANK_LABEL, classStart, formatDayYear, formatSlot, isLocked } from '../../lib/format';

// R1 incoming requests and R2 confirmations. Every professor can be asked to observe,
// so these live on the Faculty pages for everyone.

const LIMIT = 3;

/** "Mon Oct 12, 8:30 AM", or just the date when the class has no start time that day. */
const slot = (date: string, startTime: string) => (startTime ? formatSlot(date, startTime) : formatDayYear(date));

/** "Expires in 31 hours", as on My requests. */
function expiresIn(r: ObservationRequest) {
  const hours = hoursUntil(r.expiresAt);
  return hours ? `Expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}` : 'Expiring now';
}

/** Observations I accepted in the current cycle (the limit is 3 a semester). */
function useThisSemester() {
  const cycle = useCurrentCycle();
  const assignments = useMyAssignments();
  const termId = cycle.data?.term.termId;
  return { cycle, assignments, accepted: (assignments.data ?? []).filter((a) => a.term.termId === termId) };
}

function RequestCard({ r, department, full, refresh }: { r: ObservationRequest; department: string; full: boolean; refresh: () => void }) {
  const [date, setDate] = useState<string | null>(null);
  const confirm = useConfirmRequest();
  const decline = useDeclineRequest();
  const busy = confirm.isPending || decline.isPending;
  const ids = { signupId: r.signupId, observerNetId: r.observer.netid };
  // A refusal (someone else accepted first, the limit was reached, the request expired) may mean the list is out of date.
  const reload = { onError: refresh };
  const today = todayIso();
  return (
    <Card className="px-6 pt-5 pb-5">
      <div className="grid grid-cols-[312px_1fr_auto] gap-x-6">
        <div>
          <h3 className="text-base font-bold text-gray-900">{r.observee.displayName}</h3>
          <p className="mt-[7px] text-xs text-gray-500">{RANK_LABEL[r.observee.rank]}, {department}</p>
          <p className="mt-[17px] text-sm text-gray-900">{r.section.label} {r.section.title}</p>
        </div>
        <fieldset className="pt-1">
          <legend className="text-xs text-gray-500">Proposed times, pick the one you can attend</legend>
          <div className="mt-3 flex flex-col gap-[15px]">
            {r.proposedDates.map((d) => (
              <label key={d.date} className={`flex items-center gap-2.5 text-sm ${d.date < today ? 'text-gray-400' : 'cursor-pointer text-gray-900'} ${date === d.date ? 'font-bold' : ''}`}>
                <Radio name={`slot-${r.signupId}`} checked={date === d.date} disabled={d.date < today} onChange={() => setDate(d.date)} />
                {slot(d.date, d.startTime)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col items-end justify-between">
          <Tag tone="due" icon={<ClockIcon width={11} height={11} />}>{expiresIn(r)}</Tag>
          <div className="flex gap-3">
            <Button className="w-[88px]" disabled={!date || busy || full} onClick={() => date && confirm.mutate({ ...ids, date }, reload)}>Accept</Button>
            <Button className="w-[88px]" variant="secondary" disabled={busy} onClick={() => decline.mutate(ids, reload)}>Decline</Button>
          </div>
        </div>
      </div>
      <ErrorNote error={confirm.error ?? decline.error} className="mt-4" />
    </Card>
  );
}

export function ObserveRequestsPage() {
  const me = useMe();
  const incoming = useIncomingRequests();
  const { cycle, assignments, accepted } = useThisSemester();
  const pending = (incoming.data ?? []).filter((r) => r.status === 'pending');
  const n = accepted.length;

  if (incoming.error) return <PageError error={incoming.error} />;
  if (incoming.isPending) return <p role="status" className="pt-8 text-sm text-gray-500">Loading requests…</p>;
  return (
    <div className="flex flex-col pt-8">
      <ErrorNote error={assignments.error ?? cycle.error} className="mb-4" />
      <Card className="flex items-center justify-between px-6 pt-5 pb-[19px]">
        <div>
          <p className="text-base font-bold text-gray-900">You have accepted {n} of {LIMIT} observations this semester</p>
          <div className="mt-[13px] flex items-center gap-3">
            <div className="h-2 w-80 overflow-hidden rounded-full bg-gray-200" role="progressbar" aria-valuemin={0} aria-valuemax={LIMIT} aria-valuenow={n} aria-label="Observations accepted">
              <div className="h-full rounded-full bg-brand" style={{ width: `${(Math.min(n, LIMIT) / LIMIT) * 100}%` }} />
            </div>
            <span className="text-xs text-gray-500">{Math.max(0, LIMIT - n)} left</span>
          </div>
        </div>
        <Link to="/faculty/observe/confirmations" className={linkClass}>See my confirmations</Link>
      </Card>

      <h2 className="mt-6 mb-[13px] text-base font-bold text-gray-900">New requests ({pending.length})</h2>
      <div className="flex flex-col gap-4">
        {pending.map((r) => (
          <RequestCard key={r.signupId} r={r} department={me.data?.department.deptName ?? ''} full={n >= LIMIT} refresh={() => void incoming.refetch()} />
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
  const incoming = useIncomingRequests();
  const { cycle, assignments, accepted } = useThisSemester();
  const cancelled = (incoming.data ?? []).filter((r) => r.status === 'cancelled');
  const error = incoming.error ?? assignments.error ?? cycle.error;

  if (error) return <PageError error={error} />;
  if (incoming.isPending || assignments.isPending || cycle.isPending) return <p role="status" className="pt-8 text-sm text-gray-500">Loading confirmations…</p>;
  return (
    <div className="flex flex-col pt-8">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Accepted this semester" value={`${accepted.length} of ${LIMIT}`} />
        <StatCard label="You are the observer" value={accepted.length} />
        <StatCard label="Cancelled" value={cancelled.length} />
      </div>

      <h2 className="mt-6 mb-[13px] text-base font-bold text-gray-900">My confirmations</h2>
      <Table label="My confirmations" columns="190px 140px 200px 1fr 112px" head={['Observee', 'Course', 'Date and time', 'Status', '']}>
        {accepted.map((o) => {
          const closed = isLocked(o) || o.status === 'not_completed';
          return (
            <Row key={o.observationId}>
              <Cell className="font-bold">{o.observee.displayName}</Cell>
              <Cell>{o.section.label}</Cell>
              <Cell>{slot(o.scheduledDate, classStart(o.section, o.scheduledDate))}</Cell>
              <Cell><Tag tone="signed">You are the observer</Tag></Cell>
              <Cell className="pr-0">
                <Link to={`/faculty/observe/${o.observationId}${closed ? '' : '/form'}`} className={buttonClass('secondary', 'w-28', 'sm')}>{closed ? 'View' : 'Open form'}</Link>
              </Cell>
            </Row>
          );
        })}
        {cancelled.map((r) => (
          <Row key={r.signupId}>
            <Cell className="font-bold">{r.observee.displayName}</Cell>
            <Cell>{r.section.label}</Cell>
            <Cell />
            <Cell><Tag tone="neutral">Cancelled</Tag></Cell>
            <Cell />
          </Row>
        ))}
        {accepted.length + cancelled.length === 0 && <EmptyRow>No confirmations yet this semester.</EmptyRow>}
      </Table>
      <InfoLine className="mt-[18px]">If you accept first, you are paired right away. A request shows as cancelled if another colleague accepted first, or once you have accepted 3.</InfoLine>
    </div>
  );
}
