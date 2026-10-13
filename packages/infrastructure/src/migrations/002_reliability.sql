ALTER TABLE jobs ADD COLUMN scheduling_generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE jobs ADD COLUMN execution_cycle INTEGER NOT NULL DEFAULT 1;
ALTER TABLE jobs ADD COLUMN lease_token UUID;
ALTER TABLE jobs ADD COLUMN history_complete BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE jobs ALTER COLUMN history_complete SET DEFAULT TRUE;
ALTER TABLE jobs ADD CONSTRAINT jobs_attempts_valid CHECK (attempts >= 0 AND max_attempts > 0);
ALTER TABLE jobs ADD CONSTRAINT jobs_payload_object CHECK (jsonb_typeof(payload) = 'object');
ALTER TABLE jobs ADD CONSTRAINT jobs_generations_valid CHECK (scheduling_generation > 0 AND execution_cycle > 0);
ALTER TABLE jobs ADD CONSTRAINT jobs_lease_consistent CHECK (
  (status='processing' AND locked_by IS NOT NULL AND locked_until IS NOT NULL AND (NOT history_complete OR lease_token IS NOT NULL))
  OR (status<>'processing' AND locked_by IS NULL AND locked_until IS NULL AND lease_token IS NULL)
);

CREATE TABLE job_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  execution_cycle INTEGER NOT NULL,
  attempt INTEGER NOT NULL,
  lease_token UUID,
  worker_id VARCHAR(255),
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ,
  outcome TEXT CHECK (outcome IN ('completed','failed','lease_expired','legacy_unknown')),
  error TEXT,
  history_complete BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(job_id,execution_cycle,attempt)
);
-- Preserve the known V1 attempt, without inventing missing history.
INSERT INTO job_attempts(job_id,execution_cycle,attempt,worker_id,started_at,finished_at,outcome,error,history_complete)
SELECT id,1,attempts,locked_by,updated_at,
  CASE WHEN status='processing' THEN NULL ELSE updated_at END,
  CASE WHEN status='processing' THEN NULL ELSE 'legacy_unknown' END,error,FALSE
FROM jobs WHERE attempts > 0;

ALTER TABLE dead_letters ADD COLUMN execution_cycle INTEGER NOT NULL DEFAULT 1;
ALTER TABLE dead_letters ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE dead_letters ADD COLUMN replayed_at TIMESTAMPTZ;
-- Archive duplicate legacy rows; retain every historical record.
WITH ranked AS (
 SELECT id,row_number() OVER(PARTITION BY original_job_id ORDER BY moved_at DESC,id DESC) AS n
 FROM dead_letters
) UPDATE dead_letters SET active=FALSE WHERE id IN (SELECT id FROM ranked WHERE n>1);
UPDATE dead_letters d SET active=FALSE FROM jobs j WHERE j.id=d.original_job_id AND j.status<>'dead';
CREATE UNIQUE INDEX dlq_active_cycle ON dead_letters(original_job_id,execution_cycle) WHERE active;
CREATE INDEX dlq_active_list ON dead_letters(moved_at DESC,id) WHERE active;
CREATE INDEX attempts_outcomes ON job_attempts(finished_at,outcome);
CREATE INDEX jobs_pending_dispatch ON jobs(id) WHERE status='pending';

CREATE TABLE dispatch_outbox (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id UUID NOT NULL REFERENCES jobs(id),
 queue_name VARCHAR(255) NOT NULL,
 generation INTEGER NOT NULL,
 priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 10),
 available_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 published_at TIMESTAMPTZ,
 retry_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 reserved_until TIMESTAMPTZ,
 reservation_token UUID,
 publish_attempts INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,
 UNIQUE(job_id,generation)
);
CREATE INDEX outbox_dispatch ON dispatch_outbox(retry_at,created_at) WHERE published_at IS NULL;
INSERT INTO dispatch_outbox(job_id,queue_name,generation,priority,available_at)
SELECT id,queue_name,scheduling_generation,priority,available_at FROM jobs WHERE status='pending';

CREATE TABLE api_keys (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name TEXT NOT NULL,
 key_hash CHAR(64) NOT NULL UNIQUE,
 role TEXT NOT NULL CHECK(role IN ('producer','administrator')),
 queues TEXT[] NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 revoked_at TIMESTAMPTZ
);
CREATE TABLE admin_sessions (
 token_hash CHAR(64) PRIMARY KEY,
 csrf_hash CHAR(64) NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sessions_expiry ON admin_sessions(expires_at);
