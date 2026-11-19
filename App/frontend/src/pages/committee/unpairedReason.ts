import type { MatchingRow, UnmatchedFaculty } from '../../api/types';

/**
 * Dashboard > Unmatched works out why an unpaired sign-up has no observer when it is read, so it also
 * counts requests that expired with nobody accepting. The alert on the matching row can still say
 * Insufficient then. Every committee page takes the reason from Unmatched when it lists the sign-up,
 * so the pages agree.
 */
export function withUnmatchedReason(rows: MatchingRow[], unmatched: UnmatchedFaculty | undefined): MatchingRow[] {
  const reason = new Map(unmatched?.items.map((i) => [i.signupId, i.alertType]));
  return rows.map((r) => {
    const alertType = reason.get(r.signupId);
    if (!alertType || r.alert?.alertType === alertType) return r;
    return { ...r, alert: { alertId: r.alert?.alertId ?? '', createdDate: r.alert?.createdDate ?? '', alertType } };
  });
}
