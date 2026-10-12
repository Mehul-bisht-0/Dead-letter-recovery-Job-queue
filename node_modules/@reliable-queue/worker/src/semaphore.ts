// ---------------------------------------------------------------------------
// Counting semaphore — limits in-process job concurrency
// ---------------------------------------------------------------------------
//
// When concurrency=5, only 5 jobs can be executing their handler at once.
// Additional claims wait until a slot opens. This prevents a single worker
// from overwhelming downstream services.
// ---------------------------------------------------------------------------

export class Semaphore {
  private current = 0;
  private waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  /** Number of currently acquired slots */
  get active(): number {
    return this.current;
  }

  /** Number of requests waiting for a slot */
  get pending(): number {
    return this.waiting.length;
  }

  /**
   * Acquire a slot. Resolves immediately if a slot is available,
   * otherwise waits until one is released.
   */
  acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  /**
   * Release a slot. If any callers are waiting, the next one
   * is resolved immediately (FIFO order).
   */
  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      // Don't decrement — we're handing the slot directly to the waiter
      next();
    } else {
      this.current--;
    }
  }
}
