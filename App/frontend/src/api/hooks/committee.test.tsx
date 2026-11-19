import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { cycle, nextTerm } from '../../test/fixtures';
import { useAddCandidate, useCreateCycle, useUpdateCycle } from './committee';

// Each mutation marks the reads it changes as stale, so the pages that show them refetch instead of
// showing the old data until a reload.

const READS: Record<string, QueryKey> = {
  currentCycle: ['cycles', 'current'],
  faculty: ['cycles', '1', 'faculty'],
  dueProfessors: ['cycles', '1', 'due-professors'],
  signups: ['cycles', '1', 'signups'],
  matching: ['cycles', '1', 'matching'],
  latestKpis: ['cycles', 'latest', 'kpis'],
  otherCycle: ['cycles', '9', 'signups'],
  unmatched: ['dashboard', 'unmatched'],
  outstanding: ['dashboard', 'outstanding-observations'],
  evaluationStatus: ['me', 'evaluation-status'],
  templates: ['templates'],
};

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  for (const key of Object.values(READS)) qc.setQueryData(key, { seeded: true });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const stale = () => Object.entries(READS).filter(([, key]) => qc.getQueryState(key)?.isInvalidated).map(([name]) => name).sort();
  return { qc, wrapper, stale };
}

describe('committee mutations refresh what they change', () => {
  it('starting a cycle refreshes every cycle read, the dashboard and the professor pages', async () => {
    server.use(http.post('*/api/cycles', () => HttpResponse.json({ ...cycle, cycleId: '2', term: nextTerm }, { status: 201 })));
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => useCreateCycle(), { wrapper });
    await act(() => result.current.mutateAsync({ termId: nextTerm.termId, signupDeadline: '2027-01-31', observationDeadline: '2027-04-20', feedbackDeadline: '2027-05-05' }));
    await waitFor(() => expect(stale()).toEqual(
      ['currentCycle', 'dueProfessors', 'evaluationStatus', 'faculty', 'latestKpis', 'matching', 'otherCycle', 'outstanding', 'signups', 'unmatched'],
    ));
  });

  it('changing the deadlines stores the cycle and refreshes that cycle, the dashboard and the professor pages', async () => {
    const saved = { ...cycle, observationDeadline: '2026-11-25' };
    server.use(http.patch('*/api/cycles/1', () => HttpResponse.json(saved)));
    const { qc, wrapper, stale } = setup();
    const { result } = renderHook(() => useUpdateCycle('1'), { wrapper });
    await act(() => result.current.mutateAsync({ observationDeadline: '2026-11-25' }));
    expect(qc.getQueryData(READS.currentCycle)).toEqual(saved);
    await waitFor(() => expect(stale()).toEqual(['dueProfessors', 'evaluationStatus', 'faculty', 'matching', 'outstanding', 'signups', 'unmatched']));
  });

  it('adding an observer refreshes the observer lists, the sign-ups and Unmatched', async () => {
    server.use(http.post('*/api/signups/s1/candidates', () => HttpResponse.json({ signupId: 's1', observer: { netid: 'x1', displayName: 'Dr. X' }, roundNo: 2 }, { status: 201 })));
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => useAddCandidate('1'), { wrapper });
    await act(() => result.current.mutateAsync({ signupId: 's1', observerNetid: 'x1' }));
    await waitFor(() => expect(stale()).toEqual(['matching', 'signups', 'unmatched']));
  });

  it('refreshes nothing when the server refuses the change', async () => {
    server.use(http.patch('*/api/cycles/1', () => HttpResponse.json({ error: { code: 'INVALID_DEADLINES', message: 'No.' } }, { status: 400 })));
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => useUpdateCycle('1'), { wrapper });
    await act(async () => { await result.current.mutateAsync({ observationDeadline: '2026-11-25' }).catch(() => undefined); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(stale()).toEqual([]);
  });
});
