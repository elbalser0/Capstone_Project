import type { ReactNode } from 'react';
import { useSignObservation } from '../../api/hooks/faculty';
import type { ObservationDetail } from '../../api/types';
import { CheckIcon, ClockIcon, LockIcon, PenIcon } from '../../components/icons';
import { Button, Card, ErrorNote, LockNote, LockedTag, PageError, RatingScale, Tag } from '../../components/ui';
import { classStart, formatDayYear, formatShort, formatTime, isLocked } from '../../lib/format';
import { useObservationRecord } from './useObservationRecord';

// E6. The observee reads the observer's ratings and signs; once both have signed the record is locked.
// The observer signs by submitting the form, so only the observee signs on this page.

// An AC member can also open a record they are not part of.
type Role = 'observee' | 'observer' | 'viewer';

function ObservationStatusTag({ record, mine }: { record: ObservationDetail; mine: Role }) {
  if (isLocked(record)) return <LockedTag />;
  if (record.status === 'not_completed') return <Tag tone="neutral">Did not happen</Tag>;
  if (record.observerSignedDate && !record.observeeSignedDate) {
    return mine === 'observee'
      ? <Tag tone="due" icon={<PenIcon width={9} height={9} />}>Waiting for your signature</Tag>
      : <Tag tone="due">Waiting for the observee to sign</Tag>;
  }
  return <Tag tone="neutral">Scheduled {formatShort(record.scheduledDate)}</Tag>;
}

function Ratings({ record }: { record: ObservationDetail }) {
  return (
    <Card className="pt-5 pb-6">
      <div className="flex items-center justify-between px-6 pb-4">
        <h2 className="text-base font-bold text-gray-900">Ratings and comments</h2>
        <Tag tone="neutral" icon={<LockIcon width={8} height={10} />}>Read only</Tag>
      </div>
      <div className="mx-0 border-t border-gray-200" />
      <div className="divide-y divide-gray-200 px-6">
        {record.answers.map((a) => (
          <div key={a.questionId} className="flex flex-col py-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">{a.title}</h3>
              <RatingScale value={a.rating} min={a.ratingMin} max={a.ratingMax} label={a.title} />
            </div>
            <p className="mt-0.5 text-sm text-gray-500">{a.comment || (a.rating === null ? 'Not rated yet' : '')}</p>
          </div>
        ))}
        <div className="pt-4">
          <h3 className="text-sm font-bold text-gray-900">Any other comments</h3>
          <p className="mt-2.5 text-sm text-gray-500">{record.otherComments || 'None'}</p>
        </div>
        {record.reasonNotCompleted && (
          <div className="pt-4">
            <h3 className="text-sm font-bold text-gray-900">Why it did not happen</h3>
            <p className="mt-2.5 text-sm text-gray-500">{record.reasonNotCompleted}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function SignerRow({ role, name, signed, action }: { role: string; name: string; signed: string | null; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-[3px] flex w-[15px] justify-center">
        {signed ? <CheckIcon width={10} height={8} className="text-green-800" /> : <ClockIcon className="text-gray-500" />}
      </span>
      <div className="flex-1">
        <p className="text-sm font-bold text-gray-900">{role}: {name}</p>
        <p className="mt-[5px] text-xs text-gray-500">{signed ? `signed ${formatShort(signed)}` : 'Not signed yet'}</p>
        {signed && <div className="mt-2"><Tag tone="signed">Signed</Tag></div>}
      </div>
      {action}
    </div>
  );
}

function Signatures({ record, mine, reload }: { record: ObservationDetail; mine: Role; reload: () => void }) {
  const sign = useSignObservation();
  // The observee signs after the observer has submitted the form.
  const canSign = mine === 'observee' && record.status !== 'not_completed' && Boolean(record.observerSignedDate) && !record.observeeSignedDate;
  const button = canSign ? (
    <Button
      className="w-[88px]"
      disabled={sign.isPending}
      // A 409 (for example the observer changed the form meanwhile) reloads the record so it can be read again.
      onClick={() => sign.mutate({ observationId: record.observationId, lastSavedDate: record.lastSavedDate }, { onError: reload })}
    >
      <PenIcon width={12} height={12} /> Sign
    </Button>
  ) : undefined;
  return (
    <Card className="px-6 pt-5 pb-4">
      <h2 className="text-base font-bold text-gray-900">Signatures</h2>
      <div className="mt-4">
        <SignerRow role="Observer" name={mine === 'observer' ? 'you' : record.observer.displayName} signed={record.observerSignedDate} />
      </div>
      <div className="my-4 border-t border-gray-200" />
      <SignerRow role="Observee" name={mine === 'observee' ? 'you' : record.observee.displayName} signed={record.observeeSignedDate} action={button} />
      <ErrorNote error={sign.error} className="mt-3" />
      <LockNote className="mt-6">Once both of you sign, nobody can change this record.</LockNote>
    </Card>
  );
}

export function ObservationRecordPage() {
  const { observation, record, me } = useObservationRecord();

  const error = observation.error ?? me.error;
  if (error) return <PageError error={error} />;
  if (!record || !me.data) return <p role="status" className="pt-8 text-sm text-gray-500">Loading observation…</p>;
  const mine: Role = record.observee.netid === me.data.netid ? 'observee' : record.observer.netid === me.data.netid ? 'observer' : 'viewer';
  const time = classStart(record.section, record.scheduledDate);

  return (
    <div className="flex flex-col pt-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-base font-bold text-gray-900">
            {record.section.label} {record.section.title}, {formatDayYear(record.scheduledDate)}{time && `, ${formatTime(time)}`}
          </h2>
          <p className="mt-[7px] text-sm text-gray-500">
            Observation Template v{record.templateVersion.versionNo}, {mine === 'observee' ? `observer ${record.observer.displayName}` : mine === 'observer' ? `observee ${record.observee.displayName}` : `${record.observee.displayName} observed by ${record.observer.displayName}`}
          </p>
        </div>
        <div className="mt-1"><ObservationStatusTag record={record} mine={mine} /></div>
      </div>

      <div className="mt-[21px] grid grid-cols-[620px_344px] items-start gap-8">
        <Ratings record={record} />
        <Signatures record={record} mine={mine} reload={() => void observation.refetch()} />
      </div>
    </div>
  );
}
