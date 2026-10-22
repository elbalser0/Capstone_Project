import { getPool } from '../db/pool.js';
import { listCourses, type CourseSection } from './course.service.js';
import type { AuthUser, Rank } from './user.service.js';

interface SignupRow {
  signup_id: number;
  cycle_id: number;
  section_id: number;
  term_id: number;
  submit_date: string;
  observation_id: number | null;
  observation_status: 'scheduled' | 'completed' | 'not_completed' | null;
  scheduled_date: string | null;
  observer_netid: string | null;
  observer_first_name: string | null;
  observer_last_name: string | null;
  observer_rank: Rank | null;
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function mapSignup(row: SignupRow, user: AuthUser, section: CourseSection, dates: string[]) {
  return {
    signupId: String(row.signup_id),
    cycleId: String(row.cycle_id),
    observee: {
      netid: user.netid, firstName: user.firstName, lastName: user.lastName,
      displayName: user.displayName, rank: user.rank, email: user.email,
    },
    section,
    proposedDates: dates.map((date) => {
      const meeting = section.meetings.find((item) => item.dayOfWeek === weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]);
      if (!meeting) throw new Error('A proposed date is not a class meeting for this section.');
      return { date, startTime: meeting.startTime };
    }),
    submitDate: row.submit_date,
    observation: row.observation_id === null ? null : {
      observationId: String(row.observation_id),
      observer: {
        netid: row.observer_netid!, firstName: row.observer_first_name!, lastName: row.observer_last_name!,
        displayName: `Dr. ${row.observer_first_name} ${row.observer_last_name}`, rank: row.observer_rank!,
      },
      status: row.observation_status!,
      scheduledDate: row.scheduled_date!,
    },
  };
}

export async function getMySignup(user: AuthUser) {
  const db = getPool();
  const { rows } = await db.query<SignupRow>(`
    SELECT s.signup_id, s.cycle_id, s.section_id, c.term_id,
           s.submit_date::date::text AS submit_date,
           o.observation_id, o.status AS observation_status, o.scheduled_date::text,
           observer.netid AS observer_netid, observer.first_name AS observer_first_name,
           observer.last_name AS observer_last_name, observer.rank AS observer_rank
    FROM sign_up AS s
    JOIN eval_cycle AS c ON c.cycle_id = s.cycle_id
    LEFT JOIN observation AS o ON o.signup_id = s.signup_id
    LEFT JOIN professor AS observer ON observer.netid = o.observer_netid
    WHERE s.observee_netid = $1
      AND s.cycle_id = (
        SELECT cycle_id FROM eval_cycle WHERE start_date <= CURRENT_DATE
        ORDER BY start_date DESC, cycle_id DESC LIMIT 1
      )
    LIMIT 1
  `, [user.netid]);
  const signup = rows[0];
  if (!signup) return null;

  const [sections, proposedDates] = await Promise.all([
    listCourses(user.netid, signup.term_id),
    db.query<{ date: string }>(`
      SELECT date::text FROM proposed_date WHERE signup_id = $1 ORDER BY date
    `, [signup.signup_id]),
  ]);
  const section = sections.find((item) => item.sectionId === String(signup.section_id));
  if (!section) throw new Error('The sign-up section is unavailable.');
  return mapSignup(signup, user, section, proposedDates.rows.map((row) => row.date));
}
