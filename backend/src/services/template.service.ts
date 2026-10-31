import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { inTransaction } from '../db/transaction.js';
import { ApiError } from '../middleware/error.middleware.js';
import { displayName, type Rank } from './user.service.js';

export type TemplateStatus = 'draft' | 'live' | 'retired';

export interface QuestionInput {
  title: string;
  wording: string;
  ratingMin: number;
  ratingMax: number;
  minLabel: string;
  maxLabel: string;
  isRequired: boolean;
}

interface VersionRow {
  version_id: number;
  version_no: number;
  status: TemplateStatus;
  change_note: string | null;
  created_date: string;
  published_date: string | null;
  creator_netid: string;
  creator_first_name: string;
  creator_last_name: string;
  creator_rank: Rank;
  observations_count: number;
}

interface QuestionRow {
  question_id: number;
  version_id: number;
  order_no: number;
  title: string;
  wording: string;
  rating_min: number;
  rating_max: number;
  min_label: string | null;
  max_label: string | null;
  is_required: boolean;
}

// Template versions in the frontend's TemplateVersion shape, with their questions in order.
// `where` filters template_version (alias v); exported so GET /api/templates can reuse it.
export async function loadTemplateVersions(where: string, params: unknown[], db: Pick<PoolClient, 'query'> = getPool()) {
  const { rows } = await db.query<VersionRow>(`
    SELECT v.version_id, v.version_no, v.status, v.change_note,
           v.created_date::date::text AS created_date, v.published_date::date::text AS published_date,
           p.netid AS creator_netid, p.first_name AS creator_first_name,
           p.last_name AS creator_last_name, p.rank AS creator_rank,
           (SELECT count(*)::int FROM observation AS o WHERE o.version_id = v.version_id) AS observations_count
    FROM template_version AS v JOIN professor AS p ON p.netid = v.created_by
    WHERE ${where}
    ORDER BY v.version_no DESC
  `, params);
  if (!rows.length) return [];
  const { rows: questions } = await db.query<QuestionRow>(`
    SELECT question_id, version_id, order_no, title, wording, rating_min, rating_max,
           min_label, max_label, is_required
    FROM template_question WHERE version_id = ANY($1::int[])
    ORDER BY version_id, order_no
  `, [rows.map((row) => row.version_id)]);
  return rows.map((row) => ({
    versionId: String(row.version_id),
    versionNo: row.version_no,
    status: row.status,
    changeNote: row.change_note ?? '',
    createdBy: {
      netid: row.creator_netid,
      firstName: row.creator_first_name,
      lastName: row.creator_last_name,
      displayName: displayName(row.creator_first_name, row.creator_last_name),
      rank: row.creator_rank,
    },
    createdDate: row.created_date,
    publishedDate: row.published_date,
    observationsCount: row.observations_count,
    questions: questions.filter((q) => q.version_id === row.version_id).map((q) => ({
      questionId: String(q.question_id),
      orderNo: q.order_no,
      title: q.title,
      wording: q.wording,
      ratingMin: q.rating_min,
      ratingMax: q.rating_max,
      minLabel: q.min_label ?? '',
      maxLabel: q.max_label ?? '',
      isRequired: q.is_required,
    })),
  }));
}

async function loadVersion(versionId: number, db: Pick<PoolClient, 'query'>) {
  const [version] = await loadTemplateVersions('v.version_id = $1', [versionId], db);
  return version;
}

// Creating and publishing take this lock so two AC members can't race on version numbers
// or on which version is live.
const lockTemplates = (client: PoolClient) =>
  client.query("SELECT pg_advisory_xact_lock(hashtext('template_versions'))");

// GET /api/templates/active: the live version, for any signed-in professor.
export async function getActiveTemplate() {
  const [live] = await loadTemplateVersions("v.status = 'live'", []);
  if (!live) throw new ApiError(404, 'NOT_FOUND', 'No template version is live yet.');
  return live;
}

// POST /api/templates (AC): save a new draft. There is one draft at a time, so saving
// replaces the previous draft. Drafts are never used for observations, so this is safe.
export function createDraft(createdBy: string, changeNote: string, questions: QuestionInput[]) {
  return inTransaction(async (client) => {
    await lockTemplates(client);
    const { rows: [old] } = await client.query<{ version_id: number }>(
      "SELECT version_id FROM template_version WHERE status = 'draft'");
    if (old) {
      await client.query('DELETE FROM template_question WHERE version_id = $1', [old.version_id]);
      await client.query('DELETE FROM template_version WHERE version_id = $1', [old.version_id]);
    }
    const { rows: [created] } = await client.query<{ version_id: number }>(`
      INSERT INTO template_version (version_no, status, change_note, created_by)
      SELECT COALESCE(max(version_no), 0) + 1, 'draft', $1, $2 FROM template_version
      RETURNING version_id
    `, [changeNote, createdBy]);
    for (const [index, q] of questions.entries()) {
      await client.query(`
        INSERT INTO template_question
          (version_id, order_no, title, wording, rating_min, rating_max, min_label, max_label, is_required)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [created.version_id, index + 1, q.title, q.wording, q.ratingMin, q.ratingMax,
        q.minLabel || null, q.maxLabel || null, q.isRequired]);
    }
    return loadVersion(created.version_id, client);
  });
}

// PATCH /api/templates/{versionId}/publish (AC): the draft becomes live and the previous live
// version is retired. A non-empty changeNote replaces the draft's note.
export function publishDraft(versionId: number, changeNote: string | undefined) {
  return inTransaction(async (client) => {
    await lockTemplates(client);
    const { rows: [version] } = await client.query<{ status: TemplateStatus }>(
      'SELECT status FROM template_version WHERE version_id = $1', [versionId]);
    if (!version) throw new ApiError(404, 'NOT_FOUND', 'Template version not found.');
    if (version.status !== 'draft') throw new ApiError(409, 'NOT_DRAFT', 'Only a draft can be published.');
    await client.query("UPDATE template_version SET status = 'retired' WHERE status = 'live'");
    await client.query(`
      UPDATE template_version
      SET status = 'live', published_date = now(), change_note = COALESCE($2, change_note)
      WHERE version_id = $1
    `, [versionId, changeNote || null]);
    return loadVersion(versionId, client);
  });
}
