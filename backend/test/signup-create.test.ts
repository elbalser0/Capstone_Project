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
});

test('signup and proposed dates are written in one transaction', async () => {
  process.env.DATABASE_URL ??= 'postgresql://localhost/test';
  const pool = getPool() as unknown as {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    connect: () => Promise<{ query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; release: () => void }>;
  };
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const writes: { sql: string; params?: unknown[] }[] = [];
  let released = false;
  let failDates = false;
  pool.query = async (sql) => {
    if (sql.includes('FROM eval_cycle')) return { rows: [{ cycle_id: 3, term_id: 7, signup_deadline: '2026-10-31', observation_deadline: '2026-11-20', today: '2026-10-23' }] };
    if (sql.includes('FROM eval_due')) return { rows: [{ ok: 1 }] };
    if (sql.includes('FROM sign_up')) return { rows: [] };
    if (sql.includes('FROM section AS s')) return { rows: section.meetings.map((meeting) => ({
      section_id: 42, section_num: '002', class_mode: 'in-person',
      course_num: '1337', title: 'Computer Science I', course_level: 1000, dept_name: 'Computer Science',
      term_id: 7, season: 'fall', year: 2026, start_date: '2026-08-24', end_date: '2026-12-11',
      day_of_week: meeting.dayOfWeek === 'Mon' ? 'monday' : 'wednesday',
      start_time: `${meeting.startTime}:00`, end_time: `${meeting.endTime}:00`, room: meeting.room,
    })) };
    throw new Error(`Unexpected query: ${sql}`);
  };
  pool.connect = async () => ({
    query: async (sql, params) => {
      writes.push({ sql, params });
      if (failDates && sql.includes('INSERT INTO proposed_date')) throw new Error('date write failed');
      return { rows: sql.includes('INSERT INTO sign_up') ? [{ signup_id: 9, submit_date: '2026-10-23' }] : [] };
    },
    release: () => { released = true; },
  });
  try {
    const signup = await createSignup(user, 42, ['2026-11-02', '2026-11-04']);
    assert.equal(signup.signupId, '9');
    assert.deepEqual(signup.proposedDates, [
      { date: '2026-11-02', startTime: '08:30' },
      { date: '2026-11-04', startTime: '10:00' },
    ]);
    assert.deepEqual(writes.map(({ sql }) => sql.trim().split(/\s+/).slice(0, 3).join(' ')), [
      'BEGIN', 'INSERT INTO sign_up', 'INSERT INTO proposed_date', 'COMMIT',
    ]);
    assert.deepEqual(writes[2].params, [9, ['2026-11-02', '2026-11-04']]);
    assert.equal(released, true);

    writes.length = 0;
    failDates = true;
    await assert.rejects(() => createSignup(user, 42, ['2026-11-02']), /date write failed/);
    assert.equal(writes.at(-1)?.sql, 'ROLLBACK');
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
});
