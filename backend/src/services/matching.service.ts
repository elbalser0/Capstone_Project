import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { inTransaction } from '../db/transaction.js';
import { ApiError } from '../middleware/error.middleware.js';
import { mapCourseRows, type CourseSection } from './course.service.js';
import { MAX_ACCEPTED } from './request.service.js';
import { displayName, type Rank } from './user.service.js';

// Observer selection lists up to this many observers per sign-up (Business Logic doc).
export const MAX_CANDIDATES = 5;
// Fewer observers than this raises an insufficient_observers alert; none raises no_observer.
// 3 matches the frontend mock; the team still has to confirm the number.
export const INSUFFICIENT_BELOW = 3;

type AlertType = 'no_observer' | 'insufficient_observers' | 'no_acceptance';
type CourseRow = Parameters<typeof mapCourseRows>[0][number];

export function alertFor(candidates: number): AlertType | null {
  if (candidates === 0) return 'no_observer';
  return candidates < INSUFFICIENT_BELOW ? 'insufficient_observers' : null;
}

// Adds eligible observers to one sign-up until it has MAX_CANDIDATES, and returns how many it has.
// Eligible: has a sign-up in the same cycle (the observer pool), is active, is in the observee's
// department, taught a course of the same level in the four semesters up to and including the
// cycle's term, is not the observee, and has fewer than MAX_ACCEPTED observations this cycle.
// Observers with the fewest matches in this cycle come first, so the work is spread out.
async function addCandidates(client: PoolClient, signupId: number, cycleId: number): Promise<number> {
  await client.query(`
    WITH target AS (
      SELECT s.signup_id, s.observee_netid, ee.dept_id, c.course_level, t.start_date AS term_start
      FROM sign_up AS s
      JOIN professor AS ee ON ee.netid = s.observee_netid
      JOIN section AS sec ON sec.section_id = s.section_id
      JOIN course AS c ON c.course_id = sec.course_id
      JOIN eval_cycle AS cy ON cy.cycle_id = s.cycle_id
      JOIN term AS t ON t.term_id = cy.term_id
      WHERE s.signup_id = $1
    ), recent_terms AS (
      SELECT term_id FROM term, target
      WHERE term.start_date <= target.term_start
      ORDER BY term.start_date DESC LIMIT 4
    )
    INSERT INTO observer_match (signup_id, observer_netid, generated_date, round_no)
    SELECT target.signup_id, p.netid, now(), 1
    FROM target
    JOIN sign_up AS pool ON pool.cycle_id = $2
    JOIN professor AS p ON p.netid = pool.observee_netid AND p.is_active AND p.dept_id = target.dept_id
    WHERE p.netid <> target.observee_netid
      AND NOT EXISTS (SELECT 1 FROM observer_match AS m WHERE m.signup_id = target.signup_id AND m.observer_netid = p.netid)
      AND EXISTS (
        SELECT 1 FROM section AS taught
        JOIN course AS tc ON tc.course_id = taught.course_id
        WHERE taught.instructor_id = p.netid AND tc.course_level = target.course_level
          AND taught.term_id IN (SELECT term_id FROM recent_terms))
      AND (SELECT count(*) FROM observation AS o JOIN sign_up AS os ON os.signup_id = o.signup_id
           WHERE o.observer_netid = p.netid AND os.cycle_id = $2) < $3
    ORDER BY (SELECT count(*) FROM observer_match AS m JOIN sign_up AS ms ON ms.signup_id = m.signup_id
              WHERE m.observer_netid = p.netid AND ms.cycle_id = $2), p.netid
    LIMIT GREATEST(0, $4 - (SELECT count(*) FROM observer_match WHERE signup_id = $1))
  `, [signupId, cycleId, MAX_ACCEPTED, MAX_CANDIDATES]);
  const { rows } = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM observer_match WHERE signup_id = $1', [signupId]);
  return rows[0].n;
}

// POST /api/cycles/{cycleId}/matching: run observer selection for every sign-up that has no
// observer yet. Re-running replaces the list, except observers who were already sent a request.
export async function runMatching(cycleId: number) {
  await inTransaction(async (client) => {
    // One run at a time per cycle.
    const { rows: [cycle] } = await client.query<{ signup_open: boolean }>(`
      SELECT CURRENT_DATE <= signup_deadline AS signup_open FROM eval_cycle WHERE cycle_id = $1 FOR UPDATE
    `, [cycleId]);
    if (!cycle) throw new ApiError(404, 'NOT_FOUND', 'Cycle not found.');
    if (cycle.signup_open) {
      throw new ApiError(409, 'SIGNUP_OPEN', 'Run observer selection after the sign-up deadline.');
    }
    // Locks the sign-ups, like sending and confirming requests do, so they can't change mid-run.
    const { rows: signups } = await client.query<{ signup_id: number }>(`
      SELECT s.signup_id FROM sign_up AS s
      WHERE s.cycle_id = $1 AND NOT EXISTS (SELECT 1 FROM observation AS o WHERE o.signup_id = s.signup_id)
      ORDER BY s.signup_id FOR UPDATE OF s
    `, [cycleId]);
    for (const { signup_id: signupId } of signups) {
      // Observers who were sent a request stay (their request depends on the match).
      await client.query(`
        DELETE FROM observer_match AS m
        WHERE m.signup_id = $1 AND m.round_no = 1
          AND NOT EXISTS (SELECT 1 FROM observation_request AS r
                          WHERE r.signup_id = m.signup_id AND r.observer_netid = m.observer_netid)
      `, [signupId]);
      await client.query(`
        DELETE FROM alert WHERE signup_id = $1 AND resolved_date IS NULL
          AND alert_type IN ('no_observer', 'insufficient_observers')
      `, [signupId]);
      const alert = alertFor(await addCandidates(client, signupId, cycleId));
      if (alert) await client.query('INSERT INTO alert (signup_id, alert_type) VALUES ($1, $2)', [signupId, alert]);
    }
  });
  return listMatching(cycleId);
}

interface MatchingSignupRow {
  signup_id: number;
  section_id: number;
  netid: string;
  first_name: string;
  last_name: string;
  rank: Rank;
  ran_at: Date | null;
  alert_id: number | null;
  alert_type: AlertType | null;
  alert_created: Date | null;
}

function person(netid: string, firstName: string, lastName: string, rank: Rank) {
  return { netid, firstName, lastName, displayName: displayName(firstName, lastName), rank };
}

// Same section query as course.service listCourses, filtered by section IDs.
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

// Each sign-up in the cycle with its observer list and its newest open alert.
export async function listMatching(cycleId: number) {
  const db = getPool();
  const { rows } = await db.query<MatchingSignupRow>(`
    SELECT s.signup_id, s.section_id, p.netid, p.first_name, p.last_name, p.rank,
           (SELECT max(generated_date) FROM observer_match WHERE signup_id = s.signup_id) AS ran_at,
           a.alert_id, a.alert_type, a.created_date AS alert_created
    FROM sign_up AS s
    JOIN professor AS p ON p.netid = s.observee_netid
    LEFT JOIN LATERAL (
      SELECT alert_id, alert_type, created_date FROM alert
      WHERE alert.signup_id = s.signup_id AND resolved_date IS NULL
      ORDER BY created_date DESC, alert_id DESC LIMIT 1
    ) AS a ON true
    WHERE s.cycle_id = $1
    ORDER BY s.signup_id
  `, [cycleId]);
  if (rows.length === 0) return [];
  const [sections, matches] = await Promise.all([
    loadSections([...new Set(rows.map((row) => row.section_id))]),
    db.query<{ signup_id: number; netid: string; first_name: string; last_name: string; rank: Rank }>(`
      SELECT m.signup_id, p.netid, p.first_name, p.last_name, p.rank
      FROM observer_match AS m JOIN professor AS p ON p.netid = m.observer_netid
      WHERE m.signup_id = ANY($1::int[])
      ORDER BY m.round_no, m.generated_date, p.netid
    `, [rows.map((row) => row.signup_id)]),
  ]);
  return rows.map((row) => {
    const section = sections.get(String(row.section_id));
    if (!section) throw new Error('The sign-up section is unavailable.');
    return {
      signupId: String(row.signup_id),
      ranAt: row.ran_at ? row.ran_at.toISOString() : null,
      observee: person(row.netid, row.first_name, row.last_name, row.rank),
      section,
      candidates: matches.rows.filter((m) => m.signup_id === row.signup_id)
        .map((m) => person(m.netid, m.first_name, m.last_name, m.rank)),
      alert: row.alert_id && row.alert_type && row.alert_created
        ? { alertId: String(row.alert_id), alertType: row.alert_type, createdDate: row.alert_created.toISOString() }
        : null,
    };
  });
}
