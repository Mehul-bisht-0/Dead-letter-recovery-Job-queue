import type { Pool } from 'pg';
/** Read-only validation before a maintenance migration. No repair or data deletion. */
export async function preflight(pool: Pool) {
  const exists = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass('jobs') IS NOT NULL AS exists",
  );
  if (!exists.rows[0].exists) return { fresh: true, jobs: 0 };
  const counts = await pool.query<{
    jobs: number;
    invalid: number;
    processing: number;
  }>(`SELECT count(*)::int AS jobs,
    count(*) FILTER(WHERE max_attempts<1 OR attempts<0 OR jsonb_typeof(payload)<>'object' OR priority NOT BETWEEN 1 AND 10
      OR NOT isfinite(created_at) OR NOT isfinite(updated_at) OR NOT isfinite(available_at)
      OR (status='processing' AND (locked_until IS NULL OR locked_by IS NULL OR NOT isfinite(locked_until)))
      OR (status<>'processing' AND (locked_until IS NOT NULL OR locked_by IS NOT NULL)))::int AS invalid,
    count(*) FILTER(WHERE status='processing')::int AS processing FROM jobs`);
  if (counts.rows[0].invalid)
    throw new Error(
      `Migration preflight found ${counts.rows[0].invalid} invalid legacy jobs; repair explicitly before migration`,
    );
  return { fresh: false, ...counts.rows[0] };
}
