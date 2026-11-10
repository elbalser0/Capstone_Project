import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useCreateCycle, useUpdateCycle } from '../../api/hooks/committee';
import { useCurrentCycle, useTerms } from '../../api/hooks/shared';
import type { CreateCycleInput, Cycle, UpdateCycleInput } from '../../api/types';
import { usePageTitle } from '../../components/AppShell';
import { CalendarIcon, ChevronIcon } from '../../components/icons';
import { Button, Card, ErrorNote, inputClass, labelClass } from '../../components/ui';
import { todayIso } from '../../lib/dates';
import { formatDate } from '../../lib/format';
import { isMissingEndpoint } from '../../lib/missingEndpoint';

// A2. Start the evaluation cycle for a term with its three deadlines (POST /api/cycles). While the
// cycle is open, the same form changes its deadlines (PATCH /api/cycles/{cycleId}).

type Deadlines = Omit<CreateCycleInput, 'termId'>;
const KEYS = ['signupDeadline', 'observationDeadline', 'feedbackDeadline'] as const;
const DRAFT_KEY = 'assessment-helper.cycle-draft';

// ---------- Draft (this device only) ----------

const textAt = (value: object, key: string) => {
  const v: unknown = Reflect.get(value, key);
  return typeof v === 'string' ? v : '';
};

function readDraft(): CreateCycleInput | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    return {
      termId: textAt(value, 'termId'),
      signupDeadline: textAt(value, 'signupDeadline'),
      observationDeadline: textAt(value, 'observationDeadline'),
      feedbackDeadline: textAt(value, 'feedbackDeadline'),
    };
  } catch {
    return null;
  }
}

function writeDraft(draft: CreateCycleInput): boolean {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

// ---------- Form parts ----------

/** The backend's rule: start date <= sign-up <= observation <= feedback (equal dates allowed). */
function orderProblem(startDate: string, d: Deadlines): string | null {
  if (!KEYS.every((k) => d[k])) return null;
  if (d.signupDeadline < startDate) return `The sign-up deadline cannot be before the cycle start date, ${formatDate(startDate)}.`;
  if (d.observationDeadline < d.signupDeadline || d.feedbackDeadline < d.observationDeadline) {
    return 'Deadlines must be in order: sign-up, then observation, then feedback.';
  }
  return null;
}

/** The date shows as "Sep 15, 2026"; the native date picker opens on click or keyboard. */
function DateRow({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-6">
        <span className="relative block w-full sm:w-[280px] sm:shrink-0">
          <input
            id={id}
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`${inputClass} peer w-full text-transparent focus:text-gray-900 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:size-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0`}
          />
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-900 peer-focus:hidden" aria-hidden>
            {value ? formatDate(value) : ''}
          </span>
          <CalendarIcon width={13} height={13} className="pointer-events-none absolute top-[13px] right-3.5 text-gray-500" />
        </span>
        <p className="text-xs text-gray-500 sm:pt-2">{hint}</p>
      </div>
    </div>
  );
}

function DateFields({ dates, onChange }: { dates: Deadlines; onChange: (key: keyof Deadlines) => (v: string) => void }) {
  return (
    <>
      <DateRow id="signup-deadline" label="Sign-up deadline" hint="Faculty choose one course by this date." value={dates.signupDeadline} onChange={onChange('signupDeadline')} />
      <DateRow id="observation-deadline" label="Observation-period deadline" hint="Last day to observe and sign." value={dates.observationDeadline} onChange={onChange('observationDeadline')} />
      <DateRow id="feedback-deadline" label="Feedback deadline" hint="Survey closes, then KPIs are generated." value={dates.feedbackDeadline} onChange={onChange('feedbackDeadline')} />
    </>
  );
}

function Retry({ error, retry, className = '' }: { error: unknown; retry: () => void; className?: string }) {
  return (
    <div className={className}>
      <ErrorNote error={error} />
      <Button type="button" variant="secondary" className="mt-3" onClick={retry}>Try again</Button>
    </div>
  );
}

// ---------- The two forms ----------

function Settings({ term, dates, onChange, problem, error, actions }: {
  term: ReactNode;
  dates: Deadlines;
  onChange: (key: keyof Deadlines) => (v: string) => void;
  problem: string | null;
  error: unknown;
  actions: ReactNode;
}) {
  return (
    <Card className="min-w-0 px-6 pt-5 pb-6">
      <h2 className="text-base font-bold text-gray-900">Cycle settings</h2>
      <div className="mt-[17px] flex flex-col gap-5">
        {term}
        <DateFields dates={dates} onChange={onChange} />
      </div>
      {problem && <p role="alert" className="mt-4 text-sm text-red-800">{problem}</p>}
      <ErrorNote error={error} className="mt-4" />
      <div className="mt-6 flex flex-wrap items-center gap-3">{actions}</div>
    </Card>
  );
}

const TERMS_MISSING = 'The term list is not available yet, so a new cycle cannot be started here.';

/** No cycle yet, or the last one has closed: start the next one. */
function StartForm({ lastCycle }: { lastCycle: Cycle | undefined }) {
  const navigate = useNavigate();
  const terms = useTerms();
  const create = useCreateCycle();
  const sending = useRef(false);
  const [draft] = useState(readDraft);
  const [chosen, setChosen] = useState(draft?.termId ?? '');
  const [dates, setDates] = useState<Deadlines>({
    signupDeadline: draft?.signupDeadline ?? '',
    observationDeadline: draft?.observationDeadline ?? '',
    feedbackDeadline: draft?.feedbackDeadline ?? '',
  });
  const [draftNote, setDraftNote] = useState<string | null>(null);

  const today = todayIso();
  // A new cycle is for a term after the latest cycle's term that has not ended (the backend's TERM_ENDED rule).
  const upcoming = (terms.data ?? []).filter((t) => t.startDate > (lastCycle?.term.startDate ?? '') && t.endDate >= today);
  const term = upcoming.find((t) => t.termId === chosen) ?? upcoming[0];
  const termId = term?.termId ?? '';
  usePageTitle(term ? `Start the ${term.label} evaluation cycle` : null);

  const problem = orderProblem(today, dates);
  const canStart = Boolean(term) && KEYS.every((k) => dates[k]) && !problem;
  const onChange = (key: keyof Deadlines) => (v: string) => {
    setDraftNote(null);
    setDates((d) => ({ ...d, [key]: v }));
  };
  const start = () => {
    if (sending.current || !canStart || create.isPending) return;
    sending.current = true;
    create.mutate({ termId, ...dates }, {
      onSettled: () => { sending.current = false; },
      onSuccess: () => {
        clearDraft();
        navigate('/committee/faculty');
      },
    });
  };

  let picker: ReactNode;
  if (isMissingEndpoint(terms.error)) picker = <p className="text-sm text-gray-700">{TERMS_MISSING}</p>;
  else if (terms.error) picker = <Retry error={terms.error} retry={() => void terms.refetch()} />;
  else if (!terms.data) picker = <p role="status" className="text-sm text-gray-500">Loading terms…</p>;
  else if (!term) picker = <p className="text-sm text-gray-700">There is no upcoming term to start a cycle for.</p>;
  else {
    picker = (
      <span className="relative block w-full sm:w-[280px]">
        <select
          id="cycle-term"
          value={termId}
          onChange={(e) => {
            setDraftNote(null);
            setChosen(e.target.value);
          }}
          className={`${inputClass} w-full appearance-none pr-9`}
        >
          {upcoming.map((t) => <option key={t.termId} value={t.termId}>{t.label}</option>)}
        </select>
        <ChevronIcon className="pointer-events-none absolute top-[17px] right-4 text-gray-500" />
      </span>
    );
  }

  return (
    <>
      <Settings
        term={(
          <div>
            {term ? <label htmlFor="cycle-term" className={labelClass}>Term</label> : <p className={labelClass}>Term</p>}
            {picker}
          </div>
        )}
        dates={dates}
        onChange={onChange}
        problem={problem}
        error={create.error}
        actions={(
          <>
            <Button type="button" disabled={!canStart} aria-disabled={create.isPending || undefined} onClick={start}>
              {create.isPending ? 'Starting…' : 'Kick off cycle'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDraftNote(writeDraft({ termId, ...dates }) ? 'Draft saved on this device.' : 'The draft could not be saved on this device.')}>
              Save as draft
            </Button>
            {draftNote && <span role="status" className="text-xs text-gray-500">{draftNote}</span>}
          </>
        )}
      />
    </>
  );
}

/** An open cycle: change its deadlines. The term is fixed. */
function EditForm({ cycle }: { cycle: Cycle }) {
  const update = useUpdateCycle(cycle.cycleId);
  const sending = useRef(false);
  const [dates, setDates] = useState<Deadlines>({
    signupDeadline: cycle.signupDeadline,
    observationDeadline: cycle.observationDeadline,
    feedbackDeadline: cycle.feedbackDeadline,
  });
  usePageTitle(`${cycle.term.label} evaluation cycle`);

  const changes: UpdateCycleInput = {};
  for (const k of KEYS) if (dates[k] !== cycle[k]) changes[k] = dates[k];
  const changed = Object.keys(changes).length > 0;
  const problem = orderProblem(cycle.startDate, dates);
  const canSave = changed && KEYS.every((k) => dates[k]) && !problem;
  const onChange = (key: keyof Deadlines) => (v: string) => setDates((d) => ({ ...d, [key]: v }));
  const save = () => {
    if (sending.current || !canSave || update.isPending) return;
    sending.current = true;
    update.mutate(changes, { onSettled: () => { sending.current = false; } });
  };

  return (
    <>
      <Settings
        term={(
          <div>
            <p className={labelClass}>Term</p>
            <p className="text-sm text-gray-900">{cycle.term.label}</p>
          </div>
        )}
        dates={dates}
        onChange={onChange}
        problem={problem}
        error={update.error}
        actions={(
          <>
            <Button type="button" disabled={!canSave} aria-disabled={update.isPending || undefined} onClick={save}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
            {update.isSuccess && !changed && <span role="status" className="text-xs text-gray-500">Saved.</span>}
          </>
        )}
      />
    </>
  );
}

export function CyclePage() {
  const current = useCurrentCycle();

  if (current.error) return <Retry error={current.error} retry={() => void current.refetch()} className="pt-8" />;
  if (current.isPending) return <p role="status" className="pt-8 text-sm text-gray-500">Loading the current cycle…</p>;

  // GET /api/cycles/current returns the latest cycle even after it has closed: then it is the last
  // cycle and the form starts the next one.
  const open = current.data && current.data.phase !== 'closed' ? current.data : null;
  const last = current.data && current.data.phase === 'closed' ? current.data : undefined;

  return (
    <div className="grid grid-cols-1 items-start gap-8 pt-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      {open ? <EditForm key={open.cycleId} cycle={open} /> : <StartForm key={last?.cycleId ?? 'new'} lastCycle={last} />}
    </div>
  );
}
