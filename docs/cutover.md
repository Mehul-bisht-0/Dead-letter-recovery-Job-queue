# V1 to V2 maintenance cutover

V1 and V2 workers must never overlap. These instructions intentionally allow a maintenance window.

1. Pause producers at the gateway or stop the API. Stop every V1 worker and reaper, allowing existing work to drain when possible. Confirm no old process is running.
2. Take a PostgreSQL backup and record the V1 application revision, database credentials, job counts by status, and active dead letters. Test the restore procedure against a separate database before the maintenance window.
3. Install Node 24, run `npm ci`, and build V2. Use the same PostgreSQL database. Run `npm run admin -- preflight`. Invalid legacy jobs fail preflight and require an explicit repair; the migrator never silently deletes them. Remaining processing jobs recover through their expired leases.
4. Run `npm run migrate`. Migrations are ordered, transactionally applied, protected by a database advisory lock, and checksummed. Services only verify the ledger; they never execute DDL at startup.
5. Configure the administrator hash and issue producer/administrator keys through the CLI. Update paused clients to send bearer credentials. Existing routes and success responses remain compatible; authentication and invalid-input rejection are intentional new requirements.
6. Run `npm run admin -- reconcile` to populate the dedicated `rq:v2:` namespace from pending jobs. It does not modify V1 Redis keys. Start the dispatcher, workers with registered handlers, API, and dashboard.
7. Check readiness, log into the dashboard, submit one job with an idempotency key, verify completion and deduplication, and replay a disposable dead letter. Check `/diagnostics` with an administrator key and verify dispatch lag falls to zero.
8. Compare durable job counts and identifiers with the backup inventory. Historical DLQ rows remain in PostgreSQL; active listings omit archived or replayed rows. Resume producers after verification passes.

Before V2 accepts writes, rollback may stop V2, restore the backup into the original database, deploy the saved V1 revision, rebuild V1's pending Redis entries, and resume V1. After V2 accepts writes, use a forward repair: restoring an old backup would lose accepted jobs. Retain the backup and historical records until the migration is accepted.

## Recovery drills

- Redis outage: enqueue remains durable; stop Redis, enqueue a job, restore Redis, and verify the dispatcher eventually executes it.
- Redis data loss: remove only this application's scheduling namespace, run reconciliation, and confirm pending jobs reappear. Never use `FLUSHALL` against a shared service.
- Worker termination: terminate a worker during a disposable handler, wait for lease expiry plus recovery/retry delay, and verify attempts and ownership change.
- Dispatcher termination after publication: restart it and confirm repeated publication does not create a second execution lease.
- Database outage: readiness fails, claims and transitions stop, and existing handlers are cancelled if lease renewal fails. Restore PostgreSQL and verify recovery.

## Explicit retention

`npm run admin -- retention DAYS` requires an age of at least two days. It removes expired sessions and old terminal completed/failed jobs with their attempts, published outbox entries, and inactive dead letters. Active dead letters and audit records are retained. No scheduled deletion is enabled. Back up records before invoking retention and set an age appropriate for your operational/audit needs.
