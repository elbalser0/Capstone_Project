import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { useCycleFaculty, useDueProfessors, useSendDueReminders } from '../../api/hooks/committee';
import { sharedKeys, useCurrentCycle } from '../../api/hooks/shared';
import type { DueStatus, Rank } from '../../api/types';
import { DownloadIcon, MailIcon, SearchIcon } from '../../components/icons';
import { Banner, Button, Cell, Checkbox, Chip, DUE_TAG, DueTag, EmptyRow, ErrorNote, Modal, Pagination, Row, Table, inputClass, usePages } from '../../components/ui';
import { downloadCsv } from '../../lib/csv';
import { RANK_SHORT, formatClock, toggleIn } from '../../lib/format';
import { isMissingEndpoint } from '../../lib/missingEndpoint';
import { DUE_OR_OVERDUE_TEXT } from '../../lib/statusTerms';
import { errorText } from './DashboardSections';

// A3. Every professor's status this cycle, with filters, search, CSV export and reminders to the
// selected due or overdue professors. The full list (GET /api/cycles/{cycleId}/faculty) is not in
// the backend yet; until it is, the page shows the due-professors list, which has no email, no due
// semester and no NOT DUE rows.

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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The result line for a reminder send, given how many were selected and the server's { sent }. */
function sentText(sent: number, selected: number) {
  const email = 'Reminder emails go out only when the server has email turned on; delivery is not confirmed here.';
  if (sent === 0) return 'No reminders sent: none of the selected professors is still without a sign-up this cycle.';
  if (sent < selected) {
    return `Sent ${sent} of ${plural(selected, 'reminder', 'reminders')}. The others were skipped, for example because they have already signed up for this cycle. ${email}`;
  }
  return `Sent ${plural(sent, 'in-app reminder', 'in-app reminders')}. ${email}`;
}

/** Same rules as the dashboard sends: a known API error did not send; anything else may have. */
function failure(error: unknown): { known: boolean; text: string } {
  if (error instanceof ApiError && error.status === 403) return { known: true, text: 'Not sent: only Assessment Committee members can send notifications.' };
  if (error instanceof ApiError && error.status === 404) return { known: true, text: 'Not sent: this cycle was not found. Reload the page and try again.' };
  if (error instanceof ApiError && error.code !== 'HTTP_ERROR') return { known: true, text: `Not sent: ${error.message} Nothing was retried automatically.` };
  return {
    known: false,
    text: `The result is unknown: ${errorText(error)} It may have been sent. Check with a recipient before sending again; nothing was retried automatically.`,
  };
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
  const qc = useQueryClient();
  const faculty = useCycleFaculty(cycleId);
  const missing = isMissingEndpoint(faculty.error);
  // Requested only once the full list is known to be missing.
  const fallback = useDueProfessors(missing ? cycleId : undefined);
  const remind = useSendDueReminders(cycleId);
  const sending = useRef(false);
  const [shown, setShown] = useState<DueStatus[]>(DUE_ONLY);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [sentTo, setSentTo] = useState(0);

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
  const remindable = rows.filter((r) => r.status !== 'NOT_DUE').map((r) => r.netid);
  const picked = selected.filter((n) => remindable.includes(n));
  const allPicked = remindable.length > 0 && picked.length === remindable.length;

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

  const pending = remind.isPending;
  const failed = remind.isError ? failure(remind.error) : null;
  const send = () => {
    if (sending.current || picked.length === 0) return;
    sending.current = true;
    setConfirming(false);
    setSentTo(picked.length);
    remind.mutate({ netids: picked }, {
      onSettled: () => { sending.current = false; },
      onSuccess: () => {
        setSelected([]);
        // The sender may be one of the recipients, so their own inbox is refreshed.
        void qc.invalidateQueries({ queryKey: sharedKeys.notifications });
      },
    });
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
        <div className={full ? 'min-w-[880px]' : 'min-w-[740px]'}>
          <Table
            label="Faculty"
            columns={full ? '56px 200px 120px 200px 140px 140px 1fr' : '56px 220px 120px 220px 140px 1fr'}
            head={[
              <Checkbox
                key="all"
                aria-label="Select everyone due"
                checked={allPicked}
                indeterminate={!allPicked && picked.length > 0}
                disabled={remindable.length === 0}
                onChange={() => setSelected(allPicked ? [] : remindable)}
              />,
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
                <Cell>
                  <Checkbox
                    aria-label={`Select ${r.name}`}
                    checked={picked.includes(r.netid)}
                    disabled={r.status === 'NOT_DUE'}
                    onChange={() => setSelected((x) => toggleIn(x, r.netid))}
                  />
                </Cell>
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
          <Button
            type="button"
            disabled={!picked.length && !pending}
            aria-disabled={pending || undefined}
            onClick={() => { if (!pending && !sending.current && picked.length) setConfirming(true); }}
          >
            <MailIcon /> {pending ? 'Sending…' : `${failed?.known ? 'Try again: send' : 'Send'} reminder to selected (${picked.length})`}
          </Button>
        </div>
      </div>
      <p role="status" className="mt-3 text-[13px] text-gray-900 empty:hidden">
        {pending ? 'Sending…' : remind.isSuccess ? `${sentText(remind.data.sent, sentTo)} (${formatClock(remind.submittedAt)})` : ''}
      </p>
      {failed && !pending && <ErrorNote key={remind.submittedAt} error={new Error(failed.text)} className="mt-3" />}

      {confirming && (
        <Modal
          title="Send reminder to selected?"
          onClose={() => setConfirming(false)}
          footer={(
            <>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button type="button" onClick={send}>Send {plural(picked.length, 'reminder', 'reminders')}</Button>
            </>
          )}
        >
          <div className="text-sm text-gray-700">
            <p>This sends an in-app reminder to the <strong>{plural(picked.length, 'selected professor', 'selected professors')}</strong>. Anyone who has already signed up for this cycle is skipped.</p>
            <p className="mt-3">It also queues a reminder email to each professor reminded. Whether an email is delivered depends on the server's email settings; this page cannot confirm delivery.</p>
            <p className="mt-3">Sending again later reminds the same professors again.</p>
            {(remind.isSuccess || (failed && !failed.known)) && (
              <p className="mt-3 font-bold text-gray-900">
                {remind.isSuccess ? 'Sent' : 'Possibly sent'} from this page at {formatClock(remind.submittedAt)}. Sending again to the same people creates duplicate reminders.
              </p>
            )}
          </div>
        </Modal>
      )}
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
