import type { PoolClient } from 'pg';
import { inTransaction } from '../db/transaction.js';
import { ApiError } from '../middleware/error.middleware.js';

// POST /api/admin/import loads a new semester's teaching data from the same CSV
// layout as Scripts/seed_data: term, course, section and meeting_time.
// Professors and departments are added on the admin pages, not here.
export const IMPORT_TABLES = ['term', 'course', 'section', 'meeting_time'] as const;
export type ImportTable = (typeof IMPORT_TABLES)[number];
export type ImportFiles = Partial<Record<ImportTable, string>>;
export type ImportCounts = Record<ImportTable, number>;

const COLUMNS: Record<ImportTable, string[]> = {
  term: ['term_id', 'season', 'year', 'start_date', 'end_date'],
  course: ['course_id', 'dept_id', 'course_num', 'title', 'course_level'],
  section: ['section_id', 'course_id', 'term_id', 'section_num', 'instructor_id', 'class_mode'],
  meeting_time: ['section_id', 'day_of_week', 'start_time', 'end_time', 'room'],
};
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const MAX_ROWS = 20000;

type Row = { line: number; values: Record<string, string> };

const badFile = (table: ImportTable, message: string) =>
  new ApiError(400, 'INVALID_IMPORT', `${table}.csv: ${message}`);
const badRow = (table: ImportTable, row: Row, message: string) =>
  new ApiError(400, 'INVALID_IMPORT', `${table}.csv line ${row.line}: ${message}`);

// Splits CSV text into rows of cells. Handles quoted cells ("a, b" and "" for a quote).
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const input = text.replace(/^﻿/, '');
  const endRow = () => {
    cells.push(cell);
    if (cells.some((value) => value.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = [];
    cell = '';
  };
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else { if (char === '\n') line += 1; cell += char; }
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') { cells.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      endRow();
      line += 1;
      rowLine = line;
    } else cell += char;
  }
  if (quoted) throw new ApiError(400, 'INVALID_IMPORT', `A quoted value starting on line ${rowLine} is never closed.`);
  endRow();
  return rows;
}

// Checks the header and turns each data row into named values.
export function readTable(table: ImportTable, text: string): Row[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw badFile(table, 'the file is empty.');
  const names = header.cells.map((name) => name.trim().toLowerCase());
  const missing = COLUMNS[table].filter((name) => !names.includes(name));
  if (missing.length) throw badFile(table, `missing column ${missing.join(', ')}.`);
  const extra = names.filter((name) => !COLUMNS[table].includes(name));
  if (extra.length) throw badFile(table, `unknown column ${extra.join(', ')}.`);
  if (rows.length > MAX_ROWS) throw badFile(table, `at most ${MAX_ROWS} rows per file.`);
  return rows.map(({ line, cells }) => {
    if (cells.length !== names.length) {
      throw new ApiError(400, 'INVALID_IMPORT', `${table}.csv line ${line}: expected ${names.length} values, found ${cells.length}.`);
    }
    return { line, values: Object.fromEntries(names.map((name, i) => [name, cells[i].trim()])) };
  });
}

function positiveInt(table: ImportTable, row: Row, column: string) {
  const value = row.values[column];
  if (!/^[1-9]\d{0,8}$/.test(value)) throw badRow(table, row, `${column} must be a positive whole number.`);
  return Number(value);
}

function required(table: ImportTable, row: Row, column: string) {
  const value = row.values[column];
  if (!value) throw badRow(table, row, `${column} is required.`);
  return value;
}

function isoDate(table: ImportTable, row: Row, column: string) {
  const value = row.values[column];
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRow(table, row, `${column} must be a YYYY-MM-DD date.`);
  }
  return value;
}

function time(table: ImportTable, row: Row, column: string) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(row.values[column]);
  if (!match) throw badRow(table, row, `${column} must be a time like 13:00.`);
  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] ?? '00'}`;
}

// Every file ID must be listed once.
function uniqueIds(table: ImportTable, rows: Row[], column: string) {
  const seen = new Set<number>();
  for (const row of rows) {
    const id = positiveInt(table, row, column);
    if (seen.has(id)) throw badRow(table, row, `${column} ${id} is listed twice.`);
    seen.add(id);
  }
}

// The IDs in the files only link the files to each other. The database picks the real IDs and
// rows are matched on what they are: a term by season and year, a course by department and
// number, a section by course, term and section number, a meeting by section, day and start.
// An ID that is not in the uploaded parent file refers to a row already in the database.
// Rows already in the database are skipped, so uploading the same files twice changes nothing.
export async function importData(files: ImportFiles): Promise<{ imported: ImportCounts; skipped: ImportCounts }> {
  const rows = Object.fromEntries(
    IMPORT_TABLES.filter((table) => files[table] !== undefined).map((table) => [table, readTable(table, files[table]!)]),
  ) as Partial<Record<ImportTable, Row[]>>;
  if (rows.term) uniqueIds('term', rows.term, 'term_id');
  if (rows.course) uniqueIds('course', rows.course, 'course_id');
  if (rows.section) uniqueIds('section', rows.section, 'section_id');

  return inTransaction(async (client) => {
    // One import at a time: course has no unique key to stop two imports adding it twice.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('admin_import'))");
    const imported: ImportCounts = { term: 0, course: 0, section: 0, meeting_time: 0 };
    const skipped: ImportCounts = { term: 0, course: 0, section: 0, meeting_time: 0 };
    const termIds = await importTerms(client, rows.term ?? [], imported, skipped);
    const courseIds = await importCourses(client, rows.course ?? [], imported, skipped);
    const sectionIds = await importSections(client, rows.section ?? [], termIds, courseIds, imported, skipped);
    await importMeetings(client, rows.meeting_time ?? [], sectionIds, imported, skipped);
    return { imported, skipped };
  });
}

// file ID -> database ID
type IdMap = Map<number, number>;

async function importTerms(client: PoolClient, rows: Row[], imported: ImportCounts, skipped: ImportCounts): Promise<IdMap> {
  const ids: IdMap = new Map();
  const seen = new Set<string>();
  for (const row of rows) {
    const fileId = positiveInt('term', row, 'term_id');
    const season = row.values.season.toLowerCase();
    if (season !== 'fall' && season !== 'spring') throw badRow('term', row, 'season must be fall or spring.');
    const year = positiveInt('term', row, 'year');
    if (year < 2000 || year > 2100) throw badRow('term', row, 'year must be from 2000 to 2100.');
    const start = isoDate('term', row, 'start_date');
    const end = isoDate('term', row, 'end_date');
    if (end < start) throw badRow('term', row, 'end_date cannot be before start_date.');
    if (seen.has(`${season} ${year}`)) throw badRow('term', row, `${season} ${year} is listed twice.`);
    seen.add(`${season} ${year}`);

    const added = await client.query<{ term_id: number }>(`
      INSERT INTO term (season, year, start_date, end_date) VALUES ($1, $2, $3, $4)
      ON CONFLICT (season, year) DO NOTHING RETURNING term_id`, [season, year, start, end]);
    if (added.rows[0]) {
      imported.term += 1;
      ids.set(fileId, added.rows[0].term_id);
    } else {
      skipped.term += 1;
      const existing = await client.query<{ term_id: number }>(
        'SELECT term_id FROM term WHERE season = $1 AND year = $2', [season, year]);
      ids.set(fileId, existing.rows[0].term_id);
    }
  }
  return ids;
}

async function importCourses(client: PoolClient, rows: Row[], imported: ImportCounts, skipped: ImportCounts): Promise<IdMap> {
  const ids: IdMap = new Map();
  const departments = new Set((await client.query<{ dept_id: number }>('SELECT dept_id FROM department')).rows.map((row) => row.dept_id));
  const seen = new Set<string>();
  for (const row of rows) {
    const fileId = positiveInt('course', row, 'course_id');
    const deptId = positiveInt('course', row, 'dept_id');
    if (!departments.has(deptId)) throw badRow('course', row, `department ${deptId} does not exist. Add it on the admin page first.`);
    const courseNum = required('course', row, 'course_num');
    const title = required('course', row, 'title');
    const level = positiveInt('course', row, 'course_level');
    if (seen.has(`${deptId} ${courseNum}`)) throw badRow('course', row, `course ${courseNum} in department ${deptId} is listed twice.`);
    seen.add(`${deptId} ${courseNum}`);

    const existing = await client.query<{ course_id: number }>(
      'SELECT course_id FROM course WHERE dept_id = $1 AND course_num = $2 ORDER BY course_id LIMIT 1', [deptId, courseNum]);
    if (existing.rows[0]) {
      skipped.course += 1;
      ids.set(fileId, existing.rows[0].course_id);
    } else {
      const added = await client.query<{ course_id: number }>(`
        INSERT INTO course (dept_id, course_num, title, course_level) VALUES ($1, $2, $3, $4)
        RETURNING course_id`, [deptId, courseNum, title, level]);
      imported.course += 1;
      ids.set(fileId, added.rows[0].course_id);
    }
  }
  return ids;
}

// Maps each file ID to a database ID: from the uploaded parent file, or else a row already in the database.
async function resolveIds(client: PoolClient, fromFile: IdMap, sqlTable: string, idColumn: string, fileIds: number[]): Promise<IdMap> {
  const ids = new Map(fromFile);
  const unknown = [...new Set(fileIds.filter((id) => !fromFile.has(id)))];
  if (unknown.length) {
    const { rows } = await client.query<{ id: number }>(`SELECT ${idColumn} AS id FROM ${sqlTable} WHERE ${idColumn} = ANY($1)`, [unknown]);
    for (const { id } of rows) ids.set(id, id);
  }
  return ids;
}

async function importSections(
  client: PoolClient, rows: Row[], termIds: IdMap, courseIds: IdMap, imported: ImportCounts, skipped: ImportCounts,
): Promise<IdMap> {
  if (!rows.length) return new Map();
  const professors = new Set((await client.query<{ netid: string }>('SELECT netid FROM professor')).rows.map((row) => row.netid));
  const courses = await resolveIds(client, courseIds, 'course', 'course_id', rows.map((row) => positiveInt('section', row, 'course_id')));
  const terms = await resolveIds(client, termIds, 'term', 'term_id', rows.map((row) => positiveInt('section', row, 'term_id')));
  const sections = rows.map((row) => {
    const courseFileId = positiveInt('section', row, 'course_id');
    const termFileId = positiveInt('section', row, 'term_id');
    const instructor = required('section', row, 'instructor_id');
    const mode = row.values.class_mode.toLowerCase();
    if (mode !== 'online' && mode !== 'in-person') throw badRow('section', row, 'class_mode must be online or in-person.');
    const courseId = courses.get(courseFileId);
    if (courseId === undefined) throw badRow('section', row, `course_id ${courseFileId} is not in course.csv or the database.`);
    const termId = terms.get(termFileId);
    if (termId === undefined) throw badRow('section', row, `term_id ${termFileId} is not in term.csv or the database.`);
    if (!professors.has(instructor)) {
      throw badRow('section', row, `instructor ${instructor} is not a professor yet. Add them on the admin page first.`);
    }
    return { fileId: positiveInt('section', row, 'section_id'), courseId, termId, sectionNum: required('section', row, 'section_num'), instructor, mode };
  });
  const key = (courseId: number, termId: number, sectionNum: string) => `${courseId}|${termId}|${sectionNum}`;
  const seen = new Set<string>();
  sections.forEach((section, i) => {
    const k = key(section.courseId, section.termId, section.sectionNum);
    if (seen.has(k)) throw badRow('section', rows[i], `section ${section.sectionNum} of this course and term is listed twice.`);
    seen.add(k);
  });

  // One insert for all rows; rows already there are skipped and looked up afterwards.
  const added = await client.query<{ section_id: number; course_id: number; term_id: number; section_num: string }>(`
    INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode)
    SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::text[], $5::text[])
    ON CONFLICT (course_id, term_id, section_num) DO NOTHING
    RETURNING section_id, course_id, term_id, section_num`,
  [sections.map((s) => s.courseId), sections.map((s) => s.termId), sections.map((s) => s.sectionNum),
    sections.map((s) => s.instructor), sections.map((s) => s.mode)]);
  imported.section += added.rowCount ?? 0;
  skipped.section += sections.length - (added.rowCount ?? 0);
  const found = await client.query<{ section_id: number; course_id: number; term_id: number; section_num: string }>(`
    SELECT s.section_id, s.course_id, s.term_id, s.section_num
    FROM section AS s
    JOIN unnest($1::int[], $2::int[], $3::text[]) AS f(course_id, term_id, section_num)
      ON f.course_id = s.course_id AND f.term_id = s.term_id AND f.section_num = s.section_num`,
  [sections.map((s) => s.courseId), sections.map((s) => s.termId), sections.map((s) => s.sectionNum)]);
  const byKey = new Map(found.rows.map((row) => [key(row.course_id, row.term_id, row.section_num), row.section_id]));
  return new Map(sections.map((s) => [s.fileId, byKey.get(key(s.courseId, s.termId, s.sectionNum))!]));
}

async function importMeetings(client: PoolClient, rows: Row[], sectionIds: IdMap, imported: ImportCounts, skipped: ImportCounts) {
  if (!rows.length) return;
  const sections = await resolveIds(client, sectionIds, 'section', 'section_id',
    rows.map((row) => positiveInt('meeting_time', row, 'section_id')));
  const seen = new Set<string>();
  const meetings = rows.map((row) => {
    const sectionFileId = positiveInt('meeting_time', row, 'section_id');
    const day = row.values.day_of_week.toLowerCase();
    if (!DAYS.includes(day)) throw badRow('meeting_time', row, 'day_of_week must be a day like monday.');
    const start = time('meeting_time', row, 'start_time');
    const end = time('meeting_time', row, 'end_time');
    if (end <= start) throw badRow('meeting_time', row, 'end_time must be after start_time.');
    const sectionId = sections.get(sectionFileId);
    if (sectionId === undefined) throw badRow('meeting_time', row, `section_id ${sectionFileId} is not in section.csv or the database.`);
    if (seen.has(`${sectionId}|${day}|${start}`)) throw badRow('meeting_time', row, `this section's ${day} ${start} meeting is listed twice.`);
    seen.add(`${sectionId}|${day}|${start}`);
    return { sectionId, day, start, end, room: row.values.room || null };
  });
  const added = await client.query(`
    INSERT INTO meeting_time (section_id, day_of_week, start_time, end_time, room)
    SELECT * FROM unnest($1::int[], $2::text[], $3::time[], $4::time[], $5::text[])
    ON CONFLICT (section_id, day_of_week, start_time) DO NOTHING`,
  [meetings.map((m) => m.sectionId), meetings.map((m) => m.day), meetings.map((m) => m.start),
    meetings.map((m) => m.end), meetings.map((m) => m.room)]);
  imported.meeting_time += added.rowCount ?? 0;
  skipped.meeting_time += meetings.length - (added.rowCount ?? 0);
}
