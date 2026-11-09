import { describe, expect, it } from 'vitest';
import type { DueStatus } from '../api/types';
import { DUE_OR_OVERDUE_TEXT, DUE_STATUS_TEXT, OUTSTANDING_TEXT, UNMATCHED_TEXT } from './statusTerms';

// Every value of DueStatus. Adding a status to the type fails to compile here until it is listed.
const STATUSES = ['DUE', 'OVERDUE', 'NOT_DUE'] as const satisfies readonly DueStatus[];
const listsEveryStatus: [Exclude<DueStatus, (typeof STATUSES)[number]>] extends [never] ? true : false = true;

describe('status wording', () => {
  it('has a sentence for every due status', () => {
    expect(listsEveryStatus).toBe(true);
    for (const status of STATUSES) expect(DUE_STATUS_TEXT[status]).toMatch(/^.+\.$/);
    expect(Object.keys(DUE_STATUS_TEXT).sort()).toEqual([...STATUSES].sort());
  });

  it('starts each status sentence with the status name people see on the tags', () => {
    expect(DUE_STATUS_TEXT.DUE).toMatch(/^Due: /);
    expect(DUE_STATUS_TEXT.OVERDUE).toMatch(/^Overdue: /);
    expect(DUE_STATUS_TEXT.NOT_DUE).toMatch(/^Not due: /);
  });

  it('has a one-line description for each dashboard list', () => {
    for (const text of [DUE_OR_OVERDUE_TEXT, OUTSTANDING_TEXT, UNMATCHED_TEXT]) {
      expect(text).toMatch(/^.+\.$/);
      expect(text).not.toContain('\n');
    }
  });
});
