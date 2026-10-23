import { getPool } from '../db/pool.js';
import type { Rank } from './user.service.js';

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
      displayName: `Dr. ${row.sender_first_name} ${row.sender_last_name}`,
      rank: row.sender_rank!,
    },
  };
}

// GET /api/me/notifications: notifications sent to me, newest first.
export async function listMyNotifications(netid: string) {
  const { rows } = await getPool().query<NotificationRow>(`
    SELECT n.notification_id, n.notif_type, n.subject, n.sent_date,
           p.netid AS sender_netid, p.first_name AS sender_first_name,
           p.last_name AS sender_last_name, p.rank AS sender_rank
    FROM notification AS n
    LEFT JOIN professor AS p ON p.netid = n.sent_by
    WHERE n.recipient_netid = $1
    ORDER BY n.sent_date DESC, n.notification_id DESC
  `, [netid]);
  return rows.map(mapNotification);
}
