import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../client';
import type { Account, Cycle, ImportResult, Me, Notification, Term } from '../types';

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
  terms: ['terms'] as const,
};

/**
 * GET /api/me: whoever is signed in, verified through the sign-in token. This can be an admin
 * who is not a professor (role "admin", no netid, rank or department). Use it in the shells
 * and anywhere else that such an admin can reach.
 */
export function useAccount(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: sharedKeys.me,
    queryFn: () => api<Account>('/me'),
    staleTime: 5 * 60_000,
    retry: false,
    ...options,
  });
}

/**
 * The signed-in professor: profile and role ("AC" or "faculty"). Only for pages under AppShell,
 * which sends an admin who is not a professor to /admin before any of them render.
 */
export function useMe(options: { enabled?: boolean } = {}) {
  return useAccount(options) as UseQueryResult<Me>;
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

/** POST /api/admin/import: CSV files keyed by table name (professor, department, course, section, meeting_time, term, ac_member). */
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
