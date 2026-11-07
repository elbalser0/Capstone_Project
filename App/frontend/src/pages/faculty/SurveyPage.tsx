import { useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { useSubmitSurvey } from '../../api/hooks/faculty';
import { useCurrentCycle } from '../../api/hooks/shared';
import type { SurveyInput } from '../../api/types';
import { Button, Card, ErrorNote } from '../../components/ui';
import { formatDate } from '../../lib/format';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
    <Card className="mt-5 max-w-[720px] px-6 py-6">
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
          <legend className="text-sm font-bold">Did the observation process go well? *</legend>
          {([['yes', true], ['no', false]] as const).map(([label, value]) => (
            <label key={label} className="mt-2 mr-5 inline-flex items-center gap-2 text-sm capitalize">
              <input type="radio" name="processOk" value={label} required checked={processOk === value} onChange={() => setProcessOk(value)} />{label}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-2 text-sm font-bold">Difficulties (optional)
          <textarea className="min-h-24 rounded-md border border-gray-300 p-3 font-normal" maxLength={5000} value={difficulties} onChange={(e) => setDifficulties(e.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-sm font-bold">Additional feedback (optional)
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
      <p className="text-sm text-gray-600">{cycle.data.term.label} · Survey window: {formatDate(cycle.data.surveyOpensDate)}–{formatDate(cycle.data.feedbackDeadline)}</p>
      {cycle.data.phase === 'feedback' ? <SurveyForm key={cycle.data.cycleId} cycleId={cycle.data.cycleId} /> :
        <p className="mt-5 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm">The survey is not open. It is available from {formatDate(cycle.data.surveyOpensDate)} through {formatDate(cycle.data.feedbackDeadline)}.</p>}
    </>}
  </div>;
}
