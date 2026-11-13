import { inTransaction } from '../db/transaction.js';
import { getPool } from '../db/pool.js';
import { ApiError } from '../middleware/error.middleware.js';
import { getObservation } from './observation.service.js';
import type { TroubleFile } from './survey.service.js';
import type { AuthUser } from './user.service.js';

// An observation's issue file lives in survey_attachment, the same file table the survey uses.
// issue_file_key is "attachments/<attachment id>/<file name>", so the observation shows the name
// and the download finds the file.
const KEY = /^attachments\/(\d+)\//;

// POST /api/observations/{observationId}/issue-file: the observer or observee attaches a file
// about the observation (for example, proof it could not take place). A new file replaces the old one.
// Locked records (signed by both) cannot be changed.
export async function uploadIssueFile(observationId: number, user: AuthUser, file: TroubleFile | undefined) {
  const record = await getObservation(observationId, user);
  if (record.observer.netid !== user.netid && record.observee.netid !== user.netid) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the observer or the observee can attach a file.');
  }
  if (record.observerSignedDate && record.observeeSignedDate) {
    throw new ApiError(409, 'RECORD_LOCKED', 'This record is signed and locked, so files cannot be added.');
  }
  if (!file) throw new ApiError(400, 'FILE_REQUIRED', 'Choose a file to upload.');

  await inTransaction(async (client) => {
    const { rows: [current] } = await client.query<{ issue_file_key: string | null; locked: boolean }>(`
      SELECT issue_file_key, observer_signed_date IS NOT NULL AND observee_signed_date IS NOT NULL AS locked
      FROM observation WHERE observation_id = $1 FOR UPDATE`, [observationId]);
    if (current.locked) throw new ApiError(409, 'RECORD_LOCKED', 'This record is signed and locked, so files cannot be added.');
    const { rows: [saved] } = await client.query<{ attachment_id: string }>(`
      INSERT INTO survey_attachment (file_name, file_type, file_size, file_data, uploaded_by)
      VALUES ($1, $2, $3, $4, $5) RETURNING attachment_id`,
    [file.name, file.type, file.data.length, file.data, user.netid]);
    await client.query('UPDATE observation SET issue_file_key = $2 WHERE observation_id = $1',
      [observationId, `attachments/${saved.attachment_id}/${file.name}`]);
    const old = current.issue_file_key && KEY.exec(current.issue_file_key);
    if (old) await client.query('DELETE FROM survey_attachment WHERE attachment_id = $1', [old[1]]);
  });
  return getObservation(observationId, user);
}

// GET /api/observations/{observationId}/issue-file: the file itself, for anyone who can see the observation.
export async function getIssueFile(observationId: number, user: AuthUser) {
  await getObservation(observationId, user);
  const { rows: [file] } = await getPool().query<{ file_name: string; file_type: string; file_data: Buffer }>(`
    SELECT a.file_name, a.file_type, a.file_data
    FROM observation AS o
    JOIN survey_attachment AS a ON o.issue_file_key LIKE 'attachments/' || a.attachment_id || '/%'
    WHERE o.observation_id = $1`, [observationId]);
  if (!file) throw new ApiError(404, 'NO_FILE', 'This observation has no attached file.');
  return file;
}
