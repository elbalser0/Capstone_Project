import { useState } from 'react';
import { useCycleFaculty, useDueProfessors } from '../../api/hooks/committee';
import { useCurrentCycle } from '../../api/hooks/shared';
import type { DueStatus, Rank } from '../../api/types';
import { DownloadIcon, SearchIcon } from '../../components/icons';
import { Banner, Button, Cell, Chip, DUE_TAG, DueTag, EmptyRow, ErrorNote, Pagination, Row, Table, inputClass, usePages } from '../../components/ui';
import { downloadCsv } from '../../lib/csv';
import { RANK_SHORT, toggleIn } from '../../lib/format';
import { isMissingEndpoint } from '../../lib/missingEndpoint';
import { DUE_OR_OVERDUE_TEXT } from '../../lib/statusTerms';

// A3. Every professor's status this cycle, with filters, search and CSV export. The full list
// (GET /api/cycles/{cycleId}/faculty) is not in the backend yet; until it is, the page shows the
// due-professors list, which has no email, no due semester and no NOT DUE rows.

const PAGE_SIZE = 7;
const ALL: DueStatus[] = ['DUE', 'OVERDUE', 'NOT_DUE'];
const DUE_ONLY: DueStatus[] = ['DUE', 'OVERDUE'];
const FALLBACK_BANNER = 'The full faculty list is not available yet, so only due and overdue professors are shown.';

/** One table row from either list. email and dueSemester are null in the due-professors fallback. */
interface FacultyRow {
  netid: string;
  name: string;
  email: string | null;
  rank: Rank;
  department: string;
  lastObserved: string;
  dueSemester: string | null;
  status: DueStatus;
}

function exportCsv(rows: FacultyRow[], full: boolean, termLabel: string) {
  const lines = [full
    ? ['name', 'email', 'rank', 'department', 'last_observed', 'due_semester', 'status']
    : ['name', 'rank', 'department', 'last_observed', 'status']];
  for (const r of rows) {
    const status = DUE_TAG[r.status][1];
    lines.push(full
      ? [r.name, r.email ?? '', RANK_SHORT[r.rank], r.department, r.lastObserved, r.dueSemester ?? '', status]
      : [r.name, RANK_SHORT[r.rank], r.department, r.lastObserved, status]);
  }
  downloadCsv('faculty', termLabel, lines);
}

function Retry({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="pt-8">
      <ErrorNote error={error} />
      <Button type="button" variant="secondary" className="mt-3" onClick={retry}>Try again</Button>
    </div>
  );
}

function FacultyList({ cycleId, termLabel }: { cycleId: string; termLabel: string }) {
  const faculty = useCycleFaculty(cycleId);
  const missing = isMissingEndpoint(faculty.error);
  // Requested only once the full list is known to be missing.
  const fallback = useDueProfessors(missing ? cycleId : undefined);
  const [shown, setShown] = useState<DueStatus[]>(DUE_ONLY);
  const [query, setQuery] = useState('');

  const full = Boolean(faculty.data);
  const statuses = full ? ALL : DUE_ONLY;
  const all: FacultyRow[] = faculty.data
    ? faculty.data.map((r) => ({
      netid: r.professor.netid, name: r.professor.displayName, email: r.professor.email, rank: r.professor.rank,
      department: r.department.deptName, lastObserved: r.lastObservedTerm?.label ?? 'Never', dueSemester: r.dueTerm.label, status: r.dueStatus,
    }))
    : (fallback.data ?? []).map((r) => ({
      netid: r.professor.netid, name: r.professor.displayName, email: null, rank: r.professor.rank,
      department: r.department.deptName, lastObserved: r.lastObservedTerm?.label ?? 'Never', dueSemester: null, status: r.dueStatus,
    }));
  const visible = shown.filter((s) => statuses.includes(s));
  const q = query.trim().toLowerCase();
  const rows = all.filter((r) => visible.includes(r.status) && (!q || r.name.toLowerCase().includes(q)));
  const pager = usePages(rows, PAGE_SIZE);

  const error = missing ? fallback.error : faculty.error;
  const retry = missing ? fallback.refetch : faculty.refetch;
  if (error) return <Retry error={error} retry={() => void retry()} />;
  const loading = missing ? fallback.isPending : faculty.isPending;

  const filter = (next: DueStatus[]) => {
    setShown(next);
    pager.setPage(1);
  };
  const toggleStatus = (s: DueStatus) => {
    if (visible.length === statuses.length) return filter([s]);
    const next = toggleIn(visible, s);
    filter(next.length ? next : statuses);
  };

  return (
    <div className="flex flex-col pt-8">
      <p className="text-sm text-gray-500">{DUE_OR_OVERDUE_TEXT}</p>
      {missing && <div className="mt-4"><Banner tone="info">{FALLBACK_BANNER}</Banner></div>}

      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          <Chip selected={visible.length === statuses.length} onClick={() => filter(statuses)}>All ({all.length})</Chip>
          {statuses.map((s) => (
            <Chip key={s} selected={visible.includes(s) && visible.length < statuses.length} onClick={() => toggleStatus(s)}>
              {DUE_TAG[s][1]} ({all.filter((r) => r.status === s).length})
            </Chip>
          ))}
        </div>
        <span className="relative w-full md:w-[280px]">
          <input
            type="search"
            aria-label="Search by name"
            placeholder="Search by name"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              pager.setPage(1);
            }}
            className={`${inputClass} w-full pr-10`}
          />
          <SearchIcon className="pointer-events-none absolute top-[13px] right-3.5 text-gray-500" />
        </span>
      </div>

      <div className="mt-6 overflow-x-auto">
        <div className={full ? 'min-w-[840px]' : 'min-w-[720px]'}>
          <Table
            label="Faculty"
            columns={full ? '220px 120px 200px 140px 140px 1fr' : '240px 120px 220px 140px 1fr'}
            head={[
              'Name',
              'Rank',
              'Department',
              'Last observed',
              ...(full ? ['Due semester'] : []),
              'Status',
            ]}
          >
            {pager.rows.map((r) => (
              <Row key={r.netid}>
                <Cell className="font-bold">{r.name}</Cell>
                <Cell>{RANK_SHORT[r.rank]}</Cell>
                <Cell>{r.department}</Cell>
                <Cell>{r.lastObserved}</Cell>
                {full && <Cell>{r.dueSemester}</Cell>}
                <Cell><DueTag status={r.status} /></Cell>
              </Row>
            ))}
            {loading && <p role="status" className="px-4 py-4 text-sm text-gray-500">Loading faculty…</p>}
            {!loading && rows.length === 0 && <EmptyRow>{all.length === 0 ? 'No faculty to show for this cycle.' : 'Nobody matches.'}</EmptyRow>}
          </Table>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <Pagination pager={pager} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" disabled={!rows.length} onClick={() => exportCsv(rows, full, termLabel)}>
            <DownloadIcon /> Export
          </Button>
        </div>
      </div>
    </div>
  );
}

export function FacultyPage() {
  const cycle = useCurrentCycle();
  if (cycle.error) return <Retry error={cycle.error} retry={() => void cycle.refetch()} />;
  if (cycle.isPending) return <p role="status" className="pt-8 text-sm text-gray-500">Loading the current cycle…</p>;
  if (!cycle.data) return <p className="pt-8 text-sm text-gray-500">No evaluation cycle has started yet.</p>;
  return <FacultyList key={cycle.data.cycleId} cycleId={cycle.data.cycleId} termLabel={cycle.data.term.label} />;
}
