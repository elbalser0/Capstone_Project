import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { inTransaction } from '../db/transaction.js';
import { ApiError } from '../middleware/error.middleware.js';
import { fetchCycle, getCurrentCycle } from './cycle.service.js';
import { computeKpis, type CycleFacts, type KpiCode, type ObservationFact } from './kpi-rules.js';

// Two years of fall and spring terms, counting the cycle's own term.
const TEACHING_WINDOW_TERMS = 4;

interface KpiResultRow {
  kpi_code: KpiCode;
  numerator: string;
  denominator: string;
  kpi_value: string | null;
  computed_date: string;
}

export async function loadCycleFacts(db: Pool | PoolClient, cycleId: number): Promise<CycleFacts> {
  const deadline = await db.query<{ past: boolean }>(
    'SELECT CURRENT_DATE > observation_deadline AS past FROM eval_cycle WHERE cycle_id = $1', [cycleId]);

  // Inactive professors do not count as due or overdue.
  const due = await db.query<{ netid: string; due_status: 'due' | 'overdue' }>(`
    SELECT d.netid, d.due_status FROM eval_due AS d
    JOIN professor AS p ON p.netid = d.netid
    WHERE d.cycle_id = $1 AND p.is_active = true
    ORDER BY d.netid
  `, [cycleId]);

  // Question for the team: a professor deactivated after signing up still counts in 2.2, 3.1,
  // 4.1 and 4.2, and an inactive observer still counts in 1.1. Samuel's view is that inactive
  // professors shouldn't participate at all. If the team agrees, filter them here too.
  const signups = await db.query<{
    signup_id: number;
    observee_netid: string;
    match_count: number;
    requests_sent: number;
    has_accepted: boolean;
    surveyed: boolean;
  }>(`
    SELECT s.signup_id, s.observee_netid,
           (SELECT count(*)::int FROM observer_match AS m
            WHERE m.signup_id = s.signup_id AND m.round_no = 1) AS match_count,
           (SELECT count(*)::int FROM observation_request AS r
            WHERE r.signup_id = s.signup_id) AS requests_sent,
           EXISTS (SELECT 1 FROM observation_request AS r
                   WHERE r.signup_id = s.signup_id AND r.status = 'accepted') AS has_accepted,
           EXISTS (SELECT 1 FROM survey_response AS sr
                   WHERE sr.cycle_id = s.cycle_id AND sr.respondent_id = s.observee_netid
                     AND sr.respondent_role = 'observee') AS surveyed
    FROM sign_up AS s
    WHERE s.cycle_id = $1
    ORDER BY s.signup_id
  `, [cycleId]);

  const observations = await db.query<{
    signup_id: number;
    observer_netid: string;
    status: ObservationFact['status'];
    both_signed: boolean;
    self_match: boolean;
    same_dept: boolean;
    taught_level: boolean;
    schedule_conflict: boolean;
  }>(`
    SELECT o.signup_id, o.observer_netid, o.status,
           o.observer_signed_date IS NOT NULL AND o.observee_signed_date IS NOT NULL AS both_signed,
           o.observer_netid = s.observee_netid AS self_match,
           observer.dept_id = observee.dept_id AS same_dept,
           EXISTS (
             SELECT 1 FROM section AS taught
             JOIN course AS taught_course ON taught_course.course_id = taught.course_id
             WHERE taught.instructor_id = o.observer_netid
               AND taught_course.course_level = course.course_level
               AND taught.term_id IN (
                 SELECT t.term_id FROM term AS t
                 WHERE t.start_date <= cycle_term.start_date
                 ORDER BY t.start_date DESC
                 LIMIT $2
               )
           ) AS taught_level,
           -- Same overlap rule as confirming a request (request.service.ts).
           EXISTS (
             SELECT 1 FROM meeting_time AS em
             JOIN section AS os ON os.term_id = sec.term_id AND os.instructor_id = o.observer_netid
             JOIN meeting_time AS om ON om.section_id = os.section_id
               AND om.day_of_week = em.day_of_week
               AND om.start_time < em.end_time AND em.start_time < om.end_time
             WHERE em.section_id = sec.section_id
               AND em.day_of_week = lower(trim(to_char(o.scheduled_date, 'FMDay')))
           ) AS schedule_conflict
    FROM observation AS o
    JOIN sign_up AS s ON s.signup_id = o.signup_id
    JOIN professor AS observer ON observer.netid = o.observer_netid
    JOIN professor AS observee ON observee.netid = s.observee_netid
    JOIN section AS sec ON sec.section_id = s.section_id
    JOIN course ON course.course_id = sec.course_id
    JOIN term AS cycle_term ON cycle_term.term_id = sec.term_id
    WHERE s.cycle_id = $1
    ORDER BY o.signup_id
  `, [cycleId, TEACHING_WINDOW_TERMS]);

  return {
    pastObservationDeadline: deadline.rows[0]?.past ?? false,
    due: due.rows.map((row) => ({ netid: row.netid, dueStatus: row.due_status })),
    signups: signups.rows.map((row) => ({
      signupId: row.signup_id,
      netid: row.observee_netid,
      matchCount: row.match_count,
      requestsSent: row.requests_sent,
      hasAccepted: row.has_accepted,
      surveyedAsObservee: row.surveyed,
    })),
    observations: observations.rows.map((row) => ({
      signupId: row.signup_id,
      observerNetid: row.observer_netid,
      status: row.status,
      bothSigned: row.both_signed,
      selfMatch: row.self_match,
      sameDept: row.same_dept,
      taughtLevel: row.taught_level,
      scheduleConflict: row.schedule_conflict,
    })),
  };
}

async function storedKpis(cycleId: number) {
  const { rows } = await getPool().query<KpiResultRow>(`
    SELECT kpi_code, numerator, denominator, kpi_value, computed_date::date::text AS computed_date
    FROM kpi_result WHERE cycle_id = $1 ORDER BY kpi_code
  `, [cycleId]);
  return rows.map((row) => ({
    kpiCode: row.kpi_code,
    numerator: Number(row.numerator),
    denominator: Number(row.denominator),
    kpiValue: row.kpi_value === null ? null : Number(row.kpi_value),
    computedDate: row.computed_date,
  }));
}

async function calculateAndStore(cycleId: number) {
  await inTransaction(async (client) => {
    const kpis = computeKpis(await loadCycleFacts(client, cycleId));
    // Another request may be storing the same KPIs; the first one wins.
    await client.query(`
      INSERT INTO kpi_result (cycle_id, kpi_code, numerator, denominator, kpi_value)
      SELECT $1, * FROM unnest($2::text[], $3::numeric[], $4::numeric[], $5::numeric[])
      ON CONFLICT (cycle_id, kpi_code) DO NOTHING
    `, [
      cycleId,
      kpis.map((k) => k.kpiCode),
      kpis.map((k) => k.numerator),
      kpis.map((k) => k.denominator),
      kpis.map((k) => k.kpiValue),
    ]);
  });
}

// GET /api/cycles/{cycleId}/kpis: KPIs are calculated once, on the first request after
// the feedback deadline, and stay fixed from then on. "latest" is the newest closed cycle,
// or the current cycle (with no KPIs yet) if none has closed.
export async function getCycleKpis(cycleId: number | 'latest') {
  const cycle = cycleId === 'latest'
    ? await fetchCycle('c.feedback_deadline < CURRENT_DATE', []) ?? await getCurrentCycle()
    : await fetchCycle('c.cycle_id = $1', [cycleId]);
  if (!cycle) throw new ApiError(404, 'NOT_FOUND', 'Cycle not found.');

  const id = Number(cycle.cycleId);
  let kpis = await storedKpis(id);
  if (kpis.length === 0 && cycle.phase === 'closed') {
    await calculateAndStore(id);
    kpis = await storedKpis(id);
  }
  return { cycle, computedDate: kpis[0]?.computedDate ?? null, kpis };
}
