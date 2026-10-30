// Database tests for the AC notification-sending endpoints. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { skip, sql, useTestDatabase } from './db-test-helper.js';

const { listMyNotifications, sendDueReminders, sendListsReady, sendSurveyOpen } =
  await import('../src/services/notification.service.js');

async function sent(type: string) {
  const { rows } = await sql(`SELECT recipient_netid, sent_by, cycle_id, subject FROM notification
                              WHERE notif_type = $1 ORDER BY recipient_netid`, [type]);
  return rows;
}

describe('sending notifications against the database', { skip }, () => {
  useTestDatabase();

  // Cycle 1 (current): due1 and due2 are due, due1 signed up; obs observes due1.
  // ee3 signed up but has no observer list. Cycle 2 is an older cycle with its own due row.
  beforeEach(async () => {
    await sql(`TRUNCATE department, term, professor RESTART IDENTITY CASCADE`);
    await sql(`INSERT INTO department (dept_name) VALUES ('Computer Science')`);
    await sql(`INSERT INTO term (season, year, start_date, end_date)
               VALUES ('fall', 2026, CURRENT_DATE - 60, CURRENT_DATE + 90),
                      ('spring', 2026, CURRENT_DATE - 300, CURRENT_DATE - 200)`);
    for (const netid of ['ac1', 'due1', 'due2', 'ee3', 'obs', 'old']) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term)
                 VALUES ($1, $1, 'Test', $1 || '@example.edu', 'full', 1, 2, 1)`, [netid]);
    }
    await sql(`INSERT INTO ac_member (netid) VALUES ('ac1')`);
    await sql(`INSERT INTO template_version (version_no, status, created_by, published_date) VALUES (1, 'live', 'ac1', now())`);
    await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
               VALUES (1, 'ac1', CURRENT_DATE - 30, CURRENT_DATE + 5, CURRENT_DATE + 30, CURRENT_DATE + 45),
                      (2, 'ac1', CURRENT_DATE - 300, CURRENT_DATE - 290, CURRENT_DATE - 250, CURRENT_DATE - 220)`);
    await sql(`INSERT INTO eval_due (cycle_id, netid, due_status) VALUES (1, 'due1', 'due'), (1, 'due2', 'overdue'), (2, 'old', 'due')`);
    await sql(`INSERT INTO course (dept_id, course_num, title, course_level) VALUES (1, '1337', 'CS I', 1000)`);
    await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode)
               VALUES (1, 1, '001', 'due1', 'in-person'), (1, 1, '002', 'ee3', 'in-person')`);
    await sql(`INSERT INTO sign_up (cycle_id, observee_netid, section_id) VALUES (1, 'due1', 1), (1, 'ee3', 2)`);
    await sql(`INSERT INTO proposed_date (signup_id, date) VALUES (1, CURRENT_DATE + 7)`);
    await sql(`INSERT INTO observer_match (signup_id, observer_netid) VALUES (1, 'obs')`);
    await sql(`INSERT INTO observation_request (signup_id, observer_netid, status, responded_date) VALUES (1, 'obs', 'accepted', now())`);
    await sql(`INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date) VALUES (1, 'obs', 1, CURRENT_DATE + 7)`);
  });

  test('due reminders go to due professors in this cycle who have not signed up, with status and deadlines', async () => {
    assert.deepEqual(await sendDueReminders(1, 'ac1'), { sent: 1 });
    const { rows: [d] } = await sql(`SELECT (CURRENT_DATE + 5)::text AS s, (CURRENT_DATE + 30)::text AS o, (CURRENT_DATE + 45)::text AS f`);
    assert.deepEqual(await sent('reminder'), [{
      recipient_netid: 'due2', sent_by: 'ac1', cycle_id: 1,
      subject: `Reminder: you are overdue for a classroom observation. Sign up by ${d.s}. Observations are due by ${d.o} and feedback by ${d.f}.`,
    }]);
    await sql(`DELETE FROM notification`);
    await sql(`UPDATE eval_due SET due_status = 'due' WHERE netid = 'due2'`);
    await sendDueReminders(1, 'ac1');
    assert.match((await sent('reminder'))[0].subject, /^Reminder: you are due for a classroom observation\./);
  });

  test('due reminders can target chosen netids, and skip anyone not due or already signed up', async () => {
    assert.deepEqual(await sendDueReminders(1, 'ac1', ['due1', 'obs', 'old']), { sent: 0 });
    assert.deepEqual(await sendDueReminders(1, 'ac1', ['due2']), { sent: 1 });
    assert.deepEqual(await sendDueReminders(1, 'ac1', []), { sent: 1 }); // empty list means everyone
  });

  test('lists-ready goes only to observees who have an observer list', async () => {
    assert.deepEqual(await sendListsReady(1, 'ac1'), { sent: 1 });
    assert.deepEqual((await sent('matches_ready')).map((r) => [r.recipient_netid, r.subject]), [['due1', 'Your observer list is ready']]);
  });

  test('the survey goes to every observee and observer once', async () => {
    assert.deepEqual(await sendSurveyOpen(1, 'ac1'), { sent: 3 });
    assert.deepEqual((await sent('survey_open')).map((r) => r.recipient_netid), ['due1', 'ee3', 'obs']);
    const { rows: [d] } = await sql(`SELECT (CURRENT_DATE + 45)::text AS f`);
    assert.equal((await sent('survey_open'))[0].subject, `The end-of-process survey is open until ${d.f}.`);
  });

  test('an unknown cycle returns NOT_FOUND and sends nothing', async () => {
    for (const send of [() => sendDueReminders(99, 'ac1'), () => sendListsReady(99, 'ac1'), () => sendSurveyOpen(99, 'ac1')]) {
      await assert.rejects(send(), { status: 404, code: 'NOT_FOUND' });
    }
    assert.equal((await sql('SELECT count(*)::int AS n FROM notification')).rows[0].n, 0);
  });

  test('sent notifications show up in the recipient inbox, and a notification with no sender has sentBy null', async () => {
    await sendSurveyOpen(1, 'ac1');
    const [fromAc] = await listMyNotifications('obs');
    assert.equal(fromAc.notifType, 'survey_open');
    assert.equal(fromAc.sentBy?.netid, 'ac1');
    await sql(`INSERT INTO notification (cycle_id, recipient_netid, sent_by, notif_type, subject)
               VALUES (1, 'obs', NULL, 'reminder', 'system message')`);
    const [system] = await listMyNotifications('obs');
    assert.equal(system.subject, 'system message');
    assert.equal(system.sentBy, null);
  });
});
