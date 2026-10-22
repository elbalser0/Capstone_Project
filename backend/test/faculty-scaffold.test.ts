import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app.js';
import { mapCourseRows } from '../src/services/course.service.js';
import { mapEvaluationStatus } from '../src/services/evaluation-status.service.js';

test('faculty endpoints require a login', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const path of ['/api/me', '/api/me/courses?termId=1', '/api/me/evaluation-status']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 401, path);
    }
    const signup = await fetch(`${base}/api/signups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sectionId: '1', proposedDates: ['2026-11-02'] }),
    });
    assert.equal(signup.status, 401);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});

test('course rows become one API section with normalized meetings', () => {
  const base = {
    section_id: 42, section_num: '002', class_mode: 'in-person' as const,
    course_num: '1337', title: 'Computer Science I', course_level: 1000,
    dept_name: 'Computer Science', term_id: 7, season: 'fall' as const,
    year: 2026, start_date: '2026-08-24', end_date: '2026-12-11',
  };
  assert.deepEqual(mapCourseRows([
    { ...base, day_of_week: 'monday', start_time: '08:30:00', end_time: '09:45:00', room: 'ECSS 2.410' },
    { ...base, day_of_week: 'wednesday', start_time: '08:30:00', end_time: '09:45:00', room: null },
  ]), [{
    sectionId: '42', label: 'Computer Science 1337.002', courseNum: '1337', sectionNum: '002',
    title: 'Computer Science I', courseLevel: 1000, classMode: 'in-person', enrollment: null,
    term: { termId: '7', season: 'fall', year: 2026, label: 'Fall 2026', startDate: '2026-08-24', endDate: '2026-12-11' },
    meetings: [
      { dayOfWeek: 'Mon', startTime: '08:30', endTime: '09:45', room: 'ECSS 2.410' },
      { dayOfWeek: 'Wed', startTime: '08:30', endTime: '09:45', room: '' },
    ],
  }]);
});

test('evaluation status uses the signed evaluation term and returns no cycle when none exists', () => {
  const terms = [
    { term_id: 1, season: 'fall' as const, year: 2025, start_date: '2025-08-24', end_date: '2025-12-11' },
    { term_id: 2, season: 'spring' as const, year: 2026, start_date: '2026-01-12', end_date: '2026-05-08' },
    { term_id: 3, season: 'fall' as const, year: 2026, start_date: '2026-08-24', end_date: '2026-12-11' },
    { term_id: 4, season: 'spring' as const, year: 2027, start_date: '2027-01-12', end_date: '2027-05-08' },
  ];
  const professor = {
    rank: 'assistant' as const, eval_interval_years: 1,
    baseline_last_eval_term: 1, last_completed_term_id: null, today: '2026-10-22',
  };
  const due = mapEvaluationStatus(professor, terms, null);
  assert.equal(due.status, 'DUE');
  assert.equal(due.dueTerm.termId, '3');
  assert.equal(due.lastObservedTerm?.termId, '1');
  assert.equal(due.cycle, null);
  assert.equal(due.canSignUp, false);

  const recentlyObserved = mapEvaluationStatus({ ...professor, last_completed_term_id: 2 }, terms, null);
  assert.equal(recentlyObserved.status, 'NOT_DUE');
  assert.equal(recentlyObserved.dueTerm.termId, '4');
  assert.equal(recentlyObserved.lastObservedTerm?.termId, '2');

  const neverEvaluated = mapEvaluationStatus({ ...professor, baseline_last_eval_term: null }, terms, null);
  assert.equal(neverEvaluated.status, 'DUE');
  assert.equal(neverEvaluated.lastObservedTerm, null);
  const overdue = mapEvaluationStatus({ ...professor, today: '2027-02-01' }, terms, null);
  assert.equal(overdue.status, 'OVERDUE');

  assert.throws(
    () => mapEvaluationStatus({ ...professor, eval_interval_years: 2, last_completed_term_id: 2 }, terms, null),
    { status: 503, code: 'TERM_DATA_UNAVAILABLE' },
  );
});

test('evaluation status opens sign-up only for due professors without a signup', () => {
  const terms = [
    { term_id: 1, season: 'fall' as const, year: 2025, start_date: '2025-08-24', end_date: '2025-12-11' },
    { term_id: 2, season: 'spring' as const, year: 2026, start_date: '2026-01-12', end_date: '2026-05-08' },
    { term_id: 3, season: 'fall' as const, year: 2026, start_date: '2026-08-24', end_date: '2026-12-11' },
    { term_id: 4, season: 'spring' as const, year: 2027, start_date: '2027-01-12', end_date: '2027-05-08' },
  ];
  const professor = {
    rank: 'assistant' as const, eval_interval_years: 1,
    baseline_last_eval_term: 1, last_completed_term_id: null, today: '2026-10-22',
  };
  const cycle = {
    cycle_id: 7, term_id: 3, started_by: 'ac1', start_date: '2026-10-01',
    signup_deadline: '2026-10-30', observation_deadline: '2026-11-30', feedback_deadline: '2026-12-15',
    first_name: 'Ada', last_name: 'Lovelace', rank: 'full' as const,
    has_match: false, signup_id: null,
  };
  const open = mapEvaluationStatus(professor, terms, cycle);
  assert.equal(open.canSignUp, true);
  assert.equal(open.cycle?.phase, 'signup');
  assert.equal(open.cycle?.surveyOpensDate, '2026-12-01');

  const signedUp = mapEvaluationStatus(professor, terms, { ...cycle, signup_id: 42 });
  assert.equal(signedUp.canSignUp, false);
  assert.equal(signedUp.signupId, '42');
  const notDue = mapEvaluationStatus({ ...professor, last_completed_term_id: 2 }, terms, cycle);
  assert.equal(notDue.status, 'NOT_DUE');
  assert.equal(notDue.canSignUp, false);
  const closed = mapEvaluationStatus({ ...professor, today: '2026-11-01' }, terms, cycle);
  assert.equal(closed.canSignUp, false);
  assert.equal(closed.cycle?.phase, 'matching');
});
