// Unit tests for reading the import CSV files (no database needed).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { parseCsv, readTable } = await import('../src/services/import.service.js');

describe('import CSV reading', () => {
  test('splits rows and cells, keeping quoted commas and quotes', () => {
    const rows = parseCsv('a,b,c\r\n1,"Data, Systems","say ""hi"""\n\n2,x,y\n');
    assert.deepEqual(rows.map((row) => row.cells), [['a', 'b', 'c'], ['1', 'Data, Systems', 'say "hi"'], ['2', 'x', 'y']]);
    assert.deepEqual(rows.map((row) => row.line), [1, 2, 4]);
  });

  test('ignores a byte order mark and a missing last newline', () => {
    assert.deepEqual(parseCsv('﻿a,b\n1,2').map((row) => row.cells), [['a', 'b'], ['1', '2']]);
  });

  test('refuses a quote that is never closed', () => {
    assert.throws(() => parseCsv('a,b\n1,"open'), { status: 400, code: 'INVALID_IMPORT' });
  });

  test('reads named values in any column order and trims them', () => {
    const rows = readTable('term', 'season, term_id,year,start_date,end_date\nspring , 12,2027,2027-01-12,2027-05-08\n');
    assert.deepEqual(rows, [{ line: 2, values: { season: 'spring', term_id: '12', year: '2027', start_date: '2027-01-12', end_date: '2027-05-08' } }]);
  });

  test('names the missing, unknown or short column and the line', () => {
    assert.throws(() => readTable('term', 'term_id,season,year,start_date\n'), { message: 'term.csv: missing column end_date.' });
    assert.throws(() => readTable('course', 'course_id,dept_id,course_num,title,course_level,extra\n'), { message: 'course.csv: unknown column extra.' });
    assert.throws(() => readTable('meeting_time', 'section_id,day_of_week,start_time,end_time,room\n1,monday,10:00\n'),
      { message: 'meeting_time.csv line 2: expected 5 values, found 3.' });
    assert.throws(() => readTable('section', ''), { message: 'section.csv: the file is empty.' });
  });
});
