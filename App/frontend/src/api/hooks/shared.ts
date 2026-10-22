import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from '../client';
import type { Cycle, ImportResult, Me, Notification, TemplateVersion, Term } from '../types';

/** Query options for an endpoint that needs an id: it waits until the id is known. */
export const withId = <T,>(id: string | undefined, key: (id: string) => QueryKey, fetch: (id: string) => Promise<T>) => ({
  queryKey: key(id ?? ''),
  queryFn: () => fetch(id!),
  enabled: Boolean(id),
});

/** Marks several queries stale after a save; returns nothing, so the mutation does not wait for the refetches. */
export function invalidate(qc: QueryClient, ...keys: QueryKey[]) {
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
}

export const sharedKeys = {
  me: ['me'] as const,
  notifications: ['me', 'notifications'] as const,
  currentCycle: ['cycles', 'current'] as const,
  activeTemplate: ['templates', 'active'] as const,
  terms: ['terms'] as const,
};

/** GET /api/me: profile and role ("AC" or "faculty"), verified through the sign-in token. */
export function useMe(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: sharedKeys.me,
    queryFn: () => api<Me>('/me'),
    staleTime: 5 * 60_000,
    retry: false,
    ...options,
  });
}

/** GET /api/me/notifications */
export function useNotifications() {
  return useQuery({ queryKey: sharedKeys.notifications, queryFn: () => api<Notification[]>('/me/notifications') });
}

/** GET /api/cycles/current: the active cycle, its deadlines and current phase. */
export function useCurrentCycle() {
  return useQuery({
    queryKey: sharedKeys.currentCycle,
    queryFn: () => api<Cycle | null>('/cycles/current'),
    staleTime: 60_000,
  });
}

/** GET /api/terms: every term, oldest first (A2 term picker). */
export function useTerms() {
  return useQuery({ queryKey: sharedKeys.terms, queryFn: () => api<Term[]>('/terms'), staleTime: 60 * 60_000 });
}

/** GET /api/templates/active */
export function useActiveTemplate() {
  return useQuery({ queryKey: sharedKeys.activeTemplate, queryFn: () => api<TemplateVersion>('/templates/active') });
}

/** POST /api/admin/import: CSV files keyed by table name (professor, department, course, section, meeting_time, term). */
export function useImportData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: Partial<Record<keyof ImportResult['imported'], File>>) => {
      const form = new FormData();
      for (const [table, file] of Object.entries(files)) if (file) form.append(table, file);
      return api<ImportResult>('/admin/import', { method: 'POST', body: form });
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}
