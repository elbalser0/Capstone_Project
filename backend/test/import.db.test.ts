// Database tests for POST /api/admin/import. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { skip, sql, useTestDatabase } from './db-test-helper.js';

const { importRouter, MAX_IMPORT_BYTES } = await import('../src/routes/import.routes.js');
const { errorHandler } = await import('../src/middleware/error.middleware.js');
const { requireAdmin } = await import('../src/middleware/auth.middleware.js');

const TERM = 'term_id,season,year,start_date,end_date\n900,spring,2027,2027-01-12,2027-05-08\n';
const COURSE = 'course_id,dept_id,course_num,title,course_level\n500,1,4390,"Senior Design, Part 2",4000\n';
const SECTION = 'section_id,course_id,term_id,section_num,instructor_id,class_mode\n'
  + '7000,500,900,001,prof1,in-person\n7001,1,900,002,prof2,online\n';
const MEETING = 'section_id,day_of_week,start_time,end_time,room\n'
  + '7000,Tuesday,13:00,14:15,ECN 2.120\n7000,thursday,13:00,14:15,ECN 2.120\n7001,monday,9:00,9:50,\n';

// Posts CSV files the way the frontend does, behind the same admin check as app.ts.
// admin: an admin who is not a professor. ac1: an AC member who is not an admin. prof1: faculty.
async function upload(who: 'admin' | 'ac1' | 'prof1', files: Record<string, string>) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = who === 'admin' ? undefined : { netid: who, role: who === 'ac1' ? 'AC' : 'faculty' } as typeof req.user;
    req.account = { email: `${who}@example.edu`, professor: req.user, admin: who === 'admin' ? { email: 'admin@example.edu' } : undefined } as typeof req.account;
    next();
  });
  app.use('/api/admin/import', requireAdmin, importRouter);
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

// Full counts as the endpoint returns them: every table, zero unless given.
const TABLES = ['department', 'term', 'professor', 'ac_member', 'course', 'section', 'meeting_time'];
const counts = (some: Record<string, number> = {}) => Object.fromEntries(TABLES.map((t) => [t, some[t] ?? 0]));

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
    const result = await upload('admin', { term: TERM, course: COURSE, section: SECTION, meeting_time: MEETING });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      imported: counts({ term: 1, course: 1, section: 2, meeting_time: 3 }),
      skipped: counts(),
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
    await upload('admin', files);
    const again = await upload('admin', files);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, {
      imported: counts(),
      skipped: counts({ term: 1, course: 1, section: 2, meeting_time: 3 }),
    });
    assert.deepEqual([await count('term'), await count('course'), await count('section'), await count('meeting_time')], [2, 2, 2, 3]);
  });

  test('a term can be uploaded alone, then its sections can point at it', async () => {
    assert.equal((await upload('admin', { term: TERM })).status, 200);
    const sections = 'section_id,course_id,term_id,section_num,instructor_id,class_mode\n1,1,2,001,prof1,in-person\n';
    const result = await upload('admin', { section: sections });
    assert.equal(result.status, 200);
    assert.equal(result.body.imported.section, 1);
    assert.equal((await sql('SELECT term_id FROM section')).rows[0].term_id, 2);
  });

  test('an instructor who is not a professor stops the whole import', async () => {
    const sections = SECTION.replace('prof2', 'newprof');
    const result = await upload('admin', { term: TERM, course: COURSE, section: sections, meeting_time: MEETING });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'INVALID_IMPORT');
    assert.equal(result.body.error.message, 'section.csv line 3: instructor newprof is not in professor.csv or the database.');
    assert.deepEqual([await count('term'), await count('course'), await count('section')], [1, 1, 0]);
  });

  test('bad values name the file and line, and nothing is saved', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ term: TERM.replace('spring', 'summer') }, 'term.csv line 2: season must be fall or spring.'],
      [{ term: TERM.replace('2027-05-08', '2027-02-30') }, 'term.csv line 2: end_date must be a YYYY-MM-DD date.'],
      [{ course: COURSE.replace(',1,4390', ',9,4390') }, 'course.csv line 2: dept_id 9 is not in department.csv or the database.'],
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
      const result = await upload('admin', files);
      assert.equal(result.status, 400, message);
      assert.equal(result.body.error.message, message);
    }
    assert.deepEqual([await count('term'), await count('course'), await count('section'), await count('meeting_time')], [1, 1, 0, 0]);
  });

  test('a new term may not overlap another term or break season order, wherever it is in the file', async () => {
    const header = 'term_id,season,year,start_date,end_date\n';
    const cases: [string, string][] = [
      // Spring 2027 dated inside Fall 2026 (2026-08-24 to 2026-12-11).
      ['901,spring,2027,2026-11-01,2027-05-08', "term.csv line 2: Spring 2027's dates overlap Fall 2026."],
      // Starts before Fall 2026 but is a later semester.
      ['901,spring,2027,2026-01-12,2026-05-08', 'term.csv line 2: Spring 2027 cannot start before Fall 2026.'],
      // Starts after Fall 2026 but is an earlier semester.
      ['901,spring,2026,2027-01-12,2027-05-08', 'term.csv line 2: Spring 2026 cannot start after Fall 2026.'],
    ];
    for (const [line, message] of cases) {
      const result = await upload('admin', { term: header + line + '\n' });
      assert.equal(result.status, 400, message);
      assert.equal(result.body.error.message, message);
    }
    // Rows in the same file are checked against each other too.
    const clash = await upload('admin', { term: header + '901,spring,2027,2027-01-12,2027-05-08\n902,fall,2027,2027-05-01,2027-12-10\n' });
    assert.equal(clash.status, 400);
    assert.equal(clash.body.error.message, "term.csv line 3: Fall 2027's dates overlap Spring 2027.");
    assert.equal(await count('term'), 1);
    // Listed out of order but dated correctly, both are added.
    const ok = await upload('admin', { term: header + '902,fall,2027,2027-08-23,2027-12-10\n901,spring,2027,2027-01-12,2027-05-08\n' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.imported.term, 2);
    // A term that already exists is still skipped, not checked.
    const again = await upload('admin', { term: header + '900,fall,2026,2026-09-01,2026-12-01\n' });
    assert.equal(again.status, 200);
    assert.equal(again.body.skipped.term, 1);
  });

  const DEPT = 'dept_id,dept_name\n50,Mathematics\n51,computer science\n';
  const PROF_HEADER = 'netid,first_name,last_name,email,dept_id,rank,eval_interval_years,baseline_last_eval_term,start_term,is_active\n';
  const PROF = PROF_HEADER
    + 'ABC123456,Ada,Lovelace,ada@example.edu,50,associate,1,,900,True\n'
    + 'def654321,Alan,Turing,alan@example.edu,51,assistant,1,1,1,false\n';
  const AC = 'netid,is_active\nabc123456,true\n';

  test('imports departments, professors and AC members, linked to new and existing rows', async () => {
    const result = await upload('admin', {
      department: DEPT, term: TERM, professor: PROF, ac_member: AC,
      section: 'section_id,course_id,term_id,section_num,instructor_id,class_mode\n1,1,900,003,Abc123456,online\n',
    });
    assert.equal(result.status, 200);
    // "computer science" is already there (names match without regard to case), so it is skipped.
    assert.deepEqual(result.body, {
      imported: counts({ department: 1, term: 1, professor: 2, ac_member: 1, section: 1 }),
      skipped: counts({ department: 1 }),
    });
    const { rows } = await sql(`
      SELECT p.netid, d.dept_name, p.rank, p.eval_interval_years, p.baseline_last_eval_term, t.season, t.year, p.is_active
      FROM professor p JOIN department d USING (dept_id) JOIN term t ON t.term_id = p.start_term
      WHERE p.netid IN ('abc123456', 'def654321') ORDER BY p.netid`);
    // NetIDs are lowercased, the rank trigger sets the interval, and dept 51 / term 1 mean the existing rows.
    assert.deepEqual(rows, [
      { netid: 'abc123456', dept_name: 'Mathematics', rank: 'associate', eval_interval_years: 2,
        baseline_last_eval_term: null, season: 'spring', year: 2027, is_active: true },
      { netid: 'def654321', dept_name: 'Computer Science', rank: 'assistant', eval_interval_years: 1,
        baseline_last_eval_term: 1, season: 'fall', year: 2026, is_active: false },
    ]);
    assert.deepEqual((await sql(`SELECT netid, is_active FROM ac_member ORDER BY netid`)).rows,
      [{ netid: 'abc123456', is_active: true }, { netid: 'ac1', is_active: true }]);
    assert.equal((await sql(`SELECT instructor_id FROM section`)).rows[0].instructor_id, 'abc123456');
  });

  test('skips professors and AC members already there, matching netids without regard to case', async () => {
    await upload('admin', { department: DEPT, term: TERM, professor: PROF, ac_member: AC });
    const again = await upload('admin', {
      professor: PROF_HEADER + 'Abc123456,Changed,Name,other@example.edu,1,full,2,,,false\n',
      ac_member: 'netid,is_active\nABC123456,false\n',
    });
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, { imported: counts(), skipped: counts({ professor: 1, ac_member: 1 }) });
    // Nothing changed: skipping never updates a row.
    assert.deepEqual((await sql(`SELECT first_name, rank, is_active FROM professor WHERE netid = 'abc123456'`)).rows,
      [{ first_name: 'Ada', rank: 'associate', is_active: true }]);
    assert.deepEqual((await sql(`SELECT netid, is_active FROM ac_member ORDER BY netid`)).rows,
      [{ netid: 'abc123456', is_active: true }, { netid: 'ac1', is_active: true }]);
  });

  test('uploading the same files again still adds nothing after a professor on the AC is deactivated', async () => {
    const files = { department: DEPT, term: TERM, professor: PROF, ac_member: AC };
    assert.equal((await upload('admin', files)).status, 200);
    // What PATCH /api/admin/professors does when deactivating a professor who is on the AC.
    await sql(`UPDATE professor SET is_active = false WHERE netid = 'abc123456'`);
    await sql(`UPDATE ac_member SET is_active = false WHERE netid = 'abc123456'`);
    const again = await upload('admin', files);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, {
      imported: counts(), skipped: counts({ department: 2, term: 1, professor: 2, ac_member: 1 }),
    });
    assert.deepEqual((await sql(`SELECT is_active FROM ac_member WHERE netid = 'abc123456'`)).rows, [{ is_active: false }]);
  });

  test('eval_interval_years may be blank or disagree with the rank; the rank decides', async () => {
    const result = await upload('admin', {
      department: DEPT, term: TERM,
      professor: PROF_HEADER + 'ghi111111,G,H,g@example.edu,50,assistant,,,,true\njkl222222,J,K,j@example.edu,50,full,7,,,true\n',
    });
    assert.equal(result.status, 200);
    assert.deepEqual((await sql(`SELECT netid, eval_interval_years FROM professor WHERE netid IN ('ghi111111', 'jkl222222') ORDER BY netid`)).rows,
      [{ netid: 'ghi111111', eval_interval_years: 1 }, { netid: 'jkl222222', eval_interval_years: 2 }]);
  });

  test('an inactive professor cannot be an active AC member', async () => {
    const result = await upload('admin', {
      department: DEPT, term: TERM, professor: PROF, ac_member: 'netid,is_active\ndef654321,true\n',
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.message,
      'ac_member.csv line 2: professor def654321 is inactive, so they cannot be an active AC member.');
    assert.equal(await count('professor'), 3);
    // Listed as inactive, the same professor can be an AC member row.
    const ok = await upload('admin', { department: DEPT, term: TERM, professor: PROF, ac_member: 'netid,is_active\ndef654321,f\n' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.imported.ac_member, 1);
  });

  test('a bad department, professor or AC member row saves nothing and names the line', async () => {
    const prof = (line: string) => ({ department: DEPT, term: TERM, professor: PROF_HEADER + line });
    const cases: [Record<string, string>, string][] = [
      [{ department: 'dept_id,dept_name\n1,Math\n2,MATH\n' }, 'department.csv line 3: department MATH is listed twice.'],
      [{ department: 'dept_id,dept_name\n1,\n' }, 'department.csv line 2: dept_name is required.'],
      [prof('ab1234567,A,B,a@example.edu,50,full,2,,,true\n'),
        'professor.csv line 2: netid must be three letters followed by six digits, like abc123456.'],
      [prof('abc123456,A,B,not-an-email,50,full,2,,,true\n'), 'professor.csv line 2: email must be a valid email address.'],
      [prof(`abc123456,A,B,${'a'.repeat(65)}@example.edu,50,full,2,,,true\n`), 'professor.csv line 2: email must be a valid email address.'],
      [prof('abc123456,A,B,a@example.edu,50,lecturer,2,,,true\n'), 'professor.csv line 2: rank must be assistant, associate or full.'],
      [prof('abc123456,A,B,a@example.edu,50,full,2,,,yes\n'), 'professor.csv line 2: is_active must be true or false.'],
      [prof('abc123456,A,B,a@example.edu,99,full,2,,,true\n'), 'professor.csv line 2: dept_id 99 is not in department.csv or the database.'],
      [prof('abc123456,A,B,a@example.edu,50,full,2,,77,true\n'), 'professor.csv line 2: start_term 77 is not in term.csv or the database.'],
      [prof('abc123456,A,B,a@example.edu,50,full,2,,,true\nABC123456,C,D,c@example.edu,50,full,2,,,true\n'),
        'professor.csv line 3: netid abc123456 is listed twice.'],
      [prof('abc123456,A,B,PROF1@example.edu,50,full,2,,,true\n'),
        'professor.csv line 2: email PROF1@example.edu already belongs to professor prof1.'],
      [{ ac_member: 'netid,is_active\nzzz000000,true\n' }, 'ac_member.csv line 2: netid zzz000000 is not in professor.csv or the database.'],
    ];
    for (const [files, message] of cases) {
      const result = await upload('admin', files);
      assert.equal(result.status, 400, message);
      assert.equal(result.body.error.message, message);
    }
    assert.deepEqual([await count('department'), await count('term'), await count('professor'), await count('ac_member')], [1, 1, 3, 1]);
  });

  test('refuses unknown or empty uploads, and non-admins (faculty and AC)', async () => {
    assert.equal((await upload('admin', { rooms: 'a\n' })).body.error.message,
      'Unknown file rooms. Send department, term, professor, ac_member, course, section, meeting_time.');
    assert.equal((await upload('admin', {})).body.error.message, 'Send at least one CSV file.');
    const faculty = await upload('prof1', { term: TERM });
    assert.equal(faculty.status, 403);
    // An AC member who is not an admin can no longer import.
    const ac = await upload('ac1', { term: TERM });
    assert.equal(ac.status, 403);
    assert.equal(ac.body.error.message, 'Only admins can do this.');
    assert.equal(await count('term'), 1);
  });

  test('refuses an upload over the size limit with 413', async () => {
    const result = await upload('admin', { term: TERM + 'x'.repeat(MAX_IMPORT_BYTES) });
    assert.equal(result.status, 413);
    assert.equal(result.body.error.code, 'TOO_LARGE');
  });
});
