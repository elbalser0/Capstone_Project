import { getPool } from '../db/pool.js';
import { ApiError } from '../middleware/error.middleware.js';
import { mapCourseRows, type CourseRow } from './course.service.js';
import { getCurrentCycle } from './cycle.service.js';
import { displayName, type Rank } from './user.service.js';

interface UnmatchedRow extends CourseRow {
  signup_id: number;
  observee_netid: string;
  observee_first_name: string;
  observee_last_name: string;
  observee_rank: Rank;
  alert_type: 'no_observer' | 'no_acceptance';
}

export function mapUnmatchedRows(rows: UnmatchedRow[]) {
  const groups = new Map<number, UnmatchedRow[]>();
  for (const row of rows) groups.set(row.signup_id, [...(groups.get(row.signup_id) ?? []), row]);
  return [...groups.values()].map((group) => {
    const row = group[0];
    return {
      signupId: String(row.signup_id),
      observee: {
        netid: row.observee_netid,
        firstName: row.observee_first_name,
        lastName: row.observee_last_name,
        displayName: displayName(row.observee_first_name, row.observee_last_name),
        rank: row.observee_rank,
      },
      section: mapCourseRows(group)[0],
      alertType: row.alert_type,
    };
  });
}

export async function listUnmatchedFaculty() {
  const cycle = await getCurrentCycle();
  if (!cycle) throw new ApiError(404, 'NO_CYCLE', 'No cycle has started yet.');

  const { rows } = await getPool().query<UnmatchedRow>(`
    SELECT s.signup_id, p.netid AS observee_netid, p.first_name AS observee_first_name,
           p.last_name AS observee_last_name, p.rank AS observee_rank, a.alert_type,
           sec.section_id, sec.section_num, sec.class_mode,
           course.course_num, course.title, course.course_level, dept.dept_name,
           term.term_id, term.season, term.year,
           term.start_date::text, term.end_date::text,
           meeting.day_of_week, meeting.start_time::text, meeting.end_time::text, meeting.room
    FROM sign_up AS s
    JOIN professor AS p ON p.netid = s.observee_netid
    JOIN section AS sec ON sec.section_id = s.section_id
    JOIN course ON course.course_id = sec.course_id
    JOIN department AS dept ON dept.dept_id = course.dept_id
    JOIN term ON term.term_id = sec.term_id
    JOIN LATERAL (
      SELECT alert_type FROM alert
      WHERE alert.signup_id = s.signup_id AND resolved_date IS NULL
      ORDER BY created_date DESC, alert_id DESC LIMIT 1
    ) AS a ON true
    LEFT JOIN meeting_time AS meeting ON meeting.section_id = sec.section_id
    WHERE s.cycle_id = $1
      AND a.alert_type IN ('no_observer', 'no_acceptance')
      AND NOT EXISTS (SELECT 1 FROM observation AS o WHERE o.signup_id = s.signup_id)
    ORDER BY s.signup_id, meeting.day_of_week, meeting.start_time
  `, [cycle.cycleId]);
  const items = mapUnmatchedRows(rows);
  return { cycleId: cycle.cycleId, total: items.length, items };
}
