import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useSubmitSignedForm } from '../../api/hooks/faculty';
import { Button, Card, Checkbox, Detail, ErrorNote, LockNote, PageError, Tag, inputClass, labelClass, linkClass } from '../../components/ui';
import { PenIcon } from '../../components/icons';
import { formatDate, isLocked } from '../../lib/format';
import type { ObservationDetail } from '../../api/types';
import { clearDraft, readDraft, serverDraft, type Draft } from './observationDraft';
import { whenLong, meetingTime } from './observationDisplay';
import { beginSignedFormSubmission, endSignedFormSubmission } from './signedFormSubmission';
import { useObservationRecord } from './useObservationRecord';

function buildSignedFormPayload(o: ObservationDetail, draft: Draft) {
  return {
    answers: o.answers.flatMap((answer) => {
      const value = draft.answers[answer.questionId];
      if (!value || value.rating === null || value.rating === undefined) return [];
      return [{ questionId: answer.questionId, rating: value.rating, comment: value.comment }];
    }),
    otherComments: draft.otherComments,
  };
}

function normalizeName(name: string) {
  return name.toLowerCase().replace(/^dr\.?\s+/, '').replace(/\s+/g, ' ').trim();
}

function FormSummary({ o, draft, alreadySubmitted }: { o: ObservationDetail; draft: Draft; alreadySubmitted: boolean }) {
  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
        <h2 className="font-bold">Review your observation</h2>
        <Tag tone={alreadySubmitted ? 'signed' : o.observerSignedDate ? 'due' : 'neutral'}>
          {alreadySubmitted ? 'Already submitted' : o.observerSignedDate ? 'Revision pending' : 'Not yet submitted'}
        </Tag>
      </div>
      {o.answers.map((answer) => {
        const value = draft.answers[answer.questionId];
        return (
          <section key={answer.questionId} className="grid min-w-0 gap-2 border-b border-gray-200 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-bold">{answer.title}{answer.isRequired && <span> (required)</span>}</h3>
              <p className="text-xs text-gray-500">{answer.wording}</p>
              <p className="whitespace-pre-line text-sm text-gray-700">{value?.comment || 'No comment'}</p>
              {value?.comment && (value.rating === null || value.rating === undefined) && (
                <p className="text-xs text-amber-800">This comment will not be submitted unless you select a rating for {answer.title}.</p>
              )}
            </div>
            <p className="text-sm font-bold">{value?.rating !== null && value?.rating !== undefined ? `${value.rating} of ${answer.ratingMax}` : 'Not rated'}</p>
          </section>
        );
      })}
      <section className="space-y-1 px-5 py-4">
        <h3 className="text-sm font-bold">Any other comments</h3>
        <p className="whitespace-pre-line text-sm text-gray-700">{draft.otherComments || 'None'}</p>
      </section>
    </Card>
  );
}

export function ObservationSignPage() {
  const { profile, record } = useObservationRecord();
  const submit = useSubmitSignedForm();
  const inFlight = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [acknowledgedDraftKey, setAcknowledgedDraftKey] = useState<string | null>(null);
  if (profile.error) return <PageError error={profile.error} />;
  if (record.error) return <PageError error={record.error} />;
  if (!profile.data || !record.data) return <p role="status" className="pt-8">Loading observation review…</p>;

  const o = record.data;
  const user = profile.data.netid;
  if (o.observer.netid !== user) return <p role="alert" className="pt-8">Only the assigned observer can submit this observation.</p>;
  if (!o.templateVersion || !Array.isArray(o.answers) || o.answers.length === 0) return <p role="alert" className="pt-8">The assigned observation form is unavailable.</p>;
  if (isLocked(o) || o.status === 'not_completed') return <p role="alert" className="pt-8">This observation is locked or did not happen. It cannot be submitted.</p>;

  const draftRead = readDraft(user, o);
  const draft = draftRead.draft;
  const draftAcknowledgementKey = `${o.observationId}:${o.lastSavedDate}`;
  const draftAcknowledged = acknowledgedDraftKey === draftAcknowledgementKey;
  const form = buildSignedFormPayload(o, draft);
  const saved = buildSignedFormPayload(o, serverDraft(o));
  const changed = JSON.stringify(form) !== JSON.stringify(saved);
  const alreadySubmitted = Boolean(o.observerSignedDate) && !changed;
  const requiredComplete = o.answers.every((answer) => !answer.isRequired || draft.answers[answer.questionId]?.rating !== null && draft.answers[answer.questionId]?.rating !== undefined);
  const fullName = `${profile.data.firstName} ${profile.data.lastName}`;
  const validName = normalizeName(typedName) === normalizeName(fullName);
  const canSubmit = requiredComplete && (!draftRead.warning || draftAcknowledged) && confirmed && typedName.trim().length > 0 && !submit.isPending && !alreadySubmitted;
  const observationTime = meetingTime(o.section, o.scheduledDate);
  const timeText = observationTime ? ` at ${observationTime}` : '';

  const signNow = () => {
    if (!canSubmit || inFlight.current) return;
    if (!beginSignedFormSubmission(o.observationId)) {
      setProblem('A submission for this observation is already in progress. Wait before trying again.');
      return;
    }
    if (!validName) {
      endSignedFormSubmission(o.observationId);
      setProblem(`Type your full name as it appears on your account: ${fullName}.`);
      return;
    }
    setProblem(null);
    inFlight.current = true;
    setSuccess(false);
    submit.mutate({ observationId: o.observationId, ...form }, {
      onSuccess: () => {
        clearDraft(user, o.observationId);
        setSuccess(true);
      },
      onSettled: () => {
        endSignedFormSubmission(o.observationId);
        inFlight.current = false;
      },
    });
  };

  return (
    <div className="min-w-0 space-y-5 pt-8 text-gray-900 [overflow-wrap:anywhere]">
      <Link to={`/faculty/observe/${o.observationId}/form`} className={linkClass}><PenIcon /> Back to the form</Link>
      <h2 className="text-base font-bold">{o.observee.displayName}, {o.section.label}, {whenLong(o)}</h2>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(17rem,1fr)] lg:items-start">
        <div className="min-w-0 space-y-5">
          <FormSummary o={o} draft={draft} alreadySubmitted={alreadySubmitted} />
          {draftRead.warning && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{draftRead.warning} This review contains only the saved server responses; local draft changes are not included.</p>}
          {alreadySubmitted && <p role="status">This form has already been submitted. Change a response before submitting it again.</p>}
          {o.observerSignedDate && !o.observeeSignedDate && changed && <p role="status">This updates your earlier submission. The observee has not signed yet.</p>}
        </div>
        <div className="min-w-0 space-y-5">
          <Card className="space-y-4 p-5">
            <h2 className="text-base font-bold">Observer signature</h2>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>I confirm this observation took place on {formatDate(o.scheduledDate)}{timeText}.</span>
            </label>
            <p className="text-xs text-gray-500">The server accepts submission on or after the scheduled date.</p>
            {draftRead.warning && (
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <Checkbox checked={draftAcknowledged} onChange={(event) => setAcknowledgedDraftKey(event.target.checked ? draftAcknowledgementKey : null)} />
                <span>I reviewed the saved server responses and understand that local draft changes are not included.</span>
              </label>
            )}
            <div>
              <label htmlFor="typed-name" className={labelClass}>Type your full name to sign</label>
              <input id="typed-name" autoComplete="name" className={`${inputClass} w-full`} value={typedName} onChange={(event) => {
                setTypedName(event.target.value);
                setProblem(null);
              }} />
              <p className="mt-2 text-xs text-gray-500">Your typed name confirms your intent. The saved signature is recorded by the system when you submit.</p>
            </div>
            {!requiredComplete && <p role="status" className="text-sm text-amber-800">Rate every required question before submitting.</p>}
            {submit.isPending && <p role="status">Submitting your signed observation…</p>}
            {success && <p role="status">Observation submitted successfully. Your observer signature is recorded.</p>}
            <ErrorNote error={problem ? new Error(problem) : submit.error} />
            {!alreadySubmitted && (
              <Button onClick={signNow} disabled={!canSubmit}>
                <PenIcon width={12} height={12} /> Sign as observer
              </Button>
            )}
            <LockNote>After the observee signs, the record is locked for everyone.</LockNote>
            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-bold">Signature status</h3>
              <dl className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <dt className="text-sm text-gray-700">Observer signature</dt>
                  <dd>{o.observerSignedDate ? <Tag tone="signed">Signed {formatDate(o.observerSignedDate)}</Tag> : <Tag tone="neutral">Not signed yet</Tag>}</dd>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <dt className="text-sm text-gray-700">Observee signature</dt>
                  <dd>{o.observeeSignedDate ? <Tag tone="signed">Signed {formatDate(o.observeeSignedDate)}</Tag> : <Tag tone="due">{o.observerSignedDate ? 'Waiting for observee' : 'Waiting for observer submission'}</Tag>}</dd>
                </div>
              </dl>
            </div>
          </Card>
          <Card className="space-y-4 p-5">
            <h2 className="font-bold">Summary</h2>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Detail label="Observee">{o.observee.displayName}</Detail>
              <Detail label="Course">{o.section.label}</Detail>
              <Detail label="Date">{formatDate(o.scheduledDate)}{timeText}</Detail>
              <Detail label="Template">Observation Template v{o.templateVersion.versionNo}</Detail>
            </dl>
            <div className="border-t border-gray-200 pt-3">
              <Link to={`/faculty/observe/${o.observationId}/form`} className={linkClass}><PenIcon /> Edit the form</Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
