import type { CourseSection, Cycle, EvaluationStatus, ObservationSummary, PersonRef, Signup, Term } from '../api/types';

export const term: Term = {
  termId: '1', season: 'fall', year: 2026, label: 'Fall 2026', startDate: '2026-08-24', endDate: '2026-12-12',
};
export const faculty: PersonRef = {
  netid: 'ml123', firstName: 'Maya', lastName: 'Lin', displayName: 'Dr. Maya Lin', rank: 'assistant',
};
export const observer: PersonRef = {
  netid: 'er123', firstName: 'Elena', lastName: 'Ruiz', displayName: 'Dr. Elena Ruiz', rank: 'associate',
};
export const cycle: Cycle = {
  cycleId: '1', term, startedBy: observer, startDate: '2026-09-01', signupDeadline: '2026-09-15',
  observationDeadline: '2026-09-21', feedbackDeadline: '2026-10-01', surveyOpensDate: '2026-09-22', phase: 'signup',
};
export const evaluationStatus: EvaluationStatus = {
  status: 'DUE', rank: 'assistant', evalIntervalYears: 1, dueTerm: term,
  lastObservedTerm: null, cycle, canSignUp: true, signupId: null,
};
export const course: CourseSection = {
  sectionId: '10', label: 'CS 1337.002', courseNum: '1337', sectionNum: '002', title: 'Computer Science I',
  courseLevel: 1000, classMode: 'in-person', term,
  meetings: [{ dayOfWeek: 'Mon', startTime: '08:30', endTime: '09:45', room: 'ECSS 2.410' }],
};
export const otherCourse: CourseSection = {
  ...course, sectionId: '11', label: 'CS 2336.001', courseNum: '2336', sectionNum: '001', title: 'Computer Science II',
  courseLevel: 2000, meetings: [{ dayOfWeek: 'Wed', startTime: '10:00', endTime: '11:15', room: 'ECSS 2.412' }],
};
export const signup: Signup = {
  signupId: '20', cycleId: cycle.cycleId, observee: { ...faculty, email: 'maya.lin@demo.edu' }, section: course,
  proposedDates: [{ date: '2026-09-21', startTime: '08:30' }], submitDate: '2026-09-08', observation: null,
};
export const observation: ObservationSummary = {
  observationId: '30', term, observer, observee: faculty, section: course, scheduledDate: '2026-09-21',
  status: 'scheduled', observeeSignedDate: null, observerSignedDate: null,
};
