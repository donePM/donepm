import type { AgentProcess, ProcessFactory, SpawnOptions } from "../agent/process.js";

/** Scriptable `claude` stand-in: the test emits stdout lines and exits it by hand. */
export class FakeProcess implements AgentProcess {
  readonly stdin: string[] = [];
  readonly signals: NodeJS.Signals[] = [];
  /** Exit when a signal arrives (like a well-behaved CLI). Set false to simulate a hang. */
  exitOnSignal = true;
  private lineCbs: Array<(line: string) => void> = [];
  private stderrCbs: Array<(chunk: string) => void> = [];
  private exitCbs: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  exited = false;

  constructor(
    readonly cmd: string,
    readonly args: string[],
    readonly opts: SpawnOptions,
  ) {}

  write(line: string): void {
    this.stdin.push(line);
  }
  onStdoutLine(cb: (line: string) => void): void {
    this.lineCbs.push(cb);
  }
  onStderr(cb: (chunk: string) => void): void {
    this.stderrCbs.push(cb);
  }
  onExit(cb: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    this.exitCbs.push(cb);
  }
  kill(signal: NodeJS.Signals): void {
    this.signals.push(signal);
    if (this.exitOnSignal || signal === "SIGKILL") this.exit(null, signal);
  }

  emit(...lines: Array<string | object>): void {
    for (const l of lines) {
      const line = typeof l === "string" ? l : JSON.stringify(l);
      this.lineCbs.forEach((cb) => cb(line));
    }
  }
  stderr(chunk: string): void {
    this.stderrCbs.forEach((cb) => cb(chunk));
  }
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.exitCbs.forEach((cb) => cb(code, signal));
  }
  /** Parsed stdin lines. */
  sent(): any[] {
    return this.stdin.map((l) => JSON.parse(l));
  }
}

export function fakeProcesses(): ProcessFactory & { spawned: FakeProcess[]; last: () => FakeProcess } {
  const spawned: FakeProcess[] = [];
  const spawn: ProcessFactory = (cmd, args, opts) => {
    const p = new FakeProcess(cmd, args, opts);
    spawned.push(p);
    return p;
  };
  const last = () => {
    const p = spawned.at(-1);
    if (!p) throw new Error("no process spawned");
    return p;
  };
  return Object.assign(spawn, { spawned, last });
}
