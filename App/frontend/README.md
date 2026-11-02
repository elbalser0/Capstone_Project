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
- `/faculty/assignments`: assigned observations with links to their record and form.
- `/faculty/observe/:observationId`: read-only assigned observation record.
- `/faculty/observe/:observationId/form`: observer-only local draft editor using the assigned observation's question ranges.
- `/committee/dashboard`: committee home with KPI results, a current-cycle summary, and lists of due or overdue faculty, unmatched faculty and outstanding observations.

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

The evaluation-status and sign-up write routes still return 501 on `main`, and several read routes are missing, so those pages show errors against the real backend.

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

Response types are in `src/api/types.ts`. Roles are `faculty` and `AC`; committee membership adds access without removing faculty access. Backend routes must enforce their own permissions. Client-side route guards are not server authorization.

`VITE_AUTH_MODE` is `demo` (any password, mock API) or `firebase` (Firebase email/password; the backend verifies the ID token and decides the role through `GET /api/me`). Firebase mode needs `VITE_USE_MOCKS=false`, the `VITE_FIREBASE_*` variables from `.env.example`, and the backend running with its own service-account key and database. Any other value is an error.

Vite's proxy is development configuration; production API routing requires separate configuration. If switching away from a previous mock session, clear old site/service-worker data if mock interception persists.

## Observation form and status

The form saves a bounded draft in this browser, scoped to the signed-in account and observation. Saving does not submit answers or sign the record. If local storage is corrupt or blocked, the page explains the fallback or failure; unsaved edits last only while the editor stays open. Signing/submission and printing are not implemented here. The server enforces access and remains authoritative; these UI checks are not authorization. The assigned observation's historical template fields determine ratings, including zero, and required flags. Connected Firebase/backend/database testing was not performed by the mock-backed page tests.

The evaluation view distinguishes loading, failed requests, empty history, and current-cycle sign-up details. Signature labels use both the observation lifecycle and the available signature dates. When only a sign-up summary is available, the page does not guess whether the record is signed. Observation history is horizontally scrollable on narrower screens; its available record links open the read-only route.

Run `npm test` for page-level regression tests using controlled HTTP responses. These tests do not establish real-backend authentication or database persistence. The evaluation-status, current sign-up, and observee observation-history endpoints must be available before connected status-view acceptance can be verified.

## Committee dashboard (`/committee/dashboard`)

Below the KPI cards and executive summary, three lists show the current cycle:

| List | Request | Rows |
| --- | --- | --- |
| Due or overdue for evaluation | `GET /api/cycles/{cycleId}/due-professors` | The cycle's DUE and OVERDUE professors, overdue first |
| Unmatched faculty | `GET /api/dashboard/unmatched` | Sign-ups with no observation that have no observer, too few observers, or no one who accepted |
| Outstanding observations | `GET /api/cycles/{cycleId}/signups` | Sign-ups with no observation yet, or one that is not completed (completed means the observee has signed) |

Each list says when it is loading, empty or failed, and one failing does not hide the others. A summary count that is loading or failed shows a dash, never 0. Before the first cycle starts, `GET /api/cycles/current` returns `null`, so the page shows one message that no cycle has started in place of the cards and lists. The dashboard endpoints also answer `404 NO_CYCLE` then.

A list, a count or the KPI cards that fail to load offer Try again, which repeats only the requests that failed and moves keyboard focus to that part of the page. A failed refresh keeps the last data on screen with a "Couldn't refresh" note, and a failed count is announced. The KPI cards show a dash with Loading or Couldn't load until the KPIs arrive, and N/A only when the cycle has no value for a KPI (no result yet, or nothing to divide by).

The KPI cards, the summary counts and the Export CSV row follow the width of the content column (not the window, since the sidebar takes part of it): four KPI cards per row, then two, then one. Each list keeps the Figma column order, status last. A table that is too wide for the column scrolls sideways inside its section, with a fade at the edge while columns are out of view, and its status moves next to the name so it stays in view. Loading, empty and failed lists show their message in a plain box instead. Lists show 7 rows a page, as in the A3 and A4 tables; the pager keeps at most seven page slots (the first, the last and the nearby pages), so its arrows stay put.

Not settled with the backend yet:

- The sign-ups response has no signature dates, so the outstanding list cannot tell "waiting for the observee to sign" apart from Scheduled.
- The due list and the "Due for evaluation" count come from the due roster captured when the cycle started (`eval_due`), and nothing updates it during the cycle. Question for the backend team: should a professor whose observation is completed and signed this cycle stay listed as due or overdue? The frontend shows the roster as the API returns it.

The mock API differs from the backend in a few places the dashboard reads (the mock itself is unchanged here):

- Unmatched: the mock never returns `insufficient_observers` and ignores resolved alerts.
- Latest KPIs: before any cycle has started, the mock still returns a cycle that has results; the backend answers 404.
- Observations: the mock marks an observation completed when the observer submits it; the backend does so only when the observee signs. In demo mode the "Signed up but not observed" count and the outstanding list can therefore disagree after a submission.

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
- `POST /api/signups/{signupId}/requests` is implemented in the backend. This page still needs the backend candidate and outgoing-request reads before it can use the live API end to end.
