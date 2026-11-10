# Assessment Helper frontend

React, TypeScript, and Tailwind. Requires Node 20 or newer.

## Run locally

From `App/frontend`:

```sh
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. The example environment enables the mock API so these pages can be demonstrated while the application endpoints are being built.

## Included pages

- `/login`: email/password form, password visibility toggle, and sign-in errors.
- `/faculty/evaluation`: faculty identity, evaluation status, deadlines, and observation history.
- `/faculty/sign-up`: pick a course and the class meetings you'd like to be observed in.
- `/faculty/observe`: incoming observation requests, proposed times, accept or decline controls, and a count toward the semester limit.
- `/faculty/observe/confirmations`: accepted assignments, cancelled requests, and links to forms or records. Legacy `/faculty/assignments` URLs redirect here.
- `/faculty/observe/:observationId`: read-only assigned observation record, with browser-native printing of its saved contents.
- `/faculty/observe/:observationId/form`: observer-only local draft editor using the assigned observation's question ranges.
- `/faculty/observe/:observationId/sign`: observer review and signed-form submission; the observee signs from the saved record.
- `/faculty/survey`: current-cycle survey submission as an observer or observee, with an optional trouble file.
- `/committee/survey-responses`: AC-only current-cycle responses and authenticated trouble-file downloads.
- `/committee/dashboard`: committee home with KPI results and a current-cycle summary. Its lists of due or overdue faculty, unmatched faculty and outstanding observations, and the notification sends, each have a short page under Dashboard in the sidebar (`/committee/dashboard/due`, `/committee/dashboard/unmatched`, `/committee/dashboard/outstanding` and `/committee/dashboard/notifications`).
- `/committee/cycle`: start the evaluation cycle for a term with its three deadlines (with a draft saved on this device), or change the deadlines while the cycle is open, beside who is due.
- `/committee/faculty`: every professor's status this cycle with filters, name search, CSV export, and due reminders to the selected due or overdue professors.
- `/committee/signups`: AC-only sign-up requests: run observer selection after the sign-up deadline, see the sign-ups that need attention, add an observer by hand, and notify observees that their lists are ready.
- `/guide`: Process guide, linked from the sidebar in both views: the current cycle's deadlines, the steps of a semester, and who is due.

Committee demo accounts can switch between Faculty and Committee views. Faculty-only accounts cannot open the committee dashboard. Faculty who are due can open sign-up from My evaluation. Current and past observations link to the read-only record. Other later-sprint pages are not included.

The dashboard's KPI cards and CSV export read `GET /api/cycles/latest/kpis`: the newest cycle past its feedback deadline, or the current cycle (with no KPIs yet) before any has closed.

## Demo accounts

With `VITE_USE_MOCKS=true` and `VITE_AUTH_MODE=demo`, use any nonempty password:

| Account | Access |
| --- | --- |
| `maya.lin@demo.edu` | Faculty |
| `elena.ruiz@demo.edu` | Faculty |
| `linda.chen@demo.edu` | Faculty and Committee |

These are fictional accounts, not UTD credentials. Demo tokens are only for the mock API and must not be accepted as production authentication.

## Checks

```sh
npm run typecheck
npm run build
npm test
```

## Backend integration

Set `VITE_USE_MOCKS=false` in `.env` and restart Vite to send requests through the existing `/api` development proxy to `http://localhost:3000`. The Express package is at the repository root under `backend/`, not inside `App/`.

The evaluation-status, sign-up, candidate, outgoing-request, observation, survey and notification routes are implemented in the backend source. Check the running backend revision and configuration before diagnosing a missing route; source availability alone does not verify populated end-to-end behavior.

The current screens request:

- `GET /api/me`
- `GET /api/cycles/current`
- `GET /api/me/evaluation-status`
- `GET /api/me/observations?as=observee`
- `GET /api/me/signup`
- `GET /api/me/courses?termId=...`
- `POST /api/signups` with `{ sectionId, proposedDates }`
- `GET /api/cycles/latest/kpis`
- `GET /api/dashboard/due-by-rank`
- `GET /api/dashboard/outstanding-observations`
- `GET /api/dashboard/unmatched`
- `GET /api/cycles/{cycleId}/due-professors`
- `GET /api/cycles/{cycleId}/signups`
- `POST /api/cycles/{cycleId}/survey-responses`
- `GET /api/cycles/{cycleId}/survey-responses`
- `GET /api/cycles/{cycleId}/survey-responses/{responseId}/trouble-file`
- `POST /api/cycles` and `PATCH /api/cycles/{cycleId}`
- `GET /api/terms`, `GET /api/terms/{termId}/due-preview` and `GET /api/cycles/{cycleId}/faculty` (not in the backend yet: the cycle and faculty pages show a "not available yet" note for each, and the faculty page falls back to the due-professors list)
- `POST /api/cycles/{cycleId}/notifications/due-reminders` with `{ netids }`

Response types are in `src/api/types.ts`. Roles are `faculty` and `AC`; committee membership adds access without removing faculty access. Backend routes must enforce their own permissions. Client-side route guards are not server authorization.

`VITE_AUTH_MODE` is `demo` (any password, mock API) or `firebase` (Firebase email/password; the backend verifies the ID token and decides the role through `GET /api/me`). Firebase mode needs `VITE_USE_MOCKS=false`, the `VITE_FIREBASE_*` variables from `.env.example`, and the backend running with its own service-account key and database. Any other value is an error.

Vite's proxy is development configuration; production API routing requires separate configuration. If switching away from a previous mock session, clear old site/service-worker data if mock interception persists.

## Observation form and status

The form saves a bounded draft in this browser, scoped to the signed-in account and observation. Saving does not submit answers or sign the record. If local storage is corrupt or blocked, the page explains the fallback or failure; edits are retained in memory while moving between the form and review screens. Observer submission posts the reviewed answers and records the observer signature. The server enforces the on-or-after scheduled-date rule and returns a specific rejection when a submission is early; the frontend does not guess using its own clock. Required ratings are enforced at submission, and zero is a valid rating when the assigned scale includes it. A comment on an unrated optional question remains visible in review but is not part of the signed-form API payload until that question is rated. If a local draft is based on an older server revision, review shows the saved server responses and requires explicit acknowledgement that local edits will not be submitted. The observee signs the saved record using its exact last-saved revision; after a stale response, the page reloads the latest record and requires an explicit acknowledgement that the updated responses were reviewed before another signature attempt. Typed-name confirmation is not stored as a signature field. The server enforces access and remains authoritative; these UI checks are not authorization. The assigned observation's historical template fields determine ratings, including zero, and required flags. Connected Firebase/backend/database testing was not performed by the mock-backed page tests.

## Printable observation record

The read-only observation route's **Print record** button opens the browser's native print flow. The printed view uses the saved `GET /api/observations/{observationId}` record only—not a local unsaved draft—and includes course/section/date, participant names, template version, saved question wording/ratings/comments, other comments, any non-completion reason, status, and both signature states/dates. The current backend returns `observerSignedDate` and `observeeSignedDate` as calendar dates (the exact time-of-day is not exposed), so the print view does not invent signature times. Navigation, screen-only labels, print controls, and signing/retry controls are omitted from paper output. Page size is selected in the browser print dialog; no PDF service or dependency is added.

Source-checked field semantics (`backend/src/services/observation.service.ts`, base `e9eb96c`):

| Field | Source behavior |
| --- | --- |
| `scheduledDate` | Saved observation date; a displayed time is inferred only from an unambiguous regular section meeting, not an actual attendance timestamp. |
| `answers`, `otherComments` | Saved responses and the observation's assigned historical template questions, not the current live template or local draft. |
| `observerSignedDate` | Set when the observer submits or resubmits; exposed as a calendar date. Typed-name confirmation is not stored. |
| `observeeSignedDate` | Set when the observee signs the exact saved revision; completes and locks the record. Exposed as a calendar date. |
| `lastSavedDate` | Revision token updated by observer submission and observee signing. Not a standalone signature timestamp. |

Short and long controlled saved records were rendered in Chromium on Letter and A4: short output was one page on each; long output was six Letter pages and five A4 pages. Text checks covered saved content, signature states, absence of local drafts and hidden navigation/actions, and no blank trailing page. Representative first/middle/final pages were visually inspected. This verifies browser printing with controlled responses, not physical printers or live persistence. Backend-team confirmation and the approved populated observer-submit → observee-sign → refetch/print run remain required for #198/#162.

On a mounted form refetch, local edits stay tied to the revision that initialized the editor. A visible warning explains that the server changed; saving does not relabel old answers as current. The signing screen uses the newer saved server responses and requires explicit acknowledgement before submitting them. Older draft edits are not automatically merged.

## Survey and attachments

The survey uses the current cycle's `feedback` phase for availability and displays the server-provided opening/closing dates. Participants explicitly choose observer or observee and Yes or No. The API remains authoritative for the survey window, participation and one-response-per-role constraint. Text fields allow 5,000 characters each. The optional trouble file is sent as multipart field `troubleFile`, at most 10 MiB. Pending submission disables the form; errors preserve its inputs, while successful submission clears the attachment and marks that role submitted for this mounted form. A reload may submit again, in which case the server returns `ALREADY_SUBMITTED` rather than saving a duplicate.

The AC response page confirms the user's role before fetching responses and provides loading, empty, error and retry states. File downloads use the cycle/response-scoped endpoint with the current bearer token, not a public storage URL or the opaque `troubleFileKey`. Download errors remain visible without discarding the response list. Response text preserves line breaks. These screens use the existing UI language; exact Figma fidelity remains unverified pending access to the survey/response frames.

Survey tests and isolated Chromium checks cover submission with and without files and authenticated binary download. They do not prove Firebase authorization, server storage or PostgreSQL persistence. Existing demo fixtures are not a substitute for an approved feedback-phase cycle. Coordinate the populated connected run with the backend team before closing integration work. Notification send controls are a separate frontend workstream; due reminders already queue email in the existing backend, but `{ sent }` counts notifications, not confirmed email deliveries. Admin/import screens are outside this workstream.

The evaluation view distinguishes loading, failed requests, empty history, and current-cycle sign-up details. Signature labels use both the observation lifecycle and the available signature dates. When only a sign-up summary is available, the page does not guess whether the record is signed. Observation history is horizontally scrollable on narrower screens; its available record links open the read-only route.

Run `npm test` for page-level regression tests using controlled HTTP responses. These tests do not establish real-backend authentication or database persistence. The evaluation-status, current sign-up, and observee observation-history endpoints must be available before connected status-view acceptance can be verified.

## Committee dashboard (`/committee/dashboard`)

The dashboard is split into short pages so each one stays readable. In Committee mode the sidebar lists them as a list nested under Dashboard, and exactly one row is highlighted on each page:

| Sidebar row | Page | Shows |
| --- | --- | --- |
| Dashboard | `/committee/dashboard` | The KPI cards with Export CSV, and the executive summary; each count links to its list's page |
| Due or overdue | `/committee/dashboard/due` | The due or overdue list |
| Unmatched | `/committee/dashboard/unmatched` | The unmatched faculty list |
| Outstanding | `/committee/dashboard/outstanding` | The outstanding observations list |
| Notifications | `/committee/dashboard/notifications` | The notification sends, then your own notifications |

Faculty-only accounts are sent from every one of these pages to My evaluation, as before. The three lists show the current cycle:

| List | Request | Rows |
| --- | --- | --- |
| Due or overdue for evaluation | `GET /api/cycles/{cycleId}/due-professors` | The cycle's DUE and OVERDUE professors, overdue first |
| Unmatched faculty | `GET /api/dashboard/unmatched` | Sign-ups with no observation that have no observer, too few observers, or no one who accepted |
| Outstanding observations | `GET /api/cycles/{cycleId}/signups` | Sign-ups with no observation yet, or one that is not completed (completed means the observee has signed) |

Each list has a one-line description under its heading (from `src/lib/statusTerms.ts`) that says who is on it and what due, overdue and outstanding mean; it shows while the list loads, is empty or fails, and the list's section is described by it for screen readers. Each list says when it is loading, empty or failed. A summary count that is loading or failed shows a dash, never 0. Before the first cycle starts, `GET /api/cycles/current` returns `null`, so the overview shows one message that no cycle has started in place of the cards, each list page says it once in place of its list, and the Notifications page keeps its sends turned off with a note that there is no one to notify yet. The dashboard endpoints also answer `404 NO_CYCLE` then.

A list, a count or the KPI cards that fail to load offer Try again, which repeats only the requests that failed and moves keyboard focus to that part of the page. A failed refresh keeps the last data on screen with a "Couldn't refresh" note, and a failed count is announced. The unmatched count and the unmatched list read the same request but are on different pages now, so each offers its own Try again. The KPI cards show a dash with Loading or Couldn't load until the KPIs arrive, and N/A only when the cycle has no value for a KPI (no result yet, or nothing to divide by).

The KPI cards, the summary counts and the Export CSV row follow the width of the content column (not the window, since the sidebar takes part of it): four KPI cards per row, then two, then one. Each list keeps the Figma column order, status last. A table that is too wide for the column scrolls sideways inside its section, with a fade at the edge while columns are out of view, and its status moves next to the name so it stays in view. Loading, empty and failed lists show their message in a plain box instead. Lists show 7 rows a page, as in the A3 and A4 tables; the pager keeps at most seven page slots (the first, the last and the nearby pages), so its arrows stay put.

The mock API differs from the backend in a few places the dashboard reads (the mock itself is unchanged here):

- Unmatched: the mock never returns `insufficient_observers` and ignores resolved alerts.
- Latest KPIs: before any cycle has started, the mock still returns a cycle that has results; the backend answers 404.
- Observations: the mock marks an observation completed when the observer submits it; the backend does so only when the observee signs. In demo mode the "Signed up but not observed" count and the outstanding list can therefore disagree after a submission.

### Open dashboard rule questions (#199)

The backend team has not answered these yet, so the lists follow the API as it is today and nothing is guessed:

1. Does "Unmatched faculty" mean only sign-ups with an open alert, or every sign-up that has no observer yet? Today the list shows only sign-ups with no observation that have an open `no_observer` or `insufficient_observers` alert, or (`no_acceptance`) requests sent and no usable observer left, as `GET /api/dashboard/unmatched` returns them. A sign-up with pending requests and no alert is not on it; it is on the outstanding list as "No observer yet".
2. Does a professor whose observation is completed and signed this cycle stay on the due roster? Today the due list and the "Due for evaluation" count show the roster captured when the cycle started (`eval_due`), which nothing updates during the cycle, so that professor stays listed as due or overdue.
3. Can the sign-ups summary (`GET /api/cycles/{cycleId}/signups`) include `observerSignedDate` and `observeeSignedDate`? Without them the outstanding list cannot tell "waiting for the observee to sign" apart from Scheduled, so it shows Scheduled for both.

When an answer arrives, the list's filter, its description in `src/lib/statusTerms.ts` and its tests change together.

## Sign-up requests (`/committee/signups`)

After the sign-up deadline the committee runs observer selection, checks the sign-ups that need attention, adds an observer by hand where the list came up short, and tells observees their lists are ready. The dashboard's Unmatched faculty summary links here ("Open in Sign-ups").

| Action or read | Request |
| --- | --- |
| Table and attention banner | `GET /api/cycles/{cycleId}/matching` (each sign-up with its observer list and newest open alert) |
| Observee email column | `GET /api/cycles/{cycleId}/signups` |
| Run observer selection | `POST /api/cycles/{cycleId}/matching`, no body; the backend refuses it with `409 SIGNUP_OPEN` until the day after the sign-up deadline, so the button stays off until then |
| Notify observees: lists are ready | `POST /api/cycles/{cycleId}/notifications/lists-ready`, no body, answered with `{ sent }` |
| Add observer (rows with an alert) | `POST /api/signups/{signupId}/candidates` with exactly `{ observerNetid }`, trimmed |

The lists-ready send follows the dashboard's rules: it asks first, ignores repeat clicks while it runs, is never retried automatically, and says when nobody was notified or when only committee members may send. Run observer selection and Add observer also send once under repeated clicks. Every error message from the backend is shown as sent, and the NetID stays in the box after a failed add.

Checked against the real backend (same revision as this branch) on a private local PostgreSQL database built from `database/schema.sql`, the migrations and the seed data, with 14 sign-ups made through the API: the page listed them as not run yet before the deadline; after it, observer selection filled the lists (9 with 5 observers, 5 with fewer than 3) and the banner, Show only these and the table matched; lists-ready reported 14 notifications; an add with the observee's own NetID and one with an unknown NetID showed the backend's messages, and a valid add brought that sign-up to 3 observers and cleared its alert.

On the shared database (read only, signed in with Firebase as an AC member, 2026-11-10): the page showed the cycle's one sign-up as not run yet after the deadline, with Run on, Notify off and no attention banner, which matches the dashboard's empty Unmatched faculty list; every read returned 200. Running selection, notifying and adding an observer were not done there.

Still depends on the backend:

- "Ran" shows the newest `ranAt` across the sign-ups. The backend fills it from the newest observer match, so a later manual add moves it too.
- The mock answers `POST /api/signups/{signupId}/candidates` with a matching row and its own eligibility rules; the backend returns `{ signupId, observer, roundNo }` and accepts any active professor while fewer than 3 observers are usable. The page reads neither body, so both work.
- The insufficient threshold (3) and the list size (5) are the backend's `INSUFFICIENT_BELOW` and `MAX_CANDIDATES`; the backend notes the team still has to confirm 3.

## Mock data

`src/mocks/` contains the existing fixture, handlers, and rules from the frontend prototype. It retains shared support for later workflows, but does not expose their pages. Mock responses do not prove PostgreSQL integration, matching-rule acceptance, or real notifications.

```sh
npm run data
npm run data -- --today 2026-10-20
```

These commands replace the local fixture. The default snapshot uses September 8, 2026 so the displayed cycle is reproducible rather than following the computer's date. Mock changes reset on a full reload. The TypeScript fixture generator supports frontend development; it does not replace the database team's planned Python/CSV import.

## My requests (`/faculty/requests`)

Faculty choose observers from their recommended list, send requests, and follow the answers. The page shows one state at a time, from the sign-up, candidate, and outgoing-request reads:

| State | Shown when |
| --- | --- |
| No sign-up | `GET /api/me/signup` returns `null` |
| No observer list yet | no candidates and no requests; before the sign-up deadline it names the deadline, after it the message stays neutral |
| Choose observers | at least one current candidate has no request; ended requests remain in request history |
| Requests sent | any request is pending, or accepted while the sign-up has no observation yet |
| None accepted | requests exist but none is pending or accepted |
| Matched | the sign-up has an observation |

It sends `POST /api/signups/{signupId}/requests` with the selected `observerNetids`, never an empty list (the API reads an empty or missing list as every candidate). Expired requests can be resent; pending and answered requests are not sent again. While requests are out, the list is not ready, or none were accepted, it re-reads `GET /api/me/signup`, `GET /api/signups/{signupId}/candidates` and `GET /api/me/requests/outgoing` every 30 seconds and when the window regains focus. It stops once matched or while the professor is choosing.

Not settled with the backend yet:

- The candidates response cannot tell "matching has not run" from "matching found no eligible observers", so after the deadline both show the same neutral message.
- Candidate and outgoing-request reads and the request write are implemented in the backend source. Populated connected-flow acceptance still needs the intended backend revision, approved fictional accounts and test data.
