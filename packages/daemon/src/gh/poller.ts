/**
 * Runs `task` now and then every `intervalMs`, one at a time. A run requested while one is in
 * flight joins that run instead of starting a second one.
 */
export class Poller {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private stopped = true;

  constructor(
    private readonly task: () => Promise<void>,
    private intervalMs: number,
  ) {}

  start(): void {
    this.stopped = false;
    void this.runNow();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  setInterval(ms: number): void {
    this.intervalMs = ms;
    if (!this.stopped && !this.inFlight) this.schedule();
  }

  runNow(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.inFlight = this.task()
      .catch(() => {})
      .finally(() => {
        this.inFlight = undefined;
        if (!this.stopped) this.schedule();
      });
    return this.inFlight;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.runNow(), this.intervalMs);
    this.timer.unref();
  }
}
