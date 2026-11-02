import type { ReactNode } from 'react';

import { useCycleKpis, useDueByRank, useOutstandingObservations, useUnmatchedFaculty } from '../../api/hooks/committee';
import type { CycleKpis, KpiCode, KpiResult } from '../../api/types';
import { DownloadIcon } from '../../components/icons';
import { Button, Card, ErrorNote } from '../../components/ui';
import { downloadCsv } from '../../lib/csv';
import { formatDate, formatShort, percent, ranks } from '../../lib/format';
import { DashboardSections, isNoCycle } from './DashboardSections';

// A1. KPIs are generated the day after a cycle's feedback deadline, so the cards show the
// latest cycle that has results; the executive summary and the lists below are the current cycle so far.

interface KpiMeta {
  group: string;
  name: string;
  format: 'rate' | 'count' | 'average';
  describe: (k: KpiResult) => string;
}

const KPI_META: Record<KpiCode, KpiMeta> = {
  '1.1': { group: 'Faculty evaluation', name: 'Evaluation Eligibility Accuracy', format: 'rate', describe: (k) => `Observers who met every matching rule (${k.denominator - k.numerator} wrong).` },
  '1.2': { group: 'Faculty evaluation', name: 'Overdue Evaluation Count', format: 'count', describe: () => 'Due semester ended with no signed observation.' },
  '2.1': { group: 'Participation', name: 'Assessment Participation Rate', format: 'rate', describe: (k) => `${k.numerator} of the ${k.denominator} professors who were due signed up.` },
  '2.2': { group: 'Participation', name: 'Observer Utilization Rate', format: 'rate', describe: (k) => `${k.numerator} of the ${k.denominator} signed-up professors also observed a colleague.` },
  '3.1': { group: 'Observer recommendations', name: 'List Sufficiency Rate', format: 'average', describe: () => 'Observers found per sign-up, on average. The target is 5.' },
  '4.1': { group: 'Completion', name: 'Missing Observation Count', format: 'count', describe: () => 'Confirmed observations that did not happen.' },
  '4.2': { group: 'Completion', name: 'Survey Completion Rate', format: 'rate', describe: (k) => `${k.numerator} of the ${k.denominator} signed-up professors finished the survey.` },
};
const ROW_1: KpiCode[] = ['1.1', '1.2', '2.1', '2.2'];
const ROW_2: KpiCode[] = ['3.1', '4.1', '4.2'];

const value = (k: KpiResult | undefined, meta: KpiMeta) => {
  if (!k || k.kpiValue === null) return 'N/A';
  if (meta.format === 'rate') return percent(k.kpiValue);
  if (meta.format === 'average') return k.kpiValue.toFixed(1);
  return String(k.kpiValue);
};

function KpiCard({ code, kpi }: { code: KpiCode; kpi: KpiResult | undefined }) {
  const meta = KPI_META[code];
  return (
    <Card className="flex min-h-[154px] flex-col px-4 pt-3.5 pb-3">
      <p className="text-xs text-gray-500"><span className="font-bold text-gray-900">{code}</span> {meta.group}</p>
      <h3 className="mt-[3px] text-sm font-bold text-gray-900">{meta.name}</h3>
      <p className="mt-auto text-[28px] leading-[34px] font-bold text-gray-900">{value(kpi, meta)}</p>
      <p className="mt-1 min-h-8 text-xs text-gray-500">{kpi ? meta.describe(kpi) : 'Generated after the feedback deadline.'}</p>
    </Card>
  );
}

function exportCsv(data: CycleKpis) {
  const lines = [['kpi_code', 'name', 'numerator', 'denominator', 'value', 'computed_date']];
  for (const k of data.kpis) lines.push([k.kpiCode, KPI_META[k.kpiCode].name, String(k.numerator), String(k.denominator), k.kpiValue === null ? '' : String(k.kpiValue), k.computedDate]);
  downloadCsv('kpis', data.cycle.term.label, lines);
}

function SummaryCell({ label, total, detail, children }: { label: string; total: number | undefined; detail: string; children?: ReactNode }) {
  return (
    <div className="my-4 flex flex-col px-5">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="mt-[3px] flex items-baseline gap-3.5">
        <span className="text-[22px] font-bold">{total ?? '–'}</span>
        <span className="text-[13px] text-gray-700">{detail}</span>
      </span>
      {children}
    </div>
  );
}

/** Shown in place of a count that has not arrived, so a pending or failed request never reads as 0. */
const notLoaded = ({ error }: { error: unknown }) => (isNoCycle(error) ? 'No cycle has started' : error ? "Couldn't load" : 'Loading');

function Summary() {
  const due = useDueByRank();
  const outstanding = useOutstandingObservations();
  const unmatched = useUnmatchedFaculty();
  const first = unmatched.data?.items[0];
  const more = (unmatched.data?.total ?? 0) - 1;
  return (
    <section aria-labelledby="executive-summary">
      <h2 id="executive-summary" className="mt-[30px] mb-3 text-base font-bold text-gray-900">Executive summary</h2>
      <Card className="grid grid-cols-3 divide-x divide-gray-200">
        <SummaryCell label="Due for evaluation" total={due.data?.total} detail={due.data ? ranks(due.data.byRank) : notLoaded(due)} />
        <SummaryCell
          label="Signed up but not observed"
          total={outstanding.data?.total}
          detail={outstanding.data ? ranks(outstanding.data.byRank) : notLoaded(outstanding)}
        />
        <SummaryCell
          label="Unmatched faculty"
          total={unmatched.data?.total}
          detail={!unmatched.data ? notLoaded(unmatched) : first ? `${first.observee.displayName}, ${first.section.label}${more > 0 ? `, and ${more} more` : ''}` : 'None'}
        />
      </Card>
    </section>
  );
}

export function DashboardPage() {
  const kpis = useCycleKpis('latest');
  const data = kpis.data;
  const byCode = new Map(data?.kpis.map((k) => [k.kpiCode, k]));
  const subtitle = data
    ? `${data.cycle.term.label} cycle. ${data.computedDate ? `Generated ${formatDate(data.computedDate)}, after` : 'KPIs are generated after'} the feedback deadline (${formatShort(data.cycle.feedbackDeadline)}).`
    : '';

  return (
    <div className="flex flex-col pt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{subtitle}</p>
        <Button variant="secondary" size="compact" disabled={!data?.kpis.length} onClick={() => data && exportCsv(data)}>
          <DownloadIcon /> Export CSV
        </Button>
      </div>
      <ErrorNote error={kpis.error} />
      <div className="mt-4 grid grid-cols-4 gap-4">
        {ROW_1.map((code) => <KpiCard key={code} code={code} kpi={byCode.get(code)} />)}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        {ROW_2.map((code) => <KpiCard key={code} code={code} kpi={byCode.get(code)} />)}
      </div>
      <Summary />
      <DashboardSections />
    </div>
  );
}
