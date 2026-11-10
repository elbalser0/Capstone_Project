// Database tests for POST /api/admin/import. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { skip, sql, useTestDatabase } from './db-test-helper.js';

const { importRouter, MAX_IMPORT_BYTES } = await import('../src/routes/import.routes.js');
const { errorHandler } = await import('../src/middleware/error.middleware.js');

const TERM = 'term_id,season,year,start_date,end_date\n900,spring,2027,2027-01-12,2027-05-08\n';
const COURSE = 'course_id,dept_id,course_num,title,course_level\n500,1,4390,"Senior Design, Part 2",4000\n';
const SECTION = 'section_id,course_id,term_id,section_num,instructor_id,class_mode\n'
  + '7000,500,900,001,prof1,in-person\n7001,1,900,002,prof2,online\n';
const MEETING = 'section_id,day_of_week,start_time,end_time,room\n'
  + '7000,Tuesday,13:00,14:15,ECN 2.120\n7000,thursday,13:00,14:15,ECN 2.120\n7001,monday,9:00,9:50,\n';

// Posts CSV files the way the frontend does, as the given professor.
async function upload(netid: string, files: Record<string, string>) {
  const app = express();
  app.use((req, _res, next) => { req.user = { netid, role: netid === 'ac1' ? 'AC' : 'faculty' } as typeof req.user; next(); });
  app.use('/api/admin/import', importRouter);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const form = new FormData();
    for (const [name, text] of Object.entries(files)) form.append(name, new Blob([text], { type: 'text/csv' }), `${name}.csv`);
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/import`, { method: 'POST', body: form });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const count = async (table: string) => Number((await sql(`SELECT count(*) FROM ${table}`)).rows[0].count);

describe('admin import against the database', { skip }, () => {
  useTestDatabase();

  // One department, fall 2026 with course 1 (CS 1337), and professors ac1 (AC), prof1, prof2.
  beforeEach(async () => {
    await sql('TRUNCATE department, term, professor RESTART IDENTITY CASCADE');
    await sql(`INSERT INTO department (dept_name) VALUES ('Computer Science')`);
    await sql(`INSERT INTO term (season, year, start_date, end_date) VALUES ('fall', 2026, '2026-08-24', '2026-12-11')`);
    for (const netid of ['ac1', 'prof1', 'prof2']) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term)
                 VALUES ($1, $1, 'Test', $1 || '@example.edu', 'full', 1, 2, 1)`, [netid]);
    }
    await sql(`INSERT INTO ac_member (netid) VALUES ('ac1')`);
    await sql(`INSERT INTO course (dept_id, course_num, title, course_level) VALUES (1, '1337', 'CS I', 1000)`);
  });

  test('imports a new semester, linking the files by their own IDs', async () => {
    const result = await upload('ac1', { term: TERM, course: COURSE, section: SECTION, meeting_time: MEETING });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      imported: { term: 1, course: 1, section: 2, meeting_time: 3 },
      skipped: { term: 0, course: 0, section: 0, meeting_time: 0 },
    });
    const { rows } = await sql(`
      SELECT c.course_num, c.title, s.section_num, s.instructor_id, s.class_mode, t.season, t.year,
             string_agg(m.day_of_week || ' ' || m.start_time || ' ' || coalesce(m.room, '-'), ', ' ORDER BY m.day_of_week) AS meetings
      FROM section s JOIN course c USING (course_id) JOIN term t USING (term_id) JOIN meeting_time m USING (section_id)
      GROUP BY 1, 2, 3, 4, 5, 6, 7 ORDER BY s.section_num`);
    assert.deepEqual(rows, [
      { course_num: '4390', title: 'Senior Design, Part 2', section_num: '001', instructor_id: 'prof1', class_mode: 'in-person',
        season: 'spring', year: 2027, meetings: 'thursday 13:00:00 ECN 2.120, tuesday 13:00:00 ECN 2.120' },
      // course_id 1 is not in course.csv, so it means the existing course 1337.
      { course_num: '1337', title: 'CS I', section_num: '002', instructor_id: 'prof2', class_mode: 'online',
        season: 'spring', year: 2027, meetings: 'monday 09:00:00 -' },
    ]);
  });

  test('uploading the same files again adds nothing', async () => {
    const files = { term: TERM, course: COURSE, section: SECTION, meeting_time: MEETING };
    await upload('ac1', files);
    const again = await upload('ac1', files);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, {
      imported: { term: 0, course: 0, section: 0, meeting_time: 0 },
      skipped: { term: 1, course: 1, section: 2, meeting_time: 3 },
    });
    assert.deepEqual([await count('term'), await count('course'), await count('section'), await count('meeting_time')], [2, 2, 2, 3]);
  });

  test('a term can be uploaded alone, then its sections can point at it', async () => {
    assert.equal((await upload('ac1', { term: TERM })).status, 200);
    const sections = 'section_id,course_id,term_id,section_num,instructor_id,class_mode\n1,1,2,001,prof1,in-person\n';
    const result = await upload('ac1', { section: sections });
    assert.equal(result.status, 200);
    assert.equal(result.body.imported.section, 1);
    assert.equal((await sql('SELECT term_id FROM section')).rows[0].term_id, 2);
  });

  test('an instructor who is not a professor stops the whole import', async () => {
    const sections = SECTION.replace('prof2', 'newprof');
    const result = await upload('ac1', { term: TERM, course: COURSE, section: sections, meeting_time: MEETING });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'INVALID_IMPORT');
    assert.equal(result.body.error.message, 'section.csv line 3: instructor newprof is not a professor yet. Add them on the admin page first.');
    assert.deepEqual([await count('term'), await count('course'), await count('section')], [1, 1, 0]);
  });

  test('bad values name the file and line, and nothing is saved', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ term: TERM.replace('spring', 'summer') }, 'term.csv line 2: season must be fall or spring.'],
      [{ term: TERM.replace('2027-05-08', '2027-02-30') }, 'term.csv line 2: end_date must be a YYYY-MM-DD date.'],
      [{ course: COURSE.replace(',1,4390', ',9,4390') }, 'course.csv line 2: department 9 does not exist. Add it on the admin page first.'],
      [{ term: TERM, course: COURSE, section: SECTION.replace('online', 'hybrid') }, 'section.csv line 3: class_mode must be online or in-person.'],
      [{ term: TERM, section: SECTION.replace(',500,', ',77,') }, 'section.csv line 2: course_id 77 is not in course.csv or the database.'],
      [{ section: 'section_id,course_id,term_id,section_num,instructor_id,class_mode\n1,1,88,001,prof1,online\n' },
        'section.csv line 2: term_id 88 is not in term.csv or the database.'],
      [{ meeting_time: MEETING }, 'meeting_time.csv line 2: section_id 7000 is not in section.csv or the database.'],
      [{ term: TERM, course: COURSE, section: SECTION, meeting_time: MEETING.replace('14:15', '12:00') },
        'meeting_time.csv line 2: end_time must be after start_time.'],
      [{ term: TERM, course: COURSE, section: SECTION, meeting_time: MEETING.replace('Tuesday', 'Funday') },
        'meeting_time.csv line 2: day_of_week must be a day like monday.'],
      [{ section: SECTION.replace('7001', '7000') }, 'section.csv line 3: section_id 7000 is listed twice.'],
    ];
    for (const [files, message] of cases) {
      const result = await upload('ac1', files);
      assert.equal(result.status, 400, message);
      assert.equal(result.body.error.message, message);
    }
    assert.deepEqual([await count('term'), await count('course'), await count('section'), await count('meeting_time')], [1, 1, 0, 0]);
  });

  test('refuses professors and departments, unknown or empty uploads, and non-AC users', async () => {
    const professor = await upload('ac1', { professor: 'netid\n' });
    assert.equal(professor.status, 400);
    assert.equal(professor.body.error.message, 'professor.csv is not imported here. Add professors on the admin page.');
    assert.equal((await upload('ac1', { rooms: 'a\n' })).body.error.message, 'Unknown file rooms. Send term, course, section or meeting_time.');
    assert.equal((await upload('ac1', {})).body.error.message, 'Send at least one CSV file.');
    const faculty = await upload('prof1', { term: TERM });
    assert.equal(faculty.status, 403);
    assert.equal(await count('term'), 1);
  });

  test('refuses an upload over the size limit with 413', async () => {
    const result = await upload('ac1', { term: TERM + 'x'.repeat(MAX_IMPORT_BYTES) });
    assert.equal(result.status, 413);
    assert.equal(result.body.error.code, 'TOO_LARGE');
  });
});
