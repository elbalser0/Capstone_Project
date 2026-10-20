import type { CountByRank, CourseSection, Me, MeetingTime, ObservationSummary, ProposedDate, Rank } from '../api/types';
import { utcDay as day } from './dates';

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => day(iso).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

/** "Sep 15, 2026" */
export const formatDate = (iso: string) => fmt(iso, { month: 'short', day: 'numeric', year: 'numeric' });

/** "Nov 2 to 15, 2026", "Nov 28 to Dec 4, 2026" */
export function formatRange(from: string, to: string) {
  const a = day(from);
  const b = day(to);
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${formatDate(from)} to ${formatDate(to)}`;
  const end = a.getUTCMonth() === b.getUTCMonth() ? fmt(to, { day: 'numeric' }) : fmt(to, { month: 'short', day: 'numeric' });
  return `${fmt(from, { month: 'short', day: 'numeric' })} to ${end}, ${b.getUTCFullYear()}`;
}

/** "Nov 2" */
export const formatShort = (iso: string) => fmt(iso, { month: 'short', day: 'numeric' });

export const RANK_LABEL: Record<Rank, string> = {
  assistant: 'Assistant Professor',
  associate: 'Associate Professor',
  full: 'Full Professor',
};

export const initials = (me: Pick<Me, 'firstName' | 'lastName'>) => `${me.firstName[0]}${me.lastName[0]}`.toUpperCase();

export const percent = (value: number) => `${Math.round(value * 100)}%`;

// ---------- Times, days and meetings ----------

/** Timestamps are shown in the university's time zone, whatever the viewer's. */
const CAMPUS_TZ = 'America/Chicago';

/** "Sep 18, 9:14 AM" */
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: CAMPUS_TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "9:41 AM" for a clock time in milliseconds */
export const formatClock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: CAMPUS_TZ, hour: 'numeric', minute: '2-digit' });

/** "Mon Oct 12" (the Figma writes no comma after the weekday) */
const formatDay = (iso: string) => `${weekday(iso)} ${fmt(iso, { month: 'short', day: 'numeric' })}`;

/** "Wed Oct 14, 2026" */
export const formatDayYear = (iso: string) => `${formatDay(iso)}, ${day(iso).getUTCFullYear()}`;

/** "08:30" -> "8:30 AM" */
export function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "8:30 to 9:45 AM", "11:30 AM to 12:45 PM" */
function formatTimeRange(start: string, end: string) {
  const a = formatTime(start);
  const b = formatTime(end);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} to ${b}` : `${a} to ${b}`;
}

/** "Mon Oct 12, 8:30 AM" */
export const formatSlot = (date: string, startTime: string) => `${formatDay(date)}, ${formatTime(startTime)}`;

type Day = MeetingTime['dayOfWeek'];
const LETTER: Record<Day, string> = { Mon: 'M', Tue: 'T', Wed: 'W', Thu: 'R', Fri: 'F' };
const ORDER: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const days = (meetings: MeetingTime[]) => ORDER.filter((d) => meetings.some((m) => m.dayOfWeek === d));

/** "MW" (UTD style: Thursday is R) */
export const dayLetters = (meetings: MeetingTime[]) => days(meetings).map((d) => LETTER[d]).join('');

/** "Mon and Wed", "Mon, Wed and Fri" */
function dayNames(meetings: MeetingTime[]) {
  return joinAnd(days(meetings));
}

/** "MW 8:30 to 9:45 AM, ECSS 2.410" */
export function meetingSummary(section: CourseSection, style: 'letters' | 'names' = 'letters') {
  const m = section.meetings[0];
  if (!m) return section.classMode === 'online' ? 'Online' : '';
  const when = style === 'letters' ? dayLetters(section.meetings) : `${dayNames(section.meetings)},`;
  return `${when} ${formatTimeRange(m.startTime, m.endTime)}, ${m.room}`;
}

/** The start time of a section's class on a given date ("" when it does not meet that day). */
export function classStart(section: CourseSection, date: string) {
  return section.meetings.find((m) => m.dayOfWeek === weekday(date))?.startTime ?? section.meetings[0]?.startTime ?? '';
}

/** "Mon Oct 12, 8:30 AM and Wed Oct 14, 8:30 AM" */
export const listSlots = (dates: ProposedDate[]) => joinAnd(dates.map((d) => formatSlot(d.date, d.startTime)));

/** "1 accepted, 1 cancelled, 1 declined" from labelled counts, skipping zeros. */
export const countSummary = (counts: [number, string][]) =>
  counts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`).join(', ');

export const RANK_SHORT: Record<Rank, string> = { assistant: 'Assistant', associate: 'Associate', full: 'Full' };

/** "Assistant 8, Associate 6, Full 4" */
export const ranks = (c: CountByRank) => `Assistant ${c.assistant}, Associate ${c.associate}, Full ${c.full}`;

/** "Mon" for "2026-10-12". */
export const weekday = (iso: string) => fmt(iso, { weekday: 'short' });

/** "A", "A and B", "A, B and C" */
export const joinAnd = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? ''));

/** Signed by both: the record is locked for everyone. */
export const isLocked = (o: Pick<ObservationSummary, 'observeeSignedDate' | 'observerSignedDate'>) => Boolean(o.observeeSignedDate && o.observerSignedDate);

/** The list with `value` added, or removed if it was there. */
export const toggleIn = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
