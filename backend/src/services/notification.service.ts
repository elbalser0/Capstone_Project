import { getPool } from '../db/pool.js';
import { displayName, type Rank } from './user.service.js';

// The newest notifications are enough for the inbox; older ones aren't shown.
export const NOTIFICATION_LIMIT = 100;

// notification.sent_by is NOT NULL and references ac_member, which references professor,
// so every notification has a sender.
interface NotificationRow {
  notification_id: number;
  notif_type: string;
  subject: string;
  sent_date: Date;
  sender_netid: string;
  sender_first_name: string;
  sender_last_name: string;
  sender_rank: Rank;
}

export function mapNotification(row: NotificationRow) {
  return {
    notificationId: String(row.notification_id),
    notifType: row.notif_type,
    subject: row.subject,
    sentDate: row.sent_date.toISOString(),
    sentBy: {
      netid: row.sender_netid,
      firstName: row.sender_first_name,
      lastName: row.sender_last_name,
      displayName: displayName(row.sender_first_name, row.sender_last_name),
      rank: row.sender_rank,
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
    JOIN professor AS p ON p.netid = n.sent_by
    WHERE n.recipient_netid = $1
    ORDER BY n.sent_date DESC, n.notification_id DESC
    LIMIT $2
  `, [netid, NOTIFICATION_LIMIT]);
  return rows.map(mapNotification);
}
