import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app.js';
import { readSendRequests } from '../src/routes/requests.routes.js';
import { expiresAt, requestStatus, withStartTimes } from '../src/services/request.service.js';

test('request endpoints require a login', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${base}/api/me/requests/incoming`)).status, 401);
    assert.equal((await fetch(`${base}/api/signups/1/requests`, { method: 'POST' })).status, 401);
    for (const action of ['confirm', 'decline']) {
      const response = await fetch(`${base}/api/signups/1/requests/abc123/${action}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: '2026-10-27' }),
      });
      assert.equal(response.status, 401, action);
    }
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});

test('send requests accepts an optional list of distinct observer IDs', () => {
  assert.equal(readSendRequests(undefined), undefined);
  assert.deepEqual(readSendRequests({ observerNetids: [] }), []);
  assert.deepEqual(readSendRequests({ observerNetids: ['obsA', 'obsA', 'obsB'] }), ['obsA', 'obsB']);
  for (const body of [{ observerNetids: 'obsA' }, { observerNetids: [5] }, { observerNetids: [''] }]) {
    assert.throws(() => readSendRequests(body), { code: 'INVALID_OBSERVERS' });
  }
});

test('a pending request expires 48 hours after it is sent', () => {
  const sent = new Date('2026-10-20T12:00:00Z');
  assert.equal(expiresAt(sent).toISOString(), '2026-10-22T12:00:00.000Z');
  assert.equal(requestStatus('pending', sent, new Date('2026-10-22T11:59:59Z')), 'pending');
  assert.equal(requestStatus('pending', sent, new Date('2026-10-22T12:00:00Z')), 'expired');
  // Answered requests keep their status after 48 hours.
  assert.equal(requestStatus('accepted', sent, new Date('2026-10-25T00:00:00Z')), 'accepted');
  assert.equal(requestStatus('declined', sent, new Date('2026-10-25T00:00:00Z')), 'declined');
});

test('proposed dates get the class start time for that weekday', () => {
  const section = {
    sectionId: '742', label: 'Computer Science 3377.001', courseNum: '3377', sectionNum: '001',
    title: 'Discrete Math', courseLevel: 3000, classMode: 'in-person' as const, enrollment: null,
    term: { termId: '11', season: 'fall' as const, year: 2026, label: 'Fall 2026', startDate: '2026-08-24', endDate: '2026-12-11' },
    meetings: [
      { dayOfWeek: 'Tue', startTime: '14:30', endTime: '15:45', room: 'ECSS 2.410' },
      { dayOfWeek: 'Thu', startTime: '16:00', endTime: '17:15', room: 'ECSS 2.410' },
    ],
  };
  assert.deepEqual(withStartTimes(section, ['2026-10-27', '2026-10-29']), [
    { date: '2026-10-27', startTime: '14:30' },
    { date: '2026-10-29', startTime: '16:00' },
  ]);
  // A Wednesday is not a meeting day for this section, so no start time is invented.
  assert.deepEqual(withStartTimes(section, ['2026-10-28']), [{ date: '2026-10-28', startTime: '' }]);
});
