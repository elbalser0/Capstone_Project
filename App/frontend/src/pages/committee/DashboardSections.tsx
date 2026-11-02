import { useId, type ReactNode } from 'react';

import { ApiError } from '../../api/client';
import { useCycleSignups, useDueProfessors, useUnmatchedFaculty } from '../../api/hooks/committee';
import { useCurrentCycle } from '../../api/hooks/shared';
import type { AlertType, CourseSection, DueProfessor, ObservationStatus, Signup, UnmatchedFaculty } from '../../api/types';
import { AlertIcon } from '../../components/icons';
import { Cell, DueTag, EmptyRow, ErrorNote, Pagination, Row, Table, Tag, usePages, type TagTone } from '../../components/ui';
import { RANK_SHORT, dayLetters, formatDate, formatTime } from '../../lib/format';

// A1 detail lists under the executive summary, in the table style of A3, A4 and A6.
// Each list has its own request, so one failing or loading does not hold back the others.

const PAGE_SIZE = 5;

/** The dashboard endpoints answer 404 NO_CYCLE before the first cycle starts. */
export const isNoCycle = (error: unknown) => error instanceof ApiError && error.code === 'NO_CYCLE';

interface ListProps<T> {
  title: string;
  /** Each column has a minimum width that fits its longest tag or word. */
  columns: string;
  /** The columns' minimums plus the row padding; below it the table scrolls sideways. */
  minWidth: string;
  head: string[];
  /** undefined until the list has loaded */
  rows: T[] | undefined;
  error: unknown;
  noCycle: boolean;
  loading: string;
  empty: string;
  rowKey: (row: T) => string;
  cells: (row: T) => ReactNode;
}

function DetailList<T>({ title, columns, minWidth, head, rows, error, noCycle, loading, empty, rowKey, cells }: ListProps<T>) {
  const headingId = useId();
  const pager = usePages(rows ?? [], PAGE_SIZE);

  let message: ReactNode = null;
  // No cycle comes first: before one starts, the unmatched endpoint answers with a NO_CYCLE error.
  if (noCycle) message = <EmptyRow>No evaluation cycle has started yet.</EmptyRow>;
  else if (error) message = <div className="p-4"><ErrorNote error={error} /></div>;
  else if (!rows) message = <p role="status" className="px-4 py-4 text-sm text-gray-500">{loading}</p>;
  else if (!rows.length) message = <EmptyRow>{empty}</EmptyRow>;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mt-[30px] mb-3 text-base font-bold text-gray-900">
        {title}{rows && !message ? ` (${rows.length})` : ''}
      </h2>
      {/* Scrolls sideways on a narrow screen instead of overlapping; focusable so the keyboard can scroll it too. */}
      <div role="group" aria-labelledby={headingId} tabIndex={0} className="max-w-full overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-brand">
        <div className={minWidth}>
          <Table label={title} columns={columns} head={head}>
            {/* A message stays inside a row and cell so the table's structure is still valid. */}
            {message ? <div role="row"><div role="cell">{message}</div></div> : pager.rows.map((row) => <Row key={rowKey(row)}>{cells(row)}</Row>)}
          </Table>
        </div>
      </div>
      {!message && pager.pages > 1 && <div className="mt-3"><Pagination pager={pager} /></div>}
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
      columns="minmax(130px,2fr) minmax(80px,1fr) minmax(120px,2fr) minmax(110px,1.3fr) minmax(96px,1fr)"
      minWidth="min-w-[568px]"
      head={['Name', 'Rank', 'Department', 'Last observed', 'Status']}
      rows={rows}
      error={cycle.error ?? due.error}
      noCycle={cycle.isSuccess && !cycle.data}
      loading="Loading faculty…"
      empty="Nobody is due or overdue this cycle."
      rowKey={(r) => r.professor.netid}
      cells={(r) => (
        <>
          <Cell className="font-bold">{r.professor.displayName}</Cell>
          <Cell>{RANK_SHORT[r.professor.rank]}</Cell>
          <Cell>{r.department.deptName}</Cell>
          <Cell>{r.lastObservedTerm?.label ?? 'Not observed yet'}</Cell>
          <Cell><DueTag status={r.dueStatus} /></Cell>
        </>
      )}
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
      columns="minmax(130px,2fr) minmax(80px,1fr) minmax(100px,1.3fr) minmax(100px,1.3fr) minmax(168px,1.6fr)"
      minWidth="min-w-[610px]"
      head={['Observee', 'Rank', 'Course', 'Days and time', 'Reason']}
      rows={unmatched.data?.items}
      error={unmatched.error}
      noCycle={isNoCycle(unmatched.error)}
      loading="Loading unmatched faculty…"
      empty="Every sign-up has an observer or is still being matched."
      rowKey={(r) => r.signupId}
      cells={(r) => {
        const [tone, label] = ALERT_TAG[r.alertType];
        return (
          <>
            <Cell className="font-bold">{r.observee.displayName}</Cell>
            <Cell>{RANK_SHORT[r.observee.rank]}</Cell>
            <Cell>{r.section.label}</Cell>
            <Cell>{classTime(r.section)}</Cell>
            <Cell><Tag tone={tone} icon={<AlertIcon width={11} height={10} />}>{label}</Tag></Cell>
          </>
        );
      }}
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
      columns="minmax(125px,2fr) minmax(80px,1fr) minmax(120px,2fr) minmax(95px,1.3fr) minmax(95px,1.3fr) minmax(168px,1.8fr)"
      minWidth="min-w-[715px]"
      head={['Observee', 'Rank', 'Observer', 'Course', 'Date', 'Status']}
      rows={rows}
      error={cycle.error ?? signups.error}
      noCycle={cycle.isSuccess && !cycle.data}
      loading="Loading observations…"
      empty="Every sign-up has a completed observation."
      rowKey={(s) => s.signupId}
      cells={(s) => {
        const [tone, label] = OBSERVATION_TAG[s.observation?.status ?? 'none'];
        return (
          <>
            <Cell className="font-bold">{s.observee.displayName}</Cell>
            <Cell>{RANK_SHORT[s.observee.rank]}</Cell>
            <Cell className={s.observation ? '' : 'text-gray-500'}>{s.observation?.observer.displayName ?? 'None yet'}</Cell>
            <Cell>{s.section.label}</Cell>
            <Cell>{s.observation?.scheduledDate ? formatDate(s.observation.scheduledDate) : ''}</Cell>
            <Cell><Tag tone={tone}>{label}</Tag></Cell>
          </>
        );
      }}
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
