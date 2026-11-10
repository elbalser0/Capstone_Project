import type { DueStatus } from '../api/types';

export const DUE_STATUS_TEXT: Record<DueStatus, string> = {
  DUE: 'Due: a peer observation is needed this semester.',
  OVERDUE: 'Overdue: the observation was due in an earlier semester and is still not done.',
  NOT_DUE: 'Not due: no observation is needed this semester.',
};
export const DUE_OR_OVERDUE_TEXT = 'Professors who need a peer observation this cycle. Overdue means it was already due in an earlier semester.';
export const OUTSTANDING_TEXT = 'Professors who signed up this cycle whose observation is not yet finished and signed by both people.';
export const UNMATCHED_TEXT = 'Sign-ups that need committee attention: no observer was found, too few were found, or nobody accepted.';
