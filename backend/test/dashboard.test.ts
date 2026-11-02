import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app.js';
import { mapDueByRank } from '../src/services/due-by-rank.service.js';
import { mapUnmatchedRows } from '../src/services/unmatched.service.js';

test('dashboard endpoints require a login', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${base}/api/dashboard/unmatched`)).status, 401);
    assert.equal((await fetch(`${base}/api/dashboard/due-by-rank`)).status, 401);
    assert.equal((await fetch(`${base}/api/dashboard/outstanding-observations`)).status, 401);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('due-by-rank includes zero counts and totals the saved due roster', () => {
  assert.deepEqual(mapDueByRank('3', [
    { rank: 'assistant', count: 2 }, { rank: 'full', count: 1 },
  ]), {
    cycleId: '3', total: 3, byRank: { assistant: 2, associate: 0, full: 1 },
  });
});

test('unmatched results contain one item per signup despite multiple meeting times', () => {
  const row: Parameters<typeof mapUnmatchedRows>[0][number] = {
    signup_id: 4, observee_netid: 'isabel', observee_first_name: 'Isabel',
    observee_last_name: 'Nakamura', observee_rank: 'associate', alert_type: 'no_observer',
    section_id: 8, section_num: '501', class_mode: 'in-person', course_num: '4347',
    title: 'Database Systems', course_level: 4000, dept_name: 'Computer Science',
    term_id: 11, season: 'fall', year: 2026, start_date: '2026-08-24', end_date: '2026-12-11',
    day_of_week: 'tuesday', start_time: '19:00:00', end_time: '20:15:00', room: 'ECN 2.455',
  };
  const items = mapUnmatchedRows([row, { ...row, day_of_week: 'thursday' }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].observee.displayName, 'Dr. Isabel Nakamura');
  assert.equal(items[0].section.meetings.length, 2);
  assert.equal(items[0].alertType, 'no_observer');
});
