import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '../api/client';
import { server } from '../test/setup';
import { isMissingEndpoint } from './missingEndpoint';

const reply = (status: number, code: string, message: string) => HttpResponse.json({ error: { code, message } }, { status });

/** The error the real client throws for a reply, so the check sees exactly what the screens will see. */
async function errorFor(response: () => Response) {
  server.use(http.get('*/api/probe', response));
  try {
    await api('/probe');
  } catch (error) {
    return error;
  }
  throw new Error('The request did not fail.');
}

describe('isMissingEndpoint', () => {
  it("is true for the backend's reply to a route it does not have", async () => {
    expect(isMissingEndpoint(await errorFor(() => reply(404, 'NOT_FOUND', 'The requested endpoint does not exist.')))).toBe(true);
  });

  it('is false for another not found reply', async () => {
    expect(isMissingEndpoint(await errorFor(() => reply(404, 'NOT_FOUND', 'Observation not found.')))).toBe(false);
  });

  it('is false for the same message with another status or code', async () => {
    expect(isMissingEndpoint(await errorFor(() => reply(500, 'NOT_FOUND', 'The requested endpoint does not exist.')))).toBe(false);
    expect(isMissingEndpoint(await errorFor(() => reply(404, 'NO_CYCLE', 'The requested endpoint does not exist.')))).toBe(false);
  });

  it('is false for a server error', async () => {
    expect(isMissingEndpoint(await errorFor(() => reply(500, 'INTERNAL', 'Something broke.')))).toBe(false);
  });

  it('is false for a 404 without a JSON body', async () => {
    expect(isMissingEndpoint(await errorFor(() => new HttpResponse(null, { status: 404 })))).toBe(false);
  });

  it('is false for a plain error and for nothing', () => {
    expect(isMissingEndpoint(new Error('The requested endpoint does not exist.'))).toBe(false);
    expect(isMissingEndpoint(undefined)).toBe(false);
  });
});
