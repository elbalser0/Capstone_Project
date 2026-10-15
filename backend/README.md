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

PostgreSQL integration and application endpoints await the actual schema,
Firebase authentication interface, and frontend contracts. Future authenticated
routes must verify identity and enforce AC authorization in the backend.
No authentication bypasses or protected application routes are included.
React will call this API rather than PostgreSQL. Configure a frontend development
proxy or agreed CORS origin when the frontend connects.
