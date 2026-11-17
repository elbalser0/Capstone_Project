import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseNewProfessor } from '../src/routes/admin.routes.js';
import { mapAdminProfessor } from '../src/services/admin-professor.service.js';

const valid = {
  netid: 'abc123456', firstName: 'Maya', lastName: 'Lin', email: 'maya.lin@example.edu', rank: 'associate', deptId: '1',
};

function rejects(body: unknown, field: string) {
  assert.throws(() => parseNewProfessor(body), (error: { status: number; code: string; message: string }) => {
    assert.equal(error.status, 400);
    assert.equal(error.code, 'INVALID_PROFESSOR');
    assert.match(error.message, new RegExp(field), `message should name ${field}: ${error.message}`);
    return true;
  });
}

describe('parseNewProfessor', () => {
  test('accepts a valid professor', () => {
    assert.deepEqual(parseNewProfessor(valid), { ...valid, deptId: 1 });
  });

  test('trims every field, lowercases the netid, and ignores extra fields', () => {
    assert.deepEqual(parseNewProfessor({
      netid: '  ABC123456 ', firstName: ' Maya ', lastName: ' Lin\t', email: ' Maya.Lin@Example.edu ',
      rank: 'full', deptId: '12', isAc: true,
    }), { netid: 'abc123456', firstName: 'Maya', lastName: 'Lin', email: 'Maya.Lin@Example.edu', rank: 'full', deptId: 12 });
  });

  test('needs a JSON object', () => {
    for (const body of [undefined, null, 'abc123456', [valid]]) rejects(body, 'JSON object');
  });

  test('netid must be three letters and six digits', () => {
    for (const netid of [undefined, 123456789, '', 'ab1234567', 'abcd12345', 'abc12345', 'abc1234567', 'ab_123456']) {
      rejects({ ...valid, netid }, 'netid');
    }
  });

  test('names must not be blank', () => {
    for (const firstName of [undefined, '', '   ', 5]) rejects({ ...valid, firstName }, 'firstName');
    for (const lastName of [undefined, '', '   ', null]) rejects({ ...valid, lastName }, 'lastName');
  });

  test('email must look like an email address', () => {
    for (const email of [undefined, '', 'maya', 'maya@', '@example.edu', 'maya lin@example.edu', 'maya@example']) {
      rejects({ ...valid, email }, 'email');
    }
  });

  test('rank must be assistant, associate or full', () => {
    for (const rank of [undefined, 'professor', 'Full', 2]) rejects({ ...valid, rank }, 'rank');
  });

  test('deptId must be a positive integer sent as a string', () => {
    for (const deptId of [undefined, 1, '0', '-1', '01', '1.5', 'cs', '']) rejects({ ...valid, deptId }, 'deptId');
  });
});

test('an admin professor row maps to the API shape with string IDs', () => {
  assert.deepEqual(mapAdminProfessor({
    netid: 'abc123456', first_name: 'Maya', last_name: 'Lin', email: 'maya.lin@example.edu',
    rank: 'associate', dept_id: 3, dept_name: 'Mathematics', is_ac: true, is_active: false,
  }), {
    netid: 'abc123456',
    firstName: 'Maya',
    lastName: 'Lin',
    displayName: 'Dr. Maya Lin',
    email: 'maya.lin@example.edu',
    rank: 'associate',
    department: { deptId: '3', deptName: 'Mathematics' },
    isAc: true,
    isActive: false,
  });
});
