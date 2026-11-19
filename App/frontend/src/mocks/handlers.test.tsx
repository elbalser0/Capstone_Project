import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { server } from '../test/setup';
import { committeeHandlers } from './handlers/committee';
import { facultyHandlers } from './handlers/faculty';
import { db, section } from './store';
import type { ObservationRow, SurveyResponseRow } from './schema';

// These tests run the mock handlers themselves, so the demo data keeps following the backend's rules.

const AC = 'linda.chen@demo.edu';
const OBSERVEE = 'kli247055';
const OBSERVEE_EMAIL = () => db.professor.find((p) => p.netid === OBSERVEE)!.email;
const OBSERVER = 'eru150234';
const OBSERVER_EMAIL = 'elena.ruiz@demo.edu';
const OTHER = 'maya.lin@demo.edu';

const call = (email: string, path: string, init: { method?: string; body?: unknown; form?: FormData } = {}) =>
  fetch(path, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer demo:${email}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.form ?? (init.body ? JSON.stringify(init.body) : undefined),
  });

const snapshot = () => structuredClone({ meta: db.meta, observation: db.observation, observation_request: db.observation_request, proposed_date: db.proposed_date, survey_response: db.survey_response, notification: db.notification, observation_answer: db.observation_answer, observer_match: db.observer_match, alert: db.alert });
let saved: ReturnType<typeof snapshot>;
beforeEach(() => {
  saved = snapshot();
  server.use(...facultyHandlers, ...committeeHandlers);
});
afterEach(() => { Object.assign(db, saved); });

/** A scheduled observation of the observee's FA26 sign-up, observed by the observer, on the given date. */
function schedule(date: string, extra: Partial<ObservationRow> = {}): ObservationRow {
  const signup = db.sign_up.find((s) => s.observee_netid === OBSERVEE && s.cycle_id === 'C-FA26')!;
  const row: ObservationRow = {
    observation_id: 'OB-TEST', signup_id: signup.signup_id, observer_netid: OBSERVER, version_id: db.template_version.find((v) => v.status === 'live')!.version_id,
    scheduled_date: date, status: 'scheduled', observee_signed_date: null, observer_signed_date: null,
    reason_not_completed: null, issue_file_key: null, other_comments: '', last_saved_date: null, ...extra,
  };
  db.observation.push(row);
  return row;
}
const answers = (versionId: string) => db.template_question.filter((q) => q.version_id === versionId).map((q) => ({ questionId: q.question_id, rating: q.rating_min, comment: '' }));
const submitForm = (o: ObservationRow) => call(OBSERVER_EMAIL, `/api/observations/${o.observation_id}/signed-form`, { method: 'POST', body: { answers: answers(o.version_id), otherComments: 'ok', lastSavedDate: null } });
const error = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe('observation lifecycle', () => {
  it('keeps the record scheduled after the observer submits, and completes it when the observee signs', async () => {
    const o = schedule(db.meta.today);
    expect((await call(OBSERVEE_EMAIL(), `/api/observations/${o.observation_id}/sign`, { method: 'POST', body: {} })).status).toBe(409);

    const submitted = await submitForm(o);
    expect(submitted.status).toBe(200);
    expect(o.status).toBe('scheduled');
    expect(o.observer_signed_date).toBe(db.meta.today);
    expect(o.observee_signed_date).toBeNull();

    const signed = await call(OBSERVEE_EMAIL(), `/api/observations/${o.observation_id}/sign`, { method: 'POST', body: {} });
    expect(signed.status).toBe(200);
    expect(o.status).toBe('completed');
    expect(o.observee_signed_date).toBe(db.meta.today);

    expect(await error(await submitForm(o))).toBe('LOCKED');
  });

  it('refuses an observee signature before the observer has submitted', async () => {
    const o = schedule(db.meta.today);
    expect(await error(await call(OBSERVEE_EMAIL(), `/api/observations/${o.observation_id}/sign`, { method: 'POST', body: {} }))).toBe('FORM_NOT_SUBMITTED');
    expect(o.status).toBe('scheduled');
  });

  it('refuses the form before the scheduled date', async () => {
    const o = schedule('2026-09-30');
    const res = await submitForm(o);
    expect(res.status).toBe(409);
    expect(await error(res)).toBe('NOT_YET_OBSERVED');
    expect(o.observer_signed_date).toBeNull();
  });
});

describe('who can read a record', () => {
  it('lets a committee member who is neither party read it, and not another professor', async () => {
    const o = schedule(db.meta.today);
    expect((await call(AC, `/api/observations/${o.observation_id}`)).status).toBe(200);
    expect((await call(OTHER, `/api/observations/${o.observation_id}`)).status).toBe(404);
  });
});

describe('requests', () => {
  const pendingRequest = () => {
    const signup = db.sign_up.find((s) => s.observee_netid === OBSERVEE && s.cycle_id === 'C-FA26')!;
    db.proposed_date.push({ signup_id: signup.signup_id, date: '2026-09-10', start_time: '10:00' } as (typeof db.proposed_date)[number]);
    db.observation_request.push({ signup_id: signup.signup_id, observer_netid: OBSERVER, status: 'pending', sent_date: '2026-09-19T12:00:00.000Z', responded_date: null });
    return signup;
  };

  it('refuses a proposed date that has already passed', async () => {
    const signup = pendingRequest();
    db.meta.today = '2026-09-20';
    const res = await call(OBSERVER_EMAIL, `/api/signups/${signup.signup_id}/requests/${OBSERVER}/confirm`, { method: 'PATCH', body: { date: '2026-09-10' } });
    expect(await error(res.clone())).toBe('DATE_PASSED');
    expect(res.status).toBe(400);
  });

  it('writes no notifications when requests are sent', async () => {
    const signup = db.sign_up.find((s) => s.observee_netid === OBSERVEE && s.cycle_id === 'C-FA26')!;
    db.observer_match.push({ signup_id: signup.signup_id, observer_netid: OBSERVER, round_no: 1 } as (typeof db.observer_match)[number]);
    const ofType = () => db.notification.filter((n) => n.notif_type === 'observation_request').length;
    const before = ofType();
    const res = await call(OBSERVEE_EMAIL(), `/api/signups/${signup.signup_id}/requests`, { method: 'POST', body: { observerNetids: [OBSERVER] } });
    expect(res.status).toBe(201);
    expect(ofType()).toBe(before);
  });
});

describe('survey', () => {
  const survey = (role: 'observer' | 'observee') => {
    const form = new FormData();
    form.set('respondentRole', role);
    form.set('processOk', 'true');
    return call(OBSERVEE_EMAIL(), '/api/cycles/C-FA26/survey-responses', { method: 'POST', form });
  };

  it('allows one response per person per role', async () => {
    db.meta.today = '2026-11-10';
    expect((await survey('observee')).status).toBe(201);
    const again = await survey('observee');
    expect(again.status).toBe(409);
    expect(await error(again)).toBe('ALREADY_SUBMITTED');
    expect((await survey('observer')).status).toBe(201);
  });

  it('lets only the committee download a response file, and answers 404 when there is none', async () => {
    const withFile: SurveyResponseRow = { response_id: 'SR-T1', cycle_id: 'C-FA26', respondent_id: OBSERVEE, respondent_role: 'observee', process_ok: false, difficulties: '', additional_feedback: '', trouble_file_key: 'uploads/SR-T1/notes.txt', submitted_date: db.meta.today };
    db.survey_response.push(withFile, { ...withFile, response_id: 'SR-T2', trouble_file_key: null });
    const ok = await call(AC, '/api/cycles/C-FA26/survey-responses/SR-T1/trouble-file');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Disposition')).toContain("filename*=UTF-8''notes.txt");
    expect((await call(AC, '/api/cycles/C-FA26/survey-responses/SR-T2/trouble-file')).status).toBe(404);
    expect((await call(OTHER, '/api/cycles/C-FA26/survey-responses/SR-T1/trouble-file')).status).toBe(403);
  });
});

describe('course labels', () => {
  it('use the department name, like the backend', () => {
    const label = section(db.section[0].section_id).label;
    expect(label).toMatch(/^Computer Science \d{4}\.\d{3}$/);
  });
});

describe('click-test mock fixes', () => {
  it('gives a never-saved record the same save time on every read, so a local draft stays usable', async () => {
    const o = schedule(db.meta.today);
    const read = async () => ((await (await call(OBSERVER_EMAIL, `/api/observations/${o.observation_id}`)).json()) as { lastSavedDate: string }).lastSavedDate;
    const first = await read();
    expect(await read()).toBe(first);
    await submitForm(o);
    expect(await read()).not.toBe(first);
  });

  it('adds an observer by hand without the matching rules, refusing only what the backend refuses', async () => {
    const s = db.sign_up.find((x) => x.cycle_id === 'C-FA26' && !db.observation.some((ob) => ob.signup_id === x.signup_id))!;
    const someone = db.professor.find((p) => p.is_active && p.netid !== s.observee_netid && !db.observer_match.some((m) => m.signup_id === s.signup_id && m.observer_netid === p.netid))!;
    const add = (netid: string) => call(AC, `/api/signups/${s.signup_id}/candidates`, { method: 'POST', body: { observerNetid: netid } });
    expect((await add(someone.netid)).status).toBe(201);
    expect(await error(await add(someone.netid))).toBe('ALREADY_MATCHED');
    expect(await error(await add(s.observee_netid))).toBe('INVALID_CANDIDATE');
    expect(await error(await add('nobody1'))).toBe('CANDIDATE_NOT_FOUND');
  });

  it('sends no due reminder to a professor who already signed up', async () => {
    const signedUp = db.sign_up.filter((x) => x.cycle_id === 'C-FA26').map((x) => x.observee_netid);
    expect(db.eval_due.some((d) => d.cycle_id === 'C-FA26' && signedUp.includes(d.netid))).toBe(true);
    const before = db.notification.length;
    const res = await call(AC, '/api/cycles/C-FA26/notifications/due-reminders', { method: 'POST', body: {} });
    expect(res.status).toBe(200);
    const sentTo = db.notification.slice(before).map((n) => n.recipient_netid);
    expect(sentTo.filter((netid) => signedUp.includes(netid))).toEqual([]);
  });

  it('lists a sign-up with too few observers on Unmatched, as the backend does', async () => {
    const s = db.sign_up.find((x) => x.cycle_id === 'C-FA26' && !db.observation.some((ob) => ob.signup_id === x.signup_id))!;
    db.observation_request = db.observation_request.filter((r) => r.signup_id !== s.signup_id);
    db.alert = [...db.alert.filter((a) => a.signup_id !== s.signup_id), { alert_id: 'AL-TEST', signup_id: s.signup_id, alert_type: 'insufficient_observers', created_date: '2026-09-16T12:00:00Z', resolved_by: null, resolved_date: null, resolution_note: null }];
    const body = (await (await call(AC, '/api/dashboard/unmatched')).json()) as { items: { signupId: string; alertType: string }[] };
    expect(body.items.find((i) => i.signupId === s.signup_id)?.alertType).toBe('insufficient_observers');
  });

  it('leaves the demo admin account off the Faculty list', async () => {
    const rows = (await (await call(AC, '/api/cycles/C-FA26/faculty')).json()) as { professor: { email: string } }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.professor.email === 'admin@demo.edu')).toBe(false);
  });
});
