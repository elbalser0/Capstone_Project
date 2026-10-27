import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useObservation, useSubmitSignedForm } from '../../api/hooks/faculty';
import { useMe } from '../../api/hooks/shared';
import type { ObservationDetail } from '../../api/types';
import { CheckIcon, ClockIcon, PenIcon } from '../../components/icons';
import { Banner, Button, Card, Checkbox, Detail, ErrorNote, LockNote, LockedTag, PageError, RatingScale, Tag, TextArea, inputClass, labelClass, linkClass } from '../../components/ui';
import { nowMs } from '../../lib/clock';
import { classStart, formatClock, formatDayYear, formatShort, formatSlot, formatTime, isLocked } from '../../lib/format';

// R3 fill in the form and R4 sign and submit. The observer's ratings stay a draft on this
// device until they sign; signing sends the form (POST signed-form), which is the
// observer's signature. The observer can change and re-sign it until the observee signs,
// which locks the record.

interface Draft {
  answers: Record<string, { rating: number | null; comment: string }>;
  otherComments: string;
  savedAt: number | null;
}

const draftKey = (id: string) => `assessment-helper.observation-draft.${id}`;

function storedDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    // Storage can be blocked; fall back to what the server has.
    return null;
  }
}

/** What the server has: the last signed form, or an empty one. */
function serverDraft(o: ObservationDetail): Draft {
  return {
    answers: Object.fromEntries(o.answers.map((a) => [a.questionId, { rating: a.rating, comment: a.comment }])),
    otherComments: o.otherComments,
    savedAt: null,
  };
}

const readDraft = (o: ObservationDetail) => storedDraft(o.observationId) ?? serverDraft(o);

/** True when the draft holds nothing the server does not already have. */
function sameAsServer(d: Draft, o: ObservationDetail) {
  const server = serverDraft(o);
  return d.otherComments === server.otherComments && o.answers.every((a) => {
    const v = d.answers[a.questionId] ?? { rating: null, comment: '' };
    return v.rating === a.rating && v.comment === a.comment;
  });
}

function writeDraft(id: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(draftKey(id), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(id));
  } catch {
    // Not saved on this device; the form still submits.
  }
}

export function useObserverRecord() {
  const { observationId } = useParams();
  const me = useMe();
  const observation = useObservation(observationId);
  const o = observation.data;
  const isObserver = Boolean(o && me.data && o.observer.netid === me.data.netid);
  return { observation, o, isObserver, me };
}

// ---------- R3 ----------

export function ObservationFormPage() {
  const navigate = useNavigate();
  const { observation, o, isObserver, me } = useObserverRecord();
  const [draft, setDraft] = useState<Draft | null>(null);

  const error = observation.error ?? me.error;
  if (error) return <PageError error={error} />;
  // Wait for both: until me loads, isObserver is false and would redirect away.
  if (!o || !me.data) return <p role="status" className="pt-8 text-sm text-gray-500">Loading observation…</p>;
  if (!isObserver || isLocked(o) || o.status === 'not_completed') return <Navigate to={`/faculty/observe/${o.observationId}`} replace />;

  const d = draft ?? readDraft(o);
  const setAnswer = (id: string, patch: Partial<Draft['answers'][string]>) =>
    setDraft({ ...d, answers: { ...d.answers, [id]: { ...(d.answers[id] ?? { rating: null, comment: '' }), ...patch } } });
  // Only a change is kept as a draft, so an unchanged signed form is not signed again.
  const save = () => {
    const saved = sameAsServer(d, o) ? { ...d, savedAt: null } : { ...d, savedAt: nowMs() };
    writeDraft(o.observationId, saved.savedAt ? saved : null);
    setDraft(saved);
  };
  const first = o.answers[0];
  const time = classStart(o.section, o.scheduledDate);

  return (
    <div className="flex flex-col pt-8">
      <h2 className="text-lg leading-[22px] font-bold text-gray-900">
        Observation: {o.observee.displayName}, {o.section.label}, {time ? formatSlot(o.scheduledDate, time) : formatDayYear(o.scheduledDate)}
      </h2>
      <div className="mt-3">
        <Banner tone="info">
          This is your copy of Observation Template v{o.templateVersion.versionNo}. Questions and rating ranges are set by the Assessment Committee.
        </Banner>
      </div>

      <div role="table" aria-label="Observation form" className="mt-6 overflow-hidden rounded-lg border border-gray-200">
        <div role="row" className="grid h-10 grid-cols-[312px_264px_1fr] items-center bg-gray-50 px-6 text-xs font-bold text-gray-500">
          <span role="columnheader">Question</span>
          <span role="columnheader">{first ? `Rating (${first.ratingMin} to ${first.ratingMax})` : 'Rating'}</span>
          <span role="columnheader">Comment</span>
        </div>
        <div role="rowgroup" className="divide-y divide-gray-200 border-t border-gray-200">
          {o.answers.map((a) => {
            const value = d.answers[a.questionId] ?? { rating: null, comment: '' };
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
        <TextArea id="other-comments" className="mt-[7px] h-12" value={d.otherComments} onChange={(e) => setDraft({ ...d, otherComments: e.target.value })} />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs text-gray-500">
          {d.savedAt && (
            <>
              <CheckIcon width={10} height={8} /> Draft saved on this device at {formatClock(d.savedAt)}
            </>
          )}
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" className="w-[72px]" onClick={save}>Save</Button>
          <Button
            onClick={() => {
              save();
              navigate(`/faculty/observe/${o.observationId}/sign`);
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
  const { observation, o, isObserver, me } = useObserverRecord();
  const submit = useSubmitSignedForm();
  const [confirmed, setConfirmed] = useState(false);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const error = observation.error ?? me.error;
  if (error) return <PageError error={error} />;
  if (!o || !me.data) return <p role="status" className="pt-8 text-sm text-gray-500">Loading observation…</p>;
  if (!isObserver || o.status === 'not_completed') return <Navigate to={`/faculty/observe/${o.observationId}`} replace />;

  const time = classStart(o.section, o.scheduledDate);
  const locked = isLocked(o);
  // Signed already and nothing changed since: nothing to send. An edited draft can be signed again until the observee signs.
  const upToDate = Boolean(o.observerSignedDate) && !storedDraft(o.observationId);
  const canSign = !locked && !o.observeeSignedDate && !upToDate;
  // Once signed (or locked), show what was signed, never a leftover draft.
  const d = canSign ? readDraft(o) : serverDraft(o);
  const fullName = `${me.data.firstName} ${me.data.lastName}`;

  const signNow = () => {
    if (normalize(typed) !== normalize(fullName)) {
      setProblem(`Type your full name as it appears on your account: ${fullName}.`);
      return;
    }
    setProblem(null);
    const answers = o.answers.flatMap((a) => {
      const v = d.answers[a.questionId];
      return v && v.rating !== null ? [{ questionId: a.questionId, rating: v.rating, comment: v.comment }] : [];
    });
    submit.mutate(
      { observationId: o.observationId, answers, otherComments: d.otherComments },
      {
        onSuccess: () => {
          writeDraft(o.observationId, null);
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
          I confirm this observation took place on {formatDayYear(o.scheduledDate)}{time && ` at ${formatTime(time)}`}
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
              ['Observer signature', o.observerSignedDate, false],
              ['Observee signature', o.observeeSignedDate, true],
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
              <Link to={`/faculty/observe/${o.observationId}`} className={linkClass}>View the record</Link>
            </div>
          )}
        </div>
        <LockNote className="mt-4">After both signatures the record is locked for everyone.</LockNote>
      </Card>

      <Card className="px-6 pt-5 pb-6">
        <h2 className="text-base font-bold text-gray-900">Summary</h2>
        <dl className="mt-[17px] flex flex-col gap-[13px]">
          <Detail label="Observee">{o.observee.displayName}</Detail>
          <Detail label="Course">{o.section.label}</Detail>
          <Detail label="Date">{formatDayYear(o.scheduledDate)}{time && `, ${formatTime(time)}`}</Detail>
          <Detail label="Template">Observation Template v{o.templateVersion.versionNo}</Detail>
        </dl>
        <div className="mt-4 border-t border-gray-200 pt-4">
          <p className="text-xs text-gray-500">Ratings</p>
          <ul className="mt-[7px] flex flex-col gap-[11px]">
            {o.answers.map((a) => {
              const rating = d.answers[a.questionId]?.rating ?? null;
              return (
                <li key={a.questionId} className="flex justify-between text-sm text-gray-900">
                  <span>{a.title}</span>
                  <span className="font-bold">{rating !== null ? `${rating} of ${a.ratingMax}` : 'Not rated'}</span>
                </li>
              );
            })}
          </ul>
          {!locked && (
            <Link to={`/faculty/observe/${o.observationId}/form`} className={`${linkClass} mt-[27px]`}>
              <PenIcon width={12} height={12} className="text-gray-600" /> Edit the form
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}
