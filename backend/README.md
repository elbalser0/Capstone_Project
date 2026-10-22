# Assessment Helper backend

Initial Express/TypeScript foundation. Run commands from this directory.

## Setup

Install Node.js 22 and npm, then:

```sh
npm ci
cp .env.example .env
npm run dev
```

PORT defaults to 3000. Verify with `curl http://localhost:3000/api/health`.
Expected: HTTP 200 and `{"status":"ok"}`. This checks HTTP server availability,
not database connectivity.

## Commands

- `npm run dev`: development server with automatic restarts.
- `npm run typecheck`: check TypeScript without emitting files.
- `npm test`: run backend endpoint tests.
- `npm run build`: compile to dist/.
- `npm start`: run compiled server after building.
- `npm run db:check`: check the configured PostgreSQL connection.

## Integration

app.ts registers JSON middleware, routes, a 404 fallback, and error handling.
server.ts loads environment variables, validates PORT, and starts the listener.
Register future routers before the fallback. Add controllers, services, and
repositories when needed; keep SQL out of routes.

Errors use `{"error":{"code":"...","message":"..."}}`. Unknown routes return
404, malformed JSON returns 400, oversized bodies return 413, and unexpected
failures return a generic 500. ApiError supports explicit application errors.

Authenticated routes verify a Firebase ID token with a verified email and look
up the active professor in PostgreSQL. The professor's `ac_member` row determines
Assessment Committee access. Set `GOOGLE_APPLICATION_CREDENTIALS` in `.env` to
your local service-account JSON file and send `Authorization: Bearer <idToken>`.
React will call this API rather than PostgreSQL. Configure a frontend development
proxy or agreed CORS origin when the frontend connects.

## Faculty endpoints

`GET /api/me` returns the signed-in professor's identity, department, rank, and
role. `GET /api/me/courses?termId=...` returns that professor's sections and
meeting times for a positive integer term ID. It returns `[]` when none match.
The schema has no department short code or section enrollment, so course labels
use the department name and `enrollment` is `null`.

`GET /api/me/evaluation-status` returns the professor's due status, last and
next evaluation terms, and the current cycle when one exists. It uses completed,
signed observations or the professor's baseline term to calculate later due terms.
For a professor with no prior evaluation, the first evaluation is due two years
after `start_term`, so a first-semester professor is `NOT_DUE`.
The current development database has no cycles yet, so `cycle` is `null` and
`canSignUp` is `false` there. The due semester is calculated from the known
start or evaluation term; it can be shown before that future term has a
database row. Its response includes the season, year, and label, without
inventing a term ID or academic-calendar dates.

`GET /api/me/signup` returns the signed-in professor's sign-up from the latest
started evaluation cycle, including its section, proposed dates, and observation
when present. It returns JSON `null` when no cycle or sign-up exists.

`POST /api/signups` remains a protected scaffold and returns
`501 NOT_IMPLEMENTED` for valid requests. Sign-ups require a `sectionId` and
at least one real `YYYY-MM-DD` proposed date; invalid input returns 400 after
authentication. This scaffold writes no sign-up data.

Technical debt: add a department short code and section enrollment if the UI
needs them. Expand the frontend meeting-day type if weekend sections are used.
Implement sign-up writes in a separate PR. Future term rows are still needed
before scheduling evaluation cycles in those semesters.

## PostgreSQL connectivity

The backend uses the pg driver and one lazily created shared pool in
`src/db/pool.ts`, following the node-postgres pooling guidance:
https://node-postgres.com/features/pooling

Set DATABASE_URL in your local .env to the development connection URL provided
by the database team, then run `npm run db:check`. For example, the format is
`postgresql://USER:PASSWORD@HOST:5432/DATABASE` (placeholders only).
Keep real credentials in .env; that file is ignored by Git.
Use the database provider's required TLS settings in the connection URL.
The backend loads `backend/.env` regardless of the directory from which the
server or connection check is launched. Environment variables already set in
the shell take precedence over `.env`.

The check runs SELECT 1 and closes the pool. It does not create a database,
inspect tables, or apply migrations. Failures exit with a nonzero status and a
generic message without printing the URL or raw database error.
The HTTP server and /api/health still run without DATABASE_URL.

Services can import getPool() for database access. Use a checked-out
client for transactions and always release it in finally. Call closePool()
when shutting down a process that uses the pool. This PR does not change the
schema or seed the shared database.
