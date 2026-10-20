# Assessment Helper backend

Initial Express/TypeScript foundation. Run commands from this directory.

## Setup

Install Node.js 22 or later and npm (required by Firebase Admin v14), then:

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
- `npm test`: check login protection and course response mapping.
- `npm run build`: compile to dist/.
- `npm start`: run compiled server after building.

## Integration

app.ts registers JSON middleware, routes, a 404 fallback, and error handling.
server.ts loads environment variables, validates PORT, and starts the listener.
Register future routers before the fallback. Add controllers, services, and
repositories when needed; keep SQL out of routes.

Errors use `{"error":{"code":"...","message":"..."}}`. Unknown routes return
404, malformed JSON returns 400, oversized bodies return 413, and unexpected
failures return a generic 500. ApiError supports explicit application errors.

The app verifies Firebase ID tokens and looks up active professors in PostgreSQL
by their verified email. Assessment Committee access comes from `ac_member`.
Set `GOOGLE_APPLICATION_CREDENTIALS` to a local service-account JSON file before
testing authenticated requests. Send `Authorization: Bearer <Firebase ID token>`.
The live development schema exists but currently has no application rows, so
professors and course sections must be imported before these routes return data.
React will call this API rather than PostgreSQL. Configure a frontend development
proxy or agreed CORS origin when the frontend connects.

## Faculty endpoints

`GET /api/me` returns the signed-in professor's identity, department, rank, and
role from PostgreSQL. `GET /api/me/courses?termId=...` returns that professor's
sections and meeting times for a positive integer term ID. It returns `[]` when
there are no sections. The current schema does not have a department short code
or section enrollment; course labels use the department name and `enrollment`
is `null` until those fields are added.

`GET /api/me/evaluation-status` and `POST /api/signups` remain protected
scaffolds and return `501 NOT_IMPLEMENTED` for valid requests. Sign-ups require
a `sectionId` and at least one real `YYYY-MM-DD` date. Invalid inputs return 400
after authentication. No sign-up is written by this scaffold.

Technical debt: seed/import professors, terms, courses, and sections; configure
Firebase credentials and verify an authenticated end-to-end request; implement
evaluation status from cycle/due data and the sign-up transaction from the
frontend contract in `App/frontend/src/api/types.ts`. Add the department short
code and enrollment columns if the UI needs those fields. An authenticated
Firebase end-to-end test still requires a service-account key and verified ID token.

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

Repositories import getPool() for database access. Use a checked-out client for
transactions and always release it in finally. Call closePool() when shutting
down a process that uses the pool. This PR does not change the schema or seed
the shared database.
