import { getPool } from '../db/pool.js';
import { inTransaction } from '../db/transaction.js';
import { ApiError } from '../middleware/error.middleware.js';
import { displayName, type Rank } from './user.service.js';

export type RespondentRole = 'observer' | 'observee';

export interface SurveyInput {
  respondentRole: RespondentRole;
  processOk: boolean;
  difficulties: string | null;
  additionalFeedback: string | null;
}

// The optional trouble file, stored in survey_attachment. trouble_file_key holds its id.
export interface TroubleFile {
  name: string;
  type: string;
  data: Buffer;
}

// POST /api/cycles/{cycleId}/survey-responses: the end-of-process survey. Open the day after
// the observation deadline through the feedback deadline. Observees must have signed up in
// the cycle and observers must have an observation in it. One response per role.
export async function submitSurvey(cycleId: number, netid: string, input: SurveyInput, file?: TroubleFile) {
  const db = getPool();
  const { rows: [cycle] } = await db.query<{
    open: boolean; opens: string; closes: string; observee: boolean; observer: boolean;
  }>(`
    SELECT CURRENT_DATE > c.observation_deadline AND CURRENT_DATE <= c.feedback_deadline AS open,
           (c.observation_deadline + 1)::text AS opens, c.feedback_deadline::text AS closes,
           EXISTS (SELECT 1 FROM sign_up AS s WHERE s.cycle_id = c.cycle_id AND s.observee_netid = $2) AS observee,
           EXISTS (SELECT 1 FROM observation AS o JOIN sign_up AS s ON s.signup_id = o.signup_id
                   WHERE s.cycle_id = c.cycle_id AND o.observer_netid = $2) AS observer
    FROM eval_cycle AS c WHERE c.cycle_id = $1
  `, [cycleId, netid]);
  if (!cycle) throw new ApiError(404, 'NOT_FOUND', 'Cycle not found.');
  if (!cycle.open) {
    throw new ApiError(409, 'SURVEY_CLOSED', `The survey is open from ${cycle.opens} to ${cycle.closes}.`);
  }
  if (!cycle[input.respondentRole]) {
    throw new ApiError(403, 'NOT_A_PARTICIPANT', `You were not an ${input.respondentRole} in this cycle.`);
  }

  // The file and the response are saved together, so a duplicate response leaves no orphan file.
  return inTransaction(async (client) => {
    let fileKey: string | null = null;
    if (file) {
      const { rows: [saved] } = await client.query<{ attachment_id: string }>(`
        INSERT INTO survey_attachment (file_name, file_type, file_size, file_data, uploaded_by)
        VALUES ($1, $2, $3, $4, $5) RETURNING attachment_id::text
      `, [file.name, file.type, file.data.length, file.data, netid]);
      fileKey = saved.attachment_id;
    }
    const { rows } = await client.query<{ response_id: number }>(`
      INSERT INTO survey_response
        (cycle_id, respondent_id, respondent_role, process_ok, difficulties, additional_feedback, trouble_file_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (cycle_id, respondent_id, respondent_role) DO NOTHING
      RETURNING response_id
    `, [cycleId, netid, input.respondentRole, input.processOk, input.difficulties, input.additionalFeedback, fileKey]);
    if (!rows.length) throw new ApiError(409, 'ALREADY_SUBMITTED', 'You already submitted the survey.');
    return { responseId: String(rows[0].response_id) };
  });
}

interface SurveyRow {
  response_id: number;
  respondent_id: string;
  first_name: string;
  last_name: string;
  rank: Rank;
  respondent_role: RespondentRole;
  process_ok: boolean;
  difficulties: string | null;
  additional_feedback: string | null;
  trouble_file_key: string | null;
  submitted_date: string;
}

export function mapSurveyResponse(row: SurveyRow) {
  return {
    responseId: String(row.response_id),
    respondent: {
      netid: row.respondent_id,
      firstName: row.first_name,
      lastName: row.last_name,
      displayName: displayName(row.first_name, row.last_name),
      rank: row.rank,
    },
    respondentRole: row.respondent_role,
    processOk: row.process_ok,
    difficulties: row.difficulties ?? '',
    additionalFeedback: row.additional_feedback ?? '',
    troubleFileKey: row.trouble_file_key,
    submittedDate: row.submitted_date,
  };
}

// GET /api/cycles/{cycleId}/survey-responses (AC only): every response in the cycle, newest first.
export async function listSurveyResponses(cycleId: number) {
  const db = getPool();
  const cycle = await db.query('SELECT 1 FROM eval_cycle WHERE cycle_id = $1', [cycleId]);
  if (!cycle.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Cycle not found.');
  const { rows } = await db.query<SurveyRow>(`
    SELECT r.response_id, r.respondent_id, p.first_name, p.last_name, p.rank, r.respondent_role,
           r.process_ok, r.difficulties, r.additional_feedback, r.trouble_file_key,
           r.submitted_date::date::text AS submitted_date
    FROM survey_response AS r JOIN professor AS p ON p.netid = r.respondent_id
    WHERE r.cycle_id = $1
    ORDER BY r.submitted_date DESC, r.response_id DESC
  `, [cycleId]);
  return rows.map(mapSurveyResponse);
}

// GET /api/cycles/{cycleId}/survey-responses/{responseId}/trouble-file (AC only): download the
// file attached to a response.
export async function getTroubleFile(cycleId: number, responseId: number) {
  const { rows: [file] } = await getPool().query<{ file_name: string; file_type: string; file_data: Buffer }>(`
    SELECT a.file_name, a.file_type, a.file_data
    FROM survey_response AS r
    JOIN survey_attachment AS a ON a.attachment_id::text = r.trouble_file_key
    WHERE r.cycle_id = $1 AND r.response_id = $2
  `, [cycleId, responseId]);
  if (!file) throw new ApiError(404, 'NOT_FOUND', 'No file for this survey response.');
  return file;
}
