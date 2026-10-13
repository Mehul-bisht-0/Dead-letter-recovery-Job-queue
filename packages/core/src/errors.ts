export class QueueError extends Error {
  constructor(
    readonly code:
      'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'LEASE_LOST' | 'UNAUTHORIZED' | 'FORBIDDEN',
    message: string,
  ) {
    super(message);
    this.name = 'QueueError';
  }
}
export function failureDisposition(attempts: number, maxAttempts: number): 'retry' | 'dead' {
  return attempts < maxAttempts ? 'retry' : 'dead';
}
