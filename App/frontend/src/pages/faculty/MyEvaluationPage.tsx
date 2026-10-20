
import { useEvaluationStatus, useMyObservations, useMySignup } from '../../api/hooks/faculty';
import type { EvaluationStatus, ObservationSummary } from '../../api/types';
import { CalendarIcon, InfoIcon } from '../../components/icons';
import { Card, DueTag, PageError, Tag, buttonClass } from '../../components/ui';
import { RANK_LABEL, formatDate, formatRange, isLocked } from '../../lib/format';

// E1 (and E1a for an AC member signed in on their Faculty pages: same page, the sidebar differs).

function headline(s: EvaluationStatus) {
  if (s.status === 'DUE') return `You are DUE this semester: ${s.dueTerm.label}`;
  if (s.status === 'OVERDUE') return `You are OVERDUE: your observation was due ${s.dueTerm.label}`;
  return `Your next observation is due ${s.dueTerm.label}`;
}

function StatusCard({ status }: { status: EvaluationStatus }) {
  const interval = status.evalIntervalYears === 1 ? 'every year' : `every ${status.evalIntervalYears} years`;
  const last = status.lastObservedTerm ? `Last observed ${status.lastObservedTerm.label}.` : 'Not observed yet.';
  const c = status.cycle;
  return (
    <Card className="px-6 pt-6 pb-[23px]">
      <div className="flex items-start justify-between gap-6">
        <div>
          <DueTag status={status.status} />
          <h2 className="mt-3 text-xl font-bold text-gray-900">{headline(status)}</h2>
          <p className="mt-2 text-sm text-gray-500">{`${RANK_LABEL[status.rank]}, evaluated ${interval}. ${last}`}</p>
        </div>
        {status.canSignUp && (
          <button type="button" disabled title="Sign-up is not included in this sprint." className={buttonClass('primary', 'mt-8 shrink-0')}>
            Sign up to be observed
          </button>
        )}
      </div>
      {c && (
        <dl className="mt-6 grid grid-cols-3 border-t border-gray-200 pt-5">
          {[
            ['Sign-up deadline', formatDate(c.signupDeadline)],
            ['Observation period deadline', formatDate(c.observationDeadline)],
            ['Survey window', formatRange(c.surveyOpensDate, c.feedbackDeadline)],
          ].map(([label, value]) => (
            <div key={label} className="flex gap-3 pl-0.5">
              <CalendarIcon width={12} height={13} className="mt-0.5 text-gray-600" />
              <div>
                <dt className="text-xs text-gray-500">{label}</dt>
                <dd className="mt-[5px] text-sm font-bold text-gray-900">{value}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function statusTag(o: ObservationSummary) {
  if (o.status === 'completed' && isLocked(o)) return <Tag tone="signed">Signed</Tag>;
  if (o.status === 'completed') return <Tag tone="neutral">Waiting for your signature</Tag>;
  if (o.status === 'not_completed') return <Tag tone="neutral">Did not happen</Tag>;
  return <Tag tone="neutral">Scheduled {formatDate(o.scheduledDate)}</Tag>;
}

const COLS = 'grid grid-cols-[160px_240px_200px_1fr_auto] items-center px-4';

function ObservationsTable({ status }: { status: EvaluationStatus }) {
  const observations = useMyObservations();
  const signup = useMySignup();
  const rows = observations.data ?? [];
  const cycleTerm = status.cycle?.term;
  // While due, the current semester shows a row even before there is an observation for it.
  const showCurrent = status.status !== 'NOT_DUE' && cycleTerm && !rows.some((o) => o.term.termId === cycleTerm.termId);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <div className={`${COLS} h-10 border-b border-gray-200 bg-gray-50 text-xs font-bold text-gray-500`} role="row">
        <span role="columnheader">Semester</span>
        <span role="columnheader">Observer</span>
        <span role="columnheader">Course</span>
        <span role="columnheader">Status</span>
        <span />
      </div>
      <div role="rowgroup" className="divide-y divide-gray-200">
        {showCurrent && (
          <div className={`${COLS} h-12`} role="row">
            <span className="font-bold">{cycleTerm.label}</span>
            <span className="text-gray-500">Not chosen yet</span>
            {signup.data ? <span>{signup.data.section.label}</span> : <span className="text-gray-500">Not signed up yet</span>}
            <span><Tag tone="neutral">Not scheduled yet</Tag></span>
            <span />
          </div>
        )}
        {rows.map((o) => (
          <div key={o.observationId} className={`${COLS} h-12`} role="row">
            <span className="font-bold">{o.term.label}</span>
            <span>{o.observer.displayName}</span>
            <span>{o.section.label}</span>
            <span>{statusTag(o)}</span>
            <button type="button" disabled title="Observation records are not included in this sprint." className="cursor-not-allowed text-gray-400">
              View
            </button>
          </div>
        ))}
        {!showCurrent && rows.length === 0 && !observations.isLoading && (
          <p className="px-4 py-4 text-gray-500">No observations yet.</p>
        )}
      </div>
    </div>
  );
}

export function MyEvaluationPage() {
  const status = useEvaluationStatus();
  if (status.error) return <PageError error={status.error} />;
  if (!status.data) return null;
  return (
    <div className="flex flex-col pt-8">
      <StatusCard status={status.data} />
      <h2 className="mt-6 mb-3 text-base font-bold text-gray-900">My observations</h2>
      <ObservationsTable status={status.data} />
      <div className="mt-8 flex gap-3 rounded-lg border border-gray-200 bg-gray-50 px-5 py-[15px]">
        <InfoIcon className="mt-0.5 text-gray-700" />
        <div>
          <p className="text-sm font-bold text-gray-900">How often am I observed?</p>
          <p className="mt-1.5 text-sm text-gray-500">Assistant professors every calendar year. Associate and Full professors every 2 calendar years.</p>
        </div>
      </div>
    </div>
  );
}
