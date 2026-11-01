import type { CourseSection, ObservationSummary } from '../../api/types';
import type { TagTone } from '../../components/ui';
import { utcDay } from '../../lib/dates';
import { formatDate, formatDayYear, formatTime, isLocked } from '../../lib/format';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * The class start time on the scheduled date, only when exactly one of the section's meetings falls on that
 * weekday. The observation itself stores only a date, so no time is shown when the section meets twice that
 * day or not at all.
 */
export function meetingTime(section: CourseSection, date: string): string | null {
  const day = DAYS[utcDay(date).getUTCDay()];
  const same = section.meetings.filter((m) => m.dayOfWeek === day);
  return same.length === 1 ? formatTime(same[0].startTime) : null;
}

/** "Wed Oct 14" (no comma, like the Figma) */
const shortDay = (date: string) => `${DAYS[utcDay(date).getUTCDay()]} ${utcDay(date).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}`;

/** "Wed Oct 14, 8:30 AM" or "Wed Oct 14" */
export function whenShort(o: Pick<ObservationSummary, 'section' | 'scheduledDate'>) {
  const time = meetingTime(o.section, o.scheduledDate);
  return time ? `${shortDay(o.scheduledDate)}, ${time}` : shortDay(o.scheduledDate);
}

/** "Wed Oct 14, 2026, 8:30 AM" or "Wed Oct 14, 2026" */
export function whenLong(o: Pick<ObservationSummary, 'section' | 'scheduledDate'>) {
  const time = meetingTime(o.section, o.scheduledDate);
  return time ? `${formatDayYear(o.scheduledDate)}, ${time}` : formatDayYear(o.scheduledDate);
}

type Parties = Pick<ObservationSummary, 'status' | 'observer' | 'observee' | 'observerSignedDate' | 'observeeSignedDate'>;

/** Status badge from the lifecycle and the signature dates that are actually returned. */
export function recordStatus(o: Parties, viewerNetid: string): { tone: TagTone; text: string } {
  if (isLocked(o)) return { tone: 'signed', text: 'Signed and locked' };
  if (o.status === 'not_completed') return { tone: 'neutral', text: 'Observation did not happen' };
  const missing = o.observerSignedDate ? 'observee' : o.observeeSignedDate ? 'observer' : null;
  if (!missing) return { tone: 'neutral', text: 'Record not fully signed' };
  return { tone: 'due', text: o[missing].netid === viewerNetid ? 'Waiting for your signature' : `Waiting for the ${missing}'s signature` };
}

/** "signed Oct 14, 2026": the response carries dates only, so no time of day is ever shown. */
export const signedOn = (date: string | null) => (date ? `signed ${formatDate(date)}` : 'Not signed yet');
