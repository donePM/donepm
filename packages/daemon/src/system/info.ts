import { statSync } from "node:fs";

/** How the daemon was started: by launchd (`donepm install-service`) or by hand (`donepm start`). */
export type ServiceKind = "launchd" | "manual";

/** The launchd job `donepm install-service` installs. */
export const SERVICE_LABEL = "com.donepm.daemon";

/** What Settings > Daemon shows (issue #127). */
export interface DaemonInfo {
  version: string;
  pid: number;
  port: number;
  startedAt: string;
  service: ServiceKind;
  configFile: string;
  dbFile: string;
  /** The database with its WAL and shared-memory files. */
  dbBytes: number;
  /** Where launchd writes the log; a daemon started by hand logs to its terminal. */
  logFile?: string;
  playbooksDir: string;
}

/** Size of a file, 0 when it does not exist. */
export function fileBytes(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** The database file plus SQLite's `-wal` and `-shm` side files. */
export const databaseBytes = (dbFile: string): number => [dbFile, `${dbFile}-wal`, `${dbFile}-shm`].reduce((n, f) => n + fileBytes(f), 0);

/** launchd tells its jobs their label in `XPC_SERVICE_NAME`. */
export const serviceKind = (env: NodeJS.ProcessEnv): ServiceKind => (env.XPC_SERVICE_NAME === SERVICE_LABEL ? "launchd" : "manual");
