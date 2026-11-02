import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  computeKpis,
  eligibilityAccuracy,
  listSufficiency,
  missingObservations,
  observerUtilization,
  overdueCount,
  participationRate,
  surveyCompletion,
  type CycleFacts,
  type ObservationFact,
  type SignupFact,
} from '../src/services/kpi-rules.js';

function signup(signupId: number, netid: string, changes: Partial<SignupFact> = {}): SignupFact {
  return { signupId, netid, matchCount: 5, requestsSent: 1, hasAccepted: true, surveyedAsObservee: true, ...changes };
}

function observation(signupId: number, observerNetid: string, changes: Partial<ObservationFact> = {}): ObservationFact {
  return {
    signupId, observerNetid, status: 'completed', bothSigned: true,
    selfMatch: false, sameDept: true, taughtLevel: true, scheduleConflict: false,
    ...changes,
  };
}

function facts(changes: Partial<CycleFacts> = {}): CycleFacts {
  return { due: [], signups: [], observations: [], pastObservationDeadline: true, ...changes };
}

describe('1.1 Evaluation Eligibility Accuracy', () => {
  test('a correct observer counts as correct', () => {
    const kpi = eligibilityAccuracy(facts({ observations: [observation(1, 'a')] }));
    assert.deepEqual(kpi, { kpiCode: '1.1', numerator: 1, denominator: 1, kpiValue: 1 });
  });

  for (const [name, wrong] of [
    ['the observee themselves', { selfMatch: true }],
    ['a same-level professor from another department', { sameDept: false }],
    ['a professor who has not taught the course level', { taughtLevel: false }],
    ['a professor who teaches at that time', { scheduleConflict: true }],
  ] as const) {
    test(`${name} counts as wrong`, () => {
      const kpi = eligibilityAccuracy(facts({ observations: [observation(1, 'a'), observation(2, 'b', wrong)] }));
      assert.deepEqual(kpi, { kpiCode: '1.1', numerator: 1, denominator: 2, kpiValue: 0.5 });
    });
  }

  test('no observations gives N/A, not 0%', () => {
    assert.equal(eligibilityAccuracy(facts()).kpiValue, null);
  });
});

describe('1.2 Overdue Evaluation Count', () => {
  test('only overdue rows are counted; due rows are ignored', () => {
    const kpi = overdueCount(facts({
      due: [{ netid: 'a', dueStatus: 'overdue' }, { netid: 'b', dueStatus: 'due' }, { netid: 'c', dueStatus: 'overdue' }],
    }));
    assert.deepEqual(kpi, { kpiCode: '1.2', numerator: 2, denominator: 3, kpiValue: 2 });
  });

  test('nobody due is a count of 0, not N/A', () => {
    assert.equal(overdueCount(facts()).kpiValue, 0);
  });
});

describe('2.1 Assessment Participation Rate', () => {
  test('counts due professors who signed up', () => {
    const kpi = participationRate(facts({
      due: [{ netid: 'a', dueStatus: 'due' }, { netid: 'b', dueStatus: 'overdue' }],
      signups: [signup(1, 'a')],
    }));
    assert.deepEqual(kpi, { kpiCode: '2.1', numerator: 1, denominator: 2, kpiValue: 0.5 });
  });

  test('a sign-up from someone who is not due does not inflate the rate', () => {
    const kpi = participationRate(facts({
      due: [{ netid: 'a', dueStatus: 'due' }],
      signups: [signup(1, 'a'), signup(2, 'volunteer')],
    }));
    assert.deepEqual(kpi, { kpiCode: '2.1', numerator: 1, denominator: 1, kpiValue: 1 });
  });

  test('nobody due gives N/A', () => {
    assert.equal(participationRate(facts()).kpiValue, null);
  });
});

describe('2.2 Observer Utilization Rate', () => {
  test('counts signed-up professors who observed someone', () => {
    const kpi = observerUtilization(facts({
      signups: [signup(1, 'a'), signup(2, 'b')],
      observations: [observation(1, 'b')],
    }));
    assert.deepEqual(kpi, { kpiCode: '2.2', numerator: 1, denominator: 2, kpiValue: 0.5 });
  });

  test('observing twice still counts as one professor', () => {
    const kpi = observerUtilization(facts({
      signups: [signup(1, 'a'), signup(2, 'b'), signup(3, 'c')],
      observations: [observation(1, 'c'), observation(2, 'c')],
    }));
    assert.equal(kpi.numerator, 1);
  });

  test('an observer whose only observation did not happen is not counted', () => {
    const kpi = observerUtilization(facts({
      signups: [signup(1, 'a'), signup(2, 'b')],
      observations: [observation(1, 'b', { status: 'not_completed', bothSigned: false })],
    }));
    assert.equal(kpi.numerator, 0);
  });

  test('an observer who did not sign up is not counted', () => {
    const kpi = observerUtilization(facts({
      signups: [signup(1, 'a')],
      observations: [observation(1, 'outsider')],
    }));
    assert.equal(kpi.numerator, 0);
  });

  test('no sign-ups gives N/A', () => {
    assert.equal(observerUtilization(facts()).kpiValue, null);
  });
});

describe('3.1 List Sufficiency Rate', () => {
  test('averages the matches per sign-up, rounded to one decimal', () => {
    const kpi = listSufficiency(facts({
      signups: [signup(1, 'a', { matchCount: 5 }), signup(2, 'b', { matchCount: 5 }), signup(3, 'c', { matchCount: 4 })],
    }));
    assert.deepEqual(kpi, { kpiCode: '3.1', numerator: 14, denominator: 3, kpiValue: 4.7 });
  });

  test('no sign-ups gives N/A', () => {
    assert.equal(listSufficiency(facts()).kpiValue, null);
  });
});

describe('4.1 Missing Observation Count', () => {
  const notCompleted = observation(1, 'a', { status: 'not_completed', bothSigned: false });
  const stillScheduled = observation(2, 'b', { status: 'scheduled', bothSigned: false });
  const completed = observation(3, 'c');

  test('counts not_completed and stale observations, but not completed ones', () => {
    const kpi = missingObservations(facts({ observations: [notCompleted, stillScheduled, completed] }));
    assert.deepEqual(kpi, { kpiCode: '4.1', numerator: 2, denominator: 3, kpiValue: 2 });
  });

  test('an observation not signed by both parties is stale even if marked scheduled', () => {
    const kpi = missingObservations(facts({ observations: [observation(1, 'a', { status: 'scheduled', bothSigned: false })] }));
    assert.equal(kpi.numerator, 1);
  });

  test('before the observation deadline a scheduled observation is not missing yet', () => {
    const kpi = missingObservations(facts({
      pastObservationDeadline: false,
      observations: [notCompleted, stillScheduled, completed],
    }));
    assert.equal(kpi.numerator, 1);
  });

  test('no observations is a count of 0, not N/A', () => {
    assert.equal(missingObservations(facts()).kpiValue, 0);
  });
});

describe('4.2 Survey Completion Rate', () => {
  test('a sign-up that finished every step counts', () => {
    const kpi = surveyCompletion(facts({ signups: [signup(1, 'a')], observations: [observation(1, 'b')] }));
    assert.deepEqual(kpi, { kpiCode: '4.2', numerator: 1, denominator: 1, kpiValue: 1 });
  });

  for (const [name, signupChanges, observationChanges] of [
    ['no request was sent', { requestsSent: 0 }, {}],
    ['no request was confirmed', { hasAccepted: false }, {}],
    ['no survey was submitted', { surveyedAsObservee: false }, {}],
    ['the observation did not happen', {}, { status: 'not_completed', bothSigned: false }],
    ['the observation is still scheduled', {}, { status: 'scheduled', bothSigned: false }],
  ] as const) {
    test(`a sign-up is excluded when ${name}`, () => {
      const kpi = surveyCompletion(facts({
        signups: [signup(1, 'a', signupChanges)],
        observations: [observation(1, 'b', observationChanges as Partial<ObservationFact>)],
      }));
      assert.deepEqual(kpi, { kpiCode: '4.2', numerator: 0, denominator: 1, kpiValue: 0 });
    });
  }

  test('a survey without any observation does not count', () => {
    const kpi = surveyCompletion(facts({ signups: [signup(1, 'a')] }));
    assert.equal(kpi.numerator, 0);
  });

  test('no sign-ups gives N/A', () => {
    assert.equal(surveyCompletion(facts()).kpiValue, null);
  });
});

test('computeKpis returns all seven KPIs in code order', () => {
  assert.deepEqual(computeKpis(facts()).map((k) => k.kpiCode), ['1.1', '1.2', '2.1', '2.2', '3.1', '4.1', '4.2']);
});
