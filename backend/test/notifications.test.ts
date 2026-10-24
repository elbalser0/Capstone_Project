import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app.js';
import { mapNotification } from '../src/services/notification.service.js';

test('notifications require a login', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${base}/api/me/notifications`)).status, 401);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});

test('a notification row becomes the API shape', () => {
  assert.deepEqual(mapNotification({
    notification_id: 7, notif_type: 'due_notice', subject: 'You are due for an observation',
    sent_date: new Date('2026-09-02T15:00:00Z'), sender_netid: 'ihn145051',
    sender_first_name: 'Isabel', sender_last_name: 'Nakamura', sender_rank: 'associate',
  }), {
    notificationId: '7', notifType: 'due_notice', subject: 'You are due for an observation',
    sentDate: '2026-09-02T15:00:00.000Z',
    sentBy: { netid: 'ihn145051', firstName: 'Isabel', lastName: 'Nakamura', displayName: 'Dr. Isabel Nakamura', rank: 'associate' },
  });
});
