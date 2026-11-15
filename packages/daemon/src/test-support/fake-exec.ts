import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Exec, ExecResult } from "../process/exec.js";

export interface FakeCall {
  cmd: string;
  args: string[];
  opts?: Parameters<Exec>[2];
}

type Responder = ExecResult | ((call: FakeCall) => ExecResult);

/**
 * Fake `Exec`: routes are matched by `cmd` plus the leading args (space-joined prefix).
 * Unmatched calls fail with code 127. Every call is recorded.
 */
export function fakeExec(routes: Record<string, Responder>): Exec & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fn = (async (cmd: string, args: string[], opts?: Parameters<Exec>[2]) => {
    const call: FakeCall = opts ? { cmd, args, opts } : { cmd, args };
    calls.push(call);
    const line = [cmd, ...args].join(" ");
    const key = Object.keys(routes)
      .filter((k) => line === k || line.startsWith(k + " "))
      .sort((a, b) => b.length - a.length)[0];
    if (key === undefined) return { code: 127, stdout: "", stderr: `fake: no route for ${line}` };
    const r = routes[key]!;
    return typeof r === "function" ? r(call) : r;
  }) as Exec & { calls: FakeCall[] };
  fn.calls = calls;
  return fn;
}

export function ok(stdout: string): ExecResult {
  return { code: 0, stdout, stderr: "" };
}

export function fail(stderr: string, code = 1): ExecResult {
  return { code, stdout: "", stderr };
}

/** Contents of `packages/daemon/fixtures/<name>`. */
export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), "utf8");
}
