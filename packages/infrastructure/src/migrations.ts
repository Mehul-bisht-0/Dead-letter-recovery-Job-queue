import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { transaction } from './database';
import { preflight } from './preflight';
const directory = join(__dirname, 'migrations');
function migrations() {
  return readdirSync(directory)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(directory, name), 'utf8').replace(/\r\n/g, '\n');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}
export async function migrate(pool: Pool): Promise<void> {
  await preflight(pool);
  await transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('reliable-queue:v2:migrations'))");
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,checksum CHAR(64) NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp())',
    );
    for (const migration of migrations()) {
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name=$1',
        [migration.name],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== migration.checksum)
          throw new Error(`Migration checksum mismatch: ${migration.name}`);
        continue;
      }
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
        migration.name,
        migration.checksum,
      ]);
    }
  });
}
export async function checkSchema(pool: Pool): Promise<void> {
  const result = await pool.query<{ name: string; checksum: string }>(
    'SELECT name,checksum FROM schema_migrations ORDER BY name',
  );
  const expected = migrations();
  if (
    result.rows.length !== expected.length ||
    expected.some(
      (m, i) => result.rows[i]?.name !== m.name || result.rows[i]?.checksum !== m.checksum,
    )
  ) {
    throw new Error(
      'Database schema is incompatible; run npm run migrate before starting services',
    );
  }
}
