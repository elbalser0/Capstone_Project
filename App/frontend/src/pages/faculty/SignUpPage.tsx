import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useCreateSignup, useEvaluationStatus, useMyCourses } from '../../api/hooks/faculty';
import type { CourseSection, Cycle, EvaluationStatus } from '../../api/types';
import { PlusIcon, XIcon } from '../../components/icons';
import { Button, Card, DueTag, ErrorNote, InfoLine, Modal, PageError, Radio, Steps } from '../../components/ui';
import { classStart, formatDate, formatShort, formatSlot, meetingSummary } from '../../lib/format';
import { addDays, utcDay } from '../../lib/dates';

// E2 sign-up (one course, then preferred class meetings) and E2a "Add a time".

const DAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 } as const;

/** Class meetings from the day after the sign-up deadline to the observation deadline. */
function meetingDates(section: CourseSection, cycle: Cycle) {
  const days = new Set(section.meetings.map((m) => DAY_INDEX[m.dayOfWeek]));
  const out: string[] = [];
  for (let d = addDays(cycle.signupDeadline, 1); d <= cycle.observationDeadline; d = addDays(d, 1)) if (days.has(utcDay(d).getUTCDay() as 1)) out.push(d);
  return out;
}

/** Monday of the week a date falls in. */
const weekOf = (iso: string) => addDays(iso, -((utcDay(iso).getUTCDay() + 6) % 7));

function AddTimeModal({ sections, cycle, initialSection, initialDates, onClose, onAdd }: {
  sections: CourseSection[];
  cycle: Cycle;
  initialSection: string;
  initialDates: string[];
  onClose: () => void;
  onAdd: (sectionId: string, dates: string[]) => void;
}) {
  const [sectionId, setSectionId] = useState(initialSection);
  const [picked, setPicked] = useState<string[]>(initialDates);
  const section = sections.find((s) => s.sectionId === sectionId)!;
  const byWeek = new Map<string, string[]>();
  for (const d of meetingDates(section, cycle)) byWeek.set(weekOf(d), [...(byWeek.get(weekOf(d)) ?? []), d]);
  const weeks = [...byWeek];

  const choose = (id: string) => {
    setSectionId(id);
    if (id !== sectionId) setPicked([]);
  };
  const toggle = (d: string) => setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort()));

  return (
    <Modal
      title="Add a time"
      width={600}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-sm font-bold text-gray-700">{picked.length} selected</span>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={picked.length === 0} onClick={() => onAdd(sectionId, picked)}>Add times</Button>
        </>
      }
    >
      <fieldset>
        <legend className="text-sm font-bold text-gray-900">1. Section</legend>
        <div className="mt-[9px] flex flex-col gap-1.5">
          {sections.map((s) => {
            const on = s.sectionId === sectionId;
            return (
              <label key={s.sectionId} className={`flex min-h-[50px] cursor-pointer items-center gap-3 rounded-md border px-4 py-2 ${on ? 'border-brand bg-brand-50' : 'border-gray-300 bg-white'}`}>
                <Radio name="add-time-section" checked={on} onChange={() => choose(s.sectionId)} />
                <span className="leading-tight">
                  <span className="block text-sm text-gray-900"><span className="font-bold">{s.label}</span> {s.title}</span>
                  <span className="mt-[3px] block text-xs text-gray-500">{meetingSummary(s, 'names')}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="text-sm font-bold text-gray-900">2. Date and time for {section.label}</legend>
        <p className="mt-[5px] text-xs text-gray-500">Class meetings before the observation deadline ({formatShort(cycle.observationDeadline)})</p>
        <div className="mt-5 -mr-6 flex max-h-[252px] flex-col gap-2 overflow-y-auto pr-6 pb-1">
          {weeks.map(([week, dates]) => (
            <div key={week} className="flex items-center">
              <span className="w-[132px] shrink-0 text-xs text-gray-500">Week of {formatShort(week)}</span>
              <span className="flex flex-wrap gap-3">
                {dates.map((d) => {
                  const on = picked.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(d)}
                      className={`flex h-[34px] min-w-[200px] items-center rounded-md border px-3.5 text-[13px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                        on ? 'border-brand bg-brand-50 font-bold text-brand' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {on && '✓ '}
                      {formatSlot(d, classStart(section, d))}
                    </button>
                  );
                })}
              </span>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="-mx-6 mt-5 border-t border-gray-200" />
    </Modal>
  );
}

function BeforeYouSubmit({ status, cycle }: { status: EvaluationStatus; cycle: Cycle }) {
  return (
    <Card className="self-start px-6 pt-6 pb-[37px]">
      <p className="text-xs text-gray-500">Sign-up deadline</p>
      <p className="mt-[3px] text-base font-bold text-gray-900">{formatDate(cycle.signupDeadline)}</p>
      <p className="mt-[19px] text-xs text-gray-500">Your status</p>
      <div className="mt-[7px]"><DueTag status={status.status} /></div>
      <div className="mt-5 border-t border-gray-200 pt-[17px]">
        <h2 className="mb-2.5 text-sm font-bold text-gray-900">What happens next</h2>
        <Steps
          items={[
            `After ${formatShort(cycle.signupDeadline)} the Assessment Committee runs observer selection.`,
            'You get a list of up to 5 colleagues who are free at the times you pick.',
            'You send requests to the ones you pick.',
          ]}
        />
      </div>
    </Card>
  );
}

export function SignUpPage() {
  const navigate = useNavigate();
  const status = useEvaluationStatus();
  const cycle = status.data?.cycle ?? null;
  const courses = useMyCourses(cycle?.term.termId);
  const create = useCreateSignup();
  const [chosen, setChosen] = useState<string | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  if (status.error) return <PageError error={status.error} />;
  if (!status.data || !courses.data) return null;
  if (!status.data.canSignUp || !cycle) return <Navigate to="/faculty/evaluation" replace />;

  const sections = courses.data;
  const sectionId = chosen ?? sections[0]?.sectionId ?? null;
  const section = sections.find((s) => s.sectionId === sectionId);
  const choose = (id: string) => {
    if (id !== sectionId) setDates([]);
    setChosen(id);
  };
  const submit = () =>
    sectionId &&
    create.mutate({ sectionId, proposedDates: dates }, { onSuccess: () => navigate('/faculty/evaluation') });

  return (
    <div className="grid grid-cols-[620px_344px] gap-8 pt-8">
      <div className="pt-2.5">
        <p className="text-sm text-gray-900">
          You teach {sections.length} {sections.length === 1 ? 'class' : 'classes'} in {cycle.term.label}. Choose one, then pick the days and times.
        </p>
        <InfoLine className="mt-3">One course per sign-up for now.</InfoLine>

        <fieldset className="mt-5">
          <legend className="sr-only">My {cycle.term.label} classes</legend>
          <div className="flex flex-col gap-3">
            {sections.map((s) => {
              const on = s.sectionId === sectionId;
              return (
                <label
                  key={s.sectionId}
                  className={`flex min-h-[76px] cursor-pointer items-center gap-4 rounded-lg px-5 py-3 ${on ? 'border-2 border-brand bg-brand-50' : 'border border-gray-300 bg-white'}`}
                >
                  <Radio name="signup-section" checked={on} onChange={() => choose(s.sectionId)} />
                  <span className="flex-1">
                    <span className="block text-sm text-pretty text-gray-900">
                      <span className="mr-[9px] font-bold">{s.label}</span>
                      {s.title}
                    </span>
                    <span className="mt-[5px] block text-sm text-gray-500">{meetingSummary(s)}</span>
                  </span>
                  {s.enrollment != null && <span className="self-start pt-1.5 text-xs whitespace-nowrap text-gray-500">{s.enrollment} students</span>}
                </label>
              );
            })}
          </div>
        </fieldset>

        <h2 className="mt-7 text-base font-bold text-gray-900">Preferred days and times for the observation</h2>
        <p className="mt-[7px] text-sm text-gray-500">Pick one or more meetings of this class. Observers are matched to these times.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {section &&
            dates.map((d) => (
              <span key={d} className="inline-flex h-8 min-w-[200px] items-center justify-between gap-2 rounded-md border border-gray-300 bg-white pr-1.5 pl-3.5 text-sm whitespace-nowrap text-gray-900">
                {formatSlot(d, classStart(section, d))}
                <button
                  type="button"
                  aria-label={`Remove ${formatSlot(d, classStart(section, d))}`}
                  onClick={() => setDates((x) => x.filter((y) => y !== d))}
                  className="flex size-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <XIcon />
                </button>
              </span>
            ))}
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={!section}
            className="inline-flex h-8 items-center gap-[13px] rounded-md border border-gray-300 bg-white pr-5 pl-3 text-sm text-gray-900 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-brand"
          >
            <PlusIcon className="text-gray-700" /> Add a time
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500">Must be before the observation deadline, {formatDate(cycle.observationDeadline)}.</p>

        <ErrorNote error={create.error} className="mt-4" />
        <div className="mt-[27px] flex gap-3">
          <Button onClick={submit} disabled={!sectionId || dates.length === 0 || create.isPending}>Submit sign-up</Button>
          <Button variant="secondary" onClick={() => navigate('/faculty/evaluation')}>Cancel</Button>
        </div>
      </div>

      <BeforeYouSubmit status={status.data} cycle={cycle} />

      {adding && sectionId && (
        <AddTimeModal
          sections={sections}
          cycle={cycle}
          initialSection={sectionId}
          initialDates={dates}
          onClose={() => setAdding(false)}
          onAdd={(id, picked) => {
            setChosen(id);
            setDates(picked);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}
