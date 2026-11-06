import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapAdminProfessor } from '../src/services/admin-professor.service.js';

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
