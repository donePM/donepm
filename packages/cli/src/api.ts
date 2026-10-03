import { readFile } from "node:fs/promises";
import { DEFAULT_CONFIG, parseConfig } from "@donepm/daemon/config";
import { pathsFor } from "@donepm/daemon/paths";
import type { Status } from "@donepm/daemon/status";

export type DaemonStatus = Status;

/** The daemon's base URL, from the port in its config (or the default before the first start). */
export async function daemonUrl(home: string): Promise<string> {
  const file = pathsFor(home).configFile;
  let port = DEFAULT_CONFIG.port;
  try {
    port = parseConfig(await readFile(file, "utf8"), file).port;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return `http://127.0.0.1:${port}`;
}

/** `GET /api/status`, or undefined when nothing answers on the port. */
export async function fetchStatus(url: string, fetchFn: typeof fetch = fetch): Promise<DaemonStatus | undefined> {
  let res: Response;
  try {
    res = await fetchFn(`${url}/api/status`, { signal: AbortSignal.timeout(5_000) });
  } catch {
    return undefined;
  }
  if (!res.ok) throw new Error(`${url} answered ${res.status}; is something else using the port?`);
  return (await res.json()) as DaemonStatus;
}
