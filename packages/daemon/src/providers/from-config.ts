import type { ConnectionConfig } from "../config/connections.js";
import { gitHubCliConnection } from "../gh/adapter.js";
import type { Exec } from "../process/exec.js";
import { providerRegistry, type Connection, type Providers } from "./registry.js";

/** The adapters of one configured connection (D50). The schema refuses a backend a kind lacks. */
function connectionOf(config: ConnectionConfig, exec: Exec): Connection {
  switch (config.kind) {
    case "github":
      return gitHubCliConnection(exec, config.host, config.id);
  }
}

/** The registry of a config's connections, read once at start (D50). */
export function providersOf(connections: readonly ConnectionConfig[], exec: Exec): Providers {
  return providerRegistry(connections.map((c) => connectionOf(c, exec)));
}
