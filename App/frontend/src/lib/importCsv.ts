export const IMPORT_TABLES = ['department', 'term', 'professor', 'ac_member', 'course', 'section', 'meeting_time', ] as const;
export type ImportType = (typeof IMPORT_TABLES)[number];

export interface Preview {
  filename: string;
  headers: string[];
  rows: string[][];
}

export const COLUMNS: Record<ImportType, string[]> = {
  professor: ['netid', 'first_name', 'last_name', 'email', 'dept_id', 'rank', 'eval_interval_years', 'baseline_last_eval_term', 'start_term', 'is_active'],
  department: ['dept_id', 'dept_name'],
  ac_member: ['netid', 'is_active'],
  term: ['term_id', 'season', 'year', 'start_date', 'end_date'],
  course: ['course_id', 'dept_id', 'course_num', 'title', 'course_level'],
  section: ['section_id', 'course_id', 'term_id', 'section_num', 'instructor_id', 'class_mode'],
  meeting_time: ['section_id', 'day_of_week', 'start_time', 'end_time', 'room'],
};

// Supports commas and line breaks inside quoted values,
// escaped quotes, Windows line endings, and a UTF-8 BOM.
function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;

  function finishRow() {
    row.push(cell);
    if (row.some((value) => value.trim() !== '')) {
      rows.push(row);
    }
    row = [];
    cell = '';
    closedQuote = false;
  }

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === ',') {
      row.push(cell);
      cell = '';
      closedQuote = false;
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && input[index + 1] === '\n') {
        index += 1;
      }
      finishRow();
    } else if (closedQuote) {
      if (character !== ' ' && character !== '\t') {
        throw new Error('Unexpected text after a closing quotation mark.');
      }
    } else if (character === '"') {
      if (cell !== '') {
        throw new Error('A quotation mark must begin at the start of a value.');
      }
      quoted = true;
    } else {
      cell += character;
    }
  }

  if (quoted) {
    throw new Error('A quoted value is missing its closing quotation mark.');
  }

  finishRow();
  return rows;
}

export function preparePreview(
  type: ImportType,
  filename: string,
  text: string,
): Preview {
  const [header, ...rows] = parseCsv(text);

  if (!header) throw new Error('The file is empty.');

  const headers = header.map((value) => value.trim().toLowerCase());
  const expected = COLUMNS[type];

  if (new Set(headers).size !== headers.length) {
    throw new Error('The file contains duplicate column names.');
  }

  const missing = expected.filter((column) => !headers.includes(column));
  const extra = headers.filter((column) => !expected.includes(column));

  if (missing.length > 0) {
    throw new Error(`Missing columns: ${missing.join(', ')}.`);
  }

  if (extra.length > 0) {
    throw new Error(`Unknown columns: ${extra.join(', ')}.`);
  }

  if (rows.length === 0) throw new Error('The file has no data rows.');
  if (rows.length > 20000) {
    throw new Error('The file can contain at most 20,000 data rows.');
  }

  const incorrectRow = rows.findIndex(
    (row) => row.length !== headers.length,
  );

  if (incorrectRow !== -1) {
    throw new Error(
      `Data row ${incorrectRow + 1} has the wrong number of values.`,
    );
  }

  return { filename, headers, rows };
}