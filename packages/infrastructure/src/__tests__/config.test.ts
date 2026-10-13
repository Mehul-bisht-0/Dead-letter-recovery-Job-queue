import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config';
import { hashPassword, verifyPassword, allowQueue } from '../auth';
describe('Configuration and credentials', () => {
  it('rejects partial numbers and unsafe lease intervals', () => {
    expect(() => loadConfig({}, { WORKER_CONCURRENCY: '2oops' })).toThrow();
    expect(() => loadConfig({ leaseRenewalMs: 20000 }, {})).toThrow();
    expect(() => loadConfig({}, { NODE_ENV: 'production' })).toThrow();
    expect(() => loadConfig({}, { NODE_ENV: 'prod' })).toThrow();
    expect(() => loadConfig({}, { CORS_ORIGINS: '*' })).toThrow();
    expect(() => loadConfig({ queueName: '' }, {})).toThrow();
  });
  it('has explicit defaults and immutable configuration', () => {
    const config = loadConfig({}, {});
    expect(config.workerConcurrency).toBe(5);
    expect(Object.isFrozen(config)).toBe(true);
  });
  it('hashes and verifies passwords without storing plaintext', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
  });
  it('enforces queue allowlists', () => {
    expect(() => allowQueue({ id: 'a', role: 'producer', queues: ['a'] }, 'b')).toThrow();
  });
});
