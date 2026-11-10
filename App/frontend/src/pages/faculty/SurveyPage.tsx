import { useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { useMyObservations, useSubmitSurvey } from '../../api/hooks/faculty';
import { useCurrentCycle } from '../../api/hooks/shared';
import type { Cycle, SurveyInput } from '../../api/types';
import { Button, Card, ErrorNote, LockedTag, Tag } from '../../components/ui';
import { formatDate, formatRange, isLocked } from '../../lib/format';
import { recordStatus, whenShort } from './observationDisplay';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const TIMING_NOTE = 'The survey opens after the observation deadline. It does not wait for signatures.';

/** "Survey closes" and, when the data exists, the professor's own observation as observee for this term (the history call is observee-only). */
function SurveySummary({ cycle }: { cycle: Cycle }) {
  const observations = useMyObservations();
  const mine = observations.data?.find((o) => o.term.termId === cycle.term.termId);
  return (
    <Card className="self-start px-6 py-5">
      <p className="text-xs text-gray-500">Survey closes</p>
      <p className="mt-1 text-base font-bold text-gray-900">{formatDate(cycle.feedbackDeadline)}</p>
      {mine && (
        <div className="mt-4 border-t border-gray-200 pt-4">
          <p className="text-xs text-gray-500">Your observation</p>
          <div className="mt-2">
            {isLocked(mine) ? <LockedTag /> : <Tag tone={recordStatus(mine, mine.observee.netid).tone}>{recordStatus(mine, mine.observee.netid).text}</Tag>}
          </div>
          <p className="mt-2.5 text-sm text-gray-900">{mine.section.label}, {whenShort(mine)}</p>
          <p className="mt-1 text-sm text-gray-500">Observer: {mine.observer.displayName}</p>
        </div>
      )}
    </Card>
  );
}

function SurveyForm({ cycleId }: { cycleId: string }) {
  const submit = useSubmitSurvey(cycleId);
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<SurveyInput['respondentRole'] | ''>('');
  const [processOk, setProcessOk] = useState<boolean | null>(null);
  const [difficulties, setDifficulties] = useState('');
  const [additionalFeedback, setAdditionalFeedback] = useState('');
  const [file, setFile] = useState<File | undefined>();
  const [fileError, setFileError] = useState('');
  const [successRole, setSuccessRole] = useState<SurveyInput['respondentRole'] | null>(null);
  const [submittedRoles, setSubmittedRoles] = useState<SurveyInput['respondentRole'][]>([]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || submit.isPending || !role || processOk === null || fileError || submittedRoles.includes(role)) return;
    busy.current = true;
    try {
      await submit.mutateAsync({ respondentRole: role, processOk, difficulties, additionalFeedback, troubleFile: file });
      setSubmittedRoles((roles) => [...roles, role]);
      setSuccessRole(role);
      setRole('');
      setProcessOk(null);
      setDifficulties('');
      setAdditionalFeedback('');
      setFile(undefined);
      if (fileInput.current) fileInput.current.value = '';
    } catch { /* Mutation error is shown below; keep the draft intact. */ }
    finally { busy.current = false; }
  };

  const error = submit.error;
  const message = error instanceof ApiError && error.code === 'SURVEY_CLOSED'
    ? `The survey is closed. ${error.message}`
    : error instanceof ApiError && error.code === 'NOT_A_PARTICIPANT'
      ? `You cannot submit as ${role || 'this role'}: ${error.message}`
      : error instanceof ApiError && error.code === 'ALREADY_SUBMITTED'
        ? `Already submitted for ${role || 'this role'}. ${error.message}`
        : error instanceof ApiError && (error.code === 'FILE_TOO_LARGE' || error.code === 'TOO_LARGE')
          ? `The attachment could not be uploaded: ${error.message}`
          : error?.message;

  return (
    <Card className="min-w-0 px-6 py-6">
      <h2 className="text-lg font-bold">End-of-process survey</h2>
      <p className="mt-2 text-sm text-gray-600">One response per role. If you participated in both roles, submit each separately.</p>
      {successRole && <p role="status" className="mt-4 rounded-md bg-green-100 px-4 py-3 text-sm text-green-900">Your {successRole} response was submitted.</p>}
      {message && <ErrorNote error={new Error(message)} className="mt-4" />}
      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-5">
        <fieldset disabled={submit.isPending} className="contents">
        <fieldset>
          <legend className="text-sm font-bold">Your role in this cycle *</legend>
          {(['observer', 'observee'] as const).map((value) => (
            <label key={value} className="mt-2 mr-5 inline-flex items-center gap-2 text-sm capitalize">
              <input type="radio" name="respondentRole" value={value} required checked={role === value} disabled={submittedRoles.includes(value)} onChange={() => { setRole(value); submit.reset(); }} />{value}{submittedRoles.includes(value) ? ' (submitted)' : ''}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend className="text-sm font-bold">1. Did the observation process go well? *</legend>
          {([['yes', true], ['no', false]] as const).map(([label, value]) => (
            <label key={label} className="mt-2 mr-5 inline-flex items-center gap-2 text-sm capitalize">
              <input type="radio" name="processOk" value={label} required checked={processOk === value} onChange={() => setProcessOk(value)} />{label}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-2 text-sm font-bold">2. Difficulties (optional)
          <textarea className="min-h-24 rounded-md border border-gray-300 p-3 font-normal" maxLength={5000} value={difficulties} onChange={(e) => setDifficulties(e.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-sm font-bold">3. Additional feedback (optional)
          <textarea className="min-h-24 rounded-md border border-gray-300 p-3 font-normal" maxLength={5000} value={additionalFeedback} onChange={(e) => setAdditionalFeedback(e.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-sm font-bold">Trouble file (optional, up to 10 MiB)
          <input ref={fileInput} type="file" className="font-normal" onChange={(e) => {
            const next = e.target.files?.[0];
            if (next && next.size > MAX_FILE_BYTES) { setFileError('Files must be 10 MiB or smaller.'); setFile(undefined); }
            else { setFileError(''); setFile(next); }
          }} />
        </label>
        {fileError && <p role="alert" className="text-sm text-red-800">{fileError}</p>}
        </fieldset>
        <Button className="self-start" type="submit" disabled={submit.isPending || Boolean(fileError) || !role || processOk === null || submittedRoles.includes(role as SurveyInput['respondentRole'])}>
          {submit.isPending ? 'Submitting…' : 'Submit survey'}
        </Button>
      </form>
    </Card>
  );
}

export function SurveyPage() {
  const cycle = useCurrentCycle();
  return <div className="pt-8">
    {cycle.isPending && <p role="status">Loading current cycle…</p>}
    {cycle.error && <><ErrorNote error={cycle.error} /><Button variant="secondary" className="mt-3" onClick={() => void cycle.refetch()}>Try again</Button></>}
    {cycle.data === null && <p>No current cycle is available.</p>}
    {cycle.data && <>
      <p className="text-sm text-gray-900">Tell the Assessment Committee how the {cycle.data.term.label} process went.</p>
      <p className="mt-1 text-sm text-gray-600">{cycle.data.term.label} · Survey window: {formatRange(cycle.data.surveyOpensDate, cycle.data.feedbackDeadline)}</p>
      <p className="mt-1 text-sm text-gray-600">{TIMING_NOTE}</p>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,720px)_minmax(0,20.5rem)] lg:items-start">
        {cycle.data.phase === 'feedback' ? <SurveyForm key={cycle.data.cycleId} cycleId={cycle.data.cycleId} /> :
          <p className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm">The survey is not open. It is available from {formatDate(cycle.data.surveyOpensDate)} through {formatDate(cycle.data.feedbackDeadline)}.</p>}
        <SurveySummary cycle={cycle.data} />
      </div>
    </>}
  </div>;
}
