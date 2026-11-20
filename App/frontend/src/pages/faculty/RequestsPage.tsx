import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCandidates, useEvaluationStatus, useMyObservations, useMySignup, useOutgoingRequests, useSendRequests } from '../../api/hooks/faculty';
import { ApiError } from '../../api/client';
import { useNotifications } from '../../api/hooks/shared';
import type { Candidate, EvaluationStatus, ObservationRequest, ObservationSummary, RequestStatus, Signup } from '../../api/types';
import { usePageTitle } from '../../components/AppShell';
import { CheckIcon, ClockIcon, SendIcon } from '../../components/icons';
import {
  Banner,
  Button,
  Callout,
  Card,
  Cell,
  Checkbox,
  ErrorNote,
  InfoLine,
  Note,
  Row,
  Steps,
  Table,
  Tag,
  buttonClass,
  linkClass,
  type TagTone,
} from '../../components/ui';
import { hoursUntil } from '../../lib/dates';
import {
  classStart,
  countSummary,
  formatDateTime,
  formatDayYear,
  formatShort,
  formatSlot,
  formatTime,
  joinAnd,
  listSlots,
  meetingSummary,
  toggleIn,
  weekday,
} from '../../lib/format';

// E3 choose observers, E4 requests sent, E4b nobody accepted, E5 matched automatically.
// One route: the page shows whichever state the current sign-up is in.

const EXPIRY_NOTE = 'Requests expire 48 hours after they are sent.';

/** While answers or a new list can arrive from elsewhere, the page re-reads the sign-up, candidates and requests this often. */
export const POLL_MS = 30_000;
const POLL_NOTE = 'This page checks for updates every 30 seconds.';

/** Fixed-width table columns scroll sideways on a narrow screen instead of being cut off. */
const Scroll = ({ min, children }: { min: string; children: ReactNode }) => (
  <div className="max-w-full overflow-x-auto">
    <div className={min}>{children}</div>
  </div>
);

// ---------- E3 ----------

/** "Yes, Mon and Wed 8:30 AM" when the observer has no class at any of the proposed times. */
function FreeAt({ candidate, signup }: { candidate: Candidate; signup: Signup }) {
  if (candidate.freeAtProposedTimes === undefined) return null;
  if (!candidate.freeAtProposedTimes) return <span className="text-gray-500">No</span>;
  // Monday first, whatever order the dates were picked in.
  const byWeekday = [...signup.proposedDates].sort((a, b) => (new Date(`${a.date}T12:00:00Z`).getUTCDay() + 6) % 7 - (new Date(`${b.date}T12:00:00Z`).getUTCDay() + 6) % 7);
  const days = [...new Set(byWeekday.map((d) => weekday(d.date)))];
  const times = [...new Set(signup.proposedDates.map((d) => formatTime(d.startTime)))];
  return (
    <span className="flex items-center gap-[11px]">
      <CheckIcon width={10} height={8} className="text-green-800" />
      Yes, {joinAnd(days)} {times.join(', ')}
    </span>
  );
}

/** "CS 1336, 1000 level": the first course they taught at the sign-up's level (UTD numbers start with the level). */
function teachesLabel(candidate: Candidate, level: number) {
  const courses = candidate.teaches ?? [];
  const atLevel = courses.find((label) => Math.floor(Number(label.split(' ').at(-1)) / 1000) * 1000 === level);
  return atLevel ? `${atLevel}, ${level} level` : (courses[0] ?? '');
}

/** "Dr. A and Dr. B declined. Dr. C did not answer within 48 hours." for requests that ended without an observer. */
function endedText(requests: ObservationRequest[]) {
  const names = (status: RequestStatus) => requests.filter((r) => r.status === status).map((r) => r.observer.displayName);
  const declined = names('declined');
  const expired = names('expired');
  const cancelled = names('cancelled');
  return [
    declined.length ? `${joinAnd(declined)} declined.` : '',
    expired.length ? `${joinAnd(expired)} did not answer within 48 hours.` : '',
    cancelled.length ? `The system cancelled the request to ${joinAnd(cancelled)}.` : '',
  ].filter(Boolean).join(' ');
}

/**
 * The server refuses the whole send with NO_AVAILABLE_DATES when a selected observer teaches or has another
 * observation at every proposed time, and names them by NetID. Here they are named as on the list, with what to do.
 */
function sendError(error: Error | null, candidates: Candidate[]): Error | null {
  if (!(error instanceof ApiError) || error.code !== 'NO_AVAILABLE_DATES') return error;
  const ids = /observer\(s\): ([^.]+)\./.exec(error.message)?.[1].split(',').map((id) => id.trim()).filter(Boolean) ?? [];
  const names = ids.map((id) => candidates.find((c) => c.observer.netid === id)?.observer.displayName ?? id);
  if (!names.length) return error;
  return new Error(`Nothing was sent. ${joinAnd(names)} ${names.length === 1 ? 'teaches or observes' : 'teach or observe'} at every one of your proposed times. Unselect ${names.length === 1 ? 'them' : 'those observers'} and send again.`);
}

function ChooseObservers({ signup, candidates, signupDeadline, ended }: { signup: Signup; candidates: Candidate[]; signupDeadline: string; ended: ObservationRequest[] }) {
  const navigate = useNavigate();
  const notifications = useNotifications();
  const send = useSendRequests(signup.signupId);
  const open = candidates.filter((c) => !c.request);
  const openIds = open.map((c) => c.observer.netid);
  const [selected, setSelected] = useState<string[]>(openIds);
  // Only observers still on the current list can be sent; a refreshed list drops anyone who left it.
  const chosen = selected.filter((netid) => openIds.includes(netid));
  // Lists are sent after this cycle's sign-up deadline; older notifications belong to past cycles.
  const ready = notifications.data?.find((n) => n.notifType === 'matches_ready' && n.sentDate.slice(0, 10) > signupDeadline);
  const all = open.length > 0 && chosen.length === open.length;
  const toggle = (netid: string) => setSelected((s) => toggleIn(s, netid));
  // After a successful send the button stays off until the refreshed requests switch the page to "sent".
  const locked = send.isPending || send.isSuccess;
  // isPending reaches React a tick after mutate(), so a fast double-click would send twice without this.
  const sending = useRef(false);
  const submit = () => {
    // An empty or missing list means "every candidate" to the API, so never send one.
    if (!chosen.length || locked || sending.current) return;
    sending.current = true;
    send.mutate({ observerNetids: chosen }, { onError: () => { sending.current = false; } });
  };
  const cols = '56px 280px 300px 1fr';

  return (
    <div className="flex flex-col pt-8">
      {ended.length > 0 ? (
        <Callout tone="warning" title={`None of the ${ended.length === 1 ? 'request' : `${ended.length} requests`} you sent found an observer.`}>
          {endedText(ended)} You can send a request to the other observers on your list below.
        </Callout>
      ) : (
        ready && <Banner tone="info">Your observer list is ready (sent by the Assessment Committee, {formatShort(ready.sentDate)})</Banner>
      )}
      <div className="mt-5 flex items-baseline justify-between">
        <h2 className="text-base font-bold text-gray-900">Recommended observers</h2>
        <span className="text-sm font-bold text-gray-900">{chosen.length} of {open.length} selected</span>
      </div>
      <p className="mt-2 text-sm text-gray-500">
        Sign-up: {signup.section.label} {signup.section.title}, {meetingSummary(signup.section).split(',')[0]}. Same department, same course level.
      </p>
      <div className="mt-[13px]">
        <Scroll min="min-w-[760px]">
          <Table
            label="Recommended observers"
            columns={cols}
            head={[
              <Checkbox
                key="all"
                aria-label="Select all"
                checked={all}
                indeterminate={!all && chosen.length > 0}
                disabled={locked}
                onChange={() => setSelected(all ? [] : openIds)}
              />,
              'Name',
              'Teaches',
              'Free at all your times',
            ]}
          >
            {open.map((c) => (
              <Row key={c.observer.netid}>
                <Cell>
                  <Checkbox aria-label={c.observer.displayName} checked={chosen.includes(c.observer.netid)} disabled={locked} onChange={() => toggle(c.observer.netid)} />
                </Cell>
                <Cell className="font-bold">{c.observer.displayName}</Cell>
                <Cell>{teachesLabel(c, signup.section.courseLevel)}</Cell>
                <Cell><FreeAt candidate={c} signup={signup} /></Cell>
              </Row>
            ))}
          </Table>
        </Scroll>
      </div>

      <h2 className="mt-6 text-base font-bold text-gray-900">Days and times from your sign-up</h2>
      <div className="mt-[13px]">
        <div className="flex flex-wrap gap-2">
          {signup.proposedDates.map((d) => (
            <span key={d.date} className="inline-flex h-8 min-w-[200px] items-center rounded-md border border-gray-300 bg-gray-50 px-3.5 text-sm whitespace-nowrap text-gray-900">
              {formatSlot(d.date, d.startTime)}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-500">Set when you signed up. Observers choose one of these dates when confirming a request.</p>

      <ErrorNote error={sendError(send.error, candidates)} className="mt-4" />
      <div className="mt-[21px] flex flex-wrap items-center gap-3">
        <Button disabled={!chosen.length || locked} aria-busy={send.isPending} onClick={submit}>
          <SendIcon width={13} height={13} />{' '}
          {send.isPending ? `Sending ${chosen.length} ${chosen.length === 1 ? 'request' : 'requests'}…` : send.isSuccess ? 'Requests sent' : `Send request to ${chosen.length} selected`}
        </Button>
        <Button variant="secondary" disabled={send.isPending} onClick={() => navigate('/faculty/evaluation')}>Cancel</Button>
        <InfoLine icon={<ClockIcon />} className="sm:ml-3">{EXPIRY_NOTE}</InfoLine>
      </div>
      {!chosen.length && open.length > 0 && <p className="mt-3 text-xs text-gray-500">Select at least one observer to send a request.</p>}
      {send.isSuccess && <p role="status" className="mt-3 text-sm text-gray-700">Requests sent. Loading their status…</p>}
    </div>
  );
}

// ---------- Request tables (E4, E4b, E5) ----------

const STATUS_TAG: Record<RequestStatus, [TagTone, string]> = {
  pending: ['due', 'Waiting'],
  accepted: ['signed', 'Accepted first'],
  declined: ['neutral', 'Declined'],
  cancelled: ['neutral', 'Cancelled by the system'],
  expired: ['neutral', 'Expired'],
};

const statusTag = (r: ObservationRequest) => <Tag tone={STATUS_TAG[r.status][0]}>{STATUS_TAG[r.status][1]}</Tag>;

const ORDER: RequestStatus[] = ['accepted', 'pending', 'expired', 'cancelled', 'declined'];

/** "Expires in 31 hours" for a pending request, by the app clock. */
function expiresIn(r: ObservationRequest) {
  const hours = hoursUntil(r.expiresAt);
  return hours ? `Expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}` : 'Expiring now';
}

/** "My requests" with the counts, then one row per request, accepted first: the observer, then the cells `children` renders. */
function RequestTable({ requests, columns, min, head, children }: { requests: ObservationRequest[]; columns: string; min: string; head: string[]; children: (r: ObservationRequest) => ReactNode }) {
  const n = (s: RequestStatus) => requests.filter((r) => r.status === s).length;
  return (
    <>
      <div className="mt-6 mb-[13px] flex flex-wrap items-baseline justify-between gap-x-4 pr-[22px]">
        <h2 className="text-base font-bold text-gray-900">My requests</h2>
        <span className="text-sm text-gray-500">
          {countSummary([[n('accepted'), 'accepted'], [n('pending'), 'waiting'], [n('expired'), 'expired'], [n('cancelled'), 'cancelled'], [n('declined'), 'declined']])}
        </span>
      </div>
      <Scroll min={min}>
        <Table label="My requests" columns={columns} head={['Observer', ...head]}>
          {[...requests].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)).map((r) => (
            <Row key={r.observer.netid}>
              <Cell className="font-bold">{r.observer.displayName}</Cell>
              {children(r)}
            </Row>
          ))}
        </Table>
      </Scroll>
    </>
  );
}

/** Requests written together share one send time; allow a minute of slack for the rows of one send. */
const SAME_SEND_MS = 60_000;

function RequestsSent({ signup, requests, observations }: { signup: Signup; requests: ObservationRequest[]; observations: ObservationSummary[] | undefined }) {
  const sent = requests.reduce((latest, r) => (r.sentDate > latest ? r.sentDate : latest), requests[0].sentDate);
  const latestSend = requests.filter((r) => Date.parse(sent) - Date.parse(r.sentDate) < SAME_SEND_MS);
  /** The accepted observer's observation can be known before the sign-up shows it; the time is its date plus the class start. */
  const pickedTime = (r: ObservationRequest) => {
    if (r.status !== 'accepted') return '';
    const o = observations?.find((x) => x.observer.netid === r.observer.netid && x.section.sectionId === signup.section.sectionId);
    return o ? formatSlot(o.scheduledDate, classStart(signup.section, o.scheduledDate)) : '';
  };
  return (
    <div className="flex flex-col pt-8">
      <div className="flex gap-[13px] rounded-lg border border-gray-200 bg-gray-50 px-[22px] pt-[19px] pb-[18px]">
        <SendIcon width={13} height={13} className="mt-0.5 shrink-0 text-gray-700" />
        <div>
          <p className="text-sm font-bold text-gray-900">
            Request sent {formatDateTime(sent)} to {latestSend.length} {latestSend.length === 1 ? 'colleague' : 'colleagues'} for {signup.section.label}
          </p>
          <p className="mt-[5px] text-sm text-gray-500">Proposed times: {listSlots(signup.proposedDates)}</p>
        </div>
      </div>
      <RequestTable requests={requests} columns="280px 280px 220px 1fr" min="min-w-[900px]" head={['Time they picked', 'Status', 'Answered']}>
        {(r) => (
          <>
            <Cell className="text-gray-500">{r.status === 'pending' ? 'Not answered yet' : pickedTime(r)}</Cell>
            <Cell>{statusTag(r)}</Cell>
            <Cell className="text-gray-500">
              {r.status === 'pending' ? expiresIn(r) : r.respondedDate ? formatDateTime(r.respondedDate) : formatDateTime(r.expiresAt)}
            </Cell>
          </>
        )}
      </RequestTable>
      <InfoLine icon={<ClockIcon />} className="mt-[18px]">{EXPIRY_NOTE} {POLL_NOTE}</InfoLine>
      <Note className="mt-6" title="The first colleague to accept becomes your observer automatically.">
        The system then cancels your other requests. You do not need to choose anyone.
      </Note>
    </div>
  );
}

function NobodyAccepted({ signup, requests }: { signup: Signup; requests: ObservationRequest[] }) {
  const allExpired = requests.every((r) => r.status === 'expired');
  return (
    <div className="flex flex-col pt-8">
      <Callout tone="warning" title={allExpired ? 'Nobody accepted your requests within 48 hours.' : 'None of your requests were accepted.'}>
        Your sign-up for {signup.section.label} has no observer yet. A new observer list shows here when the Assessment Committee sends one.
      </Callout>
      <RequestTable requests={requests} columns="280px 240px 1fr" min="min-w-[720px]" head={['Status', 'When']}>
        {(r) => (
          <>
            <Cell>{statusTag(r)}</Cell>
            <Cell className="text-gray-700">
              {r.status === 'expired' ? `${formatDateTime(r.expiresAt)} (no answer in 48 hours)` : r.respondedDate ? formatDateTime(r.respondedDate) : ''}
            </Cell>
          </>
        )}
      </RequestTable>
      <InfoLine className="mt-[18px]">{POLL_NOTE}</InfoLine>
      <div className="mt-8">
        <Link to="/faculty/evaluation" className={buttonClass('secondary')}>Back to my evaluation</Link>
      </div>
    </div>
  );
}

function Matched({ signup, requests, observation }: { signup: Signup; requests: ObservationRequest[]; observation: ObservationSummary | undefined }) {
  const observer = signup.observation!.observer;
  const date = observation?.scheduledDate;
  const time = date ? classStart(signup.section, date) : '';
  const room = signup.section.meetings[0]?.room;
  // After a missed observation and a second pairing, the first observer's request is still "accepted";
  // only the current observer's one is the pairing, and the earlier one reads as did not happen.
  const accepted = requests.find((r) => r.status === 'accepted' && r.observer.netid === observer.netid);
  const earlier = (r: ObservationRequest) => r.status === 'accepted' && r.observer.netid !== observer.netid;
  // The record was reported as "could not be done": there is no form to sign, and the sign-up can be paired again.
  const missed = signup.observation!.status === 'not_completed' || observation?.status === 'not_completed';
  return (
    <div className="flex flex-col pt-8">
      {missed ? (
        <Callout tone="warning" title={`The observation with ${observer.displayName} did not happen.`}>
          It was reported as not done{date ? ` (planned for ${formatDayYear(date)})` : ''}. There is no form to sign. Your sign-up has no observer now, so it can be paired again: when the Assessment Committee adds an observer to your list, you can send a new request from this page.
        </Callout>
      ) : (
        <Callout tone="success" title={`${observer.displayName} accepted first and is your observer.`}>
          {date && `${formatDayYear(date)}, ${formatTime(time)}. `}
          {signup.section.label} {signup.section.title}
          {room ? `, ${room}.` : '.'}
        </Callout>
      )}
      <RequestTable requests={requests} columns="280px 240px 260px 1fr" min="min-w-[900px]" head={['Time they picked', 'Status', 'When']}>
        {(r) => (
          <>
            <Cell className="text-gray-700">{r === accepted && date ? formatSlot(date, time) : ''}</Cell>
            <Cell>{earlier(r) ? <Tag tone="neutral">Did not happen</Tag> : statusTag(r)}</Cell>
            <Cell className="text-gray-700">
              {r.respondedDate
                ? formatDateTime(r.respondedDate)
                : r.status === 'expired'
                  ? `${formatDateTime(r.expiresAt)} (no answer in 48 hours)`
                  : r.status === 'cancelled' && accepted?.respondedDate ? formatDateTime(accepted.respondedDate) : ''}
            </Cell>
          </>
        )}
      </RequestTable>
      {!missed && (
        <>
          <h2 className="mt-8 mb-[13px] text-sm font-bold text-gray-900">What happens next</h2>
          <Steps
            tone="brand"
            items={[
              `Dr. ${observer.lastName} can open the observation form${date ? ` for ${formatShort(date)}` : ''} from their confirmations.`,
              'The observation shows under My evaluation.',
              'After the class, you both sign the record.',
            ]}
          />
        </>
      )}
      <div className="mt-7">
        <Link to="/faculty/evaluation" className={buttonClass('primary')}>View my evaluation</Link>
      </div>
    </div>
  );
}

// ---------- Page ----------

type View = 'none' | 'waiting' | 'choose' | 'sent' | 'nobody' | 'matched' | 'missed';

/** States whose data can change from elsewhere (an answer, an expiry, a new list); the others stay put until the professor acts. */
const POLLED: View[] = ['waiting', 'sent', 'nobody', 'missed'];

export function RequestsPage() {
  const [live, setLive] = useState(false);
  const refresh = live ? { refetchInterval: POLL_MS, refetchOnWindowFocus: true } : {};
  const status = useEvaluationStatus();
  const signup = useMySignup(refresh);
  const candidates = useCandidates(signup.data?.signupId, refresh);
  const outgoing = useOutgoingRequests(refresh);
  const observations = useMyObservations();

  const s = signup.data;
  const requests = s ? (outgoing.data ?? []).filter((r) => r.signupId === s.signupId) : [];
  // After an observation is reported as not done the sign-up is unpaired again (the backend lets it be paired
  // a second time), so the missed observer's accepted request no longer counts as an answer.
  const missed = s?.observation?.status === 'not_completed';
  const missedAccept = missed ? requests.find((r) => r.status === 'accepted' && r.observer.netid === s!.observation!.observer.netid) : undefined;
  const current = missed ? requests.filter((r) => r !== missedAccept) : requests;
  // Requests sent after the missed observer had accepted: a second round, which can end with nobody accepting.
  const secondRound = missed ? current.filter((r) => !missedAccept?.respondedDate || r.sentDate > missedAccept.respondedDate) : current;
  const fresh = (candidates.data ?? []).some((c) => !c.request);
  // An accepted request counts as "sent" until the sign-up shows its observation, so the page never flashes "nobody accepted".
  const answered = current.some((r) => r.status === 'pending' || r.status === 'accepted');
  const view: View = !s ? 'none'
    : s.observation && !missed ? 'matched'
      : answered ? 'sent' : fresh ? 'choose' : secondRound.length ? 'nobody' : missed ? 'missed' : 'waiting';
  const poll = POLLED.includes(view);
  useEffect(() => setLive(poll), [poll]);
  usePageTitle(view === 'choose' ? 'Choose your observers' : view === 'matched' ? 'Your observer' : null);

  // A read that never loaded blocks the page; a failed refresh keeps the last data on screen with a note.
  const reads = [status, signup, candidates, outgoing];
  const failed = reads.filter((q) => q.error && q.data === undefined);
  if (failed.length) {
    return (
      <div className="flex flex-col items-start gap-4 pt-8">
        <ErrorNote error={failed[0].error} className="w-full" />
        <Button variant="secondary" onClick={() => failed.forEach((q) => void q.refetch())}>Try again</Button>
      </div>
    );
  }
  if (!status.data || signup.isPending || outgoing.isPending || (s && candidates.isPending)) {
    return <p role="status" className="pt-8 text-sm text-gray-500">Loading your requests…</p>;
  }
  const stale = reads.find((q) => q.error);
  return (
    <>
      {stale && (
        <div className="pt-8">
          <Banner tone="danger" action={<button type="button" className={linkClass} onClick={() => void stale.refetch()}>Try again</button>}>
            Could not refresh this page: {stale.error instanceof Error ? stale.error.message : 'Something went wrong.'}
          </Banner>
        </div>
      )}
      {renderView(view, s, status.data, candidates.data, view === 'missed' ? requests : view === 'nobody' ? secondRound : current, observations.data)}
    </>
  );
}

function renderView(
  view: View,
  s: Signup | null | undefined,
  status: EvaluationStatus,
  candidates: Candidate[] | undefined,
  requests: ObservationRequest[],
  observations: ObservationSummary[] | undefined,
) {
  if (!s) {
    return (
      <div className="flex flex-col items-start gap-4 pt-8 text-sm text-gray-500">
        <p>You have no sign-up this semester.</p>
        {status.canSignUp && <Link to="/faculty/sign-up" className={linkClass}>Sign up to be observed</Link>}
      </div>
    );
  }
  if (view === 'waiting') {
    const cycle = status.cycle;
    return (
      <div className="flex flex-col gap-4 pt-8">
        <p role="status" className="text-sm text-gray-500">
          {cycle?.phase === 'signup'
            ? `Observer lists are sent after the sign-up deadline (${formatShort(cycle.signupDeadline)}).`
            : 'There is no observer list for your sign-up yet.'}
        </p>
        <Card className="px-6 py-5">
          <p className="text-sm text-gray-900"><span className="font-bold">{s.section.label}</span> {s.section.title}</p>
          <p className="mt-1 text-sm text-gray-500">Proposed times: {listSlots(s.proposedDates)}</p>
        </Card>
        <InfoLine>{POLL_NOTE}</InfoLine>
      </div>
    );
  }
  if (view === 'choose') return <ChooseObservers signup={s} candidates={candidates!} signupDeadline={status.cycle?.signupDeadline ?? ''} ended={requests} />;
  if (view === 'sent') return <RequestsSent signup={s} requests={requests} observations={observations} />;
  if (view === 'nobody') return <NobodyAccepted signup={s} requests={requests} />;
  return <Matched signup={s} requests={requests} observation={observations?.find((o) => o.observationId === s.observation!.observationId)} />;
}
