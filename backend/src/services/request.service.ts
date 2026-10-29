import { getPool } from '../db/pool.js';
import { inTransaction } from '../db/transaction.js';
import { ApiError } from '../middleware/error.middleware.js';
import { mapCourseRows } from './course.service.js';
import { displayName, type Rank } from './user.service.js';

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
  db_now: Date;
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

// SQL condition for a request that has not passed its 48 hours. Uses the database clock,
// the same clock the reads and status checks below use.
const NOT_EXPIRED = `sent_date > now() - make_interval(hours => ${REQUEST_HOURS})`;

export function expiresAt(sentDate: Date): Date {
  return new Date(sentDate.getTime() + REQUEST_HOURS * 60 * 60 * 1000);
}

// A pending request older than 48 hours counts as expired. `now` comes from the database.
export function requestStatus(status: RequestStatus, sentDate: Date, now: Date): RequestStatus {
  return status === 'pending' && expiresAt(sentDate) <= now ? 'expired' : status;
}

// Proposed dates come back with the class start time on that weekday. Proposed dates are
// checked against the section's meeting days when the sign-up is created (#112), so an
// empty startTime only appears for inconsistent data; this matches GET /api/cycles/{id}/signups.
export function withStartTimes(section: CourseSection, dates: string[]) {
  return dates.map((date) => {
    const day = weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const meeting = section.meetings.find((item) => item.dayOfWeek === day);
    return { date, startTime: meeting?.startTime ?? '' };
  });
}

function person(netid: string, firstName: string, lastName: string, rank: Rank) {
  return { netid, firstName, lastName, displayName: displayName(firstName, lastName), rank };
}

// shortcut: same section query as course.service listCourses, filtered by section IDs.
// Move it into course.service once #104, #111, and #112 (which also edit that file) are merged.
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
    SELECT r.signup_id, r.status, r.sent_date, r.responded_date, now() AS db_now, s.section_id,
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
  const datesBySignup = new Map<number, string[]>();
  for (const { signup_id: signupId, date } of dates.rows) {
    datesBySignup.set(signupId, [...(datesBySignup.get(signupId) ?? []), date]);
  }

  return rows.map((row) => {
    const section = sections.get(String(row.section_id));
    if (!section) throw new Error('The sign-up section is unavailable.');
    return {
      signupId: String(row.signup_id),
      observer: person(row.observer_netid, row.observer_first_name, row.observer_last_name, row.observer_rank),
      observee: person(row.observee_netid, row.observee_first_name, row.observee_last_name, row.observee_rank),
      section,
      proposedDates: withStartTimes(section, datesBySignup.get(row.signup_id) ?? []),
      status: requestStatus(row.status, row.sent_date, row.db_now),
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

// POST /api/signups/{signupId}/requests: send to all or selected matched observers.
export async function sendRequests(signupId: number, observeeNetid: string, observerNetids?: string[]) {
  await inTransaction(async (client) => {
    // Confirm also locks this sign-up, so sending cannot race with a new pairing.
    const signup = await client.query<{ observation_closed: boolean }>(
      `SELECT c.observation_deadline < CURRENT_DATE AS observation_closed
       FROM sign_up AS s JOIN eval_cycle AS c ON c.cycle_id = s.cycle_id
       WHERE s.signup_id = $1 AND s.observee_netid = $2 FOR UPDATE OF s`,
      [signupId, observeeNetid]);
    if (!signup.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Sign-up not found.');
    if (signup.rows[0].observation_closed) {
      throw new ApiError(409, 'OBSERVATION_CLOSED', 'The observation deadline has passed.');
    }

    const paired = await client.query('SELECT 1 FROM observation WHERE signup_id = $1', [signupId]);
    if (paired.rowCount) throw new ApiError(409, 'ALREADY_PAIRED', 'You are already paired with an observer.');

    const { rows } = await client.query<{ observer_netid: string }>(
      `SELECT m.observer_netid FROM observer_match AS m
       WHERE m.signup_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM observation_request AS ended
           WHERE ended.signup_id = m.signup_id AND ended.observer_netid = m.observer_netid
             AND (ended.status IN ('declined', 'cancelled', 'expired')
                  OR (ended.status = 'pending'
                      AND ended.sent_date <= now() - make_interval(hours => ${REQUEST_HOURS})))
         )`, [signupId]);
    const candidates = new Set(rows.map((row) => row.observer_netid));
    if (!candidates.size) throw new ApiError(409, 'NO_CANDIDATES', 'Your observer list is not ready yet.');
    const targets = observerNetids?.length ? observerNetids : [...candidates];
    if (targets.some((id) => !candidates.has(id))) {
      throw new ApiError(400, 'NOT_A_CANDIDATE', 'Requests can only go to observers on your list.');
    }

    for (const observerNetid of targets) {
      await client.query(`
        INSERT INTO observation_request (signup_id, observer_netid, status, sent_date)
        VALUES ($1, $2, 'pending', now())
        ON CONFLICT (signup_id, observer_netid) DO NOTHING
      `, [signupId, observerNetid]);
    }
  });
  return fetchRequests('r.signup_id = $1', [signupId]);
}

async function getRequest(signupId: number, observerNetid: string) {
  const [request] = await fetchRequests('r.signup_id = $1 AND r.observer_netid = $2', [signupId, observerNetid]);
  if (!request) throw new ApiError(404, 'NOT_FOUND', 'Request not found.');
  return request;
}

// PATCH .../confirm: the first observer to confirm is paired; other pending requests are cancelled.
export async function confirmRequest(signupId: number, observerNetid: string, date: string) {
  await inTransaction(async (client) => {
    // One confirm at a time per observer, so two confirms at once can't pass the limit of 3.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('observer:' || $1))", [observerNetid]);
    // One confirm at a time per sign-up, so two observers can't both be paired.
    const signup = await client.query<{ cycle_id: number; today: string }>(
      'SELECT cycle_id, CURRENT_DATE::text AS today FROM sign_up WHERE signup_id = $1 FOR UPDATE', [signupId]);
    const request = await client.query<{ status: RequestStatus; sent_date: Date; db_now: Date }>(`
      SELECT status, sent_date, now() AS db_now FROM observation_request
      WHERE signup_id = $1 AND observer_netid = $2 FOR UPDATE
    `, [signupId, observerNetid]);
    if (!signup.rows[0] || !request.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Request not found.');
    const { cycle_id: cycleId, today } = signup.rows[0];

    // The pairing and the limit are checked before the request status: both cancel other
    // requests, so the observer would otherwise only ever see "This request is cancelled."
    const paired = await client.query<{ observer_netid: string }>(
      'SELECT observer_netid FROM observation WHERE signup_id = $1', [signupId]);
    const pairedWithMe = paired.rows[0]?.observer_netid === observerNetid;
    if (paired.rows[0] && !pairedWithMe) {
      throw new ApiError(409, 'ALREADY_PAIRED', 'Someone else accepted first.');
    }

    const accepted = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM observation AS o
      JOIN sign_up AS s ON s.signup_id = o.signup_id
      WHERE o.observer_netid = $1 AND s.cycle_id = $2
    `, [observerNetid, cycleId]);
    const acceptedCount = accepted.rows[0].count;
    if (!pairedWithMe && acceptedCount >= MAX_ACCEPTED) {
      throw new ApiError(409, 'LIMIT_REACHED', `You have already accepted ${MAX_ACCEPTED} observations this semester.`);
    }

    const status = requestStatus(request.rows[0].status, request.rows[0].sent_date, request.rows[0].db_now);
    if (status !== 'pending') throw new ApiError(409, 'NOT_PENDING', `This request is ${status}.`);

    const proposed = await client.query(
      'SELECT 1 FROM proposed_date WHERE signup_id = $1 AND date = $2::date', [signupId, date]);
    if (!proposed.rowCount) throw new ApiError(400, 'INVALID_DATE', 'Pick one of the proposed dates.');
    if (date < today) throw new ApiError(400, 'DATE_PASSED', 'That date has already passed.');

    // The observer can't be teaching their own class while the observed class meets.
    // Compares the observee's class on that weekday with the observer's classes in the same term.
    const conflict = await client.query<{ course_num: string; section_num: string; start_time: string; end_time: string }>(`
      SELECT oc.course_num, os.section_num, om.start_time::text, om.end_time::text
      FROM sign_up AS s
      JOIN section AS es ON es.section_id = s.section_id
      JOIN meeting_time AS em ON em.section_id = es.section_id
        AND em.day_of_week = lower(trim(to_char($3::date, 'FMDay')))
      JOIN section AS os ON os.term_id = es.term_id AND os.instructor_id = $2
      JOIN course AS oc ON oc.course_id = os.course_id
      JOIN meeting_time AS om ON om.section_id = os.section_id
        AND om.day_of_week = em.day_of_week
        AND om.start_time < em.end_time AND em.start_time < om.end_time
      WHERE s.signup_id = $1
      ORDER BY om.start_time
      LIMIT 1
    `, [signupId, observerNetid, date]);
    if (conflict.rows[0]) {
      const c = conflict.rows[0];
      throw new ApiError(409, 'SCHEDULE_CONFLICT',
        `You teach ${c.course_num}.${c.section_num} from ${c.start_time.slice(0, 5)} to ${c.end_time.slice(0, 5)} at that time.`);
    }

    // The observer cannot accept two observations whose class meetings overlap.
    const booked = await client.query(`
      SELECT 1 FROM sign_up AS target
      JOIN meeting_time AS target_meeting ON target_meeting.section_id = target.section_id
        AND target_meeting.day_of_week = lower(trim(to_char($3::date, 'FMDay')))
      JOIN observation AS existing ON existing.observer_netid = $2
        AND existing.signup_id <> target.signup_id AND existing.scheduled_date = $3::date
        AND existing.status <> 'not_completed'
      JOIN sign_up AS existing_signup ON existing_signup.signup_id = existing.signup_id
      JOIN meeting_time AS existing_meeting ON existing_meeting.section_id = existing_signup.section_id
        AND existing_meeting.day_of_week = target_meeting.day_of_week
      WHERE target.signup_id = $1
        AND existing_meeting.start_time < target_meeting.end_time
        AND target_meeting.start_time < existing_meeting.end_time
      LIMIT 1
    `, [signupId, observerNetid, date]);
    if (booked.rowCount) {
      throw new ApiError(409, 'SCHEDULE_CONFLICT', 'You already have an observation scheduled at that time.');
    }

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
    // Expired requests keep their history; only still-open requests are cancelled.
    await client.query(`
      UPDATE observation_request SET status = 'cancelled'
      WHERE signup_id = $1 AND observer_netid <> $2 AND status = 'pending' AND ${NOT_EXPIRED}
    `, [signupId, observerNetid]);
    // Reaching the limit cancels this observer's other open requests in the cycle.
    if (acceptedCount + 1 >= MAX_ACCEPTED) {
      await client.query(`
        UPDATE observation_request AS r SET status = 'cancelled'
        FROM sign_up AS s
        WHERE s.signup_id = r.signup_id AND s.cycle_id = $1
          AND r.observer_netid = $2 AND r.status = 'pending' AND r.${NOT_EXPIRED}
      `, [cycleId, observerNetid]);
    }
  });
  return getRequest(signupId, observerNetid);
}

// PATCH .../decline
export async function declineRequest(signupId: number, observerNetid: string) {
  const updated = await getPool().query(`
    UPDATE observation_request SET status = 'declined', responded_date = now()
    WHERE signup_id = $1 AND observer_netid = $2 AND status = 'pending' AND ${NOT_EXPIRED}
  `, [signupId, observerNetid]);
  const request = await getRequest(signupId, observerNetid);
  if (!updated.rowCount) throw new ApiError(409, 'NOT_PENDING', `This request is ${request.status}.`);
  return request;
}
