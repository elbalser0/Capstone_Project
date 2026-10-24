import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCandidates, useEvaluationStatus, useMyObservations, useMySignup, useOutgoingRequests, useSendRequests } from '../../api/hooks/faculty';
import { useNotifications } from '../../api/hooks/shared';
import type { Candidate, ObservationRequest, ObservationSummary, RequestStatus, Signup } from '../../api/types';
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
  PageError,
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

// ---------- E3 ----------

/** "Yes, Mon and Wed 8:30 AM" when the observer has no class at any of the proposed times. */
function FreeAt({ candidate, signup }: { candidate: Candidate; signup: Signup }) {
  if (candidate.freeAtProposedTimes === undefined) return null;
  if (!candidate.freeAtProposedTimes) return <span className="text-gray-500">No</span>;
  const days = [...new Set(signup.proposedDates.map((d) => weekday(d.date)))];
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
  const atLevel = courses.find((label) => Math.floor(Number(label.split(' ')[1]) / 1000) * 1000 === level);
  return atLevel ? `${atLevel}, ${level} level` : (courses[0] ?? '');
}

function ChooseObservers({ signup, candidates, signupDeadline }: { signup: Signup; candidates: Candidate[]; signupDeadline: string }) {
  const navigate = useNavigate();
  const notifications = useNotifications();
  const send = useSendRequests(signup.signupId);
  const open = candidates.filter((c) => !c.request || c.request.status === 'expired');
  const [selected, setSelected] = useState<string[]>(() => open.map((c) => c.observer.netid));
  // Lists are sent after this cycle's sign-up deadline; older notifications belong to past cycles.
  const ready = notifications.data?.find((n) => n.notifType === 'matches_ready' && n.sentDate.slice(0, 10) > signupDeadline);
  const all = selected.length === open.length;
  const toggle = (netid: string) => setSelected((s) => toggleIn(s, netid));
  const cols = '56px 280px 300px 1fr';

  return (
    <div className="flex flex-col pt-8">
      {ready && <Banner tone="info">Your observer list is ready (sent by the Assessment Committee, {formatShort(ready.sentDate)})</Banner>}
      <div className="mt-5 flex items-baseline justify-between">
        <h2 className="text-base font-bold text-gray-900">Recommended observers</h2>
        <span className="text-sm font-bold text-gray-900">{selected.length} of {open.length} selected</span>
      </div>
      <p className="mt-2 text-sm text-gray-500">
        Sign-up: {signup.section.label} {signup.section.title}, {meetingSummary(signup.section).split(',')[0]}. Same department, same course level.
      </p>
      <div className="mt-[13px]">
        <Table
          label="Recommended observers"
          columns={cols}
          head={[
            <Checkbox
              key="all"
              aria-label="Select all"
              checked={all && open.length > 0}
              indeterminate={!all && selected.length > 0}
              onChange={() => setSelected(all ? [] : open.map((c) => c.observer.netid))}
            />,
            'Name',
            'Teaches',
            'Free at your times',
          ]}
        >
          {open.map((c) => (
            <Row key={c.observer.netid}>
              <Cell>
                <Checkbox aria-label={c.observer.displayName} checked={selected.includes(c.observer.netid)} onChange={() => toggle(c.observer.netid)} />
              </Cell>
              <Cell className="font-bold">{c.observer.displayName}</Cell>
              <Cell>{teachesLabel(c, signup.section.courseLevel)}</Cell>
              <Cell><FreeAt candidate={c} signup={signup} /></Cell>
            </Row>
          ))}
        </Table>
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
      <p className="mt-3 text-xs text-gray-500">Set when you signed up. Every observer above is free at these times.</p>

      <ErrorNote error={send.error} className="mt-4" />
      <div className="mt-[21px] flex items-center gap-3">
        <Button disabled={!selected.length || send.isPending} onClick={() => send.mutate({ observerNetids: selected })}>
          <SendIcon width={13} height={13} /> Send request to {selected.length} selected
        </Button>
        <Button variant="secondary" onClick={() => navigate('/faculty/evaluation')}>Cancel</Button>
        <InfoLine icon={<ClockIcon />} className="ml-3">{EXPIRY_NOTE}</InfoLine>
      </div>
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

/** "My requests" with the counts, then one row per request, accepted first: the observer, then the cells `children` renders. */
function RequestTable({ requests, columns, head, children }: { requests: ObservationRequest[]; columns: string; head: string[]; children: (r: ObservationRequest) => ReactNode }) {
  const n = (s: RequestStatus) => requests.filter((r) => r.status === s).length;
  return (
    <>
      <div className="mt-6 mb-[13px] flex items-baseline justify-between pr-[22px]">
        <h2 className="text-base font-bold text-gray-900">My requests</h2>
        <span className="text-sm text-gray-500">
          {countSummary([[n('accepted'), 'accepted'], [n('pending'), 'waiting'], [n('expired'), 'expired'], [n('cancelled'), 'cancelled'], [n('declined'), 'declined']])}
        </span>
      </div>
      <Table label="My requests" columns={columns} head={['Observer', ...head]}>
        {[...requests].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)).map((r) => (
          <Row key={r.observer.netid}>
            <Cell className="font-bold">{r.observer.displayName}</Cell>
            {children(r)}
          </Row>
        ))}
      </Table>
    </>
  );
}

function RequestsSent({ signup, requests }: { signup: Signup; requests: ObservationRequest[] }) {
  const sent = requests.reduce((latest, r) => (r.sentDate > latest ? r.sentDate : latest), requests[0].sentDate);
  return (
    <div className="flex flex-col pt-8">
      <div className="flex gap-[13px] rounded-lg border border-gray-200 bg-gray-50 px-[22px] pt-[19px] pb-[18px]">
        <SendIcon width={13} height={13} className="mt-0.5 text-gray-700" />
        <div>
          <p className="text-sm font-bold text-gray-900">
            Request sent {formatDateTime(sent)} to {requests.length} {requests.length === 1 ? 'colleague' : 'colleagues'} for {signup.section.label}
          </p>
          <p className="mt-[5px] text-sm text-gray-500">Proposed times: {listSlots(signup.proposedDates)}</p>
        </div>
      </div>
      <RequestTable requests={requests} columns="280px 280px 220px 1fr" head={['Time they picked', 'Status', 'Answered']}>
        {(r) => (
          <>
            <Cell className="text-gray-500">{r.status === 'pending' ? 'Not answered yet' : ''}</Cell>
            <Cell>{statusTag(r)}</Cell>
            <Cell className="text-gray-500">
              {r.status === 'pending' ? `Expires in ${hoursUntil(r.expiresAt)} hours` : r.respondedDate ? formatDateTime(r.respondedDate) : formatDateTime(r.expiresAt)}
            </Cell>
          </>
        )}
      </RequestTable>
      <InfoLine icon={<ClockIcon />} className="mt-[18px]">{EXPIRY_NOTE}</InfoLine>
      <Note className="mt-6" title="The first colleague to accept becomes your observer automatically.">
        The system then cancels your other requests and lets those colleagues know. You do not need to choose anyone.
      </Note>
    </div>
  );
}

function NobodyAccepted({ signup, requests }: { signup: Signup; requests: ObservationRequest[] }) {
  const lastExpiry = requests.reduce((latest, r) => (r.expiresAt > latest ? r.expiresAt : latest), requests[0].expiresAt);
  return (
    <div className="flex flex-col pt-8">
      <Callout tone="warning" title="Nobody accepted your requests within 48 hours.">
        Your sign-up for {signup.section.label} went back to matching. You will get a new list of observers.
      </Callout>
      <RequestTable requests={requests} columns="280px 240px 1fr" head={['Status', 'When']}>
        {(r) => (
          <>
            <Cell>{statusTag(r)}</Cell>
            <Cell className="text-gray-700">
              {r.status === 'expired' ? `${formatDateTime(r.expiresAt)} (no answer in 48 hours)` : r.respondedDate ? formatDateTime(r.respondedDate) : ''}
            </Cell>
          </>
        )}
      </RequestTable>
      <div className="mt-8 grid grid-cols-[600px_1fr] gap-8">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-5 pt-4 pb-5">
          <p className="text-xs font-bold text-gray-500">In-app notification, {formatDateTime(lastExpiry)}</p>
          <p className="mt-[9px] text-sm leading-5 text-gray-900">
            Nobody accepted your observation requests for {signup.section.label}. Your sign-up went back to matching, and the Assessment Committee has been told.
          </p>
        </div>
        <div>
          <h2 className="mb-[13px] text-sm font-bold text-gray-900">What happens next</h2>
          <Steps
            tone="brand"
            items={['The committee sees your sign-up again in Sign-ups.', 'You get a message when your new list is ready.', 'You pick observers and send requests again.']}
          />
        </div>
      </div>
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
  const accepted = requests.find((r) => r.status === 'accepted');
  return (
    <div className="flex flex-col pt-8">
      <Callout tone="success" title={`${observer.displayName} accepted first and is your observer.`}>
        {date && `${formatDayYear(date)}, ${formatTime(time)}. `}
        {signup.section.label} {signup.section.title}
        {room ? `, ${room}.` : '.'}
      </Callout>
      <RequestTable requests={requests} columns="280px 240px 260px 1fr" head={['Time', 'Status', 'When']}>
        {(r) => (
          <>
            <Cell className="text-gray-700">{r.status === 'accepted' && date ? formatSlot(date, time) : ''}</Cell>
            <Cell>{statusTag(r)}</Cell>
            <Cell className="text-gray-700">
              {r.respondedDate ? formatDateTime(r.respondedDate) : r.status === 'cancelled' && accepted?.respondedDate ? formatDateTime(accepted.respondedDate) : ''}
            </Cell>
          </>
        )}
      </RequestTable>
      <h2 className="mt-8 mb-[13px] text-sm font-bold text-gray-900">What happens next</h2>
      <Steps
        tone="brand"
        items={[
          `Dr. ${observer.lastName} gets the observation form${date ? ` for ${formatShort(date)}` : ''}.`,
          'The observation shows under My evaluation.',
          'After the class, you both sign the record.',
        ]}
      />
      <div className="mt-7">
        <Link to="/faculty/evaluation" className={buttonClass('primary')}>View my evaluation</Link>
      </div>
    </div>
  );
}

// ---------- Page ----------

export function RequestsPage() {
  const status = useEvaluationStatus();
  const signup = useMySignup();
  const candidates = useCandidates(signup.data?.signupId);
  const outgoing = useOutgoingRequests();
  const observations = useMyObservations();

  const s = signup.data;
  const requests = s ? (outgoing.data ?? []).filter((r) => r.signupId === s.signupId) : [];
  const fresh = (candidates.data ?? []).some((c) => !c.request);
  const view = !s
    ? 'none'
    : s.observation
      ? 'matched'
      : requests.some((r) => r.status === 'pending')
        ? 'sent'
        : fresh
          ? 'choose'
          : requests.length
            ? 'nobody'
            : 'waiting';
  usePageTitle(view === 'choose' ? 'Choose your observers' : view === 'matched' ? 'Your observer' : null);

  const error = status.error ?? signup.error ?? candidates.error ?? outgoing.error;
  if (error) return <PageError error={error} />;
  if (!status.data || signup.isLoading || outgoing.isLoading || (s && candidates.isLoading)) return null;

  if (!s) {
    return (
      <div className="flex flex-col items-start gap-4 pt-8 text-sm text-gray-500">
        <p>You have no sign-up this semester.</p>
        {status.data.canSignUp && <Link to="/faculty/sign-up" className={linkClass}>Sign up to be observed</Link>}
      </div>
    );
  }
  if (view === 'waiting') {
    const cycle = status.data.cycle;
    return (
      <div className="flex flex-col gap-4 pt-8">
        <p className="text-sm text-gray-500">
          {cycle ? `Your observer list comes after the Assessment Committee runs observer selection (sign-up deadline ${formatShort(cycle.signupDeadline)}).` : 'Your observer list is not ready yet.'}
        </p>
        <Card className="px-6 py-5">
          <p className="text-sm text-gray-900"><span className="font-bold">{s.section.label}</span> {s.section.title}</p>
          <p className="mt-1 text-sm text-gray-500">Proposed times: {listSlots(s.proposedDates)}</p>
        </Card>
      </div>
    );
  }
  if (view === 'choose') return <ChooseObservers signup={s} candidates={candidates.data!} signupDeadline={status.data.cycle?.signupDeadline ?? ''} />;
  if (view === 'sent') return <RequestsSent signup={s} requests={requests} />;
  if (view === 'nobody') return <NobodyAccepted signup={s} requests={requests} />;
  return <Matched signup={s} requests={requests} observation={observations.data?.find((o) => o.observationId === s.observation!.observationId)} />;
}
