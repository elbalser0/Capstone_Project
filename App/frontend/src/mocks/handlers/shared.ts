import { http, HttpResponse } from 'msw';
import type { ImportResult, Me, Notification } from '../../api/types';
import { committeeMember, contact, currentCycleRow, cycle, db, department, fail, isAc, person, signedIn, templateVersion, term } from '../store';

export const sharedHandlers = [
  http.get('/api/me', ({ request }) => {
    const p = signedIn(request);
    const me: Me = { ...contact(p.netid), department: department(p.dept_id), role: isAc(p.netid) ? 'AC' : 'faculty' };
    return HttpResponse.json(me);
  }),

  http.get('/api/me/notifications', ({ request }) => {
    const p = signedIn(request);
    const rows: Notification[] = db.notification
      .filter((n) => n.recipient_netid === p.netid)
      .sort((a, b) => b.sent_date.localeCompare(a.sent_date))
      .map((n) => ({ notificationId: n.notification_id, notifType: n.notif_type, subject: n.subject, sentDate: n.sent_date, sentBy: n.sent_by ? person(n.sent_by) : null }));
    return HttpResponse.json(rows);
  }),

  http.get('/api/cycles/current', ({ request }) => {
    signedIn(request);
    const c = currentCycleRow();
    return HttpResponse.json(c ? cycle(c) : null);
  }),

  http.get('/api/terms', ({ request }) => {
    signedIn(request);
    return HttpResponse.json([...db.term].sort((a, b) => a.start_date.localeCompare(b.start_date)).map((t) => term(t.term_id)));
  }),

  http.get('/api/templates/active', ({ request }) => {
    signedIn(request);
    const live = db.template_version.find((v) => v.status === 'live');
    return live ? HttpResponse.json(templateVersion(live)) : fail(404, 'NOT_FOUND', 'No template version is live yet.');
  }),

  // The database team's CSV import. The mock only counts rows; it does not replace the dummy data.
  http.post('/api/admin/import', async ({ request }) => {
    committeeMember(request);
    const form = await request.formData();
    const imported = { professor: 0, department: 0, course: 0, section: 0, meeting_time: 0, term: 0 } satisfies ImportResult['imported'];
    for (const table of Object.keys(imported) as (keyof typeof imported)[]) {
      const file = form.get(table);
      if (file instanceof File) imported[table] = Math.max(0, (await file.text()).trim().split('\n').length - 1);
    }
    return HttpResponse.json({ imported } satisfies ImportResult);
  }),
];
