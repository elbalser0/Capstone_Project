import type { ObservationDetail } from '../../api/types';

export interface Draft {
  answers: Record<string, { rating: number | null; comment: string }>;
  otherComments: string;
}
export const draftKey = (user: string, observationId: string) =>
  `assessment-helper.observation-draft.v1.${encodeURIComponent(user)}.${encodeURIComponent(observationId)}`;
export const serverDraft = (o: ObservationDetail): Draft => ({
  answers: Object.fromEntries(o.answers.map(a => [a.questionId, { rating: a.rating, comment: a.comment }])),
  otherComments: o.otherComments,
});
export function readDraft(user: string, o: ObservationDetail): { draft: Draft; warning: string | null } {
  const fallback = serverDraft(o);
  try {
    const raw = localStorage.getItem(draftKey(user, o.observationId));
    if (raw === null) return { draft: fallback, warning: null };
    if (raw.length > 65536) throw new Error('Oversized draft');
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') throw new Error('Invalid draft');
    const d = saved as { versionId?: unknown; lastSavedDate?: unknown; answers?: unknown; otherComments?: unknown };
    if (d.lastSavedDate !== o.lastSavedDate) {
      return { draft: fallback, warning: 'The server record has changed since this draft was saved. Showing the server record instead. The older local draft has not been deleted; saving again will replace it.' };
    }
    if (d.versionId !== o.templateVersion.versionId || typeof d.otherComments !== 'string' || d.otherComments.length > 4000 || !d.answers || typeof d.answers !== 'object' || Array.isArray(d.answers)) throw new Error('Invalid draft');
    const entries = d.answers as Record<string, unknown>;
    if (Object.keys(entries).length !== o.answers.length || o.answers.some(a => {
      const v = entries[a.questionId] as { rating?: unknown; comment?: unknown } | undefined;
      return !v || (v.rating !== null && (typeof v.rating !== 'number' || !Number.isInteger(v.rating) || v.rating < a.ratingMin || v.rating > a.ratingMax)) || typeof v.comment !== 'string' || v.comment.length > 4000;
    })) throw new Error('Invalid draft');
    return { draft: { answers: entries as Draft['answers'], otherComments: d.otherComments }, warning: null };
  } catch {
    return { draft: fallback, warning: 'The saved draft could not be read. Showing the server record instead.' };
  }
}
export function saveDraft(user: string, o: ObservationDetail, draft: Draft): boolean {
  try {
    const payload = JSON.stringify({ versionId: o.templateVersion.versionId, lastSavedDate: o.lastSavedDate, ...draft });
    if (payload.length > 65536) return false;
    localStorage.setItem(draftKey(user, o.observationId), payload);
    return true;
  } catch { return false; }
}
