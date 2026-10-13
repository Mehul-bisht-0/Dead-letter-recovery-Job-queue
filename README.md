# Reliable Queue V2

A private, distributed TypeScript job queue. PostgreSQL owns durable jobs, attempts, leases, audit history, authentication, and dispatch outbox records. Redis holds rebuildable scheduling hints. Workers execute I/O handlers with renewable leases and cooperative cancellation.

V2 evolves the existing codebase and retains `/jobs`, `/dlq`, dashboard endpoints, success response shapes, and the queue-scoped 24-hour idempotency window. Authentication and strict invalid-input rejection are intentional requirements. Execution is **at least once**: handlers must deduplicate external side effects.

Read the [architecture and decisions](docs/architecture.md) and [maintenance cutover runbook](docs/cutover.md) before upgrading an existing installation.

## Requirements and setup

Use Node.js 24 LTS, npm, and PostgreSQL 15 plus Redis 7 (or Docker Desktop). Node 20 is no longer the production runtime. Do not run V1 and V2 workers together.

```powershell
npm ci
npm run build
Copy-Item .env.example .env
```

Generate an administrator password hash from standard input, so the password does not become a command argument:

```powershell
$adminSecret = Read-Host 'Dashboard password (at least 12 characters)' -AsSecureString
$adminPlain = [System.Net.NetworkCredential]::new('', $adminSecret).Password
$adminPlain | npm run --silent admin -- hash-password
$adminPlain = $null
```

Copy the returned hash into `ADMIN_PASSWORD_HASH` in `.env`. Keep `.env` out of Git. Local commands read the root `.env`; existing process environment variables take precedence. Docker Compose also reads `.env`.

## Run with Docker

```powershell
docker compose up --build
```

The one-shot migration service completes before application services start. The default Compose file is a local demo and binds exposed ports to loopback. It enables the simulated worker handler explicitly. Visit [API health](http://localhost:3000/health) and [dashboard](http://localhost:3001), then sign in with `ADMIN_USER` and the password used to generate its hash.

Issue a producer key; its token is printed once:

```powershell
docker compose exec api node packages/infrastructure/dist/cli.js provision-key local-producer producer default
```

Set the returned token as `API_KEY` in `.env`. Seed through the authenticated HTTP API with `npm run seed` from the host. To run an end-to-end benchmark, provision an administrator key, set it as `API_KEY`, and run `npm run loadtest`. The benchmark requires a running dispatcher and worker for `QUEUE_NAME` and reports enqueue percentiles, dispatch lag, completed jobs, retries, and unreconciled jobs. It exits unsuccessfully on failure or timeout.

Scale workers with `docker compose up --scale worker=2`. Stop the local stack with `docker compose down`; the PostgreSQL volume is preserved.

## Run services locally

```powershell
docker compose up -d postgres redis
npm run migrate
npm run admin -- provision-key local-producer producer default
```

Run each process in a separate terminal:

```powershell
npm run dev:api
npm run dev:dispatcher
npm run dev:worker
npm run dev:dashboard
```

API defaults to port 3000, dashboard 3001, worker monitor 3002, dispatcher monitor 3003. `HOST` defaults to loopback. The `.env.example` enables demo handlers. Production workers require a compiled module exporting `handlers`; see the handler contract in the architecture guide.

## HTTP API

Supply `Authorization: Bearer <API_KEY>` for application endpoints. Producer keys may enqueue and inspect only allowed queues. Administrator keys may inspect all queues, list/replay dead letters, and access `/metrics` and `/diagnostics`.

```http
POST /jobs
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "queue_name": "default",
  "payload": { "type": "email", "to": "user@example.com" },
  "priority": 10,
  "idempotency_key": "unique-request-id-123"
}
```

New jobs return `{ "job": {...}, "created": true }` with HTTP 201. Reusing the queue/key within 24 hours returns the original job with HTTP 200 and `created=false`, even if the new payload differs. Redis unavailability does not undo durable acceptance.

- `GET /jobs/:id`: `{ job }`.
- `GET /jobs?queue_name=default&status=pending&limit=50&offset=0`: `{ jobs, total }`.
- `GET /dlq`: active entries as `{ items, total }`.
- `POST /dlq/:id/replay`: `{ message: "Job replayed successfully", job }`.
- `GET /openapi.json`: generated API specification, authenticated.
- `GET /diagnostics`: authoritative counts, dispatch lag, and worker status, administrator only.
- `GET /metrics`: Prometheus output, administrator only.

Priority must be 1–10, attempts 1–100, delay 0–30 days, payload an object, and page size 1–100. HTTP bodies are capped at 1 MiB. Errors retain `error` and include `code` and `request_id`; malformed requests return 400, invalid credentials 401, denied access 403, missing entities 404, conflicts 409, rate limits 429, and dependency failures 503.

Dashboard routes keep their `/api/metrics`, `/api/metrics/stream`, `/api/dlq`, and replay URLs. They require administrator sessions rather than bearer tokens. Login is `POST /api/auth/login`; logout and replay require `X-CSRF-Token` matching the `rq_csrf` cookie. Live streams are closed on disconnect, expiry, backpressure, or server shutdown.

## Operations and configuration

`/health` remains available. `/health/live` reports process liveness; `/health/ready` reports dependency availability without exposing secrets. API/dashboard readiness requires PostgreSQL, while worker/dispatcher readiness requires PostgreSQL and Redis. Dispatcher degradation and backlog are visible in protected diagnostics and Prometheus. Alert rules are provided in `ops/alerts.yml`.

Important defaults:

| Setting                                                 | Default         |
| ------------------------------------------------------- | --------------- |
| `WORKER_CONCURRENCY`                                    | 5               |
| `VISIBILITY_TIMEOUT_MS` / `LEASE_RENEWAL_MS`            | 30000 / 10000   |
| `JOB_DEADLINE_MS` / `CANCELLATION_GRACE_MS`             | 300000 / 5000   |
| `DRAIN_TIMEOUT_MS`                                      | 30000           |
| `BACKOFF_BASE_MS` / `BACKOFF_CAP_MS`                    | 1000 / 60000    |
| `DISPATCHER_INTERVAL_MS` / `RECONCILIATION_INTERVAL_MS` | 500 / 15000     |
| `BATCH_SIZE`                                            | 100             |
| `DATABASE_TIMEOUT_MS` / `REDIS_TIMEOUT_MS`              | 5000 / 2000     |
| `CORS_ORIGINS`                                          | empty allowlist |
| `TRUST_PROXY`                                           | false           |

Malformed numeric settings, unsafe renewal intervals, and missing production credentials fail startup. Production requires explicit storage URLs, non-demo database credentials, and a valid administrator hash. Configure HTTPS at the reverse proxy, keep storage private, and enable trusted proxy handling only behind a trusted gateway.

For production, supply your compiled handler module in the image or mounted directory and use:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml up --build
```

The production override uses external storage URLs, secure session cookies, registered handlers, and restart policies. The image runs compiled JavaScript as a non-root user with production dependencies. The base PostgreSQL/Redis containers are local helpers; external production storage remains the source of truth.

Management commands:

```powershell
npm run admin -- preflight
npm run migrate
npm run admin -- reconcile
npm run admin -- provision-key NAME producer queue-one,queue-two
npm run admin -- provision-key NAME administrator
npm run admin -- rotate-key NAME producer default OLD_KEY_ID
npm run admin -- revoke-key KEY_ID
npm run admin -- retention 30
```

Rotation provisions a new key and revokes the old key in one transaction. No automatic retention runs. Explicit retention keeps active dead letters and audit records; see the runbook before deleting terminal history.

## Verification

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test:unit
docker compose up -d postgres redis
npm run test:integration
```

Unit verification includes PostgreSQL persistence scenarios against an embedded PostgreSQL engine, HTTP compatibility, authentication/CSRF, safe dashboard rendering, worker draining, cancellation, retry rules, and dispatcher recovery. The network integration suite uses isolated PostgreSQL schemas, real concurrent connections, and Redis Lua; set `DATABASE_URL`/`REDIS_URL` when using non-default test services. It fails when those services are missing. It never clears shared Redis globally or deletes existing jobs.

CI runs formatting, lint, architecture boundaries, source and test type checks, build, unit tests, required PostgreSQL/Redis integration tests, dependency audit, and an API image build on Node 24. Dependencies, output JavaScript, and caches are ignored and are no longer tracked in Git. The existing study-guide PDF remains preserved as legacy V1 documentation; the architecture guide describes V2.
