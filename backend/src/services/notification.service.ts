import { getPool } from '../db/pool.js';
import { ApiError } from '../middleware/error.middleware.js';
import { displayName, type Rank } from './user.service.js';

// The newest notifications are enough for the inbox; older ones aren't shown.
export const NOTIFICATION_LIMIT = 100;

// notification.sent_by is nullable (system notifications have no sender), so the sender
// columns are null when there is none.
interface NotificationRow {
  notification_id: number;
  notif_type: string;
  subject: string;
  sent_date: Date;
  sender_netid: string | null;
  sender_first_name: string | null;
  sender_last_name: string | null;
  sender_rank: Rank | null;
}

export function mapNotification(row: NotificationRow) {
  return {
    notificationId: String(row.notification_id),
    notifType: row.notif_type,
    subject: row.subject,
    sentDate: row.sent_date.toISOString(),
    sentBy: row.sender_netid === null ? null : {
      netid: row.sender_netid,
      firstName: row.sender_first_name!,
      lastName: row.sender_last_name!,
      displayName: displayName(row.sender_first_name!, row.sender_last_name!),
      rank: row.sender_rank!,
    },
  };
}

// GET /api/me/notifications: the latest notifications sent to me, newest first.
export async function listMyNotifications(netid: string) {
  const { rows } = await getPool().query<NotificationRow>(`
    SELECT n.notification_id, n.notif_type, n.subject, n.sent_date,
           p.netid AS sender_netid, p.first_name AS sender_first_name,
           p.last_name AS sender_last_name, p.rank AS sender_rank
    FROM notification AS n
    LEFT JOIN professor AS p ON p.netid = n.sent_by
    WHERE n.recipient_netid = $1
    ORDER BY n.sent_date DESC, n.notification_id DESC
    LIMIT $2
  `, [netid, NOTIFICATION_LIMIT]);
  return rows.map(mapNotification);
}

// ---------- Sending (AC only) ----------

type NotifType = 'reminder' | 'matches_ready' | 'survey_open';

// Inserts one notification per recipient chosen by `recipientsSql` (a query returning `netid`
// and `subject` columns, with the cycle as $1 and the cycle's deadlines in the `deadlines`
// row) and returns how many were sent. Extra parameters start at $7.
async function sendToCycle(cycleId: number, sentBy: string, type: NotifType, recipientsSql: string, extra: unknown[] = []) {
  const db = getPool();
  const { rows: [cycle] } = await db.query<{ signup: string; observation: string; feedback: string }>(`
    SELECT signup_deadline::text AS signup, observation_deadline::text AS observation, feedback_deadline::text AS feedback
    FROM eval_cycle WHERE cycle_id = $1
  `, [cycleId]);
  if (!cycle) throw new ApiError(404, 'NOT_FOUND', 'Cycle not found.');

  const { rowCount } = await db.query(`
    WITH deadlines AS (SELECT $4::text AS signup, $5::text AS observation, $6::text AS feedback)
    INSERT INTO notification (cycle_id, recipient_netid, sent_by, notif_type, subject)
    SELECT $1, recipients.netid, $2, $3, recipients.subject
    FROM (${recipientsSql}) AS recipients
  `, [cycleId, sentBy, type, cycle.signup, cycle.observation, cycle.feedback, ...extra]);
  return { sent: rowCount ?? 0 };
}

// POST /api/cycles/{cycleId}/notifications/due-reminders: remind DUE/OVERDUE professors who
// have not signed up yet; all of them, or only the netids given. The subject names their
// status and all three deadlines.
export function sendDueReminders(cycleId: number, sentBy: string, netids?: string[]) {
  return sendToCycle(cycleId, sentBy, 'reminder', `
    SELECT due.netid,
           'Reminder: you are ' || CASE due.due_status WHEN 'overdue' THEN 'overdue' ELSE 'due' END
             || ' for a classroom observation. Sign up by ' || deadlines.signup
             || '. Observations are due by ' || deadlines.observation
             || ' and feedback by ' || deadlines.feedback || '.' AS subject
    FROM eval_due AS due CROSS JOIN deadlines
    WHERE due.cycle_id = $1
      AND ($7::text[] IS NULL OR due.netid = ANY($7::text[]))
      AND NOT EXISTS (SELECT 1 FROM sign_up AS s WHERE s.cycle_id = $1 AND s.observee_netid = due.netid)
  `, [netids?.length ? netids : null]);
}

// POST /api/cycles/{cycleId}/notifications/lists-ready: tell each observee who has an
// observer list that it is ready.
export function sendListsReady(cycleId: number, sentBy: string) {
  return sendToCycle(cycleId, sentBy, 'matches_ready', `
    SELECT s.observee_netid AS netid, 'Your observer list is ready' AS subject FROM sign_up AS s
    WHERE s.cycle_id = $1 AND EXISTS (SELECT 1 FROM observer_match AS m WHERE m.signup_id = s.signup_id)
  `);
}

// POST /api/cycles/{cycleId}/notifications/survey: every observee and observer in the cycle,
// once each.
export function sendSurveyOpen(cycleId: number, sentBy: string) {
  return sendToCycle(cycleId, sentBy, 'survey_open', `
    SELECT netid, 'The end-of-process survey is open until ' || deadlines.feedback || '.' AS subject FROM (
      SELECT s.observee_netid AS netid FROM sign_up AS s WHERE s.cycle_id = $1
      UNION
      SELECT o.observer_netid FROM observation AS o
      JOIN sign_up AS s ON s.signup_id = o.signup_id WHERE s.cycle_id = $1
    ) AS participants CROSS JOIN deadlines
  `);
}
