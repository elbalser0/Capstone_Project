import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { skip, sql, useTestDatabase } from './db-test-helper.js';

const { listSignupCandidates } = await import('../src/services/candidate.service.js');

describe('signup candidates against the database', { skip }, () => {
  useTestDatabase();

  test('availability includes online classes and other scheduled observations', async () => {
    await sql("INSERT INTO department (dept_name) VALUES ('Computer Science')");
    await sql("INSERT INTO term (season, year, start_date, end_date) VALUES ('fall', 2026, CURRENT_DATE - 30, CURRENT_DATE + 90)");
    for (const netid of ['ac', 'ee', 'other', 'observer']) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term)
                 VALUES ($1, $1, 'Test', $1 || '@example.edu', 'full', 1, 2, 1)`, [netid]);
    }
    await sql("INSERT INTO ac_member (netid) VALUES ('ac')");
    await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
               VALUES (1, 'ac', CURRENT_DATE - 20, CURRENT_DATE - 5, CURRENT_DATE + 30, CURRENT_DATE + 45)`);
    await sql("INSERT INTO course (dept_id, course_num, title, course_level) VALUES (1, '1337', 'CS I', 1000)");
    await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode)
               VALUES (1, 1, '001', 'ee', 'in-person'), (1, 1, '002', 'other', 'in-person'),
                      (1, 1, '003', 'observer', 'online')`);
    await sql(`INSERT INTO meeting_time (section_id, day_of_week, start_time, end_time)
               VALUES (1, 'monday', '10:00', '11:00'), (2, 'monday', '10:15', '11:15'),
                      (3, 'monday', '10:30', '11:30')`);
    await sql("INSERT INTO sign_up (cycle_id, observee_netid, section_id) VALUES (1, 'ee', 1), (1, 'other', 2)");
    await sql(`INSERT INTO proposed_date (signup_id, date)
               VALUES (1, CURRENT_DATE + 7 + ((8 - EXTRACT(DOW FROM CURRENT_DATE)::int) % 7)),
                      (2, CURRENT_DATE + 7 + ((8 - EXTRACT(DOW FROM CURRENT_DATE)::int) % 7))`);
    await sql("INSERT INTO observer_match (signup_id, observer_netid) VALUES (1, 'observer'), (2, 'observer')");

    const available = async () => (await listSignupCandidates(1, 'ee'))[0].freeAtProposedTimes;
    assert.equal(await available(), false, 'online class meeting blocks the proposed time');
    await sql('DELETE FROM meeting_time WHERE section_id = 3');
    assert.equal(await available(), true);

    await sql("INSERT INTO template_version (version_no, status, created_by, published_date) VALUES (1, 'live', 'ac', now())");
    await sql("INSERT INTO observation_request (signup_id, observer_netid, status) VALUES (2, 'observer', 'accepted')");
    await sql(`INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date)
               VALUES (2, 'observer', 1, (SELECT date FROM proposed_date WHERE signup_id = 2))`);
    assert.equal(await available(), false, 'another scheduled observation blocks the proposed time');
    await sql("UPDATE observation SET status = 'not_completed', reason_not_completed = 'Cancelled' WHERE signup_id = 2");
    assert.equal(await available(), true, 'a cancelled observation does not block the time');

    await assert.rejects(listSignupCandidates(1, 'other'), { code: 'NOT_FOUND' });
  });
});
