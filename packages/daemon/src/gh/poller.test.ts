import { afterEach, describe, expect, it, vi } from "vitest";
import { Poller } from "./poller.js";

afterEach(() => vi.useRealTimers());

describe("Poller", () => {
  it("runs on start and again after each interval", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => {});
    const p = new Poller(task, 1000);
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    p.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("joins a run in flight instead of overlapping", async () => {
    let release!: () => void;
    const task = vi.fn(() => new Promise<void>((r) => (release = r)));
    const p = new Poller(task, 1000);
    const first = p.runNow();
    const second = p.runNow();
    expect(second).toBe(first);
    release();
    await first;
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("keeps polling after a failing run", async () => {
    vi.useFakeTimers();
    const task = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(undefined);
    const p = new Poller(task, 1000);
    p.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    p.stop();
  });
});
