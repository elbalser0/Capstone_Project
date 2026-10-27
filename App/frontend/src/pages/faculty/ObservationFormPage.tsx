import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useSubmitSignedForm } from '../../api/hooks/faculty';
import { CheckIcon, ClockIcon, PenIcon } from '../../components/icons';
import { Banner, Button, Card, Checkbox, Detail, ErrorNote, LockNote, LockedTag, PageError, RatingScale, Tag, TextArea, inputClass, labelClass, linkClass } from '../../components/ui';
import { nowMs } from '../../lib/clock';
import { classStart, formatClock, formatDayYear, formatShort, formatSlot, formatTime, isLocked } from '../../lib/format';
import { readDraft, sameAsServer, serverDraft, storedDraft, writeDraft, type Draft } from './observationDraft';
import { useObservationRecord } from './useObservationRecord';

// R3 fill in the form and R4 sign and submit. The observer's ratings stay a draft until they
// sign; signing sends the form (POST signed-form), which is the observer's signature. The
// observer can change and re-sign it until the observee signs, which locks the record.

// ---------- R3 ----------

export function ObservationFormPage() {
  const navigate = useNavigate();
  const { observation, record, isObserver, me } = useObservationRecord();
  const [edits, setEdits] = useState<Draft | null>(null);
  // False when the browser refused to store the draft; it is then kept only until a reload.
  const [storedOnDevice, setStoredOnDevice] = useState(true);

  const error = observation.error ?? me.error;
  if (error) return <PageError error={error} />;
  // Wait for both: until me loads, isObserver is false and would redirect away.
  if (!record || !me.data) return <p role="status" className="pt-8 text-sm text-gray-500">Loading observation…</p>;
  if (!isObserver || isLocked(record) || record.status === 'not_completed') return <Navigate to={`/faculty/observe/${record.observationId}`} replace />;

  const draft = edits ?? readDraft(record);
  const setAnswer = (questionId: string, patch: Partial<Draft['answers'][string]>) =>
    setEdits({ ...draft, answers: { ...draft.answers, [questionId]: { ...(draft.answers[questionId] ?? { rating: null, comment: '' }), ...patch } } });
  // Only a change is kept as a draft, so an unchanged signed form is not signed again.
  const save = () => {
    if (sameAsServer(draft, record)) {
      writeDraft(record.observationId, null);
      setEdits({ ...draft, savedAt: null });
      setStoredOnDevice(true);
      return;
    }
    const kept = { ...draft, savedAt: nowMs() };
    setStoredOnDevice(writeDraft(record.observationId, kept));
    setEdits(kept);
  };
  const first = record.answers[0];
  const time = classStart(record.section, record.scheduledDate);

  return (
    <div className="flex flex-col pt-8">
      <h2 className="text-lg leading-[22px] font-bold text-gray-900">
        Observation: {record.observee.displayName}, {record.section.label}, {time ? formatSlot(record.scheduledDate, time) : formatDayYear(record.scheduledDate)}
      </h2>
      <div className="mt-3">
        <Banner tone="info">
          This is your copy of Observation Template v{record.templateVersion.versionNo}. Questions and rating ranges are set by the Assessment Committee.
        </Banner>
      </div>

      <div role="table" aria-label="Observation form" className="mt-6 overflow-hidden rounded-lg border border-gray-200">
        <div role="row" className="grid h-10 grid-cols-[312px_264px_1fr] items-center bg-gray-50 px-6 text-xs font-bold text-gray-500">
          <span role="columnheader">Question</span>
          <span role="columnheader">{first ? `Rating (${first.ratingMin} to ${first.ratingMax})` : 'Rating'}</span>
          <span role="columnheader">Comment</span>
        </div>
        <div role="rowgroup" className="divide-y divide-gray-200 border-t border-gray-200">
          {record.answers.map((a) => {
            const value = draft.answers[a.questionId] ?? { rating: null, comment: '' };
            return (
              <div role="row" key={a.questionId} className="grid grid-cols-[312px_264px_1fr] items-start px-6 py-4">
                <div role="cell" className="pt-1 pr-4">
                  <p className="text-sm font-bold text-gray-900">{a.title}</p>
                  <p className="mt-[5px] text-xs text-gray-500">{a.wording}</p>
                </div>
                <div role="cell">
                  <RatingScale size={36} min={a.ratingMin} max={a.ratingMax} value={value.rating} label={a.title} onChange={(rating) => setAnswer(a.questionId, { rating })} />
                  <div className="mt-2.5 flex w-[212px] justify-between text-xs text-gray-500" aria-hidden>
                    <span>{a.ratingMin} {a.minLabel ?? ''}</span>
                    <span>{a.ratingMax} {a.maxLabel ?? ''}</span>
                  </div>
                </div>
                <div role="cell">
                  <TextArea
                    aria-label={`Comment on ${a.title}`}
                    className="h-[60px]"
                    placeholder="Add a comment"
                    value={value.comment}
                    onChange={(e) => setAnswer(a.questionId, { comment: e.target.value })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-5">
        <label htmlFor="other-comments" className="flex items-baseline gap-3.5">
          <span className="text-sm font-bold text-gray-900">Any other comments</span>
          <span className="text-xs text-gray-500">Always the last item on every form</span>
        </label>
        <TextArea id="other-comments" className="mt-[7px] h-12" value={draft.otherComments} onChange={(e) => setEdits({ ...draft, otherComments: e.target.value })} />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs text-gray-500" role="status">
          {draft.savedAt && storedOnDevice && (
            <>
              <CheckIcon width={10} height={8} /> Draft saved on this device at {formatClock(draft.savedAt)}
            </>
          )}
          {draft.savedAt && !storedOnDevice && 'This browser did not let the draft be saved. It is kept until you reload the page.'}
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" className="w-[72px]" onClick={save}>Save</Button>
          <Button
            onClick={() => {
              save();
              navigate(`/faculty/observe/${record.observationId}/sign`);
            }}
          >
            Go to signatures
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------- R4 ----------

const normalize = (name: string) => name.toLowerCase().replace(/^dr\.?\s+/, '').replace(/\s+/g, ' ').trim();

export function SignPage() {
  const { observation, record, isObserver, me } = useObservationRecord();
  const submit = useSubmitSignedForm();
  const [confirmed, setConfirmed] = useState(false);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const error = observation.error ?? me.error;
  if (error) return <PageError error={error} />;
  if (!record || !me.data) return <p role="status" className="pt-8 text-sm text-gray-500">Loading observation…</p>;
  if (!isObserver || record.status === 'not_completed') return <Navigate to={`/faculty/observe/${record.observationId}`} replace />;

  const time = classStart(record.section, record.scheduledDate);
  const locked = isLocked(record);
  // Signed already and the draft holds nothing new: nothing to send. A changed draft can be signed again until the observee signs.
  const unsent = storedDraft(record.observationId);
  const upToDate = Boolean(record.observerSignedDate) && (unsent === null || sameAsServer(unsent, record));
  const canSign = !locked && !record.observeeSignedDate && !upToDate;
  // Once signed (or locked), show what was signed, never a leftover draft.
  const draft = canSign ? readDraft(record) : serverDraft(record);
  const fullName = `${me.data.firstName} ${me.data.lastName}`;

  const signNow = () => {
    if (normalize(typed) !== normalize(fullName)) {
      setProblem(`Type your full name as it appears on your account: ${fullName}.`);
      return;
    }
    setProblem(null);
    const answers = record.answers.flatMap((a) => {
      const value = draft.answers[a.questionId];
      return value && value.rating !== null ? [{ questionId: a.questionId, rating: value.rating, comment: value.comment }] : [];
    });
    submit.mutate(
      { observationId: record.observationId, answers, otherComments: draft.otherComments },
      {
        onSuccess: () => {
          writeDraft(record.observationId, null);
          setConfirmed(false);
          setTyped('');
        },
      },
    );
  };

  return (
    <div className="grid grid-cols-[620px_344px] items-start gap-8 pt-8">
      <Card className="px-6 pt-5 pb-6">
        <h2 className="text-base font-bold text-gray-900">Observer signature</h2>
        <label className="mt-4 flex cursor-pointer items-center gap-3 text-sm text-gray-900">
          <Checkbox checked={confirmed || !canSign} disabled={!canSign} onChange={(e) => setConfirmed(e.target.checked)} />
          I confirm this observation took place on {formatDayYear(record.scheduledDate)}{time && ` at ${formatTime(time)}`}
        </label>
        <label htmlFor="typed-name" className={`mt-6 ${labelClass}`}>Type your full name to sign</label>
        <input
          id="typed-name"
          className={`${inputClass} w-[360px]`}
          value={canSign ? typed : fullName}
          disabled={!canSign}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="name"
        />
        <p className="mt-2 text-xs text-gray-500">Your typed name counts as your signature.</p>
        <ErrorNote error={problem ? new Error(problem) : submit.error} className="mt-3" />
        {canSign && (
          <Button className="mt-[13px] w-44" disabled={!confirmed || !typed.trim() || submit.isPending} onClick={signNow}>
            <PenIcon width={12} height={12} /> Sign as observer
          </Button>
        )}

        <div className="mt-6 border-t border-gray-200 pt-[18px]">
          <h3 className="text-sm font-bold text-gray-900">Signature status</h3>
          <dl className="mt-[11px] flex flex-col gap-3.5">
            {([
              ['Observer signature', record.observerSignedDate, false],
              ['Observee signature', record.observeeSignedDate, true],
            ] as const).map(([label, date, other]) => (
              <div key={label} className="grid grid-cols-[180px_auto] items-center">
                <dt className="text-sm text-gray-700">{label}</dt>
                <dd>
                  {date ? (
                    <Tag tone="signed">Signed {formatShort(date)}</Tag>
                  ) : other ? (
                    <Tag tone="due" icon={<ClockIcon width={11} height={11} />}>Waiting</Tag>
                  ) : (
                    <Tag tone="neutral">Not signed yet</Tag>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {locked && (
            <div className="mt-6 flex items-center gap-4">
              <LockedTag />
              <Link to={`/faculty/observe/${record.observationId}`} className={linkClass}>View the record</Link>
            </div>
          )}
        </div>
        <LockNote className="mt-4">After both signatures the record is locked for everyone.</LockNote>
      </Card>

      <Card className="px-6 pt-5 pb-6">
        <h2 className="text-base font-bold text-gray-900">Summary</h2>
        <dl className="mt-[17px] flex flex-col gap-[13px]">
          <Detail label="Observee">{record.observee.displayName}</Detail>
          <Detail label="Course">{record.section.label}</Detail>
          <Detail label="Date">{formatDayYear(record.scheduledDate)}{time && `, ${formatTime(time)}`}</Detail>
          <Detail label="Template">Observation Template v{record.templateVersion.versionNo}</Detail>
        </dl>
        <div className="mt-4 border-t border-gray-200 pt-4">
          <p className="text-xs text-gray-500">Ratings</p>
          <ul className="mt-[7px] flex flex-col gap-[11px]">
            {record.answers.map((a) => {
              const rating = draft.answers[a.questionId]?.rating ?? null;
              return (
                <li key={a.questionId} className="flex justify-between text-sm text-gray-900">
                  <span>{a.title}</span>
                  <span className="font-bold">{rating !== null ? `${rating} of ${a.ratingMax}` : 'Not rated'}</span>
                </li>
              );
            })}
          </ul>
          {!locked && (
            <Link to={`/faculty/observe/${record.observationId}/form`} className={`${linkClass} mt-[27px]`}>
              <PenIcon width={12} height={12} className="text-gray-600" /> Edit the form
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}
