import { ApiError } from '../api/client';

// The backend's reply for a route it does not have yet (the 404 catch-all in backend/src/app.ts).
// Other 404s, such as "Observation not found.", use the same code with a different message.
const MISSING_ENDPOINT_MESSAGE = 'The requested endpoint does not exist.';

export function isMissingEndpoint(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === 'NOT_FOUND' && error.message === MISSING_ENDPOINT_MESSAGE;
}
