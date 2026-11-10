import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Outlet, useBlocker, useNavigate, useParams } from 'react-router';
import { useCreateTemplate, useTemplates } from '../../api/hooks/committee';
import type { TemplateQuestion, TemplateStatus, TemplateVersion } from '../../api/types';
import { usePageTitle } from '../../components/AppShell';
import { EyeIcon, LockIcon, PenIcon, PlusIcon } from '../../components/icons';
import {
  Button, Card, Cell, Checkbox, ErrorNote, Modal, Note, RatingScale, Row, Table, Tag, TextArea,
  buttonClass, inputClass, labelClass, linkClass, type TagTone,
} from '../../components/ui';
import { formatDate } from '../../lib/format';

// A5 versions and A5a view a version (read only). The draft screens (A5b, A5c, A5d, A5e) are in the same
// file so that the draft being edited lives in one layout.

const STATUS: Record<TemplateStatus, [TagTone, string]> = { draft: ['neutral', 'Draft'], live: ['signed', 'Live'], retired: ['neutral', 'Retired'] };

export function StatusTag({ status }: { status: TemplateStatus }) {
  return <Tag tone={STATUS[status][0]}>{STATUS[status][1]}</Tag>;
}

/** "1 Poor to 5 Excellent", or "1 to 5" when the labels are empty. */
export const scaleLabel = (q: Pick<TemplateQuestion, 'ratingMin' | 'ratingMax' | 'minLabel' | 'maxLabel'>) =>
  [q.ratingMin, q.minLabel, 'to', q.ratingMax, q.maxLabel].filter((part) => part !== '').join(' ');

function useVersions() {
  const templates = useTemplates();
  const versions = templates.data ?? [];
  return { templates, versions, live: versions.find((v) => v.status === 'live'), draftVersion: versions.find((v) => v.status === 'draft') };
}

function LoadError({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="pt-8">
      <ErrorNote error={error} />
      <Button variant="secondary" className="mt-3" disabled={retrying} onClick={onRetry}>{retrying ? 'Trying again…' : 'Try again'}</Button>
    </div>
  );
}

// ---------- The draft being edited ----------

type Question = Omit<TemplateQuestion, 'questionId' | 'orderNo'> & { key: string };
interface Edits { questions: Question[]; changeNote: string }
interface Draft { versionId: string | null; versionNo: number; changeNote: string; questions: Question[] }

const DraftContext = createContext<{ edits: Edits | null; setEdits: (edits: Edits | null) => void }>({ edits: null, setEdits: () => {} });

const toQuestions = (v: TemplateVersion): Question[] => v.questions.map(({ questionId, orderNo: _order, ...q }) => ({ ...q, key: questionId }));

const DRAFT_PATH = '/committee/templates/draft';

/**
 * Edits stay here, outside the pages, so Preview shows unsaved changes and "Back to editing" keeps them.
 * Leaving the draft screens with unsaved edits asks first.
 */
export function TemplatesLayout() {
  const [edits, setEditsState] = useState<Edits | null>(null);
  const dirty = useRef(false);
  const setEdits = useCallback((next: Edits | null) => {
    dirty.current = next !== null;
    setEditsState(next);
  }, []);
  const blocker = useBlocker(({ nextLocation }) => dirty.current && !nextLocation.pathname.startsWith(DRAFT_PATH));

  useEffect(() => {
    if (!edits) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [edits]);

  const stay = useCallback(() => blocker.reset?.(), [blocker]);
  return (
    <DraftContext.Provider value={{ edits, setEdits }}>
      <Outlet />
      {blocker.state === 'blocked' && (
        <Modal
          title="Leave without saving?"
          subtitle="Your edits to the draft have not been saved. They will be lost if you leave."
          onClose={stay}
          footer={
            <>
              <Button variant="secondary" onClick={stay}>Keep editing</Button>
              <Button variant="danger" onClick={() => { setEdits(null); blocker.proceed?.(); }}>Leave and discard</Button>
            </>
          }
        >
          <p className="text-sm text-gray-700">Use Save and exit on the draft page to keep your changes.</p>
        </Modal>
      )}
    </DraftContext.Provider>
  );
}

// ---------- A5 ----------

export function TemplatesPage() {
  const { templates, versions, draftVersion } = useVersions();

  if (templates.error && !templates.data) return <LoadError error={templates.error} onRetry={() => void templates.refetch()} retrying={templates.isFetching} />;
  if (!templates.data) return <p role="status" className="pt-8 text-sm text-gray-500">Loading templates…</p>;
  return (
    <div className="flex flex-col pt-8">
      <p className="text-sm text-gray-500">All versions of the observation form. Edit the draft, or view any version. Signed observations keep the version they used.</p>
      <div className="mt-[17px] flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">All versions</h2>
        <div className="flex items-center gap-3">
          {draftVersion && <span className="text-xs text-gray-500">Only one draft at a time.</span>}
          {!draftVersion ? (
            <Link to="draft" className={buttonClass('secondary')}>Start a new draft</Link>
          ) : (
            <Button variant="secondary" disabled>Start a new draft</Button>
          )}
        </div>
      </div>
      <div className="mt-[10px]">
        <Table label="Versions" columns="100px 120px 130px 150px 250px 120px 1fr" head={['Version', 'Status', 'Published', 'By', 'What changed', 'Used by', '']}>
          {versions.map((v) => (
            <Row key={v.versionId}>
              <Cell className="font-bold">Version {v.versionNo}</Cell>
              <Cell><StatusTag status={v.status} /></Cell>
              <Cell className="text-gray-700">{v.publishedDate ? formatDate(v.publishedDate) : 'Not yet'}</Cell>
              <Cell className="text-gray-700">{v.createdBy.displayName}</Cell>
              <Cell className="text-gray-700">{v.changeNote}</Cell>
              <Cell className="text-gray-700">{v.observationsCount} {v.observationsCount === 1 ? 'observation' : 'observations'}</Cell>
              <Cell className="pr-0">
                {v.status === 'draft'
                  ? <Link to="draft" className={buttonClass('primary', '', 'xs')} aria-label={`Edit version ${v.versionNo}`}>Edit</Link>
                  : <Link to={v.versionId} className={buttonClass('secondary', '', 'xs')} aria-label={`View version ${v.versionNo}`}>View</Link>}
              </Cell>
            </Row>
          ))}
          {versions.length === 0 && <p className="px-4 py-4 text-sm text-gray-500">No template versions yet.</p>}
        </Table>
      </div>
      <Note className="mt-6" title="How every form works">
        Each question gets a rating and a comment box, and every form ends with Any other comments. There are no other question types.
      </Note>
    </div>
  );
}

// ---------- A5a ----------

function QuestionsTable({ questions, label }: { questions: TemplateQuestion[]; label: string }) {
  return (
    <Table label={label} columns="200px 300px 180px 110px 1fr" head={['Question', 'Wording observers see', 'Rating', 'Comment box', 'Required']}>
      {questions.map((q) => (
        <Row key={q.questionId}>
          <Cell className="font-bold">{q.title}</Cell>
          <Cell className="text-gray-700">{q.wording}</Cell>
          <Cell className="text-gray-700">{scaleLabel(q)}</Cell>
          <Cell className="text-gray-700">Yes</Cell>
          <Cell className="text-gray-700">{q.isRequired ? 'Yes' : 'No'}</Cell>
        </Row>
      ))}
      <Row>
        <Cell className="font-bold">Any other comments</Cell>
        <Cell className="text-gray-700">Always the last item on every form</Cell>
        <Cell className="text-gray-500">No rating</Cell>
        <Cell className="text-gray-700">Yes</Cell>
        <Cell className="text-gray-500">Always included</Cell>
      </Row>
    </Table>
  );
}

function VersionView({ v }: { v: TemplateVersion }) {
  usePageTitle(`Version ${v.versionNo} (read only)`);
  return (
    <div className="flex flex-col pt-8">
      <div className="flex flex-wrap items-center gap-[15px]">
        <StatusTag status={v.status} />
        <p className="text-sm text-gray-500">
          {v.publishedDate ? `Published ${formatDate(v.publishedDate)}` : 'Not published'} by {v.createdBy.displayName}. Used by {v.observationsCount}
          {v.observationsCount === 1 ? ' observation' : ' observations'}. It cannot be edited.
        </p>
      </div>
      {v.changeNote && <p className="mt-3 text-sm text-gray-700">What changed: {v.changeNote}</p>}
      <div className="mt-[18px] overflow-x-auto"><div className="min-w-[760px]"><QuestionsTable questions={v.questions} label={`Version ${v.versionNo} questions`} /></div></div>
      <div className="mt-9">
        <Link to="/committee/templates" className={buttonClass('secondary')}>Back to templates</Link>
      </div>
    </div>
  );
}

export function VersionPage() {
  const { versionId } = useParams();
  const { templates, versions } = useVersions();
  const v = versions.find((x) => x.versionId === versionId);

  if (templates.error && !templates.data) return <LoadError error={templates.error} onRetry={() => void templates.refetch()} retrying={templates.isFetching} />;
  if (!templates.data) return <p role="status" className="pt-8 text-sm text-gray-500">Loading template…</p>;
  if (!v) return <Navigate to="/committee/templates" replace />;
  if (v.status === 'draft') return <Navigate to="/committee/templates/draft" replace />;
  return <VersionView v={v} />;
}

// ---------- Reading the draft ----------

let nextKey = 0;
const emptyQuestion = (): Question => ({
  key: `new-${++nextKey}`, title: '', wording: '', ratingMin: 1, ratingMax: 5, minLabel: 'Poor', maxLabel: 'Excellent', isRequired: true,
});

/** The draft on the server with any unsaved edits on top; with no draft yet, a copy of the live version. */
function useDraft({ seed = false } = {}) {
  const { templates, versions, live, draftVersion } = useVersions();
  const { edits, setEdits } = useContext(DraftContext);
  const base: Draft | null = draftVersion
    ? { versionId: draftVersion.versionId, versionNo: draftVersion.versionNo, changeNote: draftVersion.changeNote, questions: toQuestions(draftVersion) }
    : live
      ? { versionId: null, versionNo: Math.max(...versions.map((v) => v.versionNo)) + 1, changeNote: '', questions: toQuestions(live) }
      : seed
        ? { versionId: null, versionNo: Math.max(0, ...versions.map((v) => v.versionNo)) + 1, changeNote: '', questions: [] }
        : null;
  const draft = base && { ...base, ...edits };
  return { templates, live, draft, base, dirty: edits !== null, setEdits };
}

const sameQuestion = (a: Question, b: Pick<TemplateQuestion, 'wording' | 'ratingMin' | 'ratingMax' | 'minLabel' | 'maxLabel' | 'isRequired'>) =>
  a.wording === b.wording && a.ratingMin === b.ratingMin && a.ratingMax === b.ratingMax && a.minLabel === b.minLabel && a.maxLabel === b.maxLabel && a.isRequired === b.isRequired;

/** A question is changed when the live version has no question with the same title and settings. */
const changedFromLive = (q: Question, live: TemplateVersion | undefined) => {
  if (!live) return false;
  const same = live.questions.find((x) => x.title === q.title);
  return !same || !sameQuestion(q, same);
};

/** A5e: what the draft changes compared with the live version, one line each. */
export function describeChanges(live: TemplateVersion | undefined, questions: Question[]): string[] {
  if (!live) return [];
  const titles = new Set(questions.map((q) => q.title));
  return [
    ...questions.filter((q) => !live.questions.some((x) => x.title === q.title)).map((q) => `Added: ${q.title}`),
    ...live.questions.filter((x) => !titles.has(x.title)).map((x) => `Removed: ${x.title}`),
    ...questions.filter((q) => live.questions.some((x) => x.title === q.title) && changedFromLive(q, live)).map((q) => `Changed: ${q.title}`),
  ];
}

// ---------- A5c ----------

const MAX_QUESTIONS = 100;
const MAX_TEXT = 2000;

function EditQuestionModal({ question, isNew, draftNo, liveNo, onClose, onSave, onDelete }: {
  question: Question;
  isNew: boolean;
  draftNo: number;
  liveNo: number | undefined;
  onClose: () => void;
  onSave: (q: Question) => void;
  onDelete: () => void;
}) {
  const [q, setQ] = useState(question);
  const set = (patch: Partial<Question>) => setQ((x) => ({ ...x, ...patch }));
  const wholeNumbers = Number.isInteger(q.ratingMin) && Number.isInteger(q.ratingMax);
  const rangeOk = wholeNumbers && q.ratingMin < q.ratingMax && Math.abs(q.ratingMin) <= 100 && Math.abs(q.ratingMax) <= 100;
  const textOk = [q.title, q.wording, q.minLabel, q.maxLabel].every((t) => t.length <= MAX_TEXT);
  const valid = Boolean(q.title.trim() && q.wording.trim() && rangeOk && textOk);
  return (
    <Modal
      title={isNew ? 'Add question' : 'Edit question'}
      subtitle={`Changes go into the version ${draftNo} draft.${liveNo ? ` Version ${liveNo} stays live until you publish.` : ''}`}
      width={600}
      onClose={onClose}
      footer={
        <>
          {!isNew && <Button variant="danger" className="mr-auto" onClick={onDelete}>Delete question</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={() => onSave({ ...q, title: q.title.trim(), wording: q.wording.trim() })}>Okay</Button>
        </>
      }
    >
      <label htmlFor="q-title" className={labelClass}>Question</label>
      <input id="q-title" className={`${inputClass} w-full`} value={q.title} onChange={(e) => set({ title: e.target.value })} />
      <label htmlFor="q-wording" className={`${labelClass} mt-3`}>Wording observers see</label>
      <TextArea id="q-wording" className="h-[60px]" value={q.wording} onChange={(e) => set({ wording: e.target.value })} />
      <fieldset className="mt-3">
        <legend className="mb-[7px] text-sm font-bold text-gray-900">Rating range</legend>
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Lowest score" type="number" className={`${inputClass} w-16`} value={Number.isNaN(q.ratingMin) ? '' : q.ratingMin} onChange={(e) => set({ ratingMin: e.target.value === '' ? NaN : Number(e.target.value) })} />
          <input aria-label="Lowest score label" className={`${inputClass} w-[140px]`} value={q.minLabel} onChange={(e) => set({ minLabel: e.target.value })} />
          <span className="px-1.5 text-sm text-gray-500">to</span>
          <input aria-label="Highest score" type="number" className={`${inputClass} w-16`} value={Number.isNaN(q.ratingMax) ? '' : q.ratingMax} onChange={(e) => set({ ratingMax: e.target.value === '' ? NaN : Number(e.target.value) })} />
          <input aria-label="Highest score label" className={`${inputClass} w-40`} value={q.maxLabel} onChange={(e) => set({ maxLabel: e.target.value })} />
        </div>
        <p className="mt-1.5 text-xs text-gray-500">Lowest and highest score, with the label observers see.</p>
        {!rangeOk && <p role="alert" className="mt-1.5 text-xs text-red-800">Use whole numbers from -100 to 100, with the highest score above the lowest.</p>}
      </fieldset>
      <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm text-gray-900">
        <Checkbox checked={q.isRequired} onChange={(e) => set({ isRequired: e.target.checked })} />
        Required. Observers must rate this before signing.
      </label>
      <Note className="mt-5 py-3 text-[13px]">Every question automatically gets a comment box under its rating.</Note>
    </Modal>
  );
}

// ---------- A5e ----------

function WhatChangedModal({ draft, live, onClose }: { draft: Draft; live: TemplateVersion | undefined; onClose: () => void }) {
  const navigate = useNavigate();
  const { setEdits } = useContext(DraftContext);
  const create = useCreateTemplate();
  const [note, setNote] = useState(draft.changeNote);
  const changes = describeChanges(live, draft.questions);
  // Closing while the save is in flight would lose its result, so ignore Escape and the backdrop until it ends.
  const close = useCallback(() => { if (!create.isPending) onClose(); }, [create.isPending, onClose]);
  const save = () => {
    if (create.isPending) return;
    create.mutate(
      { changeNote: note.trim(), questions: draft.questions.map(({ key: _key, ...q }, i) => ({ ...q, orderNo: i + 1 })) },
      {
        onSuccess: () => {
          setEdits(null);
          navigate('/committee/templates');
        },
      },
    );
  };
  return (
    <Modal
      title="What changed?"
      subtitle={`Describe your changes to version ${draft.versionNo}. This note shows in the version list on the templates page.`}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" disabled={create.isPending} onClick={close}>Cancel</Button>
          <Button disabled={create.isPending} onClick={save}>{create.isPending ? 'Saving…' : 'Save and exit'}</Button>
        </>
      }
    >
      {live && (
        <div className="mb-4">
          <p className="text-sm font-bold text-gray-900">Compared with version {live.versionNo}</p>
          {changes.length === 0
            ? <p className="mt-1 text-sm text-gray-500">No changes yet.</p>
            : <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">{changes.map((line, i) => <li key={i}>{line}</li>)}</ul>}
        </div>
      )}
      <label htmlFor="change-note" className={labelClass}>What changed</label>
      <TextArea id="change-note" className="h-[92px]" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorNote error={create.error} className="mt-3" />
    </Modal>
  );
}

// ---------- A5b ----------

export function DraftPage() {
  const navigate = useNavigate();
  const { templates, live, draft, base, dirty, setEdits } = useDraft({ seed: true });
  const [editing, setEditing] = useState<{ index: number; question: Question } | null>(null);
  const [saving, setSaving] = useState(false);
  const closeEditing = useCallback(() => setEditing(null), []);
  const closeSaving = useCallback(() => setSaving(false), []);
  usePageTitle(draft ? `Edit draft: version ${draft.versionNo}` : null);

  if (templates.error && !templates.data) return <LoadError error={templates.error} onRetry={() => void templates.refetch()} retrying={templates.isFetching} />;
  if (!templates.data) return <p role="status" className="pt-8 text-sm text-gray-500">Loading template…</p>;
  if (!draft) return <Navigate to="/committee/templates" replace />;

  // Putting every question back as it was saved leaves nothing unsaved.
  const update = (questions: Question[]) => setEdits(JSON.stringify(questions) === JSON.stringify(base?.questions) ? null : { changeNote: draft.changeNote, questions });
  const toggleRequired = (i: number) => update(draft.questions.map((q, j) => (j === i ? { ...q, isRequired: !q.isRequired } : q)));
  const empty = draft.questions.length === 0;

  return (
    <div className="flex flex-col pt-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Tag tone="neutral" icon={<PenIcon width={9} height={9} />}>Draft</Tag>
            <p className="text-sm text-gray-700">
              Editing a draft of version {draft.versionNo}.{live && ` Version ${live.versionNo} is live, published ${formatDate(live.publishedDate ?? live.createdDate)}.`}
            </p>
            {dirty && <Tag tone="due">Unsaved changes</Tag>}
          </div>
          <p className="mt-3 flex items-center gap-[11px] pl-[3px] text-sm text-gray-500">
            <LockIcon /> Signed observations keep the version they used.
          </p>
          {draft.versionId === null && (
            <p className="mt-2 pl-[3px] text-sm text-gray-500">
              {live ? `This draft starts as a copy of version ${live.versionNo} and is not saved yet.` : 'This is the first template. Add questions, then save it.'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => navigate('preview')}><EyeIcon width={14} height={8} /> Preview</Button>
          <Button variant="secondary" disabled={empty} onClick={() => setSaving(true)}>Save and exit</Button>
        </div>
      </div>

      <div className="mt-[23px] overflow-x-auto">
        <div className="min-w-[820px]">
          <Table label="Questions" columns="200px 300px 120px 120px 110px 1fr" head={['Question', 'Wording', 'Rating range', 'Comment box', 'Required', '']}>
            {draft.questions.map((q, i) => (
              <Row key={q.key}>
                <Cell className="font-bold">{q.title}</Cell>
                <Cell>{q.wording}</Cell>
                <Cell>{q.ratingMin} to {q.ratingMax}</Cell>
                <Cell>Yes</Cell>
                <Cell>
                  <label className="flex cursor-pointer items-center gap-2">
                    <Checkbox checked={q.isRequired} onChange={() => toggleRequired(i)} aria-label={`${q.title} required`} />
                    {q.isRequired ? 'Yes' : 'No'}
                  </label>
                </Cell>
                <Cell className="text-right">
                  <button type="button" className={linkClass} onClick={() => setEditing({ index: i, question: q })} aria-label={`Edit ${q.title}`}>Edit</button>
                </Cell>
              </Row>
            ))}
            <Row>
              <Cell className="font-bold">Any other comments</Cell>
              <Cell>Anything else the observee should know</Cell>
              <Cell className="text-gray-500">No rating</Cell>
              <Cell>Yes</Cell>
              <Cell className="text-gray-500">Always included</Cell>
              <Cell />
            </Row>
          </Table>
        </div>
      </div>
      {empty && <p role="alert" className="mt-3 text-sm text-red-800">A template needs at least one question.</p>}
      <div className="mt-4">
        <Button variant="secondary" disabled={draft.questions.length >= MAX_QUESTIONS} onClick={() => setEditing({ index: draft.questions.length, question: emptyQuestion() })}>
          <PlusIcon /> Add question
        </Button>
      </div>
      <p className="mt-5 text-xs text-gray-500">Every question gets a rating and a comment box. Any other comments is always the last item and cannot be removed.</p>

      {editing && (
        <EditQuestionModal
          question={editing.question}
          isNew={editing.index === draft.questions.length}
          draftNo={draft.versionNo}
          liveNo={live?.versionNo}
          onClose={closeEditing}
          onSave={(q) => {
            const next = [...draft.questions];
            next[editing.index] = q;
            update(next);
            setEditing(null);
          }}
          onDelete={() => {
            update(draft.questions.filter((_, j) => j !== editing.index));
            setEditing(null);
          }}
        />
      )}
      {saving && <WhatChangedModal draft={draft} live={live} onClose={closeSaving} />}
    </div>
  );
}

// ---------- A5d ----------

export function PreviewPage() {
  const { templates, live, draft } = useDraft();
  const [ratings, setRatings] = useState<Record<string, number>>({});
  usePageTitle(draft ? `Preview: version ${draft.versionNo} (draft)` : null);

  if (templates.error && !templates.data) return <LoadError error={templates.error} onRetry={() => void templates.refetch()} retrying={templates.isFetching} />;
  if (!templates.data) return <p role="status" className="pt-8 text-sm text-gray-500">Loading template…</p>;
  if (!draft) return <Navigate to="/committee/templates" replace />;

  return (
    <div className="flex flex-col pt-8">
      <Note title="This is what observers will fill in during the class.">
        Nothing typed here is saved.{live && ` Version ${live.versionNo} stays live until you publish version ${draft.versionNo}.`}
      </Note>
      <Card className="mt-5 overflow-hidden">
        <p className="px-6 pt-4 pb-3 text-[13px] text-gray-500">Observation: the observee, course and date are filled in by the system.</p>
        <div className="divide-y divide-gray-200 border-t border-gray-200">
          {draft.questions.map((q) => (
            <div key={q.key} className="grid gap-3 px-6 py-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-6">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-[5px] text-sm font-bold text-gray-900">
                  {q.title}
                  {changedFromLive(q, live) && <Tag tone="due">Changed in v{draft.versionNo}</Tag>}
                </p>
                <p className="mt-[3px] text-xs text-gray-500">{q.wording}</p>
                <p className="mt-[3px] text-xs text-gray-500">{scaleLabel(q)}</p>
              </div>
              <RatingScale round min={q.ratingMin} max={q.ratingMax} value={ratings[q.key] ?? null} label={q.title} onChange={(n) => setRatings((r) => ({ ...r, [q.key]: n }))} />
              <TextArea aria-label={`Comment on ${q.title}`} className="h-11" placeholder="Comment" />
            </div>
          ))}
          <div className="grid gap-3 px-6 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-center lg:gap-6">
            <div>
              <p className="text-sm font-bold text-gray-900">Any other comments</p>
              <p className="mt-[3px] text-xs text-gray-500">Always the last item on every form</p>
            </div>
            <TextArea aria-label="Any other comments" className="h-11" placeholder="Any other comments about the class" />
          </div>
        </div>
      </Card>
      <div className="mt-6">
        <Link to={DRAFT_PATH} className={buttonClass('secondary')}>Back to editing</Link>
      </div>
    </div>
  );
}
