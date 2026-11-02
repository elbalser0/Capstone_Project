import { Fragment, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';

import { ApiError } from '../../api/client';
import { useCycleSignups, useDueProfessors, useUnmatchedFaculty } from '../../api/hooks/committee';
import { useCurrentCycle } from '../../api/hooks/shared';
import type { AlertType, CourseSection, DueProfessor, ObservationStatus, Signup, UnmatchedFaculty } from '../../api/types';
import { AlertIcon } from '../../components/icons';
import { Banner, Button, Cell, DueTag, EmptyRow, ErrorNote, Pagination, Row, Table, Tag, linkClass, usePages, type TagTone } from '../../components/ui';
import { RANK_SHORT, dayLetters, formatDate, formatTime } from '../../lib/format';

// A1 detail lists under the executive summary, in the table style of A3, A4 and A6.
// Each list has its own request, so one failing or loading does not hold back the others.
// Status is the last column, as on A3, A4 and A6; while a table is too wide to show at once it moves
// next to the name, so it stays in view.

// Seven rows a page, as in the A3 and A4 tables.
const PAGE_SIZE = 7;

/** The dashboard endpoints answer 404 NO_CYCLE before the first cycle starts. */
export const isNoCycle = (error: unknown) => error instanceof ApiError && error.code === 'NO_CYCLE';

export const NO_CYCLE_TEXT = 'No evaluation cycle has started yet.';

export const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

/** The parts of a request that Try again needs. */
export interface Retryable {
  error: unknown;
  errorUpdatedAt: number;
  isFetching: boolean;
  refetch: () => unknown;
}

/** Changes on every new failure, so a repeated error is shown (and announced) again. */
export const failureKey = (queries: Retryable[]) => queries.map((q) => q.errorUpdatedAt).join('-');

/**
 * Asks again for whichever of the requests failed and says "Trying again…" while it waits.
 * Focus moves to `focus` (the block's heading) first, because the button itself is replaced
 * by the result, so keyboard users are not dropped to the top of the page.
 */
export function TryAgain({ queries, focus, look = 'link' }: { queries: Retryable[]; focus: RefObject<HTMLElement | null>; look?: 'button' | 'link' }) {
  const busy = queries.some((q) => q.error && q.isFetching);
  const retry = () => {
    if (busy) return;
    focus.current?.focus();
    queries.forEach((q) => { if (q.error) void q.refetch(); });
  };
  const label = busy ? 'Trying again…' : 'Try again';
  return look === 'button'
    ? <Button type="button" variant="secondary" size="sm" aria-disabled={busy || undefined} onClick={retry}>{label}</Button>
    : <button type="button" className={linkClass} aria-disabled={busy || undefined} onClick={retry}>{label}</button>;
}

/** A heading that Try again can move focus to. */
export const headingFocus = 'rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

/**
 * Whether a table scrolls sideways, and whether columns are still hidden to its right. It is a tab
 * stop only while it scrolls, and the edge fades while more columns are out of view.
 */
function useSideScroll() {
  // A callback ref, because the scroller is only there while rows are (a message replaces it).
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [state, setState] = useState({ scrolls: false, more: false });
  useEffect(() => {
    if (!el) {
      setState((s) => (s.scrolls || s.more ? { scrolls: false, more: false } : s));
      return;
    }
    const measure = () => {
      const scrolls = el.scrollWidth > el.clientWidth + 1;
      const more = scrolls && el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setState((s) => (s.scrolls === scrolls && s.more === more ? s : { scrolls, more }));
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [el]);
  return [setEl, state] as const;
}

/** One column of a list: its heading, its grid track (with a minimum that fits its longest tag or word), and its cell. */
interface Column<T> {
  head: string;
  width: string;
  cell: (row: T) => ReactNode;
}

interface ListProps<T> {
  title: string;
  /** In Figma order, status last. */
  columns: Column<T>[];
  /** The columns' minimums plus the row padding; below it the table scrolls sideways. */
  minWidth: string;
  /** undefined until the list has loaded */
  rows: T[] | undefined;
  /** The list's own failure. The cycle read counts only while there is no cycle to ask about, so its failed refresh does not mark the list. */
  error: unknown;
  /** The requests behind the list, for Try again. */
  requests: Retryable[];
  /** No cycle has started, by the cycle check or by the list's own endpoint. */
  noCycle?: boolean;
  loading: string;
  empty: string;
  rowKey: (row: T) => string;
}

function DetailList<T>({ title, columns, minWidth, rows, error, requests, noCycle = false, loading, empty, rowKey }: ListProps<T>) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [scroller, side] = useSideScroll();
  const pager = usePages(rows ?? [], PAGE_SIZE);
  // Figma order while the table fits; while it scrolls, the status column moves next to the name.
  const shown = side.scrolls ? [columns[0], columns[columns.length - 1], ...columns.slice(1, -1)] : columns;

  let message: ReactNode = null;
  // No cycle comes first: before one starts, the unmatched endpoint answers with a NO_CYCLE error.
  if (noCycle) message = <EmptyRow>{NO_CYCLE_TEXT}</EmptyRow>;
  else if (error && !rows) {
    message = (
      <div key={failureKey(requests)} className="flex flex-col items-start gap-3 p-4">
        <ErrorNote error={new Error(`Couldn't load this list: ${errorText(error)}`)} className="w-full" />
        <TryAgain queries={requests} focus={heading} look="button" />
      </div>
    );
  } else if (!rows) message = <p role="status" className="px-4 py-4 text-sm text-gray-500">{loading}</p>;
  else if (!rows.length) message = <EmptyRow>{empty}</EmptyRow>;
  // A failed refresh keeps the last rows on screen with a note, as on the requests page.
  const stale = !noCycle && Boolean(error) && rows !== undefined;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1} className={`mt-[30px] mb-3 w-fit text-base font-bold text-gray-900 ${headingFocus}`}>
        {title}{rows && !message ? ` (${rows.length})` : ''}
      </h2>
      {stale && (
        <div key={failureKey(requests)} className="mb-3">
          <Banner tone="danger" action={<TryAgain queries={requests} focus={heading} />}>Couldn't refresh this list: {errorText(error)}</Banner>
        </div>
      )}
      {message ? (
        // A message sits in a plain box the width of the section, so it wraps instead of scrolling with the table.
        <div className="rounded-lg border border-gray-200 bg-white">{message}</div>
      ) : (
        // Scrolls sideways on a narrow screen instead of overlapping; focusable while it scrolls so the keyboard can scroll it too.
        <div className="relative">
          <div
            ref={scroller}
            role="group"
            aria-labelledby={headingId}
            tabIndex={side.scrolls ? 0 : undefined}
            className="max-w-full overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-brand"
          >
            <div className={`${minWidth} break-words`}>
              <Table label={title} columns={shown.map((c) => c.width).join(' ')} head={shown.map((c) => c.head)}>
                {pager.rows.map((row) => <Row key={rowKey(row)}>{shown.map((c) => <Fragment key={c.head}>{c.cell(row)}</Fragment>)}</Row>)}
              </Table>
            </div>
          </div>
          {side.more && <div aria-hidden="true" className="pointer-events-none absolute inset-y-px right-px w-10 rounded-r-lg bg-linear-to-l from-white" />}
        </div>
      )}
      {!message && pager.pages > 1 && <div className="mt-3"><Pagination pager={pager} label={`${title} pages`} /></div>}
    </section>
  );
}

/** "MW 8:30 AM", as in the A4 sign-ups table. */
function classTime(section: CourseSection) {
  const first = section.meetings[0];
  if (!first) return section.classMode === 'online' ? 'Online' : '';
  return `${dayLetters(section.meetings)} ${formatTime(first.startTime)}`;
}

const STATUS_ORDER = { OVERDUE: 0, DUE: 1 };

function DueFaculty() {
  const cycle = useCurrentCycle();
  const due = useDueProfessors(cycle.data?.cycleId);
  // Overdue first, as on A3; otherwise the API's order (rank, then name).
  const rows = due.data && [...due.data].sort((a, b) => STATUS_ORDER[a.dueStatus] - STATUS_ORDER[b.dueStatus]);
  return (
    <DetailList<DueProfessor>
      title="Due or overdue for evaluation"
      columns={[
        { head: 'Name', width: 'minmax(130px,2fr)', cell: (r) => <Cell className="font-bold">{r.professor.displayName}</Cell> },
        { head: 'Rank', width: 'minmax(80px,1fr)', cell: (r) => <Cell>{RANK_SHORT[r.professor.rank]}</Cell> },
        { head: 'Department', width: 'minmax(120px,2fr)', cell: (r) => <Cell>{r.department.deptName}</Cell> },
        { head: 'Last observed', width: 'minmax(110px,1.3fr)', cell: (r) => <Cell>{r.lastObservedTerm?.label ?? 'Not observed yet'}</Cell> },
        { head: 'Status', width: 'minmax(96px,1fr)', cell: (r) => <Cell><DueTag status={r.dueStatus} /></Cell> },
      ]}
      minWidth="min-w-[568px]"
      rows={rows}
      error={due.data || cycle.data !== undefined ? due.error : cycle.error ?? due.error}
      requests={[cycle, due]}
      noCycle={cycle.data === null}
      loading="Loading faculty…"
      empty="Nobody is due or overdue this cycle."
      rowKey={(r) => r.professor.netid}
    />
  );
}

// As on A4: red when no one can observe, yellow when some observers were found but fewer than needed.
const ALERT_TAG: Record<AlertType, [TagTone, string]> = {
  no_observer: ['overdue', 'No observer found'],
  insufficient_observers: ['due', 'Too few observers'],
  no_acceptance: ['overdue', 'No one accepted'],
};

function Unmatched() {
  const unmatched = useUnmatchedFaculty();
  return (
    <DetailList<UnmatchedFaculty['items'][number]>
      title="Unmatched faculty"
      columns={[
        { head: 'Observee', width: 'minmax(130px,2fr)', cell: (r) => <Cell className="font-bold">{r.observee.displayName}</Cell> },
        { head: 'Rank', width: 'minmax(80px,1fr)', cell: (r) => <Cell>{RANK_SHORT[r.observee.rank]}</Cell> },
        { head: 'Course', width: 'minmax(100px,1.3fr)', cell: (r) => <Cell>{r.section.label}</Cell> },
        { head: 'Days and time', width: 'minmax(100px,1.3fr)', cell: (r) => <Cell>{classTime(r.section)}</Cell> },
        { head: 'Reason', width: 'minmax(168px,1.6fr)', cell: (r) => <Cell><Tag tone={ALERT_TAG[r.alertType][0]} icon={<AlertIcon width={11} height={10} />}>{ALERT_TAG[r.alertType][1]}</Tag></Cell> },
      ]}
      minWidth="min-w-[610px]"
      rows={unmatched.data?.items}
      error={unmatched.error}
      requests={[unmatched]}
      noCycle={isNoCycle(unmatched.error)}
      loading="Loading unmatched faculty…"
      empty="No unmatched faculty."
      rowKey={(r) => r.signupId}
    />
  );
}

const OBSERVATION_TAG: Record<ObservationStatus | 'none', [TagTone, string]> = {
  none: ['overdue', 'No observer yet'],
  scheduled: ['due', 'Scheduled'],
  not_completed: ['neutral', 'Reported as not done'],
  completed: ['signed', 'Completed'],
};

function Outstanding() {
  const cycle = useCurrentCycle();
  const signups = useCycleSignups(cycle.data?.cycleId);
  // Same rule as the outstanding-observations count: no observation yet, or one that is not
  // completed. An observation is completed once the observee signs.
  const rows = signups.data?.filter((s) => s.observation?.status !== 'completed');
  return (
    <DetailList<Signup>
      title="Outstanding observations"
      columns={[
        { head: 'Observee', width: 'minmax(120px,2fr)', cell: (s) => <Cell className="font-bold">{s.observee.displayName}</Cell> },
        { head: 'Rank', width: 'minmax(80px,1fr)', cell: (s) => <Cell>{RANK_SHORT[s.observee.rank]}</Cell> },
        { head: 'Observer', width: 'minmax(115px,2fr)', cell: (s) => <Cell className={s.observation ? '' : 'text-gray-500'}>{s.observation?.observer.displayName ?? 'None yet'}</Cell> },
        { head: 'Course', width: 'minmax(110px,1.3fr)', cell: (s) => <Cell>{s.section.label}</Cell> },
        { head: 'Date', width: 'minmax(105px,1.3fr)', cell: (s) => <Cell className="whitespace-nowrap">{s.observation?.scheduledDate ? formatDate(s.observation.scheduledDate) : ''}</Cell> },
        { head: 'Status', width: 'minmax(168px,1.8fr)', cell: (s) => <Cell><Tag tone={OBSERVATION_TAG[s.observation?.status ?? 'none'][0]}>{OBSERVATION_TAG[s.observation?.status ?? 'none'][1]}</Tag></Cell> },
      ]}
      minWidth="min-w-[730px]"
      rows={rows}
      error={signups.data || cycle.data !== undefined ? signups.error : cycle.error ?? signups.error}
      requests={[cycle, signups]}
      noCycle={cycle.data === null}
      loading="Loading observations…"
      empty={signups.data?.length ? 'Every sign-up has a completed observation.' : 'No one has signed up yet this cycle.'}
      rowKey={(s) => s.signupId}
    />
  );
}

export function DashboardSections() {
  return (
    <>
      <DueFaculty />
      <Unmatched />
      <Outstanding />
    </>
  );
}
