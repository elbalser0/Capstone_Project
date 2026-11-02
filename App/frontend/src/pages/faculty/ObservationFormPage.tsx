import { useState } from 'react';
import { Link } from 'react-router';
import { Banner, Button, Card, PageError, RatingScale, TextArea, linkClass } from '../../components/ui';
import { nowMs } from '../../lib/clock';
import { formatClock, isLocked } from '../../lib/format';
import type { ObservationDetail } from '../../api/types';
import { readDraft, rememberDraft, saveDraft, type Draft } from './observationDraft';
import { whenShort } from './observationDisplay';
import { useObservationRecord } from './useObservationRecord';

/** Table columns on wide screens (R3); below that each question stacks as its own block. */
const ROW = 'lg:grid-cols-[minmax(0,1fr)_13rem_minmax(0,1.3fr)]';

function Editor({ o, user }: { o: ObservationDetail; user: string }) {
  const [initial] = useState(() => readDraft(user, o));
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [message, setMessage] = useState(initial.warning);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const updateDraft = (next: Draft) => {
    rememberDraft(user, o, next);
    setDraft(next);
    setDirty(true);
  };
  const answer = (id: string, update: Partial<Draft['answers'][string]>) => {
    updateDraft({ ...draft, answers: { ...draft.answers, [id]: { ...draft.answers[id], ...update } } });
  };
  return <div className="min-w-0 space-y-5 pt-8 text-gray-900 [overflow-wrap:anywhere]">
    <Link to={`/faculty/observe/${o.observationId}`} className={linkClass}>Back to read-only record</Link>
    <h2 className="text-base font-bold">Observation: {o.observee.displayName}, {o.section.label}, {whenShort(o)}</h2>
    <Banner tone="info">This is your copy of Observation Template v{o.templateVersion.versionNo}. Questions and rating ranges are set by the Assessment Committee.</Banner>
    <p className="text-sm text-gray-700">This form is a local draft on this device. It has not been submitted or signed.</p>
    {o.answers.length === 0 && <p role="status">No questions are available for this observation.</p>}
    {o.answers.length > 0 && <Card className="min-w-0">
      <div className={`hidden gap-6 border-b border-gray-200 bg-gray-50 px-5 py-3 text-xs font-bold text-gray-500 lg:grid ${ROW}`}>
        <span>Question</span><span>Rating</span><span>Comment</span>
      </div>
      {o.answers.map(a => <div key={a.questionId} className={`grid gap-3 border-b border-gray-200 px-5 py-4 last:border-b-0 lg:items-start lg:gap-6 ${ROW}`}>
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-bold">{a.title}{a.isRequired && <span> (required)</span>}</h3>
          <p className="text-xs text-gray-500">{a.wording}</p>
        </div>
        <div className="w-fit max-w-full space-y-1.5">
          <div className="max-w-full overflow-x-auto pb-1">
            <RatingScale label={a.title} min={a.ratingMin} max={a.ratingMax} value={draft.answers[a.questionId]?.rating ?? null} onChange={rating => answer(a.questionId, { rating })} />
          </div>
          {(a.minLabel || a.maxLabel) && <p className="flex justify-between gap-4 text-xs text-gray-500">
            <span>{a.minLabel && `${a.ratingMin} ${a.minLabel}`}</span><span>{a.maxLabel && `${a.ratingMax} ${a.maxLabel}`}</span>
          </p>}
        </div>
        <TextArea aria-label={`Comment on ${a.title}`} placeholder="Add a comment" maxLength={4000} value={draft.answers[a.questionId]?.comment ?? ''} onChange={e => answer(a.questionId, { comment: e.target.value })} />
      </div>)}
    </Card>}
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <label className="text-sm font-bold" htmlFor="other-comments">Any other comments</label>
        <span className="text-xs text-gray-500">Always the last item on every form</span>
      </div>
      <TextArea id="other-comments" maxLength={4000} value={draft.otherComments} onChange={e => updateDraft({ ...draft, otherComments: e.target.value })} />
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 space-y-1 text-sm text-gray-700">
        {message && <p role="status">{message}</p>}
        {savedAt && <p className="text-xs text-gray-500">Draft saved {savedAt}</p>}
        {dirty && <p role="status">Unsaved changes on this page.</p>}
      </div>
      <Button variant="secondary" onClick={() => {
        rememberDraft(user, o, draft);
        const ok = saveDraft(user, o, draft);
        setMessage(ok ? 'Draft saved on this device only. Not submitted or signed.' : 'Draft could not be saved on this device. Edits remain only while this page stays open.');
        if (ok) { setDirty(false); setSavedAt(formatClock(nowMs())); }
      }}>Save draft on this device</Button>
      <Link to={`/faculty/observe/${o.observationId}/sign`} className={linkClass}>Go to signatures</Link>
    </div>
  </div>;
}

export function ObservationFormPage() {
  const { profile, record } = useObservationRecord();
  if (profile.error) return <PageError error={profile.error} />;
  if (record.error) return <PageError error={record.error} />;
  if (!profile.data || !record.data) return <p role="status" className="pt-8">Loading observation form…</p>;
  const o = record.data;
  if (o.observer.netid !== profile.data.netid) return <p role="alert" className="pt-8">Only the assigned observer can edit this form.</p>;
  if (isLocked(o) || o.status === 'not_completed') return <p role="alert" className="pt-8">This observation is locked or did not happen. The form cannot be edited.</p>;
  if (!o.templateVersion || !Array.isArray(o.answers)) return <p role="alert" className="pt-8">The assigned observation form is unavailable.</p>;
  return <Editor key={`${profile.data.netid}:${o.observationId}:${o.templateVersion.versionId}`} o={o} user={profile.data.netid} />;
}
