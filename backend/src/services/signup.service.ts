import { getPool } from '../db/pool.js';
import { inTransaction } from '../db/transaction.js';
import { ApiError } from '../middleware/error.middleware.js';
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

function meetingFor(section: CourseSection, date: string) {
  const day = weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return section.meetings.find((meeting) => meeting.dayOfWeek === day);
}

export function validateSignupDates(dates: string[], signupDeadline: string, observationDeadline: string, section: CourseSection) {
  if (dates.length === 0 || new Set(dates).size !== dates.length || dates.some((date) => {
    return date <= signupDeadline || date > observationDeadline ||
      date < section.term.startDate || date > section.term.endDate ||
      !meetingFor(section, date);
  })) {
    throw new ApiError(400, 'INVALID_DATES', 'Choose unique class meeting dates after the signup deadline and by the observation deadline.');
  }
}

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
      const meeting = meetingFor(section, date);
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

interface CurrentCycleRow {
  cycle_id: number;
  term_id: number;
  signup_deadline: string;
  observation_deadline: string;
  today: string;
}

export async function createSignup(user: AuthUser, sectionId: number, dates: string[]) {
  try {
    return await inTransaction(async (client) => {
      const { rows: cycles } = await client.query<CurrentCycleRow>(`
        SELECT cycle_id, term_id, signup_deadline::text, observation_deadline::text,
               CURRENT_DATE::text AS today
        FROM eval_cycle
        WHERE start_date <= CURRENT_DATE
        ORDER BY start_date DESC, cycle_id DESC
        LIMIT 1 FOR SHARE
      `);
      const cycle = cycles[0];
      if (!cycle || cycle.today > cycle.signup_deadline) {
        throw new ApiError(409, 'SIGNUP_CLOSED', 'The sign-up window for this cycle is closed.');
      }

      const professor = await client.query<{ is_active: boolean }>(
        'SELECT is_active FROM professor WHERE netid = $1 FOR SHARE', [user.netid]);
      if (!professor.rows[0]?.is_active) {
        throw new ApiError(403, 'NOT_A_PROFESSOR', 'This account is not linked to an active professor.');
      }

      // Cycle kickoff records the due roster that controls signup eligibility.
      const due = await client.query('SELECT 1 FROM eval_due WHERE cycle_id = $1 AND netid = $2 FOR SHARE', [cycle.cycle_id, user.netid]);
      if (!due.rows[0]) throw new ApiError(409, 'NOT_DUE', 'You are not due for an observation this semester.');

      const sections = await listCourses(user.netid, cycle.term_id, client);
      const section = sections.find((item) => item.sectionId === String(sectionId));
      if (!section) throw new ApiError(400, 'INVALID_SECTION', 'Choose one of the sections you teach this semester.');
      validateSignupDates(dates, cycle.signup_deadline, cycle.observation_deadline, section);

      const { rows } = await client.query<{ signup_id: number; submit_date: string }>(`
        INSERT INTO sign_up (cycle_id, observee_netid, section_id)
        VALUES ($1, $2, $3)
        RETURNING signup_id, submit_date::date::text AS submit_date
      `, [cycle.cycle_id, user.netid, sectionId]);
      const inserted = rows[0];
      await client.query(`
        INSERT INTO proposed_date (signup_id, date)
        SELECT $1, unnest($2::date[])
      `, [inserted.signup_id, dates]);
      const signup = mapSignup({
        signup_id: inserted.signup_id, cycle_id: cycle.cycle_id,
        section_id: sectionId, term_id: cycle.term_id, submit_date: inserted.submit_date,
        observation_id: null, observation_status: null, scheduled_date: null,
        observer_netid: null, observer_first_name: null, observer_last_name: null, observer_rank: null,
      }, user, section, dates);
      return signup;
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ApiError(409, 'ALREADY_SIGNED_UP', 'You already signed up this semester.');
    }
    throw error;
  }
}
