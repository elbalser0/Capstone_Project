import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { invalidate, withId } from './shared';
import type {
  Candidate,
  ConfirmRequestInput,
  CourseSection,
  CreateSignupInput,
  EvaluationStatus,
  ObservationDetail,
  ObservationRequest,
  ObservationSummary,
  ReportMissedInput,
  SendRequestsInput,
  SignedFormInput,
  Signup,
  SurveyInput,
} from '../types';

// Faculty pages. Every professor is both a possible observee and a possible observer,
// so the observee and observer endpoints live together here.

const facultyKeys = {
  evaluationStatus: ['me', 'evaluation-status'] as const,
  courses: (termId: string) => ['me', 'courses', termId] as const,
  signup: ['me', 'signup'] as const,
  candidates: (signupId: string) => ['signups', signupId, 'candidates'] as const,
  outgoing: ['me', 'requests', 'outgoing'] as const,
  incoming: ['me', 'requests', 'incoming'] as const,
  myObservations: ['me', 'observations', 'observee'] as const,
  assignments: ['me', 'assignments'] as const,
  observation: (observationId: string) => ['observations', observationId] as const,
};

/** Refresh settings a page can add to a read, e.g. polling while answers are still coming in. */
export interface LiveOptions {
  refetchInterval?: number | false;
  refetchOnWindowFocus?: boolean;
}

// ---------- Observee ----------

/** GET /api/me/evaluation-status: the semester I am due and whether I am overdue. */
export function useEvaluationStatus() {
  return useQuery({ queryKey: facultyKeys.evaluationStatus, queryFn: () => api<EvaluationStatus>('/me/evaluation-status') });
}

/** GET /api/me/courses?termId=: the sections I teach this term, with days and times. */
export function useMyCourses(termId: string | undefined) {
  return useQuery(withId(termId, facultyKeys.courses, (id) => api<CourseSection[]>('/me/courses', { query: { termId: id } })));
}

/** POST /api/signups: sign up one section with preferred observation days and times. */
export function useCreateSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSignupInput) => api<Signup>('/signups', { method: 'POST', body: input }),
    onSuccess: () => invalidate(qc, facultyKeys.signup, facultyKeys.evaluationStatus, facultyKeys.myObservations),
  });
}

/** GET /api/me/signup: my sign-up for the current cycle, or null. */
export function useMySignup(options: LiveOptions = {}) {
  return useQuery({ queryKey: facultyKeys.signup, queryFn: () => api<Signup | null>('/me/signup'), ...options });
}

/** GET /api/signups/{signupId}/candidates: up to 5 eligible observers. */
export function useCandidates(signupId: string | undefined, options: LiveOptions = {}) {
  return useQuery({ ...withId(signupId, facultyKeys.candidates, (id) => api<Candidate[]>(`/signups/${id}/candidates`)), ...options });
}

/** POST /api/signups/{signupId}/requests: send requests to all or some candidates. */
export function useSendRequests(signupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendRequestsInput) =>
      api<ObservationRequest[]>(`/signups/${signupId}/requests`, { method: 'POST', body: input }),
    onSuccess: () => invalidate(qc, facultyKeys.candidates(signupId), facultyKeys.outgoing),
  });
}

/** GET /api/me/requests/outgoing: the requests I sent and their status. */
export function useOutgoingRequests(options: LiveOptions = {}) {
  return useQuery({ queryKey: facultyKeys.outgoing, queryFn: () => api<ObservationRequest[]>('/me/requests/outgoing'), ...options });
}

/** GET /api/me/observations?as=observee: observations I received, past and current. */
export function useMyObservations() {
  return useQuery({
    queryKey: facultyKeys.myObservations,
    queryFn: () => api<ObservationSummary[]>('/me/observations', { query: { as: 'observee' } }),
  });
}

/** GET /api/observations/{observationId}: the record and its signed form. */
export function useObservation(observationId: string | undefined) {
  return useQuery(withId(observationId, facultyKeys.observation, (id) => api<ObservationDetail>(`/observations/${id}`)));
}

/** POST /api/observations/{observationId}/sign: used by both the observee and the observer. */
export function useSignObservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (observationId: string) => api<ObservationDetail>(`/observations/${observationId}/sign`, { method: 'POST' }),
    onSuccess: (detail) => {
      qc.setQueryData(facultyKeys.observation(detail.observationId), detail);
      invalidate(qc, facultyKeys.myObservations, facultyKeys.assignments);
    },
  });
}

/** POST /api/observations/{observationId}/report-missed */
export function useReportMissed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ observationId, ...input }: ReportMissedInput & { observationId: string }) =>
      api<ObservationDetail>(`/observations/${observationId}/report-missed`, { method: 'POST', body: input }),
    onSuccess: (_detail, { observationId }) => {
      const refetched = qc.invalidateQueries({ queryKey: facultyKeys.myObservations });
      invalidate(qc, facultyKeys.observation(observationId));
      return refetched;
    },
  });
}

/** POST /api/observations/{observationId}/issue-file: attach a file about the observation (E6). */
export function useUploadObservationFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ observationId, file }: { observationId: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return api<ObservationDetail>(`/observations/${observationId}/issue-file`, { method: 'POST', body: form });
    },
    onSuccess: (detail) => qc.setQueryData(facultyKeys.observation(detail.observationId), detail),
  });
}

/** POST /api/cycles/{cycleId}/survey-responses: the end-of-process survey (observees and observers). */
export function useSubmitSurvey(cycleId: string) {
  return useMutation({
    mutationFn: ({ troubleFile, ...fields }: SurveyInput) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
      if (troubleFile) form.append('troubleFile', troubleFile);
      return api<{ responseId: string }>(`/cycles/${cycleId}/survey-responses`, { method: 'POST', body: form });
    },
  });
}

// ---------- Observer ----------

/** GET /api/me/requests/incoming: requests sent to me, with the observee's proposed times. */
export function useIncomingRequests() {
  return useQuery({ queryKey: facultyKeys.incoming, queryFn: () => api<ObservationRequest[]>('/me/requests/incoming') });
}

/** PATCH /api/signups/{signupId}/requests/{observerNetId}/confirm: accept with one proposed time (max 3 a semester). */
export function useConfirmRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ signupId, observerNetId, ...input }: ConfirmRequestInput & { signupId: string; observerNetId: string }) =>
      api<ObservationRequest>(`/signups/${signupId}/requests/${observerNetId}/confirm`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidate(qc, facultyKeys.incoming, facultyKeys.assignments),
  });
}

/** PATCH /api/signups/{signupId}/requests/{observerNetId}/decline */
export function useDeclineRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ signupId, observerNetId }: { signupId: string; observerNetId: string }) =>
      api<ObservationRequest>(`/signups/${signupId}/requests/${observerNetId}/decline`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: facultyKeys.incoming }),
  });
}

/** GET /api/me/assignments: observations I accepted, current and past. */
export function useMyAssignments() {
  return useQuery({ queryKey: facultyKeys.assignments, queryFn: () => api<ObservationSummary[]>('/me/assignments') });
}

/** POST /api/observations/{observationId}/signed-form: the observer's completed form. */
export function useSubmitSignedForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ observationId, ...input }: SignedFormInput & { observationId: string }) =>
      api<ObservationDetail>(`/observations/${observationId}/signed-form`, { method: 'POST', body: input }),
    onSuccess: (detail) => {
      qc.setQueryData(facultyKeys.observation(detail.observationId), detail);
      qc.invalidateQueries({ queryKey: facultyKeys.assignments });
    },
  });
}
