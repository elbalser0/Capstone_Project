import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../api/client';
import { useSignObservation } from '../../api/hooks/faculty';
import { Button, Card, Checkbox, ErrorNote, LockNote, PageError, RatingScale, Tag, linkClass } from '../../components/ui';
import { useActiveNav } from '../../components/AppShell';
import { CheckIcon, ClockIcon, PenIcon } from '../../components/icons';
import { isLocked } from '../../lib/format';
import type { PersonRef } from '../../api/types';
import { recordStatus, signedOn, whenLong } from './observationDisplay';
import { useObservationRecord } from './useObservationRecord';

function Party({ role, person, date, you, action }: { role: string; person: PersonRef; date: string | null; you: boolean; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 shrink-0 ${date ? 'text-green-800' : 'text-gray-500'}`} aria-hidden>{date ? <CheckIcon /> : <ClockIcon />}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-bold">{role}: {person.displayName}{you && ' (you)'}</p>
        <p className="text-xs text-gray-500">{signedOn(date)}</p>
        {date && <Tag tone="signed">Signed</Tag>}
      </div>
      {action}
    </div>
  );
}

export function ObservationRecordPage() {
  const { profile, record } = useObservationRecord();
  const sign = useSignObservation();
  const [staleRefresh, setStaleRefresh] = useState<'reloaded' | 'failed' | null>(null);
  const [staleReviewed, setStaleReviewed] = useState(false);
  const [signedNow, setSignedNow] = useState(false);
  const viewer = profile.data?.netid;
  const o = record.data;
  const observer = Boolean(o && o.observer.netid === viewer);
  const observee = Boolean(o && o.observee.netid === viewer);
  // The sidebar item that led here: assignments for the observer, My evaluation for the observee, neither for others.
  useActiveNav(viewer && o ? (observer ? '/faculty/assignments' : observee ? '/faculty/evaluation' : '') : null);
  if (profile.error) return <PageError error={profile.error} />;
  if (record.error && (!record.data || staleRefresh !== 'failed')) return <PageError error={record.error} />;
  if (!profile.data || !o) return <p role="status" className="pt-8">Loading observation record…</p>;
  const status = recordStatus(o, profile.data.netid);
  const hasForm = Boolean(o.templateVersion) && Array.isArray(o.answers);
  const canObserveeSign = observee && o.status === 'scheduled' && Boolean(o.observerSignedDate) && !o.observeeSignedDate && staleRefresh !== 'failed';
  const refreshLatest = async () => {
    setStaleReviewed(false);
    const result = await record.refetch();
    setStaleRefresh(result.error ? 'failed' : 'reloaded');
  };
  const signAsObservee = () => {
    setStaleRefresh(null);
    setSignedNow(false);
    sign.mutate({ observationId: o.observationId, lastSavedDate: o.lastSavedDate }, {
      onSuccess: () => setSignedNow(true),
      onError: async (error) => {
        if (error instanceof ApiError && error.code === 'STALE_FORM') await refreshLatest();
      },
    });
  };
  return (
    <div className="min-w-0 space-y-5 pt-8 text-gray-900 [overflow-wrap:anywhere]">
      <Link to={observer ? '/faculty/assignments' : '/faculty/evaluation'} className={linkClass}>Back to {observer ? 'assignments' : 'evaluation'}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-bold">{o.section.label} {o.section.title}, {whenLong(o)}</h2>
          <p className="text-sm text-gray-500">Observation Template v{o.templateVersion?.versionNo ?? 'unavailable'}, observer {o.observer.displayName}</p>
        </div>
        <div className="min-w-0 max-w-full [&>span]:h-auto [&>span]:whitespace-normal [&>span]:py-1"><Tag tone={status.tone}>{status.text}</Tag></div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        {!hasForm ? <p role="alert">The assigned observation form is unavailable.</p> : (
          <Card className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
              <h3 className="font-bold">Ratings and comments</h3>
              <Tag tone="neutral">Read only</Tag>
            </div>
            {o.answers.length === 0 && <p className="px-5 py-4 text-sm">No questions in this observation form.</p>}
            {o.answers.map(a => <section key={a.questionId} className="grid gap-2 border-b border-gray-200 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
              <div className="min-w-0 space-y-1">
                <h4 className="text-sm font-bold">{a.title}</h4>
                <p className="text-xs text-gray-500">{a.wording}</p>
                <p className="whitespace-pre-line text-sm text-gray-700">{a.comment || 'No comment'}</p>
              </div>
              <div className="max-w-full overflow-x-auto sm:max-w-[16rem]"><RatingScale label={a.title} min={a.ratingMin} max={a.ratingMax} value={a.rating} /></div>
            </section>)}
            <section className="space-y-1 px-5 py-4">
              <h4 className="text-sm font-bold">Any other comments</h4>
              <p className="whitespace-pre-line text-sm text-gray-700">{o.otherComments || 'None'}</p>
              {o.reasonNotCompleted && <p className="pt-2 text-sm">Reason not completed: {o.reasonNotCompleted}</p>}
            </section>
          </Card>
        )}
        <Card className="min-w-0 space-y-4 p-5">
          <h3 className="font-bold">Signatures</h3>
          <Party role="Observer" person={o.observer} date={o.observerSignedDate} you={observer} />
          <Party role="Observee" person={o.observee} date={o.observeeSignedDate} you={observee} action={canObserveeSign && (
            <Button size="compact" disabled={sign.isPending || staleRefresh === 'reloaded' && !staleReviewed} onClick={signAsObservee}>Sign</Button>
          )} />
          <div className="space-y-2">
            {sign.isPending && <p role="status">Recording your signature…</p>}
            {signedNow && <p role="status">You signed the observation. This record is now complete and locked.</p>}
            {staleRefresh === 'reloaded' && (
              <div className="space-y-2">
                <p role="status">The saved form changed after you opened it. The latest record has been reloaded; review the updated responses before signing.</p>
                <label className="flex cursor-pointer items-start gap-3 text-sm">
                  <Checkbox checked={staleReviewed} onChange={(event) => setStaleReviewed(event.target.checked)} />
                  <span>I reviewed the updated responses before signing.</span>
                </label>
              </div>
            )}
            {staleRefresh === 'failed' && (
              <div className="space-y-2">
                <p role="alert">Could not reload the latest record, so your signature was not recorded. Retry before signing.</p>
                <Button size="compact" disabled={record.isFetching} onClick={() => void refreshLatest()}>Retry loading latest record</Button>
              </div>
            )}
            <ErrorNote error={sign.error instanceof ApiError && sign.error.code === 'STALE_FORM' ? null : sign.error} />
            <LockNote>{isLocked(o) ? 'Signed and locked. Nobody can change this record.' : 'Once both of you sign, nobody can change this record.'}</LockNote>
          </div>
        </Card>
      </div>
      {observer && hasForm && !isLocked(o) && o.status !== 'not_completed' && (
        <Link to={`/faculty/observe/${o.observationId}/form`} className={linkClass}><PenIcon /> Edit local draft</Link>
      )}
      {!observer && !observee && <p>Read-only record.</p>}
    </div>
  );
}
