import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

import { useCycleKpis, useDueByRank, useOutstandingObservations, useUnmatchedFaculty } from '../../api/hooks/committee';
import { useCurrentCycle } from '../../api/hooks/shared';
import type { CycleKpis, KpiCode, KpiResult } from '../../api/types';
import { DownloadIcon } from '../../components/icons';
import { Banner, Button, Card, ErrorNote } from '../../components/ui';
import { downloadCsv } from '../../lib/csv';
import { formatDate, formatShort, percent, ranks } from '../../lib/format';
import { DashboardSections, NO_CYCLE_TEXT, TryAgain, errorText, failureKey, headingFocus, isNoCycle, type Retryable } from './DashboardSections';

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

/** `missing` stands in for the value while the KPIs are loading or failed, so the card never reads N/A for them. */
function KpiCard({ code, kpi, missing }: { code: KpiCode; kpi: KpiResult | undefined; missing?: string }) {
  const meta = KPI_META[code];
  return (
    <Card className="flex min-h-[154px] flex-col px-4 pt-3.5 pb-3">
      <p className="text-xs text-gray-500"><span className="font-bold text-gray-900">{code}</span> {meta.group}</p>
      <h3 className="mt-[3px] text-sm font-bold text-gray-900">{meta.name}</h3>
      <p className="mt-auto text-[28px] leading-[34px] font-bold text-gray-900">{missing ? '–' : value(kpi, meta)}</p>
      <p className="mt-1 min-h-8 text-xs text-gray-500">{missing ?? (kpi ? meta.describe(kpi) : 'Generated after the feedback deadline.')}</p>
    </Card>
  );
}

function exportCsv(data: CycleKpis) {
  const lines = [['kpi_code', 'name', 'numerator', 'denominator', 'value', 'computed_date']];
  for (const k of data.kpis) lines.push([k.kpiCode, KPI_META[k.kpiCode].name, String(k.numerator), String(k.denominator), k.kpiValue === null ? '' : String(k.kpiValue), k.computedDate]);
  downloadCsv('kpis', data.cycle.term.label, lines);
}

/**
 * `failed` shows the detail in red and, unless another part of the page already announces the same failure
 * (`announce` false), makes it an alert that names the count; `failedAt` re-creates it on every new failure.
 */
function SummaryCell({ label, total, detail, failed = false, failedAt, announce = true, children }: { label: string; total: number | undefined; detail: string; failed?: boolean; failedAt?: number; announce?: boolean; children?: ReactNode }) {
  const alert = failed && announce;
  return (
    <div className="my-4 flex flex-col px-5">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="mt-[3px] flex items-baseline gap-3.5">
        <span className="text-[22px] font-bold">{total ?? '–'}</span>
        <span key={failed ? failedAt : 'loaded'} role={alert ? 'alert' : undefined} className={`text-[13px] ${failed ? 'text-red-800' : 'text-gray-700'}`}>
          {alert && <span className="sr-only">{label}: </span>}
          {detail}
        </span>
      </span>
      {children}
    </div>
  );
}

/** Shown in place of a count that has not arrived, so a pending or failed request never reads as 0. */
const notLoaded = ({ error }: { error: unknown }) => (isNoCycle(error) ? NO_CYCLE_TEXT : error ? "Couldn't load" : 'Loading');

/** A count that never arrived because its request failed (not because no cycle has started). */
const loadFailed = (q: { data?: unknown; error: unknown }) => q.data === undefined && Boolean(q.error) && !isNoCycle(q.error);

/**
 * Under a count whose request failed: a failed refresh keeps the last count and says so, and Try again
 * repeats the request, unless another part of the page already offers it (`retry` false).
 */
function CountNote({ label, query, focus, retry = true }: { label: string; query: Retryable & { data?: unknown }; focus: RefObject<HTMLElement | null>; retry?: boolean }) {
  if (!query.error || isNoCycle(query.error) || (!retry && query.data === undefined)) return null;
  // The part of the page that offers Try again also announces the failure.
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      {query.data !== undefined && (
        <span key={query.errorUpdatedAt} role={retry ? 'alert' : undefined} className="text-xs text-red-800">
          {retry && <span className="sr-only">{label}: </span>}Couldn't refresh.
        </span>
      )}
      {retry && <TryAgain queries={[query]} focus={focus} />}
    </span>
  );
}

function Summary() {
  const due = useDueByRank();
  const outstanding = useOutstandingObservations();
  const unmatched = useUnmatchedFaculty();
  const first = unmatched.data?.items[0];
  const more = (unmatched.data?.total ?? 0) - 1;
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <section aria-labelledby="executive-summary">
      <h2 id="executive-summary" ref={heading} tabIndex={-1} className={`mt-[30px] mb-3 w-fit text-base font-bold text-gray-900 ${headingFocus}`}>Executive summary</h2>
      <Card className="grid grid-cols-3 divide-x divide-gray-200">
        <SummaryCell label="Due for evaluation" total={due.data?.total} detail={due.data ? ranks(due.data.byRank) : notLoaded(due)} failed={loadFailed(due)} failedAt={due.errorUpdatedAt}>
          <CountNote label="Due for evaluation" query={due} focus={heading} />
        </SummaryCell>
        <SummaryCell
          label="Signed up but not observed"
          total={outstanding.data?.total}
          detail={outstanding.data ? ranks(outstanding.data.byRank) : notLoaded(outstanding)}
          failed={loadFailed(outstanding)}
          failedAt={outstanding.errorUpdatedAt}
        >
          <CountNote label="Signed up but not observed" query={outstanding} focus={heading} />
        </SummaryCell>
        {/* The unmatched list below reads the same request and offers its own Try again. */}
        <SummaryCell
          label="Unmatched faculty"
          total={unmatched.data?.total}
          detail={!unmatched.data ? notLoaded(unmatched) : first ? `${first.observee.displayName}, ${first.section.label}${more > 0 ? `, and ${more} more` : ''}` : 'None'}
          failed={loadFailed(unmatched)}
          failedAt={unmatched.errorUpdatedAt}
          announce={false}
        >
          <CountNote label="Unmatched faculty" query={unmatched} focus={heading} retry={false} />
        </SummaryCell>
      </Card>
    </section>
  );
}

export function DashboardPage() {
  const kpis = useCycleKpis('latest');
  const cycle = useCurrentCycle();
  const data = kpis.data;
  const byCode = new Map(data?.kpis.map((k) => [k.kpiCode, k]));
  const subtitle = data
    ? `${data.cycle.term.label} cycle. ${data.computedDate ? `Generated ${formatDate(data.computedDate)}, after` : 'KPIs are generated after'} the feedback deadline (${formatShort(data.cycle.feedbackDeadline)}).`
    : '';
  const kpiBlock = useRef<HTMLElement>(null);
  // Until the current cycle is known, a KPI 404 may only mean no cycle has started, so the cards keep loading.
  const missing = data ? undefined : kpis.error && !cycle.isPending ? "Couldn't load" : 'Loading';

  // Before the first cycle there is nothing to show yet, so the page says so once. A cycle read that is
  // only refreshing still counts, and KPIs that did arrive are shown rather than hidden behind an old answer.
  const noCycle = cycle.data === null && !data;
  const noCycleBox = useRef<HTMLDivElement>(null);
  const focusWithin = useRef(false);
  useEffect(() => {
    // A Try again that ends here removes the element it focused, so focus the message instead of the page body.
    const lost = !document.activeElement || document.activeElement === document.body;
    if (noCycle && focusWithin.current && lost) noCycleBox.current?.focus();
  }, [noCycle]);

  if (noCycle) {
    return (
      <div className="flex flex-col pt-4">
        <div ref={noCycleBox} tabIndex={-1} className={`rounded-lg ${headingFocus}`}>
          <Banner tone="info"><span className="wrap-anywhere">{NO_CYCLE_TEXT}</span></Banner>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col pt-4" onFocus={() => { focusWithin.current = true; }}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{subtitle}</p>
        <Button variant="secondary" size="compact" disabled={!data?.kpis.length} onClick={() => data && exportCsv(data)}>
          <DownloadIcon /> Export CSV
        </Button>
      </div>
      {/* The KPI block, named by a screen-reader heading. Its Try again moves focus here, where the ring shows;
          the block's own top margin keeps that ring clear of Export CSV. */}
      <section ref={kpiBlock} aria-labelledby="kpi-results" tabIndex={-1} className="mt-4 flex flex-col gap-4 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
        <h2 id="kpi-results" className="sr-only">KPI results</h2>
        {kpis.error && !data && !cycle.isPending && (
          <div key={failureKey([kpis, cycle])} className="flex flex-col items-start gap-3">
            <ErrorNote error={new Error(`Couldn't load the KPIs: ${errorText(kpis.error)}`)} className="w-full" />
            <TryAgain queries={[kpis, cycle]} focus={kpiBlock} look="button" />
          </div>
        )}
        {kpis.error && data && (
          <div key={failureKey([kpis])}>
            <Banner tone="danger" action={<TryAgain queries={[kpis]} focus={kpiBlock} />}>Couldn't refresh the KPIs: {errorText(kpis.error)}</Banner>
          </div>
        )}
        <div className="grid grid-cols-4 gap-4">
          {ROW_1.map((code) => <KpiCard key={code} code={code} kpi={byCode.get(code)} missing={missing} />)}
        </div>
        <div className="grid grid-cols-3 gap-4">
          {ROW_2.map((code) => <KpiCard key={code} code={code} kpi={byCode.get(code)} missing={missing} />)}
        </div>
      </section>
      <Summary />
      <DashboardSections />
    </div>
  );
}
