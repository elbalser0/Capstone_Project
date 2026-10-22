import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app.js';
import { mapCourseRows } from '../src/services/course.service.js';
import { mapEvaluationStatus } from '../src/services/evaluation-status.service.js';
import { mapSignup } from '../src/services/signup.service.js';

test('faculty endpoints require a login', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const path of ['/api/me', '/api/me/courses?termId=1', '/api/me/evaluation-status', '/api/me/signup']) {
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
    baseline_last_eval_term: 1, start_term: 1, last_completed_term_id: null, today: '2026-10-22',
  };
  const due = mapEvaluationStatus(professor, terms, null);
  assert.equal(due.status, 'DUE');
  assert.equal(due.dueTerm.label, 'Fall 2026');
  assert.equal(due.lastObservedTerm?.termId, '1');
  assert.equal(due.cycle, null);
  assert.equal(due.canSignUp, false);

  const recentlyObserved = mapEvaluationStatus({ ...professor, last_completed_term_id: 2 }, terms, null);
  assert.equal(recentlyObserved.status, 'NOT_DUE');
  assert.equal(recentlyObserved.dueTerm.label, 'Spring 2027');
  assert.equal(recentlyObserved.lastObservedTerm?.termId, '2');

  const neverEvaluated = mapEvaluationStatus({ ...professor, baseline_last_eval_term: null }, terms, null);
  assert.equal(neverEvaluated.status, 'NOT_DUE');
  assert.equal(neverEvaluated.dueTerm.label, 'Fall 2027');
  assert.equal(neverEvaluated.lastObservedTerm, null);
  const overdue = mapEvaluationStatus({ ...professor, today: '2027-02-01' }, terms, null);
  assert.equal(overdue.status, 'OVERDUE');

  const futureDue = mapEvaluationStatus({ ...professor, eval_interval_years: 2, last_completed_term_id: 2 }, terms, null);
  assert.equal(futureDue.status, 'NOT_DUE');
  assert.equal(futureDue.dueTerm.label, 'Spring 2028');
});

test('a new professor is not due until two years after the start term', () => {
  const terms = [
    { term_id: 1, season: 'fall' as const, year: 2026, start_date: '2026-08-24', end_date: '2026-12-11' },
    { term_id: 2, season: 'spring' as const, year: 2027, start_date: '2027-01-12', end_date: '2027-05-08' },
    { term_id: 3, season: 'fall' as const, year: 2027, start_date: '2027-08-24', end_date: '2027-12-11' },
    { term_id: 4, season: 'spring' as const, year: 2028, start_date: '2028-01-12', end_date: '2028-05-08' },
    { term_id: 5, season: 'fall' as const, year: 2028, start_date: '2028-08-24', end_date: '2028-12-11' },
  ];
  const professor = {
    rank: 'assistant' as const, eval_interval_years: 1,
    baseline_last_eval_term: null, start_term: 1, last_completed_term_id: null, today: '2026-10-22',
  };
  const firstSemester = mapEvaluationStatus(professor, terms.slice(0, 1), null);
  assert.equal(firstSemester.status, 'NOT_DUE');
  assert.deepEqual(firstSemester.dueTerm, { season: 'fall', year: 2028, label: 'Fall 2028' });
  assert.equal(firstSemester.lastObservedTerm, null);
  assert.equal(mapEvaluationStatus({ ...professor, rank: 'associate', eval_interval_years: 2 }, terms.slice(0, 1), null).dueTerm.label, 'Fall 2028');
  assert.equal(mapEvaluationStatus({ ...professor, today: '2028-10-22' }, terms, null).status, 'DUE');
  assert.throws(
    () => mapEvaluationStatus({ ...professor, start_term: null }, terms, null),
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
    baseline_last_eval_term: 1, start_term: 1, last_completed_term_id: null, today: '2026-10-22',
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

test('a sign-up includes proposed meeting times and any scheduled observation', () => {
  const user = {
    netid: 'ada', firstName: 'Ada', lastName: 'Lovelace', displayName: 'Dr. Ada Lovelace',
    email: 'ada@example.edu', rank: 'associate' as const,
    department: { deptId: '5', deptName: 'Computer Science' }, role: 'faculty' as const,
  };
  const section = mapCourseRows([
    {
      section_id: 42, section_num: '002', class_mode: 'in-person' as const,
      course_num: '1337', title: 'Computer Science I', course_level: 1000,
      dept_name: 'Computer Science', term_id: 7, season: 'fall' as const,
      year: 2026, start_date: '2026-08-24', end_date: '2026-12-11',
      day_of_week: 'monday', start_time: '08:30:00', end_time: '09:45:00', room: 'ECSS 2.410',
    },
    {
      section_id: 42, section_num: '002', class_mode: 'in-person' as const,
      course_num: '1337', title: 'Computer Science I', course_level: 1000,
      dept_name: 'Computer Science', term_id: 7, season: 'fall' as const,
      year: 2026, start_date: '2026-08-24', end_date: '2026-12-11',
      day_of_week: 'wednesday', start_time: '10:00:00', end_time: '11:15:00', room: 'ECSS 2.410',
    },
  ])[0];
  const row = {
    signup_id: 9, cycle_id: 3, section_id: 42, term_id: 7, submit_date: '2026-10-20',
    observation_id: null, observation_status: null, scheduled_date: null,
    observer_netid: null, observer_first_name: null, observer_last_name: null, observer_rank: null,
  };
  const signup = mapSignup(row, user, section, ['2026-11-02', '2026-11-04']);
  assert.equal(signup.signupId, '9');
  assert.equal(signup.observee.email, 'ada@example.edu');
  assert.equal(signup.section.sectionId, '42');
  assert.deepEqual(signup.proposedDates, [
    { date: '2026-11-02', startTime: '08:30' },
    { date: '2026-11-04', startTime: '10:00' },
  ]);
  assert.equal(signup.observation, null);

  const observed = mapSignup({
    ...row, observation_id: 12, observation_status: 'scheduled', scheduled_date: '2026-11-04',
    observer_netid: 'grace', observer_first_name: 'Grace', observer_last_name: 'Hopper', observer_rank: 'full',
  }, user, section, []);
  assert.deepEqual(observed.observation, {
    observationId: '12',
    observer: { netid: 'grace', firstName: 'Grace', lastName: 'Hopper', displayName: 'Dr. Grace Hopper', rank: 'full' },
    status: 'scheduled', scheduledDate: '2026-11-04',
  });
});
