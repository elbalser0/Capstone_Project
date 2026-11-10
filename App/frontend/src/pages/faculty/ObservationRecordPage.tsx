import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../api/client';
import { useReportMissed, useSignObservation, useUploadObservationFile } from '../../api/hooks/faculty';
import { Button, Card, Checkbox, ErrorNote, LockNote, Modal, PageError, RatingScale, Tag, TextArea, labelClass, linkClass } from '../../components/ui';
import { useActiveNav } from '../../components/AppShell';
import { CheckIcon, ClockIcon, FlagIcon, PenIcon, UploadIcon } from '../../components/icons';
import { formatDayYear, isLocked } from '../../lib/format';
import { isMissingEndpoint } from '../../lib/missingEndpoint';
import type { ObservationDetail, PersonRef } from '../../api/types';
import { OBSERVEE_LOCK_NOTE, observeeWaitsForObserver, recordStatus, signedOn, whenLong } from './observationDisplay';
import { useObservationRecord } from './useObservationRecord';
import './observation-print.css';

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

const MAX_ISSUE_FILE_BYTES = 10 * 1024 * 1024;

function ReportMissedModal({ o, onClose, onStale }: { o: ObservationDetail; onClose: () => void; onStale: () => void }) {
  const report = useReportMissed();
  const [reason, setReason] = useState('');
  const send = () => {
    if (!reason.trim() || report.isPending) return;
    report.mutate({ observationId: o.observationId, reason: reason.trim() }, {
      onSuccess: onClose,
      // 409 means the record changed since it was loaded (for example the observer signed): show the current one.
      onError: (error) => { if (error instanceof ApiError && error.status === 409) onStale(); },
    });
  };
  return (
    <Modal
      title="The observation could not be done"
      subtitle={`${o.section.label}, ${formatDayYear(o.scheduledDate)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!reason.trim() || report.isPending} onClick={send}>{report.isPending ? 'Reporting…' : 'Report'}</Button>
        </>
      }
    >
      <label htmlFor="missed-reason" className={labelClass}>What happened?</label>
      <TextArea id="missed-reason" rows={4} value={reason} onChange={(event) => setReason(event.target.value)} />
      <ErrorNote error={report.error} className="mt-3" />
    </Modal>
  );
}

function UploadLink({ o }: { o: ObservationDetail }) {
  const upload = useUploadObservationFile();
  const input = useRef<HTMLInputElement>(null);
  const [tooBig, setTooBig] = useState(false);
  const missing = isMissingEndpoint(upload.error);
  return (
    <>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="File about the observation"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          setTooBig(false);
          if (!file || upload.isPending) return;
          if (file.size > MAX_ISSUE_FILE_BYTES) { setTooBig(true); upload.reset(); return; }
          upload.mutate({ observationId: o.observationId, file });
        }}
      />
      <button type="button" className={`${linkClass} disabled:text-gray-400 disabled:no-underline`} disabled={upload.isPending} onClick={() => input.current?.click()}>
        <UploadIcon className="text-gray-600" /> Upload a file about the observation
      </button>
      {o.issueFileName && <p role="status" className="mt-2 pl-[21px] text-xs text-gray-500">Uploaded: {o.issueFileName}</p>}
      {tooBig && <p role="alert" className="mt-2 pl-[21px] text-xs text-red-800">Files can be up to 10 MB.</p>}
      {missing && <p role="status" className="mt-2 pl-[21px] text-xs text-gray-700">Uploading a file is not available yet. Nothing was uploaded.</p>}
      {!missing && <ErrorNote error={upload.error} className="mt-2" />}
    </>
  );
}

export function ObservationRecordPage() {
  const { profile, record } = useObservationRecord();
  const sign = useSignObservation();
  const [staleRefresh, setStaleRefresh] = useState<'reloaded' | 'failed' | null>(null);
  const [staleReviewed, setStaleReviewed] = useState(false);
  const [signedNow, setSignedNow] = useState(false);
  const [reporting, setReporting] = useState(false);
  const closeReport = useCallback(() => setReporting(false), []);
  const viewer = profile.data?.netid;
  const o = record.data;
  const observer = Boolean(o && o.observer.netid === viewer);
  const observee = Boolean(o && o.observee.netid === viewer);
  // The sidebar item that led here: assignments for the observer, My evaluation for the observee, neither for others.
  useActiveNav(viewer && o ? (observer ? '/faculty/observe' : observee ? '/faculty/evaluation' : '') : null);
  if (profile.error) return <PageError error={profile.error} />;
  if (record.error && (!record.data || staleRefresh !== 'failed')) return <PageError error={record.error} />;
  if (!profile.data || !o) return <p role="status" className="pt-8">Loading observation record…</p>;
  const status = recordStatus(o, profile.data.netid);
  const hasForm = Boolean(o.templateVersion) && Array.isArray(o.answers);
  const canObserveeSign = observee && o.status === 'scheduled' && Boolean(o.observerSignedDate) && !o.observeeSignedDate && staleRefresh !== 'failed';
  // Same rule as the backend's reportMissed: observee only, while scheduled and before the observer signs.
  const canReport = observee && o.status === 'scheduled' && !o.observerSignedDate;
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
    <div className="observation-record-page min-w-0 space-y-5 pt-8 text-gray-900 [overflow-wrap:anywhere]">
      <Link to={observer ? '/faculty/observe/confirmations' : '/faculty/evaluation'} className={`${linkClass} screen-only`}>Back to {observer ? 'confirmations' : 'evaluation'}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-bold">{o.section.label} {o.section.title}, {whenLong(o)}</h2>
          <p className="text-sm text-gray-500">Observation Template v{o.templateVersion?.versionNo ?? 'unavailable'}, observer {o.observer.displayName}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="min-w-0 max-w-full [&>span]:h-auto [&>span]:whitespace-normal [&>span]:py-1"><Tag tone={status.tone}>{status.text}</Tag></div>
          {hasForm && <Button className="screen-only" onClick={() => window.print()}>Print record</Button>}
        </div>
      </div>
      {observeeWaitsForObserver(o, profile.data.netid) && <p className="text-sm text-gray-700">{OBSERVEE_LOCK_NOTE}</p>}
      <div className="observation-record-grid grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        {!hasForm ? <p role="alert">The assigned observation form is unavailable.</p> : (
          <Card className="min-w-0 lg:row-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
              <h3 className="font-bold">Ratings and comments</h3>
              <div className="screen-only"><Tag tone="neutral">Read only</Tag></div>
            </div>
            {o.answers.length === 0 && <p className="px-5 py-4 text-sm">No questions in this observation form.</p>}
            {o.answers.map(a => <section key={a.questionId} className="grid gap-2 border-b border-gray-200 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
              <div className="min-w-0 space-y-1">
                <h4 className="text-sm font-bold">{a.title}</h4>
                <p className="text-xs text-gray-500">{a.wording}</p>
                <p className="whitespace-pre-line text-sm text-gray-700">{a.comment || 'No comment'}</p>
              </div>
              <div className="observation-rating-scale max-w-full overflow-x-auto sm:max-w-[16rem]"><RatingScale label={a.title} min={a.ratingMin} max={a.ratingMax} value={a.rating} /></div>
            </section>)}
            <section className="space-y-1 px-5 py-4">
              <h4 className="text-sm font-bold">Any other comments</h4>
              <p className="whitespace-pre-line text-sm text-gray-700">{o.otherComments || 'None'}</p>
              {o.reasonNotCompleted && <p className="pt-2 text-sm">Reason not completed: {o.reasonNotCompleted}</p>}
            </section>
          </Card>
        )}
        <Card className="observation-signatures-card min-w-0 space-y-4 p-5">
          <h3 className="font-bold">Signatures</h3>
          <Party role="Observer" person={o.observer} date={o.observerSignedDate} you={observer} />
          <Party role="Observee" person={o.observee} date={o.observeeSignedDate} you={observee} action={canObserveeSign && (
            <Button className="screen-only" size="compact" disabled={sign.isPending || staleRefresh === 'reloaded' && !staleReviewed} onClick={signAsObservee}>Sign</Button>
          )} />
          <div className="screen-only space-y-2">
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
        {(observer || observee) && !isLocked(o) && (
          <Card className="screen-only min-w-0 px-5 py-4">
            <h3 className="text-sm font-bold">Something went wrong?</h3>
            <ul className="mt-3 flex flex-col gap-3">
              {canReport && (
                <li>
                  <button type="button" className={linkClass} onClick={() => setReporting(true)}>
                    <FlagIcon className="text-gray-600" /> The observation could not be done
                  </button>
                </li>
              )}
              <li><UploadLink o={o} /></li>
            </ul>
          </Card>
        )}
      </div>
      {reporting && canReport && <ReportMissedModal o={o} onClose={closeReport} onStale={() => void record.refetch()} />}
      {observer && hasForm && !isLocked(o) && o.status !== 'not_completed' && (
        <Link to={`/faculty/observe/${o.observationId}/form`} className={`${linkClass} screen-only`}><PenIcon /> Edit local draft</Link>
      )}
      {!observer && !observee && <p>Read-only record.</p>}
    </div>
  );
}
