import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { build } from "plist";
import { waitUntilDown, type LifecycleDeps } from "./lifecycle.js";

export const LABEL = "com.donepm.daemon";

export interface ServicePaths {
  plist: string;
  logDir: string;
}

/** launchd wants these in the real home, whatever `DONEPM_HOME` says. */
export function servicePaths(realHome: string): ServicePaths {
  return {
    plist: join(realHome, "Library", "LaunchAgents", `${LABEL}.plist`),
    logDir: join(realHome, "Library", "Logs", "donepm"),
  };
}

export interface PlistInput {
  node: string;
  entry: string;
  logDir: string;
  workingDirectory: string;
  /** launchd starts jobs with a bare PATH; `gh`, `git` and `claude` must be found. */
  env: Record<string, string>;
}

/**
 * Restart after a crash, not after `donepm stop`: the daemon exits 0 on SIGTERM, and
 * `SuccessfulExit: false` keeps launchd from starting it again until the next login.
 */
export function servicePlist(input: PlistInput): string {
  return build({
    Label: LABEL,
    ProgramArguments: [input.node, input.entry],
    EnvironmentVariables: input.env,
    WorkingDirectory: input.workingDirectory,
    RunAtLoad: true,
    KeepAlive: { SuccessfulExit: false },
    StandardOutPath: join(input.logDir, "daemon.log"),
    StandardErrorPath: join(input.logDir, "daemon.err.log"),
  });
}

export interface ServiceDeps extends LifecycleDeps {
  paths: ServicePaths;
  plist: PlistInput;
  uid: number;
}

/** `donepm install-service`: write the plist and (re)load it. */
export async function installService(deps: ServiceDeps): Promise<number> {
  const domain = `gui/${deps.uid}`;
  // A previous version of the job: unload it, so the new plist takes effect.
  await deps.exec("launchctl", ["bootout", `${domain}/${LABEL}`]);
  const running = await deps.status();
  if (running && !(await waitUntilDown(deps))) {
    deps.err(`donePM is running outside launchd (pid ${running.pid}). Stop it with \`donepm stop\`, then run this again.`);
    return 1;
  }

  await mkdir(dirname(deps.paths.plist), { recursive: true });
  await mkdir(deps.paths.logDir, { recursive: true });
  await writeFile(deps.paths.plist, servicePlist(deps.plist), "utf8");

  const r = await deps.exec("launchctl", ["bootstrap", domain, deps.paths.plist]);
  if (r.code !== 0) {
    deps.err(`launchctl bootstrap failed: ${r.stderr.trim() || `exit ${r.code}`}`);
    return 1;
  }
  deps.out(`Installed ${deps.paths.plist}. donePM starts now and at every login.`);
  deps.out(`Logs: ${deps.paths.logDir}. Open the board with \`donepm open\` (${deps.url}).`);
  return 0;
}

/** `donepm uninstall-service`: unload the job and delete the plist. Logs stay. */
export async function uninstallService(deps: ServiceDeps): Promise<number> {
  await deps.exec("launchctl", ["bootout", `gui/${deps.uid}/${LABEL}`]);
  await rm(deps.paths.plist, { force: true });
  deps.out(`Removed ${deps.paths.plist}.`);
  return 0;
}
