import { expect, it } from 'vitest';
import { course, faculty, observer } from '../../test/fixtures';
import { meetingTime, recordStatus, signedOn, whenLong, whenShort } from './observationDisplay';

const party = { status: 'completed' as const, observer, observee: faculty, observerSignedDate: null, observeeSignedDate: null };

it('shows a class time only when exactly one meeting falls on the scheduled weekday', () => {
  expect(meetingTime(course, '2026-09-21')).toBe('8:30 AM');
  expect(meetingTime(course, '2026-09-22')).toBeNull();
  expect(meetingTime({ ...course, meetings: [...course.meetings, { ...course.meetings[0], startTime: '14:00', endTime: '15:00' }] }, '2026-09-21')).toBeNull();
  expect(meetingTime({ ...course, meetings: [] }, '2026-09-21')).toBeNull();
});
it('formats the scheduled date with the time only when it is unambiguous', () => {
  expect(whenShort({ section: course, scheduledDate: '2026-09-21' })).toBe('Mon Sep 21, 8:30 AM');
  expect(whenLong({ section: course, scheduledDate: '2026-09-21' })).toBe('Mon Sep 21, 2026, 8:30 AM');
  expect(whenShort({ section: course, scheduledDate: '2026-09-22' })).toBe('Tue Sep 22');
  expect(whenLong({ section: course, scheduledDate: '2026-09-22' })).toBe('Tue Sep 22, 2026');
});
it('words the status from the lifecycle and the returned signature dates', () => {
  expect(recordStatus(party, faculty.netid)).toEqual({ tone: 'neutral', text: 'Record not fully signed' });
  expect(recordStatus({ ...party, observerSignedDate: '2026-09-22' }, faculty.netid)).toEqual({ tone: 'due', text: 'Waiting for your signature' });
  expect(recordStatus({ ...party, observerSignedDate: '2026-09-22' }, observer.netid)).toEqual({ tone: 'due', text: "Waiting for the observee's signature" });
  expect(recordStatus({ ...party, observeeSignedDate: '2026-09-22' }, faculty.netid).text).toBe("Waiting for the observer's signature");
  expect(recordStatus({ ...party, observerSignedDate: '2026-09-22', observeeSignedDate: '2026-09-23' }, faculty.netid)).toEqual({ tone: 'signed', text: 'Signed and locked' });
  expect(recordStatus({ ...party, status: 'not_completed' }, faculty.netid).text).toBe('Observation did not happen');
});
it('describes signatures by date only', () => {
  expect(signedOn('2026-09-22')).toBe('signed Sep 22, 2026');
  expect(signedOn(null)).toBe('Not signed yet');
});
