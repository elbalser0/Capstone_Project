// Database tests for GET /api/me/notifications. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { skip, sql, useTestDatabase } from './db-test-helper.js';

const { listMyNotifications, NOTIFICATION_LIMIT } = await import('../src/services/notification.service.js');

async function notify(recipient: string, subject: string, minutesAgo: number) {
  await sql(`INSERT INTO notification (cycle_id, recipient_netid, sent_by, notif_type, subject, sent_date)
             VALUES (1, $1, 'ac1', 'reminder', $2, now() - make_interval(mins => $3))`, [recipient, subject, minutesAgo]);
}

describe('notifications against the database', { skip }, () => {
  useTestDatabase();

  beforeEach(async () => {
    await sql(`TRUNCATE department, term, professor RESTART IDENTITY CASCADE`);
    await sql(`INSERT INTO department (dept_name) VALUES ('Computer Science')`);
    await sql(`INSERT INTO term (season, year, start_date, end_date)
               VALUES ('fall', 2020, CURRENT_DATE - 60, CURRENT_DATE + 90)`);
    for (const [netid, first, last] of [['ac1', 'Isabel', 'Nakamura'], ['me', 'Nadia', 'Chan'], ['other', 'Omar', 'Diaz']]) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term)
                 VALUES ($1, $2, $3, $1 || '@example.edu', 'associate', 1, 2, 1)`, [netid, first, last]);
    }
    await sql(`INSERT INTO ac_member (netid) VALUES ('ac1')`);
    await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
               VALUES (1, 'ac1', CURRENT_DATE - 30, CURRENT_DATE - 10, CURRENT_DATE + 30, CURRENT_DATE + 45)`);
  });

  test('a professor only gets their own notifications, newest first, with the sender', async () => {
    await notify('me', 'oldest', 30);
    await notify('other', 'not mine', 15);
    await notify('me', 'newest', 1);
    await notify('me', 'middle', 10);
    const result = await listMyNotifications('me');
    assert.deepEqual(result.map((n) => n.subject), ['newest', 'middle', 'oldest']);
    assert.deepEqual(result[0].sentBy, {
      netid: 'ac1', firstName: 'Isabel', lastName: 'Nakamura', displayName: 'Dr. Isabel Nakamura', rank: 'associate',
    });
  });

  test('a professor with no notifications gets an empty list', async () => {
    await notify('other', 'not mine', 1);
    assert.deepEqual(await listMyNotifications('me'), []);
  });

  test('only the newest notifications up to the limit are returned', async () => {
    await sql(`INSERT INTO notification (cycle_id, recipient_netid, sent_by, notif_type, subject, sent_date)
               SELECT 1, 'me', 'ac1', 'reminder', 'n' || i, now() - make_interval(mins => i)
               FROM generate_series(1, $1) AS i`, [NOTIFICATION_LIMIT + 5]);
    const result = await listMyNotifications('me');
    assert.equal(result.length, NOTIFICATION_LIMIT);
    assert.equal(result[0].subject, 'n1');
    assert.equal(result[NOTIFICATION_LIMIT - 1].subject, `n${NOTIFICATION_LIMIT}`);
  });
});
