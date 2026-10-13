-- ---------------------------------------------------------------------------
-- PostgreSQL schema for the reliable-queue system
-- Legacy baseline, applied only by the explicit V2 migration command.
-- ---------------------------------------------------------------------------

-- Jobs table — source of truth for every job in the system
CREATE TABLE IF NOT EXISTS jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_name      VARCHAR(255) NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}',
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead')),
    priority        INTEGER NOT NULL DEFAULT 5
                        CHECK (priority BETWEEN 1 AND 10),
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    available_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_by       VARCHAR(255),
    locked_until    TIMESTAMPTZ,
    idempotency_key VARCHAR(255),
    result          JSONB,
    error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status        ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_queue_status   ON jobs (queue_name, status);
CREATE INDEX IF NOT EXISTS idx_jobs_available      ON jobs (available_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_jobs_locked         ON jobs (locked_until) WHERE status = 'processing';

-- Supporting index for 24-hour idempotency lookups.
-- Older migrations created this as UNIQUE, which made idempotency permanent
-- despite the application enforcing a 24-hour dedupe window.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_index i ON i.indexrelid = c.oid
        WHERE c.relname = 'idx_jobs_idempotency'
          AND c.relnamespace = current_schema()::regnamespace
          AND i.indisunique
    ) THEN
        DROP INDEX idx_jobs_idempotency;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_idempotency
    ON jobs (queue_name, idempotency_key, created_at DESC)
    WHERE idempotency_key IS NOT NULL;

-- Dead letter table — jobs that exhausted all retry attempts
CREATE TABLE IF NOT EXISTS dead_letters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_job_id UUID NOT NULL REFERENCES jobs(id),
    queue_name      VARCHAR(255) NOT NULL,
    payload         JSONB NOT NULL,
    failure_reason  TEXT,
    failure_history JSONB NOT NULL DEFAULT '[]',
    moved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dlq_queue ON dead_letters (queue_name);
CREATE INDEX IF NOT EXISTS idx_dlq_moved ON dead_letters (moved_at DESC);

-- Worker heartbeats — dashboard uses this to show live / stale workers
CREATE TABLE IF NOT EXISTS worker_heartbeats (
    worker_id      VARCHAR(255) PRIMARY KEY,
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    jobs_in_flight INTEGER NOT NULL DEFAULT 0
);

-- Audit log — tracks replays, state transitions, and admin actions
CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id   VARCHAR(255),
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
