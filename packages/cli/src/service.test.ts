import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, parse } from "plist";
import { afterEach, describe, expect, it } from "vitest";
import { fakeDeps, RUNNING } from "./fake-deps.js";
import { installService, LABEL, servicePaths, servicePlist, uninstallService, type ServiceDeps } from "./service.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup(answers: Parameters<typeof fakeDeps>[0], execCode = 0) {
  const home = mkdtempSync(join(tmpdir(), "donepm-cli-"));
  dirs.push(home);
  const t = fakeDeps(answers, execCode);
  const paths = servicePaths(home);
  const deps: ServiceDeps = {
    ...t.deps,
    paths,
    plist: { node: "/opt/node", entry: "/src/daemon/dist/index.js", logDir: paths.logDir, workingDirectory: home, env: { PATH: "/opt/bin:/usr/bin" } },
    uid: 501,
  };
  return { ...t, deps, home, paths };
}

describe("servicePlist", () => {
  it("runs node on the daemon entry, restarts only after crashes and logs to ~/Library/Logs/donepm", () => {
    const parsed = parse(
      servicePlist({ node: "/opt/node", entry: "/d/index.js", logDir: "/h/Library/Logs/donepm", workingDirectory: "/h", env: { PATH: "/opt/bin" } }),
    );
    expect(parsed).toEqual({
      Label: "com.donepm.daemon",
      ProgramArguments: ["/opt/node", "/d/index.js"],
      EnvironmentVariables: { PATH: "/opt/bin" },
      WorkingDirectory: "/h",
      RunAtLoad: true,
      KeepAlive: { SuccessfulExit: false },
      StandardOutPath: "/h/Library/Logs/donepm/daemon.log",
      StandardErrorPath: "/h/Library/Logs/donepm/daemon.err.log",
    });
  });
});

describe("installService", () => {
  it("writes the plist into LaunchAgents and loads it", async () => {
    const t = setup([undefined]);
    expect(await installService(t.deps)).toBe(0);
    expect(t.paths.plist).toBe(join(t.home, "Library", "LaunchAgents", `${LABEL}.plist`));
    expect(parse(readFileSync(t.paths.plist, "utf8"))).toMatchObject({ ProgramArguments: ["/opt/node", "/src/daemon/dist/index.js"] });
    expect(existsSync(t.paths.logDir)).toBe(true);
    expect(t.execs).toEqual([`launchctl bootout gui/501/${LABEL}`, `launchctl bootstrap gui/501 ${t.paths.plist}`]);
  });

  it("waits for the old launchd daemon to go down before loading the new plist", async () => {
    const t = setup([RUNNING, RUNNING, undefined]);
    expect(await installService(t.deps)).toBe(0);
    expect(t.execs.at(-1)).toContain("bootstrap");
  });

  it("refuses while a daemon outside launchd holds the port", async () => {
    const t = setup([RUNNING]);
    expect(await installService(t.deps)).toBe(1);
    expect(t.err[0]).toContain("donepm stop");
    expect(t.execs.some((e) => e.includes("bootstrap"))).toBe(false);
  });

  it("reports a failed bootstrap", async () => {
    const t = setup([undefined], 5);
    expect(await installService(t.deps)).toBe(1);
    expect(t.err[0]).toContain("launchctl bootstrap failed: boom");
  });
});

describe("uninstallService", () => {
  it("unloads the job and deletes the plist", async () => {
    const t = setup([undefined]);
    await installService(t.deps);
    expect(await uninstallService(t.deps)).toBe(0);
    expect(existsSync(t.paths.plist)).toBe(false);
    expect(t.execs.at(-1)).toBe(`launchctl bootout gui/501/${LABEL}`);
  });
});
