export declare class Semaphore {
    private readonly max;
    private current;
    private waiting;
    constructor(max: number);
    /** Number of currently acquired slots */
    get active(): number;
    /** Number of requests waiting for a slot */
    get pending(): number;
    /**
     * Acquire a slot. Resolves immediately if a slot is available,
     * otherwise waits until one is released.
     */
    acquire(): Promise<void>;
    /**
     * Release a slot. If any callers are waiting, the next one
     * is resolved immediately (FIFO order).
     */
    release(): void;
}
