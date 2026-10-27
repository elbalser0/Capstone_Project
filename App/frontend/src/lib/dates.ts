import { nowMs } from './clock';

/** "2026-09-15" (or a timestamp) as midnight UTC that day. */
export const utcDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

/** "2026-09-15" plus n days. */
export const addDays = (iso: string, days: number) => {
  const d = utcDay(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Whole hours from now until a timestamp (0 once it has passed). */
export const hoursUntil = (isoDateTime: string) => Math.max(0, Math.ceil((new Date(isoDateTime).getTime() - nowMs()) / 3_600_000));

/** Today's date as "2026-09-15" by the app clock. */
export const todayIso = () => new Date(nowMs()).toISOString().slice(0, 10);

/** "Expires in 31 hours" for a pending request, by the app clock; "Expiring now" in its last hour. */
export function formatExpiry(expiresAt: string) {
  const hours = hoursUntil(expiresAt);
  return hours ? `Expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}` : 'Expiring now';
}
