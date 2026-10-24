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
- `/committee/dashboard`: committee home with sample KPI results and a current-cycle summary.

Committee demo accounts can switch between Faculty and Committee views. Faculty-only accounts cannot open the committee dashboard. Faculty who are due can open sign-up from My evaluation. The observation record buttons are still disabled. Other later-sprint pages are not included.

The dashboard keeps the existing prototype's KPI cards and CSV export; these are a preview of later dashboard work, not a claim that the backend implements those features.

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

The evaluation-status and sign-up write routes still return 501 on `main`, and there's no real Firebase sign-in yet, so the frontend only runs against the mock API for now.

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

Response types are in `src/api/types.ts`. Roles are `faculty` and `AC`; committee membership adds access without removing faculty access. Backend routes must enforce their own permissions. Client-side route guards are not server authorization.

The frontend authentication adapter currently supports demo mode only. Firebase sign-in/token handling is still pending. Changing `VITE_AUTH_MODE` alone does not implement Firebase.

Vite's proxy is development configuration; production API routing requires separate configuration. If switching away from a previous mock session, clear old site/service-worker data if mock interception persists.

## Observation status

The evaluation view distinguishes loading, failed requests, empty history, and current-cycle sign-up details. Signature labels use both the observation lifecycle and the available signature dates. When only a sign-up summary is available, the page does not guess whether the record is signed. Observation history is horizontally scrollable on narrower screens; record actions remain disabled until the record route is implemented.

Run `npm test` for page-level regression tests using controlled HTTP responses. These tests do not establish real-backend authentication or database persistence. The evaluation-status, current sign-up, and observee observation-history endpoints must be available before connected status-view acceptance can be verified.

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
| Choose observers | at least one candidate has no request (candidates whose request expired are listed again) |
| Requests sent | any request is pending, or accepted while the sign-up has no observation yet |
| None accepted | requests exist but none is pending or accepted |
| Matched | the sign-up has an observation |

It sends `POST /api/signups/{signupId}/requests` with the selected `observerNetids`, never an empty list (the API reads an empty or missing list as every candidate). While requests are out, the list is not ready, or none were accepted, it re-reads `GET /api/me/signup`, `GET /api/signups/{signupId}/candidates` and `GET /api/me/requests/outgoing` every 30 seconds and when the window regains focus. It stops once matched or while the professor is choosing.

Not settled with the backend yet:

- The candidates response cannot tell "matching has not run" from "matching found no eligible observers", so after the deadline both show the same neutral message.
- Resending to an observer whose request expired follows the mock API; the backend has not confirmed it.
- `GET /api/signups/{signupId}/candidates`, `POST /api/signups/{signupId}/requests` and `GET /api/me/requests/outgoing` are not in the backend yet. This page is verified against the mock API and the tests in `RequestsPage.test.tsx` only.
