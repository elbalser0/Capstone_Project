import { getPool } from '../db/pool.js';
import { ApiError } from '../middleware/error.middleware.js';
import { mapCourseRows } from './course.service.js';
import type { Rank } from './user.service.js';

// Rules from the Business Logic doc: a request expires 48 hours after it is sent,
// and an observer can accept at most 3 observations per cycle.
export const REQUEST_HOURS = 48;
export const MAX_ACCEPTED = 3;

type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
type CourseRow = Parameters<typeof mapCourseRows>[0][number];
type CourseSection = ReturnType<typeof mapCourseRows>[number];

interface RequestRow {
  signup_id: number;
  status: RequestStatus;
  sent_date: Date;
  responded_date: Date | null;
  section_id: number;
  observer_netid: string;
  observer_first_name: string;
  observer_last_name: string;
  observer_rank: Rank;
  observee_netid: string;
  observee_first_name: string;
  observee_last_name: string;
  observee_rank: Rank;
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function expiresAt(sentDate: Date): Date {
  return new Date(sentDate.getTime() + REQUEST_HOURS * 60 * 60 * 1000);
}

// A pending request older than 48 hours counts as expired.
export function requestStatus(status: RequestStatus, sentDate: Date, now = new Date()): RequestStatus {
  return status === 'pending' && expiresAt(sentDate) <= now ? 'expired' : status;
}

// Proposed dates come back with the class start time on that weekday.
export function withStartTimes(section: CourseSection, dates: string[]) {
  return dates.map((date) => {
    const day = weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const meeting = section.meetings.find((item) => item.dayOfWeek === day);
    return { date, startTime: meeting?.startTime ?? '' };
  });
}

function person(netid: string, firstName: string, lastName: string, rank: Rank) {
  return { netid, firstName, lastName, displayName: `Dr. ${firstName} ${lastName}`, rank };
}

async function loadSections(sectionIds: number[]): Promise<Map<string, CourseSection>> {
  if (sectionIds.length === 0) return new Map();
  const { rows } = await getPool().query<CourseRow>(`
    SELECT s.section_id, s.section_num, s.class_mode,
           c.course_num, c.title, c.course_level, d.dept_name,
           t.term_id, t.season, t.year,
           t.start_date::text, t.end_date::text,
           m.day_of_week, m.start_time::text, m.end_time::text, m.room
    FROM section AS s
    JOIN course AS c ON c.course_id = s.course_id
    JOIN department AS d ON d.dept_id = c.dept_id
    JOIN term AS t ON t.term_id = s.term_id
    LEFT JOIN meeting_time AS m ON m.section_id = s.section_id
    WHERE s.section_id = ANY($1::int[])
    ORDER BY s.section_id, m.day_of_week, m.start_time
  `, [sectionIds]);
  return new Map(mapCourseRows(rows).map((section) => [section.sectionId, section]));
}

async function fetchRequests(where: string, params: unknown[]) {
  const db = getPool();
  const { rows } = await db.query<RequestRow>(`
    SELECT r.signup_id, r.status, r.sent_date, r.responded_date, s.section_id,
           obs.netid AS observer_netid, obs.first_name AS observer_first_name,
           obs.last_name AS observer_last_name, obs.rank AS observer_rank,
           ee.netid AS observee_netid, ee.first_name AS observee_first_name,
           ee.last_name AS observee_last_name, ee.rank AS observee_rank
    FROM observation_request AS r
    JOIN sign_up AS s ON s.signup_id = r.signup_id
    JOIN professor AS obs ON obs.netid = r.observer_netid
    JOIN professor AS ee ON ee.netid = s.observee_netid
    WHERE ${where}
    ORDER BY r.sent_date DESC, r.signup_id DESC
  `, params);
  if (rows.length === 0) return [];

  const [sections, dates] = await Promise.all([
    loadSections([...new Set(rows.map((row) => row.section_id))]),
    db.query<{ signup_id: number; date: string }>(`
      SELECT signup_id, date::text FROM proposed_date
      WHERE signup_id = ANY($1::int[]) ORDER BY date
    `, [[...new Set(rows.map((row) => row.signup_id))]]),
  ]);

  return rows.map((row) => {
    const section = sections.get(String(row.section_id));
    if (!section) throw new Error('The sign-up section is unavailable.');
    const proposed = dates.rows.filter((item) => item.signup_id === row.signup_id).map((item) => item.date);
    return {
      signupId: String(row.signup_id),
      observer: person(row.observer_netid, row.observer_first_name, row.observer_last_name, row.observer_rank),
      observee: person(row.observee_netid, row.observee_first_name, row.observee_last_name, row.observee_rank),
      section,
      proposedDates: withStartTimes(section, proposed),
      status: requestStatus(row.status, row.sent_date),
      sentDate: row.sent_date.toISOString(),
      respondedDate: row.responded_date ? row.responded_date.toISOString() : null,
      expiresAt: expiresAt(row.sent_date).toISOString(),
    };
  });
}

// GET /api/me/requests/incoming: requests sent to me in the current cycle, newest first.
export function listIncomingRequests(netid: string) {
  return fetchRequests(`r.observer_netid = $1 AND s.cycle_id = (
      SELECT cycle_id FROM eval_cycle WHERE start_date <= CURRENT_DATE
      ORDER BY start_date DESC, cycle_id DESC LIMIT 1)`, [netid]);
}

async function getRequest(signupId: number, observerNetid: string) {
  const [request] = await fetchRequests('r.signup_id = $1 AND r.observer_netid = $2', [signupId, observerNetid]);
  if (!request) throw new ApiError(404, 'NOT_FOUND', 'Request not found.');
  return request;
}

// PATCH .../confirm: the first observer to confirm is paired; other pending requests are cancelled.
export async function confirmRequest(signupId: number, observerNetid: string, date: string) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Lock the sign-up so two observers cannot confirm the same sign-up at once.
    const signup = await client.query<{ cycle_id: number }>(
      'SELECT cycle_id FROM sign_up WHERE signup_id = $1 FOR UPDATE', [signupId]);
    const request = await client.query<{ status: RequestStatus; sent_date: Date }>(`
      SELECT status, sent_date FROM observation_request
      WHERE signup_id = $1 AND observer_netid = $2 FOR UPDATE
    `, [signupId, observerNetid]);
    if (!signup.rows[0] || !request.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Request not found.');
    const cycleId = signup.rows[0].cycle_id;

    const status = requestStatus(request.rows[0].status, request.rows[0].sent_date);
    if (status !== 'pending') throw new ApiError(409, 'NOT_PENDING', `This request is ${status}.`);

    const paired = await client.query('SELECT 1 FROM observation WHERE signup_id = $1', [signupId]);
    if (paired.rowCount) throw new ApiError(409, 'ALREADY_PAIRED', 'Someone else accepted first.');

    const accepted = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM observation AS o
      JOIN sign_up AS s ON s.signup_id = o.signup_id
      WHERE o.observer_netid = $1 AND s.cycle_id = $2
    `, [observerNetid, cycleId]);
    const acceptedCount = accepted.rows[0].count;
    if (acceptedCount >= MAX_ACCEPTED) {
      throw new ApiError(409, 'LIMIT_REACHED', `You have already accepted ${MAX_ACCEPTED} observations this semester.`);
    }

    const proposed = await client.query(
      'SELECT 1 FROM proposed_date WHERE signup_id = $1 AND date = $2::date', [signupId, date]);
    if (!proposed.rowCount) throw new ApiError(400, 'INVALID_DATE', 'Pick one of the proposed dates.');

    const template = await client.query<{ version_id: number }>(`
      SELECT version_id FROM template_version WHERE status = 'live'
      ORDER BY published_date DESC, version_id DESC LIMIT 1
    `);
    if (!template.rows[0]) throw new ApiError(409, 'NO_LIVE_TEMPLATE', 'No observation form is published yet.');

    await client.query(`
      INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date)
      VALUES ($1, $2, $3, $4::date)
    `, [signupId, observerNetid, template.rows[0].version_id, date]);
    await client.query(`
      UPDATE observation_request SET status = 'accepted', responded_date = now()
      WHERE signup_id = $1 AND observer_netid = $2
    `, [signupId, observerNetid]);
    await client.query(`
      UPDATE observation_request SET status = 'cancelled'
      WHERE signup_id = $1 AND observer_netid <> $2 AND status = 'pending'
    `, [signupId, observerNetid]);
    // Reaching the limit cancels this observer's other pending requests in the cycle.
    if (acceptedCount + 1 >= MAX_ACCEPTED) {
      await client.query(`
        UPDATE observation_request AS r SET status = 'cancelled'
        FROM sign_up AS s
        WHERE s.signup_id = r.signup_id AND s.cycle_id = $1
          AND r.observer_netid = $2 AND r.status = 'pending'
      `, [cycleId, observerNetid]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return getRequest(signupId, observerNetid);
}

// PATCH .../decline
export async function declineRequest(signupId: number, observerNetid: string) {
  const updated = await getPool().query(`
    UPDATE observation_request SET status = 'declined', responded_date = now()
    WHERE signup_id = $1 AND observer_netid = $2 AND status = 'pending'
      AND sent_date > now() - make_interval(hours => $3)
  `, [signupId, observerNetid, REQUEST_HOURS]);
  const request = await getRequest(signupId, observerNetid);
  if (!updated.rowCount) throw new ApiError(409, 'NOT_PENDING', `This request is ${request.status}.`);
  return request;
}
