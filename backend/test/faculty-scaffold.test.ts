import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app.js';
import { mapCourseRows } from '../src/services/course.service.js';
import { mapProfessorRow } from '../src/services/user.service.js';

test('faculty endpoints require a verified login', async () => {
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

test('active committee membership maps to the frontend role', () => {
  const professor = {
    netid: 'abc123', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.edu',
    rank: 'associate' as const, dept_id: 5, dept_name: 'Computer Science', is_ac: true,
  };
  assert.deepEqual(mapProfessorRow(professor), {
    netid: 'abc123', firstName: 'Ada', lastName: 'Lovelace',
    displayName: 'Dr. Ada Lovelace', email: 'ada@example.edu', rank: 'associate',
    department: { deptId: '5', deptName: 'Computer Science' },
    role: 'AC', roles: ['FACULTY', 'AC'],
  });
  assert.equal(mapProfessorRow({ ...professor, is_ac: false }).role, 'faculty');
});
