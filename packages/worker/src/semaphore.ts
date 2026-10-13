export class Semaphore {
  private current = 0;
  constructor(readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new RangeError('Positive concurrency required');
  }
  get active() {
    return this.current;
  }
  tryAcquire(): (() => void) | null {
    if (this.current >= this.max) return null;
    this.current++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.current--;
    };
  }
}
