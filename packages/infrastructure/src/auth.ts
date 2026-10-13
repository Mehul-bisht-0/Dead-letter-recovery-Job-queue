import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { QueueError } from '@reliable-queue/core';
import { transaction } from './database';
export interface Principal {
  id: string;
  role: 'producer' | 'administrator';
  queues: string[];
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function hashPassword(password: string): string {
  if (password.length < 12 || password.length > 1024)
    throw new Error('Administrator password must contain 12–1024 characters');
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, encoded: string): boolean {
  if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded) || password.length > 1024) return false;
  const [, salt, hash] = encoded.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, 'hex'));
}
export function allowQueue(principal: Principal, queue: string): void {
  if (principal.role !== 'administrator' && !principal.queues.includes(queue))
    throw new QueueError('FORBIDDEN', 'Queue access denied');
}
export function requireAdministrator(principal: Principal): void {
  if (principal.role !== 'administrator')
    throw new QueueError('FORBIDDEN', 'Administrator access required');
}
export class AuthStore {
  constructor(private readonly pool: Pool) {}
  async authenticate(header: string | undefined): Promise<Principal> {
    if (!header || !/^Bearer [a-f0-9]{64}$/.test(header))
      throw new QueueError('UNAUTHORIZED', 'Valid bearer API key required');
    const result = await this.pool.query<Principal>(
      `SELECT id,role,queues FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL`,
      [digest(header.slice(7))],
    );
    if (!result.rows[0]) throw new QueueError('UNAUTHORIZED', 'Invalid or revoked API key');
    return result.rows[0];
  }
  async provision(name: string, role: Principal['role'], queues: string[], revokeId?: string) {
    if (
      !name ||
      !['producer', 'administrator'].includes(role) ||
      (role === 'producer' && !queues.length)
    )
      throw new Error('Name, role and producer queue allowlist required');
    const token = randomBytes(32).toString('hex');
    const id = await transaction(this.pool, async (client) => {
      if (revokeId) {
        const revoked = await client.query(
          'UPDATE api_keys SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL',
          [revokeId],
        );
        if (revoked.rowCount !== 1) throw new QueueError('NOT_FOUND', 'Active API key not found');
      }
      const inserted = await client.query<{ id: string }>(
        'INSERT INTO api_keys(name,key_hash,role,queues) VALUES($1,$2,$3,$4) RETURNING id',
        [name, digest(token), role, queues],
      );
      await client.query(
        `INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES($1,'api_key',$2,$3)`,
        [
          revokeId ? 'key_rotated' : 'key_provisioned',
          inserted.rows[0].id,
          JSON.stringify({ name, role, queues, revokedId: revokeId }),
        ],
      );
      return inserted.rows[0].id;
    });
    return { id, token };
  }
  async revoke(id: string) {
    await transaction(this.pool, async (client) => {
      const result = await client.query(
        'UPDATE api_keys SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL',
        [id],
      );
      if (result.rowCount !== 1) throw new QueueError('NOT_FOUND', 'Active API key not found');
      await client.query(
        "INSERT INTO audit_log(action,entity_type,entity_id) VALUES('key_revoked','api_key',$1)",
        [id],
      );
    });
  }
  async createSession() {
    const token = randomBytes(32).toString('hex'),
      csrf = randomBytes(32).toString('hex');
    await this.pool.query(
      `INSERT INTO admin_sessions(token_hash,csrf_hash,expires_at)
      VALUES($1,$2,clock_timestamp()+INTERVAL '8 hours')`,
      [digest(token), digest(csrf)],
    );
    return { token, csrf };
  }
  async session(token: string | undefined, csrf?: string): Promise<boolean> {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
    const result = await this.pool.query<{ csrf_hash: string }>(
      'SELECT csrf_hash FROM admin_sessions WHERE token_hash=$1 AND expires_at>clock_timestamp()',
      [digest(token)],
    );
    if (!result.rows[0]) return false;
    return (
      csrf === undefined ||
      (/^[a-f0-9]{64}$/.test(csrf) &&
        timingSafeEqual(
          Buffer.from(digest(csrf), 'hex'),
          Buffer.from(result.rows[0].csrf_hash, 'hex'),
        ))
    );
  }
  async deleteSession(token: string | undefined) {
    if (token)
      await this.pool.query('DELETE FROM admin_sessions WHERE token_hash=$1', [digest(token)]);
  }
}
