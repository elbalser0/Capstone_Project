// Database tests for GET /api/me/requests/outgoing. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { skip, sql, useTestDatabase } from './db-test-helper.js';

const { listOutgoingRequests } = await import('../src/services/request.service.js');

async function addRequest(signupId: number, observer: string, hoursAgo: number, status = 'pending') {
  await sql('INSERT INTO observer_match (signup_id, observer_netid) VALUES ($1, $2)', [signupId, observer]);
  await sql(`INSERT INTO observation_request (signup_id, observer_netid, status, sent_date, responded_date)
             VALUES ($1, $2, $3, now() - make_interval(hours => $4), CASE WHEN $3 = 'pending' THEN NULL ELSE now() END)`,
  [signupId, observer, status, hoursAgo]);
}

describe('outgoing requests against the database', { skip }, () => {
  useTestDatabase();

  beforeEach(async () => {
    await sql(`TRUNCATE department, term, professor RESTART IDENTITY CASCADE`);
    await sql(`INSERT INTO department (dept_name) VALUES ('Computer Science')`);
    // Term 1 is an older term with an older cycle; term 2 is the current one.
    await sql(`INSERT INTO term (season, year, start_date, end_date)
               VALUES ('spring', 2020, CURRENT_DATE - 400, CURRENT_DATE - 280),
                      ('fall', 2020, CURRENT_DATE - 60, CURRENT_DATE + 90)`);
    for (const netid of ['ac1', 'ee', 'other', 'obsA', 'obsB', 'obsC']) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term)
                 VALUES ($1, $1, 'Test', $1 || '@example.edu', 'full', 1, 2, 1)`, [netid]);
    }
    await sql(`INSERT INTO ac_member (netid) VALUES ('ac1')`);
    await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
               VALUES (1, 'ac1', CURRENT_DATE - 390, CURRENT_DATE - 380, CURRENT_DATE - 300, CURRENT_DATE - 290),
                      (2, 'ac1', CURRENT_DATE - 30, CURRENT_DATE - 10, CURRENT_DATE + 30, CURRENT_DATE + 45)`);
    await sql(`INSERT INTO course (dept_id, course_num, title, course_level) VALUES (1, '1337', 'Computer Science I', 1000)`);
    // Sections: 1 = ee in the old term, 2 = ee now, 3 = other now.
    await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode)
               VALUES (1, 1, '001', 'ee', 'in-person'), (1, 2, '002', 'ee', 'in-person'), (1, 2, '003', 'other', 'in-person')`);
    for (const sectionId of [1, 2, 3]) {
      for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
        await sql(`INSERT INTO meeting_time (section_id, day_of_week, start_time, end_time) VALUES ($1, $2, '10:00', '10:50')`, [sectionId, day]);
      }
    }
    // Sign-ups: 1 = ee in the old cycle, 2 = ee in the current cycle, 3 = other in the current cycle.
    await sql(`INSERT INTO sign_up (cycle_id, observee_netid, section_id) VALUES (1, 'ee', 1), (2, 'ee', 2), (2, 'other', 3)`);
    await sql(`INSERT INTO proposed_date (signup_id, date)
               VALUES (1, CURRENT_DATE - 370), (2, CURRENT_DATE + 7), (2, CURRENT_DATE + 9), (3, CURRENT_DATE + 8)`);
  });

  test('the observee sees requests for their current sign-up, newest first, with status and dates', async () => {
    await addRequest(2, 'obsA', 5);
    await addRequest(2, 'obsB', 1, 'declined');
    await addRequest(2, 'obsC', 60);
    const result = await listOutgoingRequests('ee');
    assert.deepEqual(result.map((r) => [r.observer.netid, r.status]), [['obsB', 'declined'], ['obsA', 'pending'], ['obsC', 'expired']]);
    assert.ok(result.every((r) => r.signupId === '2' && r.observee.netid === 'ee'));
    assert.deepEqual(result[0].proposedDates.length, 2);
    assert.equal(new Date(result[1].expiresAt).getTime() - new Date(result[1].sentDate).getTime(), 48 * 3600 * 1000);
  });

  test('requests from an older cycle and other professors’ sign-ups are not included', async () => {
    await addRequest(1, 'obsA', 9000);
    await addRequest(3, 'obsB', 1);
    assert.deepEqual(await listOutgoingRequests('ee'), []);
    assert.deepEqual((await listOutgoingRequests('other')).map((r) => r.observer.netid), ['obsB']);
  });

  test('an observer does not see requests sent to them as outgoing', async () => {
    await addRequest(2, 'obsA', 1);
    assert.deepEqual(await listOutgoingRequests('obsA'), []);
  });
});
