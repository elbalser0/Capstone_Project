import { setupWorker } from 'msw/browser';
import { committeeHandlers } from './handlers/committee';
import { facultyHandlers } from './handlers/faculty';
import { sharedHandlers } from './handlers/shared';

export const worker = setupWorker(...sharedHandlers, ...facultyHandlers, ...committeeHandlers);
