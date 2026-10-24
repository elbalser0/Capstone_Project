import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueProfessors, type ProfessorDueRow } from '../src/services/eval-due.service.js';

const terms = [
  { term_id: 1, season: 'fall' as const, year: 2024, start_date: '2024-08-24', end_date: '2024-12-11' },
  { term_id: 2, season: 'spring' as const, year: 2025, start_date: '2025-01-12', end_date: '2025-05-08' },
  { term_id: 3, season: 'fall' as const, year: 2025, start_date: '2025-08-24', end_date: '2025-12-11' },
  { term_id: 4, season: 'spring' as const, year: 2026, start_date: '2026-01-12', end_date: '2026-05-08' },
  { term_id: 5, season: 'fall' as const, year: 2026, start_date: '2026-08-24', end_date: '2026-12-11' },
];
const cycle = {
  cycleId: 9, termId: 5, startedBy: 'ac1', startDate: '2026-10-24',
  signupDeadline: '2026-11-01', observationDeadline: '2026-11-20', feedbackDeadline: '2026-12-05',
};
const base = { rank: 'assistant' as const, eval_interval_years: 1, baseline_last_eval_term: null, start_term: null, last_completed_term_id: null, today: '2026-10-24' };

test('the new cycle records only DUE and OVERDUE professors', () => {
  const professors: ProfessorDueRow[] = [
    { ...base, netid: 'due', baseline_last_eval_term: 3 },          // last Fall 2025 + 1 year = Fall 2026
    { ...base, netid: 'overdue', baseline_last_eval_term: 1 },      // last Fall 2024 + 1 year = Fall 2025
    { ...base, netid: 'notdue', baseline_last_eval_term: 4 },       // last Spring 2026 + 1 year = Spring 2027
    { ...base, netid: 'newhire', start_term: 5 },                   // first evaluation in Fall 2028
    { ...base, netid: 'firstdue', start_term: 1 },                  // started Fall 2024, first due Fall 2026
    { ...base, netid: 'completed', baseline_last_eval_term: 1, last_completed_term_id: 3 }, // latest signed observation wins
  ];
  assert.deepEqual(dueProfessors(professors, terms, cycle), [
    { netid: 'due', dueStatus: 'due' },
    { netid: 'overdue', dueStatus: 'overdue' },
    { netid: 'firstdue', dueStatus: 'due' },
    { netid: 'completed', dueStatus: 'due' },
  ]);
});

test('a professor with no start term or evaluation history stops the cycle and is named', () => {
  assert.throws(() => dueProfessors([{ ...base, netid: 'abc123' }], terms, cycle), /abc123/);
});
