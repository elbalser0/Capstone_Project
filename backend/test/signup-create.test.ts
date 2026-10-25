import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPool } from '../src/db/pool.js';
import { createSignup, validateSignupDates } from '../src/services/signup.service.js';
import type { CourseSection } from '../src/services/course.service.js';
import type { AuthUser } from '../src/services/user.service.js';

const user: AuthUser = {
  netid: 'ada', firstName: 'Ada', lastName: 'Lovelace', displayName: 'Dr. Ada Lovelace',
  email: 'ada@example.edu', rank: 'associate', role: 'faculty',
  department: { deptId: '5', deptName: 'Computer Science' },
};

const section: CourseSection = {
  sectionId: '42', label: 'Computer Science 1337.002', courseNum: '1337', sectionNum: '002',
  title: 'Computer Science I', courseLevel: 1000, classMode: 'in-person', enrollment: null,
  term: { termId: '7', season: 'fall', year: 2026, label: 'Fall 2026', startDate: '2026-08-24', endDate: '2026-12-11' },
  meetings: [
    { dayOfWeek: 'Mon', startTime: '08:30', endTime: '09:45', room: 'A1' },
    { dayOfWeek: 'Wed', startTime: '10:00', endTime: '11:15', room: 'A1' },
  ],
};

test('signup dates must be unique class meetings in the observation window', () => {
  const check = (dates: string[]) => validateSignupDates(dates, '2026-10-31', '2026-11-20', section);
  assert.doesNotThrow(() => check(['2026-11-02', '2026-11-04']));
  for (const dates of [
    [], // at least one preferred date is required
    ['2026-11-02', '2026-11-02'], // duplicate
    ['2026-10-26'], // before sign-up closes
    ['2026-11-03'], // not a class meeting
    ['2026-11-23'], // after observation deadline
  ]) {
    assert.throws(() => check(dates), { code: 'INVALID_DATES' });
  }
  assert.throws(() => validateSignupDates(['2026-11-02'], '2026-11-02', '2026-11-04', section), { code: 'INVALID_DATES' });
  assert.doesNotThrow(() => validateSignupDates(['2026-11-04'], '2026-11-02', '2026-11-04', section));
  assert.throws(() => validateSignupDates(['2026-12-14'], '2026-10-31', '2026-12-20', section), { code: 'INVALID_DATES' });
});

test('signup and proposed dates are written in one transaction', async () => {
  process.env.DATABASE_URL ??= 'postgresql://localhost/test';
  const pool = getPool() as unknown as {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    connect: () => Promise<{ query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; release: (error?: Error) => void }>;
  };
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const calls: { sql: string; params?: unknown[] }[] = [];
  let mode = 'success';
  let release: { called: boolean; error?: Error } = { called: false };
  pool.query = async () => { throw new Error('A signup query escaped the transaction.'); };
  pool.connect = async () => ({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql === 'ROLLBACK' && mode === 'rollback-failure') throw new Error('rollback failed');
      if (sql.includes('FROM eval_cycle')) return { rows: mode === 'no-cycle' ? [] : [{
        cycle_id: 3, term_id: 7, signup_deadline: '2026-10-31', observation_deadline: '2026-11-20',
        today: mode === 'closed' ? '2026-11-01' : '2026-10-23',
      }] };
      if (sql.includes('FROM professor')) return { rows: [{ is_active: mode !== 'inactive' }] };
      if (sql.includes('FROM eval_due')) return { rows: mode === 'not-due' ? [] : [{ ok: 1 }] };
      if (sql.includes('FROM section AS s')) return { rows: mode === 'invalid-section' ? [] : section.meetings.map((meeting) => ({
        section_id: 42, section_num: '002', class_mode: 'in-person',
        course_num: '1337', title: 'Computer Science I', course_level: 1000, dept_name: 'Computer Science',
        term_id: 7, season: 'fall', year: 2026, start_date: '2026-08-24', end_date: '2026-12-11',
        day_of_week: meeting.dayOfWeek === 'Mon' ? 'monday' : 'wednesday',
        start_time: `${meeting.startTime}:00`, end_time: `${meeting.endTime}:00`, room: meeting.room,
      })) };
      if (sql.includes('INSERT INTO sign_up')) {
        if (mode === 'duplicate') throw Object.assign(new Error('duplicate'), { code: '23505' });
        return { rows: [{ signup_id: 9, submit_date: '2026-10-23' }] };
      }
      if (sql.includes('INSERT INTO proposed_date') && ['date-failure', 'rollback-failure'].includes(mode)) {
        throw new Error('date write failed');
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.includes('INSERT INTO proposed_date')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release: (error) => { release = { called: true, error }; },
  });
  try {
    const signup = await createSignup(user, 42, ['2026-11-02', '2026-11-04']);
    assert.equal(signup.signupId, '9');
    assert.deepEqual(signup.proposedDates, [
      { date: '2026-11-02', startTime: '08:30' },
      { date: '2026-11-04', startTime: '10:00' },
    ]);
    assert.deepEqual(calls.filter(({ sql }) => sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('INSERT INTO'))
      .map(({ sql }) => sql.trim().split(/\s+/).slice(0, 3).join(' ')), [
      'BEGIN', 'INSERT INTO sign_up', 'INSERT INTO proposed_date', 'COMMIT',
    ]);
    assert.ok(calls.find(({ sql }) => sql.includes('FROM eval_cycle'))?.sql.includes('FOR SHARE'));
    assert.ok(calls.find(({ sql }) => sql.includes('FROM eval_due'))?.sql.includes('FOR SHARE'));
    assert.deepEqual(calls.find(({ sql }) => sql.includes('INSERT INTO proposed_date'))?.params, [9, ['2026-11-02', '2026-11-04']]);
    assert.deepEqual(release, { called: true, error: undefined });

    calls.length = 0;
    release = { called: false };
    mode = 'date-failure';
    await assert.rejects(() => createSignup(user, 42, ['2026-11-02']), /date write failed/);
    assert.equal(calls.at(-1)?.sql, 'ROLLBACK');
    assert.deepEqual(release, { called: true, error: undefined });

    calls.length = 0;
    release = { called: false };
    mode = 'rollback-failure';
    await assert.rejects(() => createSignup(user, 42, ['2026-11-02']), /date write failed/);
    assert.equal(release.called, true);
    assert.match(release.error?.message ?? '', /rollback failed/);

    for (const [caseName, code] of [
      ['duplicate', 'ALREADY_SIGNED_UP'], ['closed', 'SIGNUP_CLOSED'], ['no-cycle', 'SIGNUP_CLOSED'],
      ['inactive', 'NOT_A_PROFESSOR'], ['not-due', 'NOT_DUE'], ['invalid-section', 'INVALID_SECTION'],
    ]) {
      calls.length = 0;
      release = { called: false };
      mode = caseName;
      await assert.rejects(() => createSignup(user, 42, ['2026-11-02']), { code });
      assert.equal(calls.at(-1)?.sql, 'ROLLBACK');
      assert.equal(release.called, true);
      if (caseName !== 'duplicate') assert.ok(!calls.some(({ sql }) => sql.includes('INSERT INTO')));
    }
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
});
