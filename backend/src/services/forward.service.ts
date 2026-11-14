import { randomBytes } from 'node:crypto';
import { getPool } from '../db/pool.js';
import { ApiError } from '../middleware/error.middleware.js';
import { queueEmail } from './email.service.js';
import { getObservation } from './observation.service.js';
import type { AuthUser } from './user.service.js';

type Record = Awaited<ReturnType<typeof getObservation>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The email body: the whole signed record as plain text. There is no read-only page for
// link_token yet, so the record itself goes in the email.
export function recordText(record: Record, sharedBy: string) {
  const course = `${record.section.courseNum} ${record.section.title}, section ${record.section.sectionNum}`;
  const lines = [
    `${sharedBy} shared a signed classroom observation record with you.`,
    '',
    `Observee: ${record.observee.displayName}`,
    `Observer: ${record.observer.displayName}`,
    `Course: ${course} (${record.term.label})`,
    `Observation date: ${record.scheduledDate}`,
    '',
  ];
  for (const answer of record.answers) {
    lines.push(`${answer.title}: ${answer.rating ?? '-'} of ${answer.ratingMax}`);
    if (answer.comment) lines.push(`  ${answer.comment}`);
  }
  lines.push('', `Other comments: ${record.otherComments || 'None'}`, '');
  lines.push(`Signed by the observer on ${record.observerSignedDate}`);
  lines.push(`Signed by the observee on ${record.observeeSignedDate}`);
  lines.push('', 'This record is signed and locked. It cannot be changed.', '', 'Assessment Committee');
  return lines.join('\n');
}

// POST /api/observations/{observationId}/forward (AC only): shares a signed and locked
// record by email. Every forward is saved in forwarded_observation with its own token.
export async function forwardObservation(observationId: number, user: AuthUser, email: unknown) {
  const record = await getObservation(observationId, user);
  if (!(record.observerSignedDate && record.observeeSignedDate)) {
    throw new ApiError(409, 'NOT_LOCKED', 'Only signed and locked records can be forwarded.');
  }
  const to = typeof email === 'string' ? email.trim() : '';
  if (!EMAIL.test(to)) throw new ApiError(400, 'INVALID_EMAIL', 'Enter a valid email address.');

  const { rows } = await getPool().query<{ forward_id: number; shared_date: string }>(`
    INSERT INTO forwarded_observation (observation_id, recipient_email, shared_by, link_token)
    VALUES ($1, $2, $3, $4)
    RETURNING forward_id, to_json(shared_date) #>> '{}' AS shared_date`,
  [observationId, to, user.netid, randomBytes(24).toString('base64url')]);

  queueEmail({
    to,
    subject: `Observation record: ${record.observee.displayName}, ${record.term.label}`,
    text: recordText(record, user.displayName),
  });
  return { forwardId: String(rows[0].forward_id), sharedDate: rows[0].shared_date };
}
