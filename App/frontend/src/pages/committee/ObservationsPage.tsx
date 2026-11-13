import { useCallback, useRef, useState } from 'react';
import { useCycleSignups, useForwardObservation, useMatching, useOutstandingObservations } from '../../api/hooks/committee';
import { useObservation } from '../../api/hooks/faculty';
import { useCurrentCycle } from '../../api/hooks/shared';
import type { MatchingRow, Signup } from '../../api/types';
import { CheckIcon, LinkIcon, MailIcon, SendIcon } from '../../components/icons';
import { Button, Cell, EmptyRow, ErrorNote, LockNote, Modal, Pagination, Row, Table, Tabs, Tag, inputClass, labelClass, usePages } from '../../components/ui';
import { RANK_SHORT, formatDate, ranks } from '../../lib/format';
import { isMissingEndpoint } from '../../lib/missingEndpoint';
import { OUTSTANDING_TEXT } from '../../lib/statusTerms';

// A6 outstanding, A6a completed, A6b forward a link to a signed record.
// The lists come from the current cycle's sign-ups with the dashboard's rule: a sign-up is outstanding until
// its observation is completed, and the observation is completed once the observee signs, so a completed row
// is signed by both people and locked. Forwarding a link (POST /api/observations/{id}/forward) is not in the
// backend yet; until it is, the forward dialog says so.

type Tab = 'outstanding' | 'completed';

const PAGE_SIZE = 7;
const FORWARD_MISSING = 'Forwarding a link is not available yet. Nothing was sent.';

const observedOn = (s: Signup) => (s.observation?.scheduledDate ? formatDate(s.observation.scheduledDate) : '');

/**
 * A scheduled row reads its own record, because the sign-up list has no signature dates: the observer has
 * submitted and signed once observerSignedDate is set. While the record loads, or if it cannot be read, the
 * row simply says Scheduled.
 */
function ScheduledStatus({ observationId }: { observationId: string }) {
  const record = useObservation(observationId);
  const waiting = Boolean(record.data?.observerSignedDate && !record.data.observeeSignedDate);
  return waiting ? <Tag tone="due">Waiting for the observee to sign</Tag> : <Tag tone="neutral">Scheduled</Tag>;
}

function OutstandingStatus({ signup, alert }: { signup: Signup; alert: MatchingRow['alert'] | undefined }) {
  const o = signup.observation;
  if (!o) {
    if (alert?.alertType === 'no_observer') return <Tag tone="overdue">No observer, see Sign-ups</Tag>;
    if (alert?.alertType === 'no_acceptance') return <Tag tone="overdue">Nobody accepted, see Sign-ups</Tag>;
    return <Tag tone="neutral">Not paired yet</Tag>;
  }
  if (o.status === 'not_completed') return <Tag tone="neutral">Reported as not done</Tag>;
  return <ScheduledStatus observationId={o.observationId} />;
}

function ForwardModal({ signup, onClose, onSent }: { signup: Signup; onClose: () => void; onSent: (email: string) => void }) {
  const forward = useForwardObservation();
  const [email, setEmail] = useState('');
  const busy = useRef(false);
  const o = signup.observation!;
  const missing = isMissingEndpoint(forward.error);
  // Closing while the send is in flight would lose its result, so ignore Escape and the backdrop until it ends.
  const close = useCallback(() => { if (!forward.isPending) onClose(); }, [forward.isPending, onClose]);
  const send = () => {
    const to = email.trim();
    if (!to || busy.current) return;
    busy.current = true;
    forward.mutate(
      { observationId: o.observationId, email: to },
      { onSuccess: () => onSent(to), onSettled: () => { busy.current = false; } },
    );
  };
  return (
    <Modal
      title="Forward a link to this observation"
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
          <Button disabled={!email.trim() || forward.isPending} onClick={send}>
            <SendIcon width={13} height={13} /> {forward.isPending ? 'Sending…' : 'Send link'}
          </Button>
        </>
      }
    >
      <label htmlFor="forward-email" className={labelClass}>Email</label>
      <span className="relative block">
        <input id="forward-email" type="email" autoComplete="email" className={`${inputClass} w-full pr-10`} value={email} onChange={(e) => setEmail(e.target.value)} />
        <MailIcon className="pointer-events-none absolute top-[14px] right-3.5 text-gray-500" />
      </span>
      {missing ? <p role="status" className="mt-3 text-sm text-gray-700">{FORWARD_MISSING}</p> : <ErrorNote error={forward.error} className="mt-3" />}
      <LockNote className="mt-5 py-[11px]">The link opens a read-only view. This forward is recorded.</LockNote>
    </Modal>
  );
}

export function ObservationsPage() {
  const cycle = useCurrentCycle();
  const c = cycle.data;
  const signups = useCycleSignups(c?.cycleId);
  const matching = useMatching(c?.cycleId);
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
  const alerts = new Map(matching.data?.map((m) => [m.signupId, m.alert]));
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
              <div className="min-w-[760px]">
                <Table label="Outstanding observations" columns="170px 100px 170px 130px 120px 1fr" head={['Observee', 'Rank', 'Observer', 'Course', 'Date', 'Status']}>
                  {outPager.rows.map((s) => (
                    <Row key={s.signupId}>
                      <Cell className="font-bold">{s.observee.displayName}</Cell>
                      <Cell className="text-gray-700">{RANK_SHORT[s.observee.rank]}</Cell>
                      <Cell className={s.observation ? 'text-gray-700' : 'text-gray-500'}>{s.observation?.observer.displayName ?? 'None yet'}</Cell>
                      <Cell className="text-gray-700">{s.section.label}</Cell>
                      <Cell className="text-gray-700">{observedOn(s)}</Cell>
                      <Cell><OutstandingStatus signup={s} alert={alerts.get(s.signupId)} /></Cell>
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
                <CheckIcon width={10} height={8} className="text-green-800" /> Link sent to {sentTo}. The forward is recorded.
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
                      <Cell className="flex justify-end pr-0">
                        <Button variant="secondary" size="sm" aria-label={`Forward a link to ${s.observee.displayName}'s observation`} onClick={() => { setSentTo(null); setForwarding(s); }}>
                          <LinkIcon /> Forward a link
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
