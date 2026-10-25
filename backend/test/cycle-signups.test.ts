import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapCycleSignupRows } from '../src/services/cycle-signups.service.js';

test('cycle signups include complete records without duplicating a signup per meeting', () => {
  const first: Parameters<typeof mapCycleSignupRows>[0][number] = {
    signup_id: 10, cycle_id: 3,
    observee_netid: 'maya', observee_first_name: 'Maya', observee_last_name: 'Lin',
    observee_email: 'maya@example.edu', observee_rank: 'assistant', submit_date: '2026-10-19',
    proposed_dates: ['2026-10-20', '2026-10-22'],
    observation_id: null, observation_status: null, scheduled_date: null,
    observer_netid: null, observer_first_name: null, observer_last_name: null, observer_rank: null,
    section_id: 20, section_num: '001', class_mode: 'in-person',
    course_num: '1337', title: 'Intro', course_level: 1000, dept_name: 'CS',
    term_id: 2, season: 'fall', year: 2026, start_date: '2026-08-24', end_date: '2026-12-14',
    day_of_week: 'tuesday', start_time: '09:00:00', end_time: '10:00:00', room: 'A1',
  };
  const rows = [
    first,
    { ...first, day_of_week: 'thursday', start_time: '11:00:00', end_time: '12:00:00', room: 'A2' },
    { ...first, signup_id: 11, observee_netid: 'isabel', observee_first_name: 'Isabel',
      observee_last_name: 'Nakamura', observee_email: 'isabel@example.edu', section_id: 21,
      proposed_dates: [], day_of_week: null, start_time: null, end_time: null, room: null,
      observation_id: 30, observation_status: 'scheduled' as const, scheduled_date: '2026-10-27',
      observer_netid: 'maya', observer_first_name: 'Maya', observer_last_name: 'Lin', observer_rank: 'assistant' as const },
  ];

  const signups = mapCycleSignupRows(rows);
  assert.equal(signups.length, 2);
  assert.deepEqual(signups[0].proposedDates, [
    { date: '2026-10-20', startTime: '09:00' },
    { date: '2026-10-22', startTime: '11:00' },
  ]);
  assert.equal(signups[0].section.meetings.length, 2);
  assert.equal(signups[0].observation, null);
  assert.equal(signups[1].observee.email, 'isabel@example.edu');
  assert.deepEqual(signups[1].observation, {
    observationId: '30',
    observer: { netid: 'maya', firstName: 'Maya', lastName: 'Lin', displayName: 'Dr. Maya Lin', rank: 'assistant' },
    status: 'scheduled', scheduledDate: '2026-10-27',
  });
});
