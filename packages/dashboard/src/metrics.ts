import type { MetricsSnapshot, Logger } from '@reliable-queue/core';
import { repeat } from '@reliable-queue/infrastructure';
export class MetricsSampler {
  private readonly listeners = new Set<(snapshot: MetricsSnapshot) => void>();
  private readonly controller = new AbortController();
  private running: Promise<void> | null = null;
  latest: MetricsSnapshot | null = null;
  constructor(
    private readonly gather: () => Promise<MetricsSnapshot>,
    private readonly logger: Logger,
  ) {}
  start() {
    if (this.running) return;
    this.running = repeat(
      2000,
      async () => {
        this.latest = await this.gather();
        for (const listener of this.listeners) listener(this.latest);
      },
      this.controller.signal,
      this.logger,
    );
  }
  subscribe(listener: (snapshot: MetricsSnapshot) => void) {
    this.listeners.add(listener);
    if (this.latest) listener(this.latest);
    return () => this.listeners.delete(listener);
  }
  async stop() {
    this.controller.abort();
    await this.running;
    this.listeners.clear();
  }
}
