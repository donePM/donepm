import type { DaemonStatus } from "./api.js";
import type { LifecycleDeps } from "./lifecycle.js";

export const RUNNING: DaemonStatus = {
  version: "0.0.0", pid: 4242, runningAgents: 1, lastPoll: undefined, lastScan: undefined,
  gh: { state: "ready", account: "octo" }, claude: { state: "not_logged_in" },
};

/** Fake deps: `answers` are what successive status calls return; the last one repeats. */
export function fakeDeps(answers: Array<DaemonStatus | undefined>, execCode = 0) {
  const out: string[] = [];
  const err: string[] = [];
  const kills: Array<[number, string]> = [];
  const execs: string[] = [];
  let n = 0;
  const deps: LifecycleDeps = {
    url: "http://127.0.0.1:6174",
    status: async () => answers[Math.min(n++, answers.length - 1)],
    exec: async (cmd, args) => {
      execs.push([cmd, ...args].join(" "));
      return { code: execCode, stdout: "", stderr: execCode ? "boom" : "" };
    },
    kill: (pid, signal) => void kills.push([pid, signal]),
    sleep: async () => {},
    out: (l) => void out.push(l),
    err: (l) => void err.push(l),
  };
  return { deps, out, err, kills, execs };
}
