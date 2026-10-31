import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app.js';
import { readReminderNetids } from '../src/routes/cycles.routes.js';
import { mapNotification } from '../src/services/notification.service.js';
import { reminderText, sendReminderEmails, setMailTransportForTests } from '../src/services/email.service.js';

test('notification sending endpoints require a login', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const path of ['due-reminders', 'lists-ready', 'survey']) {
      assert.equal((await fetch(`${base}/api/cycles/1/notifications/${path}`, { method: 'POST' })).status, 401);
    }
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('due reminders take an optional list of distinct netids', () => {
  assert.equal(readReminderNetids(undefined), undefined);
  assert.equal(readReminderNetids({}), undefined);
  assert.deepEqual(readReminderNetids({ netids: [] }), []);
  assert.deepEqual(readReminderNetids({ netids: ['a1', 'a1', 'b2'] }), ['a1', 'b2']);
  for (const body of [[], 'a1', { netids: 'a1' }, { netids: [5] }, { netids: [''] }, { netids: [' a1'] }]) {
    assert.throws(() => readReminderNetids(body), { code: 'INVALID_NETIDS' });
  }
});

test('a notification without a sender has sentBy null', () => {
  const row = {
    notification_id: 7, notif_type: 'reminder', subject: 'x', sent_date: new Date('2026-10-30T12:00:00Z'),
    sender_netid: null, sender_first_name: null, sender_last_name: null, sender_rank: null,
  };
  assert.equal(mapNotification(row).sentBy, null);
});

test('the reminder email greets the professor and repeats the reminder', () => {
  assert.equal(reminderText({ to: 'a@example.edu', name: 'Dr. Ana Park', subject: 'Reminder: you are due.' }),
    'Hello Dr. Ana Park,\n\nReminder: you are due.\n\nPlease sign in to Assessment Helper to sign up for your observation.\n\nAssessment Committee');
});

test('EMAIL_MODE off or unknown sends nothing and does not throw', async () => {
  const email = { to: 'a@example.edu', name: 'Dr. Ana Park', subject: 'x' };
  const saved = process.env.EMAIL_MODE;
  setMailTransportForTests(undefined);
  const errors = console.error;
  console.error = () => {};
  try {
    delete process.env.EMAIL_MODE;
    assert.deepEqual(await sendReminderEmails([email]), [{ to: 'a@example.edu', sent: false }]);
    process.env.EMAIL_MODE = 'carrier-pigeon';
    assert.deepEqual(await sendReminderEmails([email]), [{ to: 'a@example.edu', sent: false }]);
    process.env.EMAIL_MODE = 'smtp'; // without SMTP_URL
    delete process.env.SMTP_URL;
    assert.deepEqual(await sendReminderEmails([email]), [{ to: 'a@example.edu', sent: false }]);
  } finally {
    console.error = errors;
    if (saved === undefined) delete process.env.EMAIL_MODE; else process.env.EMAIL_MODE = saved;
  }
});
