import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useCycleSignups, useForwardObservation, useMatching, useOutstandingObservations, useUnmatchedFaculty } from '../../api/hooks/committee';
import { ScheduledObservationTag } from './DashboardSections';
import { useCurrentCycle } from '../../api/hooks/shared';
import type { AlertType, Signup } from '../../api/types';
import { CheckIcon, MailIcon, SendIcon } from '../../components/icons';
import { Button, Cell, buttonClass, EmptyRow, ErrorNote, LockNote, Modal, Pagination, Row, Table, Tabs, Tag, inputClass, labelClass, usePages } from '../../components/ui';
import { RANK_SHORT, formatDate, ranks } from '../../lib/format';
import { OUTSTANDING_TEXT } from '../../lib/statusTerms';

// A6 outstanding, A6a completed, A6b forward a signed record by email.
// The lists come from the current cycle's sign-ups with the dashboard's rule: a sign-up is outstanding until
// its observation is completed, and the observation is completed once the observee signs, so a completed row
// is signed by both people and locked.

type Tab = 'outstanding' | 'completed';

const PAGE_SIZE = 7;

const observedOn = (s: Signup) => (s.observation?.scheduledDate ? formatDate(s.observation.scheduledDate) : '');

function OutstandingStatus({ signup, reason }: { signup: Signup; reason: AlertType | undefined }) {
  const o = signup.observation;
  if (!o) {
    if (reason === 'no_observer') return <Tag wrap tone="overdue">No observer, see Sign-ups</Tag>;
    if (reason === 'no_acceptance') return <Tag wrap tone="overdue">Nobody accepted, see Sign-ups</Tag>;
    if (reason === 'insufficient_observers') return <Tag wrap tone="due">Too few observers, see Sign-ups</Tag>;
    return <Tag wrap tone="neutral">Not paired yet</Tag>;
  }
  if (o.status === 'not_completed') return <Tag wrap tone="neutral">Reported as not done</Tag>;
  // Read before the date too. The server refuses a form before its date, so this matters only when the
  // server's date and the campus date differ.
  return <ScheduledObservationTag observationId={o.observationId} scheduledDate={o.scheduledDate} scheduledTone="neutral" readEarly />;
}

function ViewRecordLink({ signup }: { signup: Signup }) {
  return (
    <Link
      to={`/committee/observations/${signup.observation!.observationId}`}
      className={buttonClass('secondary', '', 'sm')}
      aria-label={`View ${signup.observee.displayName}'s observation record`}
    >
      View record
    </Link>
  );
}

function ForwardModal({ signup, onClose, onSent }: { signup: Signup; onClose: () => void; onSent: (email: string) => void }) {
  const forward = useForwardObservation();
  const [email, setEmail] = useState('');
  const busy = useRef(false);
  const o = signup.observation!;
  // Closing while the send is in flight would lose its result, so ignore Escape and the backdrop until it ends.
  const close = useCallback(() => { if (!forward.isPending) onClose(); }, [forward.isPending, onClose]);
  // Email addresses allow 64 characters before the @ and 254 in all; the server does not check the length yet.
  const to = email.trim();
  const tooLong = to.length > 254 || to.split('@')[0].length > 64;
  const send = () => {
    if (!to || tooLong || busy.current) return;
    busy.current = true;
    forward.mutate(
      { observationId: o.observationId, email: to },
      { onSuccess: () => onSent(to), onSettled: () => { busy.current = false; } },
    );
  };
  return (
    <Modal
      title="Forward this observation"
      subtitle={
        <span className="text-sm">
          {signup.observee.displayName}, observed by {o.observer.displayName}
          {o.scheduledDate && `, ${formatDate(o.scheduledDate)}`}
        </span>
      }
      onClose={close}
      closeButton
      footer={
        <>
          <Button variant="secondary" disabled={forward.isPending} onClick={close}>Cancel</Button>
          <Button disabled={!to || tooLong || forward.isPending} onClick={send}>
            <SendIcon width={13} height={13} /> {forward.isPending ? 'Sending…' : 'Send'}
          </Button>
        </>
      }
    >
      <label htmlFor="forward-email" className={labelClass}>Email</label>
      <span className="relative block">
        <input id="forward-email" type="email" autoComplete="email" className={`${inputClass} w-full pr-10`} value={email} onChange={(e) => setEmail(e.target.value)} />
        <MailIcon className="pointer-events-none absolute top-[14px] right-3.5 text-gray-500" />
      </span>
      {tooLong && <p role="alert" className="mt-2 text-sm text-red-800">That address is too long: an email address has at most 64 characters before the @ and 254 in all.</p>}
      <ErrorNote error={forward.error} className="mt-3" />
      <LockNote className="mt-5 py-[11px]">The record is sent as text in an email. This forward is recorded.</LockNote>
    </Modal>
  );
}

export function ObservationsPage() {
  const cycle = useCurrentCycle();
  const c = cycle.data;
  const signups = useCycleSignups(c?.cycleId);
  const matching = useMatching(c?.cycleId);
  const unmatched = useUnmatchedFaculty();
  const outstanding = useOutstandingObservations();
  const [tab, setTab] = useState<Tab>('outstanding');
  const [forwarding, setForwarding] = useState<Signup | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const closeForward = useCallback(() => setForwarding(null), []);

  const all = signups.data ?? [];
  const outstandingRows = all.filter((s) => s.observation?.status !== 'completed');
  const completedRows = all
    .filter((s) => s.observation?.status === 'completed')
    .sort((a, b) => (a.observation!.scheduledDate ?? '').localeCompare(b.observation!.scheduledDate ?? ''));
  // Dashboard > Unmatched works out the reason when it is read (it also counts requests that expired with nobody
  // accepting), so its reason wins over the alert on the matching row, the same way Sign-ups shows it.
  const reasons = new Map<string, AlertType>([
    ...(matching.data ?? []).flatMap((m) => (m.alert ? [[m.signupId, m.alert.alertType] as const] : [])),
    ...(unmatched.data?.items ?? []).map((i) => [i.signupId, i.alertType] as const),
  ]);
  const outPager = usePages(outstandingRows, PAGE_SIZE);
  const donePager = usePages(completedRows, PAGE_SIZE);

  const error = cycle.error ?? signups.error;
  if (error && !signups.data) {
    const retrying = cycle.isFetching || signups.isFetching;
    return (
      <div className="pt-8">
        <ErrorNote error={error} />
        <Button variant="secondary" className="mt-3" disabled={retrying} onClick={() => { void cycle.refetch(); void signups.refetch(); }}>{retrying ? 'Trying again…' : 'Try again'}</Button>
      </div>
    );
  }
  if (c === null) return <p className="pt-8 text-sm text-gray-500">No evaluation cycle has started yet.</p>;
  if (!c || !signups.data) return <p role="status" className="pt-8 text-sm text-gray-500">Loading observations…</p>;

  const byRank = outstanding.data?.byRank;
  return (
    <div className="flex flex-col pt-6">
      <div className="pt-4">
        <Tabs
          label="Observations"
          value={tab}
          onChange={(next) => { setSentTo(null); setTab(next); }}
          tabs={[
            { id: 'outstanding', label: `Outstanding (${outstandingRows.length})` },
            { id: 'completed', label: `Completed (${completedRows.length})` },
          ]}
        />
      </div>

      <div role="tabpanel" aria-label={tab === 'outstanding' ? 'Outstanding observations' : 'Completed observations'} className="mt-6">
        {tab === 'outstanding' ? (
          <>
            <p className="mb-3 text-sm text-gray-500">{OUTSTANDING_TEXT}</p>
            <div className="overflow-x-auto">
              <div className="min-w-[860px]">
                <Table label="Outstanding observations" columns="minmax(130px,1.4fr) 76px minmax(130px,1.4fr) minmax(96px,1fr) minmax(96px,1fr) minmax(170px,1.6fr) 130px" head={['Observee', 'Rank', 'Observer', 'Course', 'Date', 'Status', '']}>
                  {outPager.rows.map((s) => (
                    <Row key={s.signupId}>
                      <Cell className="font-bold">{s.observee.displayName}</Cell>
                      <Cell className="text-gray-700">{RANK_SHORT[s.observee.rank]}</Cell>
                      <Cell className={s.observation ? 'text-gray-700' : 'text-gray-500'}>{s.observation?.observer.displayName ?? 'None yet'}</Cell>
                      <Cell className="text-gray-700">{s.section.label}</Cell>
                      <Cell className="text-gray-700">{observedOn(s)}</Cell>
                      <Cell><OutstandingStatus signup={s} reason={reasons.get(s.signupId)} /></Cell>
                      <Cell className="flex justify-end pr-0">{s.observation && <ViewRecordLink signup={s} />}</Cell>
                    </Row>
                  ))}
                  {outstandingRows.length === 0 && <EmptyRow>{all.length === 0 ? 'No one has signed up yet this cycle.' : 'Nothing outstanding.'}</EmptyRow>}
                </Table>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              {byRank ? <p className="text-sm text-gray-500">By hire level: {ranks(byRank)}</p> : <span />}
              {outPager.pages > 1 && <Pagination pager={outPager} label="Outstanding pages" />}
            </div>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-gray-500">Observations signed by both people. These records are locked.</p>
            {sentTo && (
              <p role="status" className="mb-3 flex items-center gap-2 text-sm text-gray-700">
                <CheckIcon width={10} height={8} className="text-green-800" /> Sent to {sentTo}. The forward is recorded.
              </p>
            )}
            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                <Table label="Completed observations" columns="170px 170px 130px 120px 170px 1fr" head={['Observee', 'Observer', 'Course', 'Date', 'Status', '']}>
                  {donePager.rows.map((s) => (
                    <Row key={s.signupId}>
                      <Cell className="font-bold">{s.observee.displayName}</Cell>
                      <Cell>{s.observation!.observer.displayName}</Cell>
                      <Cell>{s.section.label}</Cell>
                      <Cell>{observedOn(s)}</Cell>
                      <Cell><Tag tone="signed">Signed and locked</Tag></Cell>
                      <Cell className="flex justify-end gap-2 pr-0">
                        <ViewRecordLink signup={s} />
                        <Button variant="secondary" size="sm" aria-label={`Forward ${s.observee.displayName}'s observation`} onClick={() => { setSentTo(null); setForwarding(s); }}>
                          <SendIcon /> Forward
                        </Button>
                      </Cell>
                    </Row>
                  ))}
                  {completedRows.length === 0 && <EmptyRow>No signed observations yet.</EmptyRow>}
                </Table>
              </div>
            </div>
            {donePager.pages > 1 && <div className="mt-[11px]"><Pagination pager={donePager} label="Completed pages" /></div>}
          </>
        )}
      </div>

      {forwarding && (
        <ForwardModal
          signup={forwarding}
          onClose={closeForward}
          onSent={(email) => {
            setSentTo(email);
            setForwarding(null);
          }}
        />
      )}
    </div>
  );
}
