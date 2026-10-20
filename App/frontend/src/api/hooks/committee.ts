import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type {
  CreateCycleInput,
  CreateTemplateInput,
  Cycle,
  CycleKpis,
  DueByRank,
  DueProfessor,
  DueRemindersInput,
  FacultyStatus,
  ForwardInput,
  ForwardResult,
  MatchingRow,
  OutstandingObservations,
  Signup,
  SurveyResponse,
  TemplateVersion,
  UnmatchedFaculty,
  UpdateCycleInput,
} from '../types';
import { invalidate, sharedKeys, withId } from './shared';

// Assessment Committee pages. The backend must check AC_Member on every one of these;
// the sidebar toggle only decides which pages the front end shows.

const committeeKeys = {
  dueProfessors: (cycleId: string) => ['cycles', cycleId, 'due-professors'] as const,
  faculty: (cycleId: string) => ['cycles', cycleId, 'faculty'] as const,
  duePreview: (termId: string) => ['terms', termId, 'due-preview'] as const,
  signups: (cycleId: string) => ['cycles', cycleId, 'signups'] as const,
  matching: (cycleId: string) => ['cycles', cycleId, 'matching'] as const,
  surveyResponses: (cycleId: string) => ['cycles', cycleId, 'survey-responses'] as const,
  kpis: (cycleId: string) => ['cycles', cycleId, 'kpis'] as const,
  dueByRank: ['dashboard', 'due-by-rank'] as const,
  outstanding: ['dashboard', 'outstanding-observations'] as const,
  unmatched: ['dashboard', 'unmatched'] as const,
  templates: ['templates'] as const,
};

type Notified = { sent: number };

// ---------- Cycle ----------

/** POST /api/cycles: start a cycle for a term with its three deadlines. */
export function useCreateCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCycleInput) => api<Cycle>('/cycles', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: sharedKeys.currentCycle }),
  });
}

/** PATCH /api/cycles/{cycleId}: change the deadlines. */
export function useUpdateCycle(cycleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCycleInput) => api<Cycle>(`/cycles/${cycleId}`, { method: 'PATCH', body: input }),
    onSuccess: (cycle) => qc.setQueryData(sharedKeys.currentCycle, cycle),
  });
}

/** GET /api/cycles/{cycleId}/due-professors */
export function useDueProfessors(cycleId: string | undefined) {
  return useQuery(withId(cycleId, committeeKeys.dueProfessors, (id) => api<DueProfessor[]>(`/cycles/${id}/due-professors`)));
}

/** GET /api/cycles/{cycleId}/faculty: every active professor, NOT DUE included (A3). */
export function useCycleFaculty(cycleId: string | undefined) {
  return useQuery(withId(cycleId, committeeKeys.faculty, (id) => api<FacultyStatus[]>(`/cycles/${id}/faculty`)));
}

/** GET /api/terms/{termId}/due-preview: who would be due if a cycle started for this term (A2 before kickoff). */
export function useDuePreview(termId: string | undefined) {
  return useQuery(withId(termId, committeeKeys.duePreview, (id) => api<FacultyStatus[]>(`/terms/${id}/due-preview`)));
}

/** POST /api/cycles/{cycleId}/notifications/due-reminders: everyone due, or only the netids given. */
export function useSendDueReminders(cycleId: string) {
  return useMutation({
    mutationFn: (input: DueRemindersInput = {}) =>
      api<Notified>(`/cycles/${cycleId}/notifications/due-reminders`, { method: 'POST', body: input }),
  });
}

// ---------- Sign-ups and observer selection ----------

/** GET /api/cycles/{cycleId}/signups */
export function useCycleSignups(cycleId: string | undefined) {
  return useQuery(withId(cycleId, committeeKeys.signups, (id) => api<Signup[]>(`/cycles/${id}/signups`)));
}

/** POST /api/cycles/{cycleId}/matching: Run observer selection (up to 5 eligible observers per sign-up). */
export function useRunMatching(cycleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<MatchingRow[]>(`/cycles/${cycleId}/matching`, { method: 'POST' }),
    onSuccess: (rows) => {
      qc.setQueryData(committeeKeys.matching(cycleId), rows);
      qc.invalidateQueries({ queryKey: committeeKeys.unmatched });
    },
  });
}

/** GET /api/cycles/{cycleId}/matching: each sign-up with its observer list and any alert. */
export function useMatching(cycleId: string | undefined) {
  return useQuery(withId(cycleId, committeeKeys.matching, (id) => api<MatchingRow[]>(`/cycles/${id}/matching`)));
}

/** POST /api/cycles/{cycleId}/notifications/lists-ready */
export function useNotifyListsReady(cycleId: string) {
  return useMutation({
    mutationFn: () => api<Notified>(`/cycles/${cycleId}/notifications/lists-ready`, { method: 'POST' }),
  });
}

/** POST /api/signups/{signupId}/candidates: manually add an observer (stretch goal). */
export function useAddCandidate(cycleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ signupId, observerNetid }: { signupId: string; observerNetid: string }) =>
      api<MatchingRow>(`/signups/${signupId}/candidates`, { method: 'POST', body: { observerNetid } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: committeeKeys.matching(cycleId) }),
  });
}

// ---------- Survey and results ----------

/** POST /api/cycles/{cycleId}/notifications/survey */
export function useNotifySurvey(cycleId: string) {
  return useMutation({
    mutationFn: () => api<Notified>(`/cycles/${cycleId}/notifications/survey`, { method: 'POST' }),
  });
}

/** GET /api/cycles/{cycleId}/survey-responses */
export function useSurveyResponses(cycleId: string | undefined) {
  return useQuery(withId(cycleId, committeeKeys.surveyResponses, (id) => api<SurveyResponse[]>(`/cycles/${id}/survey-responses`)));
}

/**
 * GET /api/cycles/{cycleId}/kpis. Pass "latest" for the most recent cycle that has results
 * (KPIs are generated after a cycle's feedback deadline).
 */
export function useCycleKpis(cycleId: string | undefined) {
  return useQuery(withId(cycleId, committeeKeys.kpis, (id) => api<CycleKpis>(`/cycles/${id}/kpis`)));
}

// ---------- Executive reports ----------

/** GET /api/dashboard/due-by-rank */
export function useDueByRank() {
  return useQuery({ queryKey: committeeKeys.dueByRank, queryFn: () => api<DueByRank>('/dashboard/due-by-rank') });
}

/** GET /api/dashboard/outstanding-observations */
export function useOutstandingObservations() {
  return useQuery({
    queryKey: committeeKeys.outstanding,
    queryFn: () => api<OutstandingObservations>('/dashboard/outstanding-observations'),
  });
}

/** GET /api/dashboard/unmatched */
export function useUnmatchedFaculty() {
  return useQuery({ queryKey: committeeKeys.unmatched, queryFn: () => api<UnmatchedFaculty>('/dashboard/unmatched') });
}

/** POST /api/observations/{observationId}/forward: email a read-only link to a signed record. */
export function useForwardObservation() {
  return useMutation({
    mutationFn: ({ observationId, ...input }: ForwardInput & { observationId: string }) =>
      api<ForwardResult>(`/observations/${observationId}/forward`, { method: 'POST', body: input }),
  });
}

// ---------- Templates ----------

/** GET /api/templates: every version (draft, live, retired). */
export function useTemplates() {
  return useQuery({ queryKey: committeeKeys.templates, queryFn: () => api<TemplateVersion[]>('/templates') });
}

/** POST /api/templates: save a new draft version. */
export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTemplateInput) => api<TemplateVersion>('/templates', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: committeeKeys.templates }),
  });
}

/** PATCH /api/templates/{versionId}/publish: make a version the live one. */
export function usePublishTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId, changeNote }: { versionId: string; changeNote: string }) =>
      api<TemplateVersion>(`/templates/${versionId}/publish`, { method: 'PATCH', body: { changeNote } }),
    onSuccess: () => invalidate(qc, committeeKeys.templates, sharedKeys.activeTemplate),
  });
}
