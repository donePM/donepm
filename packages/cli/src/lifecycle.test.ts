import { describe, expect, it } from "vitest";
import { fakeDeps, RUNNING } from "./fake-deps.js";
import { open, status, stop } from "./lifecycle.js";

describe("status", () => {
  it("reports a running daemon and its CLI checks", async () => {
    const t = fakeDeps([RUNNING]);
    expect(await status(t.deps)).toBe(0);
    expect(t.out).toEqual([
      "donePM 0.0.0 is running at http://127.0.0.1:6174 (pid 4242).",
      "Agents running: 1",
      "gh: ready (octo)",
      "claude: not logged in",
    ]);
  });

  it("exits 1 when nothing answers", async () => {
    const t = fakeDeps([undefined]);
    expect(await status(t.deps)).toBe(1);
    expect(t.out[0]).toContain("not running");
  });
});

describe("stop", () => {
  it("sends SIGTERM to the daemon's pid and waits until it is gone", async () => {
    const t = fakeDeps([RUNNING, RUNNING, RUNNING, undefined]);
    expect(await stop(t.deps)).toBe(0);
    expect(t.kills).toEqual([[4242, "SIGTERM"]]);
    expect(t.out).toEqual(["donePM stopped."]);
  });

  it("does nothing when the daemon is not running", async () => {
    const t = fakeDeps([undefined]);
    expect(await stop(t.deps)).toBe(0);
    expect(t.kills).toEqual([]);
  });

  it("fails when the daemon keeps answering", async () => {
    const t = fakeDeps([RUNNING]);
    expect(await stop(t.deps)).toBe(1);
    expect(t.err[0]).toContain("did not stop");
  });
});

describe("open", () => {
  it("opens the board URL", async () => {
    const t = fakeDeps([RUNNING]);
    expect(await open(t.deps)).toBe(0);
    expect(t.execs).toEqual(["open http://127.0.0.1:6174"]);
  });

  it("refuses when the daemon is not running", async () => {
    const t = fakeDeps([undefined]);
    expect(await open(t.deps)).toBe(1);
    expect(t.execs).toEqual([]);
    expect(t.err[0]).toContain("donepm start");
  });
});
