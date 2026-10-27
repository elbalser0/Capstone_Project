import type { ObservationDetail } from '../../api/types';

// The observer's unsigned edits to an observation form. They are kept in memory for this
// visit, so moving from the form to the signature page never loses them, and also on this
// device when the browser allows it, so they survive a reload. Signing clears both.

export interface Draft {
  answers: Record<string, { rating: number | null; comment: string }>;
  otherComments: string;
  /** When the draft was last kept; null for the server's own answers. */
  savedAt: number | null;
}

const storageKey = (observationId: string) => `assessment-helper.observation-draft.${observationId}`;
const keptThisVisit = new Map<string, Draft>();

/** The unsigned draft for an observation, or null when there is none. */
export function storedDraft(observationId: string): Draft | null {
  const kept = keptThisVisit.get(observationId);
  if (kept) return kept;
  try {
    const raw = localStorage.getItem(storageKey(observationId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    // Storage can be blocked; the server's answers are used instead.
    return null;
  }
}

/** Keeps a draft, or forgets it when given null. Returns false when this device could not store it. */
export function writeDraft(observationId: string, draft: Draft | null): boolean {
  if (draft) keptThisVisit.set(observationId, draft);
  else keptThisVisit.delete(observationId);
  try {
    if (draft) localStorage.setItem(storageKey(observationId), JSON.stringify(draft));
    else localStorage.removeItem(storageKey(observationId));
    return true;
  } catch {
    return false;
  }
}

/** What the server has: the last signed form, or an empty one. */
export function serverDraft(observation: ObservationDetail): Draft {
  return {
    answers: Object.fromEntries(observation.answers.map((a) => [a.questionId, { rating: a.rating, comment: a.comment }])),
    otherComments: observation.otherComments,
    savedAt: null,
  };
}

/** The draft to show and sign: the unsigned edits if there are any, else the server's answers. */
export const readDraft = (observation: ObservationDetail) => storedDraft(observation.observationId) ?? serverDraft(observation);

/** True when the draft holds nothing the server does not already have. */
export function sameAsServer(draft: Draft, observation: ObservationDetail) {
  return draft.otherComments === observation.otherComments && observation.answers.every((a) => {
    const value = draft.answers[a.questionId] ?? { rating: null, comment: '' };
    return value.rating === a.rating && value.comment === a.comment;
  });
}
