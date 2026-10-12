# Reliable Queue

A distributed job queue using Redis for fast queue operations and PostgreSQL for durable job state, audit data, worker heartbeats, and dead-letter records.

## Architecture

```text
Client / load test
       |
       v
 Fastify API (:3000) ---> PostgreSQL
       |                  - jobs
       v                  - dead_letters
 Redis 7                  - worker_heartbeats
       |                  - audit_log
       v
 Worker processes

 Dashboard (:3001) reads metrics, worker status, and DLQ state.
```

## Features

- Atomic Redis Lua job claims so one job is processed by one worker.
- PostgreSQL-backed idempotency keys for 24-hour enqueue deduplication.
- Retry handling with exponential backoff and jitter.
- Dead-letter queue with API and dashboard replay support.
- Reaper leadership lock to recover stale in-flight jobs.
- Worker heartbeats and dashboard metrics.

## Run With Docker

This is the easiest way to run the full stack.

```bash
docker compose up --build
```

Then open:

- API health: [http://localhost:3000/health](http://localhost:3000/health)
- Dashboard: [http://localhost:3001](http://localhost:3001)

Seed sample jobs from another terminal:

```bash
docker compose exec api npx tsx packages/loadtest/src/seed.ts
```

Stop the stack:

```bash
docker compose down
```

## Local Development

Start only the backing services:

```bash
docker compose up -d postgres redis
```

Install dependencies and build workspace packages:

```bash
npm install
npm run build
```

Run the services in separate terminals:

```bash
npm run dev:api
npm run dev:worker
npm run dev:dashboard
```

Useful local commands:

```bash
npm run typecheck
npm test
npm run seed
npm run loadtest
```

Database-backed integration tests are skipped by default. To run them, start
Postgres and Redis first, then set `RUN_INTEGRATION_TESTS=1`:

```powershell
docker compose up -d postgres redis
$env:RUN_INTEGRATION_TESTS = "1"; npm test
```

Default local connection strings are:

- PostgreSQL: `postgresql://rq_user:rq_password@localhost:5432/reliable_queue`
- Redis: `redis://localhost:6380`

## API Reference

Enqueue a job:

```http
POST /jobs
Content-Type: application/json

{
  "queue_name": "default",
  "payload": { "type": "email", "to": "user@example.com" },
  "priority": 10,
  "idempotency_key": "unique-request-id-123"
}
```

Replay from the dead-letter queue:

```http
POST /dlq/:id/replay
```
