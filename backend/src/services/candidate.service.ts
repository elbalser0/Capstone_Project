import { getPool } from '../db/pool.js';
import { ApiError } from '../middleware/error.middleware.js';
import { REQUEST_HOURS, requestStatus } from './request.service.js';
import { displayName, type Rank } from './user.service.js';

type StoredRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

interface CandidateRow {
  observer_netid: string | null;
  first_name: string | null;
  last_name: string | null;
  rank: Rank | null;
  round_no: number | null;
  request_status: StoredRequestStatus | null;
  sent_date: Date | null;
  db_now: Date;
  teaches: string[] | null;
  free_at_proposed_times: boolean | null;
}

// Read the saved observer list; matching is run separately by the Assessment Committee.
export async function listSignupCandidates(signupId: number, netid: string) {
  const { rows } = await getPool().query<CandidateRow>(`
    SELECT m.observer_netid, p.first_name, p.last_name, p.rank, m.round_no,
           r.status AS request_status, r.sent_date, now() AS db_now,
           ARRAY(
             SELECT taught.label FROM (
               SELECT DISTINCT ON (course.course_id)
                      dept.dept_name || ' ' || course.course_num AS label,
                      course.course_level, term.start_date
               FROM section AS taught_section
               JOIN course ON course.course_id = taught_section.course_id
               JOIN department AS dept ON dept.dept_id = course.dept_id
               JOIN term ON term.term_id = taught_section.term_id
               WHERE taught_section.instructor_id = m.observer_netid
                 AND term.term_id IN (
                   SELECT term_id FROM term
                   WHERE start_date <= cycle_term.start_date
                   ORDER BY start_date DESC LIMIT 4
                 )
               ORDER BY course.course_id, term.start_date DESC
             ) AS taught
             ORDER BY (taught.course_level = signup_course.course_level) DESC,
                      taught.start_date DESC, taught.label
           ) AS teaches,
           NOT EXISTS (
             SELECT 1 FROM proposed_date AS proposed
             JOIN meeting_time AS signup_meeting ON signup_meeting.section_id = signup.section_id
               AND signup_meeting.day_of_week = lower(trim(to_char(proposed.date, 'FMDay')))
             JOIN section AS observer_section ON observer_section.instructor_id = m.observer_netid
               AND observer_section.term_id = cycle.term_id AND observer_section.class_mode = 'in-person'
             JOIN meeting_time AS observer_meeting ON observer_meeting.section_id = observer_section.section_id
               AND observer_meeting.day_of_week = signup_meeting.day_of_week
             WHERE proposed.signup_id = signup.signup_id
               AND observer_meeting.start_time < signup_meeting.end_time
               AND signup_meeting.start_time < observer_meeting.end_time
           ) AS free_at_proposed_times
    FROM sign_up AS signup
    JOIN eval_cycle AS cycle ON cycle.cycle_id = signup.cycle_id
    JOIN term AS cycle_term ON cycle_term.term_id = cycle.term_id
    JOIN section AS signup_section ON signup_section.section_id = signup.section_id
    JOIN course AS signup_course ON signup_course.course_id = signup_section.course_id
    LEFT JOIN observer_match AS m ON m.signup_id = signup.signup_id
      AND NOT EXISTS (
        SELECT 1 FROM observation_request AS ended
        WHERE ended.signup_id = m.signup_id AND ended.observer_netid = m.observer_netid
          AND (ended.status IN ('declined', 'cancelled', 'expired')
               OR (ended.status = 'pending'
                   AND ended.sent_date <= now() - make_interval(hours => ${REQUEST_HOURS})))
      )
    LEFT JOIN professor AS p ON p.netid = m.observer_netid
    LEFT JOIN observation_request AS r ON r.signup_id = m.signup_id AND r.observer_netid = m.observer_netid
    WHERE signup.signup_id = $1 AND signup.observee_netid = $2
    ORDER BY m.round_no, m.generated_date, m.observer_netid
  `, [signupId, netid]);
  if (rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Sign-up not found.');

  return rows.filter((row) => row.observer_netid !== null).map((row) => ({
    observer: {
      netid: row.observer_netid!,
      firstName: row.first_name!,
      lastName: row.last_name!,
      displayName: displayName(row.first_name!, row.last_name!),
      rank: row.rank!,
    },
    roundNo: row.round_no!,
    request: row.request_status && row.sent_date ? {
      status: requestStatus(row.request_status, row.sent_date, row.db_now),
      sentDate: row.sent_date.toISOString(),
    } : null,
    teaches: row.teaches ?? [],
    freeAtProposedTimes: row.free_at_proposed_times!,
  }));
}
