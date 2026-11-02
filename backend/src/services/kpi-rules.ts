// The KPI formulas. Pure functions over facts loaded by kpi.service.ts, so they need no database.

export type KpiCode = '1.1' | '1.2' | '2.1' | '2.2' | '3.1' | '4.1' | '4.2';

export interface DueFact {
  netid: string;
  dueStatus: 'due' | 'overdue';
}

export interface SignupFact {
  signupId: number;
  netid: string;
  /** Observers matched in the first round of observer selection. */
  matchCount: number;
  requestsSent: number;
  hasAccepted: boolean;
  surveyedAsObservee: boolean;
}

export interface ObservationFact {
  signupId: number;
  observerNetid: string;
  status: 'scheduled' | 'completed' | 'not_completed';
  bothSigned: boolean;
  selfMatch: boolean;
  sameDept: boolean;
  /** The observer taught the observee section's course level in the two-year window. */
  taughtLevel: boolean;
  /** The observer teaches while the observed class meets on the scheduled date. */
  scheduleConflict: boolean;
}

export interface CycleFacts {
  due: DueFact[];
  signups: SignupFact[];
  observations: ObservationFact[];
  pastObservationDeadline: boolean;
}

export interface KpiRow {
  kpiCode: KpiCode;
  numerator: number;
  denominator: number;
  /** Rates are 0..1, counts and averages are plain numbers. null when there is nothing to divide by. */
  kpiValue: number | null;
}

const rate = (kpiCode: KpiCode, numerator: number, denominator: number): KpiRow => ({
  kpiCode, numerator, denominator, kpiValue: denominator === 0 ? null : numerator / denominator,
});

const count = (kpiCode: KpiCode, numerator: number, denominator: number): KpiRow => ({
  kpiCode, numerator, denominator, kpiValue: numerator,
});

const isSignedOff = (o: ObservationFact) => o.status === 'completed' && o.bothSigned;

export function eligibilityAccuracy({ observations }: CycleFacts): KpiRow {
  const correct = observations.filter((o) => !o.selfMatch && o.sameDept && o.taughtLevel && !o.scheduleConflict);
  return rate('1.1', correct.length, observations.length);
}

export function overdueCount({ due }: CycleFacts): KpiRow {
  return count('1.2', due.filter((d) => d.dueStatus === 'overdue').length, due.length);
}

export function participationRate({ due, signups }: CycleFacts): KpiRow {
  const signedUp = new Set(signups.map((s) => s.netid));
  return rate('2.1', due.filter((d) => signedUp.has(d.netid)).length, due.length);
}

export function observerUtilization({ signups, observations }: CycleFacts): KpiRow {
  const observers = new Set(observations.filter((o) => o.status !== 'not_completed').map((o) => o.observerNetid));
  return rate('2.2', signups.filter((s) => observers.has(s.netid)).length, signups.length);
}

export function listSufficiency({ signups }: CycleFacts): KpiRow {
  const matches = signups.reduce((total, s) => total + s.matchCount, 0);
  return {
    kpiCode: '3.1',
    numerator: matches,
    denominator: signups.length,
    kpiValue: signups.length === 0 ? null : Math.round((matches / signups.length) * 10) / 10,
  };
}

export function missingObservations({ observations, pastObservationDeadline }: CycleFacts): KpiRow {
  const missing = observations.filter((o) => o.status === 'not_completed' || (pastObservationDeadline && !isSignedOff(o)));
  return count('4.1', missing.length, observations.length);
}

export function surveyCompletion({ signups, observations }: CycleFacts): KpiRow {
  const signedOff = new Set(observations.filter(isSignedOff).map((o) => o.signupId));
  const finished = signups.filter((s) => s.requestsSent > 0 && s.hasAccepted && signedOff.has(s.signupId) && s.surveyedAsObservee);
  return rate('4.2', finished.length, signups.length);
}

export function computeKpis(facts: CycleFacts): KpiRow[] {
  return [
    eligibilityAccuracy(facts),
    overdueCount(facts),
    participationRate(facts),
    observerUtilization(facts),
    listSufficiency(facts),
    missingObservations(facts),
    surveyCompletion(facts),
  ];
}
