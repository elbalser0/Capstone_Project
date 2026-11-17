import type { PoolClient } from 'pg';
import { inTransaction } from '../db/transaction.js';
import { ApiError } from '../middleware/error.middleware.js';
import { EMAIL } from './forward.service.js';

// POST /api/admin/import loads data from the same CSV layout as Scripts/seed_data. The tables are
// listed in the order they are imported, so a row can point to a row from an earlier file.
export const IMPORT_TABLES = ['department', 'term', 'professor', 'ac_member', 'course', 'section', 'meeting_time'] as const;
export type ImportTable = (typeof IMPORT_TABLES)[number];
export type ImportFiles = Partial<Record<ImportTable, string>>;
export type ImportCounts = Record<ImportTable, number>;

const COLUMNS: Record<ImportTable, string[]> = {
  department: ['dept_id', 'dept_name'],
  professor: ['netid', 'first_name', 'last_name', 'email', 'dept_id', 'rank', 'eval_interval_years',
    'baseline_last_eval_term', 'start_term', 'is_active'],
  ac_member: ['netid', 'is_active'],
  term: ['term_id', 'season', 'year', 'start_date', 'end_date'],
  course: ['course_id', 'dept_id', 'course_num', 'title', 'course_level'],
  section: ['section_id', 'course_id', 'term_id', 'section_num', 'instructor_id', 'class_mode'],
  meeting_time: ['section_id', 'day_of_week', 'start_time', 'end_time', 'room'],
};
const RANKS = ['assistant', 'associate', 'full'];
// Same netid format as POST /api/admin/professors.
const NETID = /^[a-z]{3}\d{6}$/;
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
  const repeated = names.filter((name, i) => names.indexOf(name) !== i);
  if (repeated.length) throw badFile(table, `column ${[...new Set(repeated)].join(', ')} is listed twice.`);
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

function bool(table: ImportTable, row: Row, column: string) {
  const value = row.values[column].toLowerCase();
  if (value === 'true' || value === 't') return true;
  if (value === 'false' || value === 'f') return false;
  throw badRow(table, row, `${column} must be true or false.`);
}

// NetIDs are stored in lowercase, so ABC123456 and abc123456 are the same professor.
function netid(table: ImportTable, row: Row, column: string) {
  const value = required(table, row, column).toLowerCase();
  if (!NETID.test(value)) throw badRow(table, row, `${column} must be three letters followed by six digits, like abc123456.`);
  return value;
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
// rows are matched on what they are: a department by name, a term by season and year, a
// professor or AC member by netid, a course by department and number, a section by course, term
// and section number, a meeting by section, day and start.
// An ID that is not in the uploaded parent file refers to a row already in the database.
// Rows already in the database are skipped, so uploading the same files twice changes nothing.
export async function importData(files: ImportFiles): Promise<{ imported: ImportCounts; skipped: ImportCounts }> {
  const rows = Object.fromEntries(
    IMPORT_TABLES.filter((table) => files[table] !== undefined).map((table) => [table, readTable(table, files[table]!)]),
  ) as Partial<Record<ImportTable, Row[]>>;
  if (rows.department) uniqueIds('department', rows.department, 'dept_id');
  if (rows.term) uniqueIds('term', rows.term, 'term_id');
  if (rows.course) uniqueIds('course', rows.course, 'course_id');
  if (rows.section) uniqueIds('section', rows.section, 'section_id');

  return inTransaction(async (client) => {
    // One import at a time: course has no unique key to stop two imports adding it twice.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('admin_import'))");
    const zero = () => Object.fromEntries(IMPORT_TABLES.map((table) => [table, 0])) as ImportCounts;
    const imported = zero();
    const skipped = zero();
    const deptIds = await importDepartments(client, rows.department ?? [], imported, skipped);
    const termIds = await importTerms(client, rows.term ?? [], imported, skipped);
    await importProfessors(client, rows.professor ?? [], deptIds, termIds, imported, skipped);
    await importAcMembers(client, rows.ac_member ?? [], imported, skipped);
    const courseIds = await importCourses(client, rows.course ?? [], deptIds, imported, skipped);
    const sectionIds = await importSections(client, rows.section ?? [], termIds, courseIds, imported, skipped);
    await importMeetings(client, rows.meeting_time ?? [], sectionIds, imported, skipped);
    return { imported, skipped };
  });
}

// file ID -> database ID
type IdMap = Map<number, number>;

async function importDepartments(client: PoolClient, rows: Row[], imported: ImportCounts, skipped: ImportCounts): Promise<IdMap> {
  const ids: IdMap = new Map();
  if (!rows.length) return ids;
  // Every department name, loaded once (lowercase name -> dept_id).
  const byName = new Map<string, number>();
  for (const { dept_id, dept_name } of (await client.query<{ dept_id: number; dept_name: string }>(
    'SELECT dept_id, dept_name FROM department ORDER BY dept_id DESC')).rows) {
    byName.set(dept_name.toLowerCase(), dept_id);
  }
  const seen = new Set<string>();
  for (const row of rows) {
    const fileId = positiveInt('department', row, 'dept_id');
    const name = required('department', row, 'dept_name');
    if (seen.has(name.toLowerCase())) throw badRow('department', row, `department ${name} is listed twice.`);
    seen.add(name.toLowerCase());
    const existing = byName.get(name.toLowerCase());
    if (existing !== undefined) {
      skipped.department += 1;
      ids.set(fileId, existing);
      continue;
    }
    const added = await client.query<{ dept_id: number }>(
      'INSERT INTO department (dept_name) VALUES ($1) RETURNING dept_id', [name]);
    imported.department += 1;
    ids.set(fileId, added.rows[0].dept_id);
  }
  return ids;
}

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

    const existing = await client.query<{ term_id: number }>(
      'SELECT term_id FROM term WHERE season = $1 AND year = $2', [season, year]);
    if (existing.rows[0]) {
      skipped.term += 1;
      ids.set(fileId, existing.rows[0].term_id);
      continue;
    }
    await checkTermFits(client, row, season, year, start, end);
    const added = await client.query<{ term_id: number }>(`
      INSERT INTO term (season, year, start_date, end_date) VALUES ($1, $2, $3, $4)
      RETURNING term_id`, [season, year, start, end]);
    imported.term += 1;
    ids.set(fileId, added.rows[0].term_id);
  }
  return ids;
}

// Spring comes before fall in a year, the same order the due-date calculation uses.
const semesterIndex = (season: string, year: number) => year * 2 + (season === 'fall' ? 1 : 0);
const termLabel = (season: string, year: number) => `${season === 'fall' ? 'Fall' : 'Spring'} ${year}`;

// A new term may not overlap another term, and sorting terms by start date must keep season order
// (the same checks as the closed admin terms PR #207). Terms added earlier in this file count too.
async function checkTermFits(client: PoolClient, row: Row, season: string, year: number, start: string, end: string) {
  const label = termLabel(season, year);
  const { rows: [overlap] } = await client.query<{ season: string; year: number }>(`
    SELECT season, year FROM term
    WHERE start_date <= $2::date AND end_date >= $1::date
    ORDER BY start_date LIMIT 1`, [start, end]);
  if (overlap) {
    throw badRow('term', row, `${label}'s dates overlap ${termLabel(overlap.season, overlap.year)}.`);
  }
  const { rows: [near] } = await client.query<{
    prev_season: string | null; prev_year: number | null; next_season: string | null; next_year: number | null;
  }>(`
    SELECT prev.season AS prev_season, prev.year AS prev_year, next.season AS next_season, next.year AS next_year
    FROM (SELECT 1) AS one
    LEFT JOIN LATERAL (SELECT season, year FROM term WHERE start_date < $1::date
                       ORDER BY start_date DESC LIMIT 1) AS prev ON true
    LEFT JOIN LATERAL (SELECT season, year FROM term WHERE start_date > $1::date
                       ORDER BY start_date LIMIT 1) AS next ON true`, [start]);
  const index = semesterIndex(season, year);
  if (near.prev_season && semesterIndex(near.prev_season, near.prev_year!) >= index) {
    throw badRow('term', row, `${label} cannot start after ${termLabel(near.prev_season, near.prev_year!)}.`);
  }
  if (near.next_season && semesterIndex(near.next_season, near.next_year!) <= index) {
    throw badRow('term', row, `${label} cannot start before ${termLabel(near.next_season, near.next_year!)}.`);
  }
}

async function importCourses(
  client: PoolClient, rows: Row[], deptIds: IdMap, imported: ImportCounts, skipped: ImportCounts,
): Promise<IdMap> {
  const ids: IdMap = new Map();
  const departments = await resolveIds(client, deptIds, 'department', 'dept_id',
    rows.map((row) => positiveInt('course', row, 'dept_id')));
  const seen = new Set<string>();
  for (const row of rows) {
    const fileId = positiveInt('course', row, 'course_id');
    const deptFileId = positiveInt('course', row, 'dept_id');
    const deptId = departments.get(deptFileId);
    if (deptId === undefined) throw badRow('course', row, `dept_id ${deptFileId} is not in department.csv or the database.`);
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

// Every professor, loaded once: lowercase netid -> stored netid and active flag, and the email owners.
async function loadProfessors(client: PoolClient) {
  const { rows } = await client.query<{ netid: string; email: string; is_active: boolean }>(
    'SELECT netid, email, is_active FROM professor');
  return {
    byNetid: new Map(rows.map((row) => [row.netid.toLowerCase(), { netid: row.netid, isActive: row.is_active }])),
    byEmail: new Map(rows.map((row) => [row.email.toLowerCase(), row.netid])),
  };
}

// A professor already in the database (matched by netid, ignoring case) is skipped. The rank trigger
// sets eval_interval_years, so the file's value is not used and may be blank.
async function importProfessors(
  client: PoolClient, rows: Row[], deptIds: IdMap, termIds: IdMap, imported: ImportCounts, skipped: ImportCounts,
) {
  if (!rows.length) return;
  const optionalTerm = (row: Row, column: string) => (row.values[column] ? positiveInt('professor', row, column) : null);
  const departments = await resolveIds(client, deptIds, 'department', 'dept_id',
    rows.map((row) => positiveInt('professor', row, 'dept_id')));
  const terms = await resolveIds(client, termIds, 'term', 'term_id',
    rows.flatMap((row) => [optionalTerm(row, 'baseline_last_eval_term'), optionalTerm(row, 'start_term')])
      .filter((id): id is number => id !== null));
  const { byNetid, byEmail } = await loadProfessors(client);
  const seenNetids = new Set<string>();
  const seenEmails = new Set<string>();
  const added: unknown[][] = [];
  for (const row of rows) {
    const id = netid('professor', row, 'netid');
    const firstName = required('professor', row, 'first_name');
    const lastName = required('professor', row, 'last_name');
    const email = required('professor', row, 'email');
    if (!EMAIL.test(email)) throw badRow('professor', row, 'email must be a valid email address.');
    const rank = row.values.rank.toLowerCase();
    if (!RANKS.includes(rank)) throw badRow('professor', row, 'rank must be assistant, associate or full.');
    const deptFileId = positiveInt('professor', row, 'dept_id');
    const deptId = departments.get(deptFileId);
    if (deptId === undefined) throw badRow('professor', row, `dept_id ${deptFileId} is not in department.csv or the database.`);
    const termId = (column: string) => {
      const fileId = optionalTerm(row, column);
      if (fileId === null) return null;
      const found = terms.get(fileId);
      if (found === undefined) throw badRow('professor', row, `${column} ${fileId} is not in term.csv or the database.`);
      return found;
    };
    const baseline = termId('baseline_last_eval_term');
    const startTerm = termId('start_term');
    const isActive = bool('professor', row, 'is_active');
    if (seenNetids.has(id)) throw badRow('professor', row, `netid ${id} is listed twice.`);
    seenNetids.add(id);
    if (seenEmails.has(email.toLowerCase())) throw badRow('professor', row, `email ${email} is listed twice.`);
    seenEmails.add(email.toLowerCase());

    if (byNetid.has(id)) {
      skipped.professor += 1;
      continue;
    }
    const emailOwner = byEmail.get(email.toLowerCase());
    if (emailOwner) throw badRow('professor', row, `email ${email} already belongs to professor ${emailOwner}.`);
    added.push([id, firstName, lastName, email, rank, deptId, baseline, startTerm, isActive]);
  }
  if (!added.length) return;
  // One insert for all new professors. eval_interval_years is a placeholder the rank trigger replaces.
  const column = (i: number) => added.map((values) => values[i]);
  await client.query(`
    INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years,
                           baseline_last_eval_term, start_term, is_active)
    SELECT netid, first_name, last_name, email, rank, dept_id, 1, baseline, start_term, is_active
    FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[], $8::int[], $9::boolean[])
      AS f(netid, first_name, last_name, email, rank, dept_id, baseline, start_term, is_active)`,
  [column(0), column(1), column(2), column(3), column(4), column(5), column(6), column(7), column(8)]);
  imported.professor += added.length;
}

// An AC member already in the database is skipped, without checking it. A new AC member must be a
// professor, and only an active professor can be an active AC member.
async function importAcMembers(client: PoolClient, rows: Row[], imported: ImportCounts, skipped: ImportCounts) {
  if (!rows.length) return;
  const { byNetid } = await loadProfessors(client);
  const existing = new Set((await client.query<{ netid: string }>('SELECT netid FROM ac_member')).rows
    .map((row) => row.netid.toLowerCase()));
  const seen = new Set<string>();
  const added: { netid: string; isActive: boolean }[] = [];
  for (const row of rows) {
    const id = netid('ac_member', row, 'netid');
    const isActive = bool('ac_member', row, 'is_active');
    if (seen.has(id)) throw badRow('ac_member', row, `netid ${id} is listed twice.`);
    seen.add(id);
    if (existing.has(id)) {
      skipped.ac_member += 1;
      continue;
    }
    const professor = byNetid.get(id);
    if (!professor) throw badRow('ac_member', row, `netid ${id} is not in professor.csv or the database.`);
    if (isActive && !professor.isActive) {
      throw badRow('ac_member', row, `professor ${professor.netid} is inactive, so they cannot be an active AC member.`);
    }
    added.push({ netid: professor.netid, isActive });
  }
  if (!added.length) return;
  await client.query(`
    INSERT INTO ac_member (netid, is_active)
    SELECT * FROM unnest($1::text[], $2::boolean[])`,
  [added.map((member) => member.netid), added.map((member) => member.isActive)]);
  imported.ac_member += added.length;
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
  // Matched without regard to case; the stored netid is used.
  const professors = new Map((await client.query<{ netid: string }>('SELECT netid FROM professor')).rows
    .map((row) => [row.netid.toLowerCase(), row.netid]));
  const courses = await resolveIds(client, courseIds, 'course', 'course_id', rows.map((row) => positiveInt('section', row, 'course_id')));
  const terms = await resolveIds(client, termIds, 'term', 'term_id', rows.map((row) => positiveInt('section', row, 'term_id')));
  const sections = rows.map((row) => {
    const courseFileId = positiveInt('section', row, 'course_id');
    const termFileId = positiveInt('section', row, 'term_id');
    const instructorId = required('section', row, 'instructor_id');
    const instructor = professors.get(instructorId.toLowerCase());
    const mode = row.values.class_mode.toLowerCase();
    if (mode !== 'online' && mode !== 'in-person') throw badRow('section', row, 'class_mode must be online or in-person.');
    const courseId = courses.get(courseFileId);
    if (courseId === undefined) throw badRow('section', row, `course_id ${courseFileId} is not in course.csv or the database.`);
    const termId = terms.get(termFileId);
    if (termId === undefined) throw badRow('section', row, `term_id ${termFileId} is not in term.csv or the database.`);
    if (instructor === undefined) {
      throw badRow('section', row, `instructor ${instructorId} is not in professor.csv or the database.`);
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
