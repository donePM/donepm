import { describe, expect, it } from "vitest";
import { spawnProcess } from "./process.js";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check: () => boolean): Promise<void> {
  while (!check()) await new Promise((r) => setTimeout(r, 20));
}

describe("spawnProcess", () => {
  it("signals what the agent started along with the agent (#115)", async () => {
    // The shell stands in for claude, the background sleep for a test run it started.
    const proc = spawnProcess("/bin/sh", ["-c", "sleep 30 & echo $!; wait"], { cwd: "/", env: { PATH: "/bin:/usr/bin" } });
    const grandchild = await new Promise<number>((resolve) => proc.onStdoutLine((l) => resolve(Number(l))));
    const exited = new Promise<NodeJS.Signals | null>((resolve) => proc.onExit((_code, signal) => resolve(signal)));
    expect(alive(grandchild)).toBe(true);

    proc.kill("SIGTERM");

    expect(await exited).toBe("SIGTERM");
    await until(() => !alive(grandchild));
  });

  it("ignores a signal after the agent is gone", async () => {
    const proc = spawnProcess("/bin/sh", ["-c", "exit 0"], { cwd: "/", env: { PATH: "/bin:/usr/bin" } });
    await new Promise<void>((resolve) => proc.onExit(() => resolve()));
    expect(() => proc.kill("SIGKILL")).not.toThrow();
  });
});
