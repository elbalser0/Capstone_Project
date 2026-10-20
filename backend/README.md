# Assessment Helper backend

Initial Express/TypeScript foundation. Run commands from this directory.

## Setup

Install Node.js and npm (verified locally with Node 20.14.0), then:

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

Application queries and endpoints await the actual schema,
Firebase authentication interface, and frontend contracts. Future authenticated
routes must verify identity and enforce AC authorization in the backend.
No authentication bypasses or protected application routes are included.
React will call this API rather than PostgreSQL. Configure a frontend development
proxy or agreed CORS origin when the frontend connects.

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

Future repositories can import getPool() for database access. Use a checked-out
client for transactions and always release it in finally. Call closePool()
when shutting down a process that uses the pool. No application database
queries or schema changes are included yet.
