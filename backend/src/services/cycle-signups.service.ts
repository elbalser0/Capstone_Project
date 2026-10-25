import { getPool } from '../db/pool.js';
import { ApiError } from '../middleware/error.middleware.js';
import { mapCourseRows, type CourseRow } from './course.service.js';
import type { Rank } from './user.service.js';

interface CycleSignupRow extends CourseRow {
  signup_id: number;
  cycle_id: number;
  observee_netid: string;
  observee_first_name: string;
  observee_last_name: string;
  observee_email: string;
  observee_rank: Rank;
  submit_date: string;
  proposed_dates: string[];
  observation_id: number | null;
  observation_status: 'scheduled' | 'completed' | 'not_completed' | null;
  scheduled_date: string | null;
  observer_netid: string | null;
  observer_first_name: string | null;
  observer_last_name: string | null;
  observer_rank: Rank | null;
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function mapCycleSignupRows(rows: CycleSignupRow[]) {
  const groups = new Map<number, CycleSignupRow[]>();
  for (const row of rows) {
    const group = groups.get(row.signup_id) ?? [];
    group.push(row);
    groups.set(row.signup_id, group);
  }
  return [...groups.values()].map((group) => {
    const row = group[0];
    const section = mapCourseRows(group)[0];
    return {
      signupId: String(row.signup_id),
      cycleId: String(row.cycle_id),
      observee: {
        netid: row.observee_netid,
        firstName: row.observee_first_name,
        lastName: row.observee_last_name,
        displayName: `Dr. ${row.observee_first_name} ${row.observee_last_name}`,
        rank: row.observee_rank,
        email: row.observee_email,
      },
      section,
      proposedDates: row.proposed_dates.map((date) => {
        const day = weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()];
        // shortcut: proposed_date stores only the date; record a selected time when the schema supports it.
        return { date, startTime: section.meetings.find((meeting) => meeting.dayOfWeek === day)?.startTime ?? '' };
      }),
      submitDate: row.submit_date,
      observation: row.observation_id === null ? null : {
        observationId: String(row.observation_id),
        observer: {
          netid: row.observer_netid!,
          firstName: row.observer_first_name!,
          lastName: row.observer_last_name!,
          displayName: `Dr. ${row.observer_first_name} ${row.observer_last_name}`,
          rank: row.observer_rank!,
        },
        status: row.observation_status!,
        scheduledDate: row.scheduled_date!,
      },
    };
  });
}

export async function listCycleSignups(cycleId: number) {
  const db = getPool();
  const cycle = await db.query('SELECT 1 FROM eval_cycle WHERE cycle_id = $1', [cycleId]);
  if (cycle.rowCount === 0) throw new ApiError(404, 'NOT_FOUND', 'Cycle not found.');

  const { rows } = await db.query<CycleSignupRow>(`
    SELECT s.signup_id, s.cycle_id,
           p.netid AS observee_netid, p.first_name AS observee_first_name,
           p.last_name AS observee_last_name, p.email AS observee_email,
           p.rank AS observee_rank, s.submit_date::date::text AS submit_date,
           ARRAY(SELECT pd.date::text FROM proposed_date AS pd
                 WHERE pd.signup_id = s.signup_id ORDER BY pd.date) AS proposed_dates,
           o.observation_id, o.status AS observation_status, o.scheduled_date::text,
           observer.netid AS observer_netid, observer.first_name AS observer_first_name,
           observer.last_name AS observer_last_name, observer.rank AS observer_rank,
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
    LEFT JOIN meeting_time AS meeting ON meeting.section_id = sec.section_id
    LEFT JOIN observation AS o ON o.signup_id = s.signup_id
    LEFT JOIN professor AS observer ON observer.netid = o.observer_netid
    WHERE s.cycle_id = $1
    ORDER BY s.signup_id, meeting.day_of_week, meeting.start_time
  `, [cycleId]);
  return mapCycleSignupRows(rows);
}
