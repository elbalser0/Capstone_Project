import { http, HttpResponse } from 'msw';
import { committeeMember, contact, currentCycleRow, cycle, db, department, fail, isAc, person, signedIn, templateVersion, term } from '../store';
import { ADMIN_DEMO_EMAIL } from '../store';
import type { AdminProfessor, ImportResult, Me, Notification } from '../../api/types';
import { IMPORT_TABLES, preparePreview } from '../../lib/importCsv';
import type { ProfessorRow } from '../schema';

function readImportRow(headers: string[], cells: string[], index: number) {
  const values = Object.fromEntries(
    headers.map((header, column) => [header, cells[column].trim()]),
  ) as Record<string, string>;

  function invalid(message: string): never {
    throw new Error(`Data row ${index + 1}: ${message}`);
  }

  function requireValue(field: string): string {
    const value = values[field];
    if (!value) invalid(`${field} is required.`);
    return value;
  }

  return { values, invalid, requireValue };
}

export const sharedHandlers = [
    http.patch('/api/admin/professors/:netid', async ({ request, params }) => {
    const account = signedIn(request);

    if (account.email !== ADMIN_DEMO_EMAIL) {
      return fail(403, 'FORBIDDEN', 'Only administrators can do this.');
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return fail(400, 'INVALID_PROFESSOR', 'Send valid JSON.');
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return fail(400, 'INVALID_PROFESSOR', 'Send changes as a JSON object.');
    }

    const fields = body as Record<string, unknown>;
    const keys = Object.keys(fields);

    // Validate rank, AC membership, and professor status changes.
    if (
      keys.length === 0 ||
      keys.some((key) => key !== 'rank' && key !== 'isAc' && key !== 'isActive',)
    ) {
      return fail(
        400,
        'INVALID_PROFESSOR',
        'Send rank or isAc or isActive for these controls.',
      );
    }

    const rank = fields.rank;

    if (
      'rank' in fields &&
      rank !== 'assistant' &&
      rank !== 'associate' &&
      rank !== 'full'
    ) {
      return fail(400, 'INVALID_PROFESSOR', 'Select a valid rank.');
    }

    if ('isAc' in fields && typeof fields.isAc !== 'boolean') {
      return fail(400, 'INVALID_PROFESSOR', 'isAc must be true or false.');
    }

    if ('isActive' in fields && typeof fields.isActive !== 'boolean') {
      return fail(
        400,
        'INVALID_PROFESSOR',
        'isActive must be true or false.',
      );
    }

    const netid = String(params.netid).trim().toLowerCase();
    const professor = db.professor.find(
      (row) => row.netid.toLowerCase() === netid,
    );

    if (!professor) {
      return fail(404, 'NOT_FOUND', 'Professor not found.');
    }

    // Validate before changing either record.
    const nextActive =
      typeof fields.isActive === 'boolean'
        ? fields.isActive
        : professor.is_active;

    if (fields.isAc === true && !nextActive) {
      return fail(
        409,
        'PROFESSOR_INACTIVE',
        'Only an active professor can be on the Assessment Committee.',
      );
    }

    if (rank === 'assistant' || rank === 'associate' || rank === 'full') {
      professor.rank = rank;
      professor.eval_interval_years = rank === 'assistant' ? 1 : 2;
    }

    const membership = db.ac_member.find(
      (row) => row.netid === professor.netid,
    );

    if (fields.isAc === true) {
      if (membership) {
        membership.is_active = true;
      } else {
        db.ac_member.push({
          netid: professor.netid,
          is_active: true,
        });
      }
    } else if (fields.isAc === false && membership) {
      membership.is_active = false;
    }

    professor.is_active = nextActive;

    if (!nextActive && membership) {
      membership.is_active = false;
    }

    const updated: AdminProfessor = {...contact(professor.netid), department: department(professor.dept_id), isAc: isAc(professor.netid), isActive: professor.is_active,};

    return HttpResponse.json(updated);

  }),

  http.get('/api/admin/departments', ({ request }) => {
    const account = signedIn(request);

    if (account.email !== ADMIN_DEMO_EMAIL) {
      return fail(403, 'FORBIDDEN', 'Only administrators can do this.');
    }

    return HttpResponse.json(
      [...db.department]
        .sort((a, b) => a.dept_name.localeCompare(b.dept_name))
        .map((row) => department(row.dept_id)),
    );
  }),

  http.post('/api/admin/professors', async ({ request }) => {
    const account = signedIn(request);

    if (account.email !== ADMIN_DEMO_EMAIL) {
      return fail(403, 'FORBIDDEN', 'Only administrators can do this.');
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return fail(400, 'INVALID_PROFESSOR', 'Send valid JSON.');
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return fail(
        400,
        'INVALID_PROFESSOR',
        'Send the professor as a JSON object.',
      );
    }

    const fields = body as Record<string, unknown>;
    const text = (name: string) =>
      typeof fields[name] === 'string' ? fields[name].trim() : '';

    const netid = text('netid').toLowerCase();
    const firstName = text('firstName');
    const lastName = text('lastName');
    const email = text('email');
    const deptId = text('deptId');
    const rank = fields.rank;

    if (!/^[a-z]{3}\d{6}$/.test(netid)) {
      return fail(
        400,
        'INVALID_PROFESSOR',
        'NetID must be three letters followed by six digits, like abc123456.',
      );
    }

    if (!firstName || !lastName) {
      return fail(
        400,
        'INVALID_PROFESSOR',
        'First name and last name are required.',
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(400, 'INVALID_PROFESSOR', 'Enter a valid email address.');
    }

    if (rank !== 'assistant' && rank !== 'associate' && rank !== 'full') {
      return fail(400, 'INVALID_PROFESSOR', 'Select a valid rank.');
    }

    // Use the IDs supplied by the mock department list.
    if (!db.department.some((row) => row.dept_id === deptId)) {
      return fail(400, 'INVALID_PROFESSOR', 'Select a valid department.');
    }

    const nextTerm = [...db.term]
      .filter((row) => row.start_date > db.meta.today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];

    if (!nextTerm) {
      return fail(
        409,
        'NEXT_TERM_MISSING',
        'Add the next term before adding professors.',
      );
    }

    if (db.professor.some((row) => row.netid.toLowerCase() === netid)) {
      return fail(
        409,
        'NETID_TAKEN',
        `A professor with NetID ${netid} already exists.`,
      );
    }

    if (
      db.professor.some(
        (row) => row.email.toLowerCase() === email.toLowerCase(),
      )
    ) {
      return fail(
        409,
        'EMAIL_TAKEN',
        'A professor with that email already exists.',
      );
    }

    db.professor.push({
      netid,
      first_name: firstName,
      last_name: lastName,
      email,
      rank,
      dept_id: deptId,
      eval_interval_years: rank === 'assistant' ? 1 : 2,
      baseline_last_eval_term: null,
      start_term: nextTerm.term_id,
      is_active: true,
    });

    const professor: AdminProfessor = {
      ...contact(netid),
      department: department(deptId),
      isAc: false,
      isActive: true,
    };

    return HttpResponse.json(professor, { status: 201 });
  }),
    http.get('/api/admin/professors', ({ request }) => {
    const account = signedIn(request);

    if (account.email !== ADMIN_DEMO_EMAIL) {
      return fail(403, 'FORBIDDEN', 'Only administrators can do this.');
    }

    const professors: AdminProfessor[] = [...db.professor]
      .sort(
        (a, b) =>
          a.last_name.localeCompare(b.last_name) ||
          a.first_name.localeCompare(b.first_name) ||
          a.netid.localeCompare(b.netid),
      )
      .map((p) => ({
        ...contact(p.netid),
        department: department(p.dept_id),
        isAc: isAc(p.netid),
        isActive: p.is_active,
      }));

    return HttpResponse.json(professors);
  }),
  http.get('/api/me', ({ request }) => {
    const p = signedIn(request);

    const me: Me = {
      ...contact(p.netid),
      department: department(p.dept_id),
      role: isAc(p.netid) ? 'AC' : 'faculty',
      isAdmin: p.email === ADMIN_DEMO_EMAIL,
    };

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
    committeeMember(request);
    return HttpResponse.json([...db.term].sort((a, b) => a.start_date.localeCompare(b.start_date)).map((t) => term(t.term_id)));
  }),

  http.get('/api/templates/active', ({ request }) => {
    signedIn(request);
    const live = db.template_version.find((v) => v.status === 'live');
    return live ? HttpResponse.json(templateVersion(live)) : fail(404, 'NOT_FOUND', 'No template version is live yet.');
  }),

    http.post('/api/admin/import', async ({ request }) => {
    const account = signedIn(request);

    if (account.email !== ADMIN_DEMO_EMAIL) {
      return fail(403, 'FORBIDDEN', 'Only administrators can do this.');
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(400, 'INVALID_IMPORT', 'The form data could not be read.');
    }


    const imported = { department: 0, term: 0, professor: 0, ac_member: 0, course: 0, section: 0, meeting_time: 0,};
    const skipped = { ...imported };
    const updated = { ...imported };
    const seen = new Set<string>();
    const pending: ProfessorRow[] = [];

    const stagedDepartments = structuredClone(db.department);
    const stagedTerms = structuredClone(db.term);
    const stagedAcMembers = structuredClone(db.ac_member);

    const stagedCourses = structuredClone(db.course);
    const stagedSections = structuredClone(db.section);
    const stagedMeetingTimes = structuredClone(db.meeting_time);

    const entries = [...form.entries()].sort(
      ([left], [right]) =>
        IMPORT_TABLES.findIndex((table) => table === left) -
        IMPORT_TABLES.findIndex((table) => table === right),
    );

    for (const [name, file] of entries) {
      const table = IMPORT_TABLES.find((option) => option === name);

      if (!table) {
        return fail(400, 'INVALID_IMPORT', `Unsupported import field: ${name}.`);
      }
      if (typeof file === 'string') {
        return fail(400, 'INVALID_IMPORT', `${table} must be a CSV file.`);
      }
      if (seen.has(table)) {
        return fail(400, 'INVALID_IMPORT', `${table} was sent twice.`);
      }
      seen.add(table);

      try {
        const preview = preparePreview(table, file.name, await file.text());

        if (table === 'department' || table === 'term' || table === 'ac_member') {
          const keys = new Set<string>();

          for (const [index, cells] of preview.rows.entries()) {
           const importRow = readImportRow(preview.headers, cells, index);
           const { values } = importRow;
           const invalid: (message: string) => never = importRow.invalid;

            const key =
              table === 'department' ? values.dept_id :
              table === 'term' ? values.term_id :
              values.netid.toLowerCase();

            if (!key) invalid('The record ID is required.');
            if (keys.has(key)) invalid(`Duplicate record ID "${key}".`);
            keys.add(key);

            if (table === 'department') {
              if (!values.dept_name) invalid('Department name is required.');

              const existing = stagedDepartments.find((row) => row.dept_id === key);
              if (!existing) {
                stagedDepartments.push({
                  dept_id: key,
                  dept_name: values.dept_name,
                });
                imported.department += 1;
              } else if (existing.dept_name !== values.dept_name) {
                existing.dept_name = values.dept_name;
                updated.department += 1;
              } else {
                skipped.department += 1;
              }
            }

            if (table === 'term') {
              const season = values.season.toLowerCase();
              if (season !== 'spring' && season !== 'fall') {
                invalid('Season must be spring or fall.');
              }

              const year = Number(values.year);
              if (!Number.isInteger(year) || year < 2000 || year > 2100) {
                invalid('Year must be from 2000 to 2100.');
              }

              for (const field of ['start_date', 'end_date']) {
                const value = values[field];
                const parsed = new Date(`${value}T00:00:00Z`);
                if (
                  !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
                  Number.isNaN(parsed.getTime()) ||
                  parsed.toISOString().slice(0, 10) !== value
                ) {
                  invalid(`${field} must be a valid YYYY-MM-DD date.`);
                }
              }

              if (values.start_date > values.end_date) {
                invalid('End date cannot be before start date.');
              }

              const existing = stagedTerms.find((row) => row.term_id === key);
              const termRow: (typeof stagedTerms)[number] = {
                term_id: key,
                season,
                year,
                start_date: values.start_date,
                end_date: values.end_date,
              };

              if (!existing) {
                const overlap = stagedTerms.find(
                  (row) =>
                    row.start_date <= termRow.end_date &&
                    row.end_date >= termRow.start_date,
                );

                if (overlap) {
                  invalid(`Term dates overlap ${overlap.season} ${overlap.year}.`);
                }

                const termOrder = (row: { year: number; season: string }) =>
                  row.year * 2 + (row.season === 'fall' ? 1 : 0);

                const newOrder = termOrder(termRow);
                const outOfOrder = stagedTerms.find((row) => {
                  const existingOrder = termOrder(row);

                  if (row.start_date < termRow.start_date) {
                    return existingOrder >= newOrder;
                  }

                  return existingOrder <= newOrder;
                });

                if (outOfOrder) {
                  invalid(`Term dates are out of order with ${outOfOrder.season} ${outOfOrder.year}.`);
                }

                stagedTerms.push(termRow);
                imported.term += 1;
              } else if (
                existing.season !== season ||
                existing.year !== year ||
                existing.start_date !== values.start_date ||
                existing.end_date !== values.end_date
              ) {
                invalid(`Term ID "${key}" already exists with different values.`);
              } else {
                skipped.term += 1;
              }
            }

            if (table === 'ac_member') {
              const professor = pending.find((row) => row.netid.toLowerCase() === key) ??
              db.professor.find((row) => row.netid.toLowerCase() === key);

              if (!professor) invalid(`Professor "${key}" does not exist.`);

              const active = values.is_active.toLowerCase();
              if (!['true', 'false', 't', 'f'].includes(active)) {
                invalid('is_active must be true, false, t, or f.');
              }

              const isActive = active === 'true' || active === 't';
              if (isActive && !professor.is_active) {
                invalid('An inactive professor cannot receive active AC membership.');
              }

              const existing = stagedAcMembers.find(
                (row) => row.netid.toLowerCase() === key,
              );
              if (!existing) {
                stagedAcMembers.push({ netid: professor.netid, is_active: isActive });
                imported.ac_member += 1;
              } else if (existing.is_active !== isActive) {
                existing.is_active = isActive;
                updated.ac_member += 1;
              } else {
                skipped.ac_member += 1;
              }
            }
          }

          continue;
        }

       if (
        table === 'course' ||
        table === 'section' ||
        table === 'meeting_time'
      ) {
        const importTable = table;
        const keys = new Set<string>();

        for (const [index, cells] of preview.rows.entries()) {
          const importRow = readImportRow(preview.headers, cells, index);
          const { values, requireValue } = importRow;
          const invalid: (message: string) => never = importRow.invalid;

          function checkDuplicate(key: string) {
            if (keys.has(key)) {
              invalid('The same record appears more than once in this CSV.');
            }
            keys.add(key);
          }

          function saveRow<T extends object>(
            rows: T[],
            row: T,
            existing: T | undefined,
          ) {
            if (!existing) {
              rows.push(row);
              imported[importTable] += 1;
              return;
            }

            const changed = (Object.keys(row) as (keyof T)[])
              .some((field) => existing[field] !== row[field]);

            if (changed) {
              Object.assign(existing, row);
              updated[importTable] += 1;
            } else {
              skipped[importTable] += 1;
            }
          }

          if (table === 'course') {
            const courseId = requireValue('course_id');
            checkDuplicate(courseId);

            const deptId = requireValue('dept_id');
            if (!stagedDepartments.some((row) => row.dept_id === deptId)) {
              invalid(`Department "${deptId}" does not exist.`);
            }

            const levelText = requireValue('course_level');
            const courseLevel = Number(levelText);
            if (!Number.isInteger(courseLevel) || courseLevel <= 0) {
              invalid('course_level must be a positive whole number.');
            }

            const row: (typeof stagedCourses)[number] = {
              course_id: courseId,
              dept_id: deptId,
              course_num: requireValue('course_num'),
              title: requireValue('title'),
              course_level: courseLevel,
            };

            saveRow(
              stagedCourses,
              row,
              stagedCourses.find((item) => item.course_id === courseId),
            );
          }

          if (table === 'section') {
            const sectionId = requireValue('section_id');
            checkDuplicate(sectionId);

            const courseId = requireValue('course_id');
            if (!stagedCourses.some((row) => row.course_id === courseId)) {
              invalid(`Course "${courseId}" does not exist.`);
            }

            const termId = requireValue('term_id');
            if (!stagedTerms.some((row) => row.term_id === termId)) {
              invalid(`Term "${termId}" does not exist.`);
            }

            const instructorId = requireValue('instructor_id').toLowerCase();
            const instructor =
              pending.find((row) => row.netid.toLowerCase() === instructorId) ??
              db.professor.find((row) => row.netid.toLowerCase() === instructorId);

            if (!instructor) {
              invalid(`Professor "${instructorId}" does not exist.`);
            }

            const classMode = requireValue('class_mode').toLowerCase();
            if (classMode !== 'in-person' && classMode !== 'online') {
              invalid('class_mode must be in-person or online.');
            }

            const existing = stagedSections.find(
              (row) => row.section_id === sectionId,
            );

            const row: (typeof stagedSections)[number] = {
              section_id: sectionId,
              course_id: courseId,
              term_id: termId,
              section_num: requireValue('section_num'),
              instructor_id: instructor.netid,
              class_mode: classMode,
              enrollment: existing?.enrollment ?? null,
            };

            saveRow(stagedSections, row, existing);
          }

          if (table === 'meeting_time') {
            const sectionId = requireValue('section_id');
            if (!stagedSections.some((row) => row.section_id === sectionId)) {
              invalid(`Section "${sectionId}" does not exist.`);
            }

            const weekdays: Record<
              string,
              (typeof stagedMeetingTimes)[number]['day_of_week']
            > = {
              mon: 'Mon',
              monday: 'Mon',
              tue: 'Tue',
              tuesday: 'Tue',
              wed: 'Wed',
              wednesday: 'Wed',
              thu: 'Thu',
              thursday: 'Thu',
              fri: 'Fri',
              friday: 'Fri',
              sat: 'Sat',
              saturday: 'Sat',
              sun: 'Sun',
              sunday: 'Sun',
            };

            const dayText = requireValue('day_of_week').toLowerCase();
            const day = weekdays[dayText];
            if (!day) {
              invalid('day_of_week must be Monday through Sunday.');
            }

            function readTime(field: string): string {
              const value = requireValue(field);

              if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)) {
                invalid(`${field} must use HH:MM or HH:MM:SS.`);
              }

              return value.length === 5 ? `${value}:00` : value;
            }

            const startTime = readTime('start_time');
            const endTime = readTime('end_time');

            if (startTime >= endTime) {
              invalid('start_time must be before end_time.');
            }

            // A section may meet more than once on the same day.
            const key = JSON.stringify([sectionId, day, startTime]);
            checkDuplicate(key);

            const existing = stagedMeetingTimes.find((row) => {
              const existingStart = row.start_time.length === 5
                ? `${row.start_time}:00`
                : row.start_time;

              return (
                row.section_id === sectionId &&
                row.day_of_week === day &&
                existingStart === startTime
              );
            });

            const row: (typeof stagedMeetingTimes)[number] = {
              section_id: sectionId,
              day_of_week: day,
              start_time: startTime,
              end_time: endTime,
              room: values.room || '',
            };

            saveRow(stagedMeetingTimes, row, existing);
          }
        }

        continue;
      }

        const netids = new Set<string>();
        const today = db.meta.today;
        const nextTerm =  [...stagedTerms]
          .filter((term) => term.start_date > today)
          .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];

        for (const [index, cells] of preview.rows.entries()) {
          const importRow = readImportRow(preview.headers, cells, index);
          const { values } = importRow;
          const invalid: (message: string) => never = importRow.invalid;


          const netid = values.netid.toLowerCase();
          if (!/^[a-z]{3}\d{6}$/.test(netid)) {
            invalid('NetID must be three letters followed by six digits, like abc123456.');
          }
          if (netids.has(netid)) invalid(`Duplicate NetID "${netid}".`);
          netids.add(netid);

          if (!values.first_name || !values.last_name) {
            invalid('First name and last name are required.');
          }

          const email = values.email.toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            invalid('Enter a valid email address.');
          }

          const rank = values.rank;
          if (rank !== 'assistant' && rank !== 'associate' && rank !== 'full') {
            invalid('Rank must be assistant, associate, or full.');
          }

          if (!stagedDepartments.some((dept) => dept.dept_id === values.dept_id)) {
            invalid(`Department "${values.dept_id}" does not exist in demo data.`);
          }

          const interval = Number(values.eval_interval_years);
          if (!Number.isInteger(interval) || interval <= 0) {
            invalid('Evaluation interval must be a positive whole number.');
          }

          const active = values.is_active.toLowerCase();
          if (!['true', 'false', 't', 'f'].includes(active)) {
            invalid('is_active must be true, false, t, or f.');
          }

          const existing = db.professor.find((p) => p.netid.toLowerCase() === netid);
          const startTerm =
            values.start_term || existing?.start_term || nextTerm?.term_id;

          if (!startTerm || !stagedTerms.some((term) => term.term_id === startTerm)) {
            invalid('Provide an existing start term or add an upcoming demo term.');
          }

          const baseline = values.baseline_last_eval_term || null;
          if (baseline && !stagedTerms.some((term) => term.term_id === baseline))  {
            invalid(`Baseline term "${baseline}" does not exist in demo data.`);
          }

          pending.push({
            netid: existing?.netid ?? netid,
            first_name: values.first_name,
            last_name: values.last_name,
            email,
            rank,
            dept_id: values.dept_id,
            eval_interval_years: interval,
            baseline_last_eval_term: baseline,
            start_term: startTerm,
            is_active: active === 'true' || active === 't',
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not read the CSV.';
        return fail(400, 'INVALID_IMPORT', `${table}.csv: ${message}`);
      }
    }

    if (!seen.size) {
      return fail(400, 'INVALID_IMPORT', 'Send at least one CSV file.');
    }

    // Check email uniqueness against the complete resulting professor list.
    const replacements = new Map(pending.map((row) => [row.netid, row]));
    const finalRows = [
      ...db.professor.filter((row) => !replacements.has(row.netid)),
      ...pending,
    ];
    const emailOwners = new Map<string, string>();

    for (const row of finalRows) {
      const email = row.email.trim().toLowerCase();
      const owner = emailOwners.get(email);
      if (owner !== undefined && owner !== row.netid) {
        return fail(
          400,
          'INVALID_IMPORT',
          `Email "${email}" is shared by NetIDs "${owner}" and "${row.netid}".`,
        );
      }
      emailOwners.set(email, row.netid);
    }


    const inactiveNetids = new Set(
      pending
        .filter((professor) => !professor.is_active)
        .map((professor) => professor.netid.toLowerCase()),
    );

    for (const membership of stagedAcMembers) {
      if (inactiveNetids.has(membership.netid.toLowerCase())) {
        membership.is_active = false;
      }
    }

    // Apply changes only after every uploaded row has passed validation.
    db.department = stagedDepartments;
    db.term = stagedTerms;
    db.ac_member = stagedAcMembers;
    db.course = stagedCourses;
    db.section = stagedSections;
    db.meeting_time = stagedMeetingTimes;

    for (const row of pending) {
      const existing = db.professor.find((p) => p.netid === row.netid);

      if (!existing) {
        db.professor.push(row);
        imported.professor += 1;
        continue;
      }

      const changed = (Object.keys(row) as (keyof ProfessorRow)[])
        .some((key) => existing[key] !== row[key]);

      if (changed) {
        Object.assign(existing, row);
        updated.professor += 1;
      } else {
        skipped.professor += 1;
      }
    }

    return HttpResponse.json({
      imported,
      updated,
      skipped,
    } satisfies ImportResult);
  }),
];
