import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseNewTerm } from '../src/routes/admin.routes.js';

const valid = { season: 'fall', year: 2027, startDate: '2027-08-24', endDate: '2027-12-11' };

function rejects(body: unknown, field: string) {
  assert.throws(() => parseNewTerm(body), (error: { status: number; code: string; message: string }) => {
    assert.equal(error.status, 400);
    assert.equal(error.code, 'INVALID_TERM');
    assert.match(error.message, new RegExp(field), `message should name ${field}: ${error.message}`);
    return true;
  });
}

describe('parseNewTerm', () => {
  test('accepts a valid term', () => {
    assert.deepEqual(parseNewTerm(valid), valid);
    assert.deepEqual(parseNewTerm({ ...valid, endDate: valid.startDate }), { ...valid, endDate: valid.startDate });
  });

  test('ignores extra fields', () => {
    assert.deepEqual(parseNewTerm({ ...valid, termId: '9' }), valid);
  });

  test('needs a JSON object', () => {
    for (const body of [undefined, null, 'fall', [valid]]) rejects(body, 'JSON object');
  });

  test('season must be fall or spring', () => {
    for (const season of [undefined, 'summer', 'Fall', 1]) rejects({ ...valid, season }, 'season');
  });

  test('year must be a whole number from 2000 to 2100', () => {
    for (const year of [undefined, '2027', 2027.5, 1999, 2101]) rejects({ ...valid, year }, 'year');
  });

  test('dates must be real YYYY-MM-DD dates', () => {
    for (const startDate of [undefined, '2027-8-24', '2027-02-30', 20270824]) rejects({ ...valid, startDate }, 'startDate');
    for (const endDate of [undefined, '12/11/2027', '2027-13-01']) rejects({ ...valid, endDate }, 'endDate');
  });

  test('endDate cannot be before startDate', () => {
    rejects({ ...valid, endDate: '2027-08-23' }, 'endDate');
  });

  test("startDate must be in the term's year", () => {
    rejects({ ...valid, year: 2028 }, 'startDate');
    rejects({ season: 'spring', year: 2028, startDate: '2027-12-30', endDate: '2028-05-08' }, 'startDate');
  });
});
