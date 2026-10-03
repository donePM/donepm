import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface McpConfigInput {
  /** Directory owned by the daemon (mode 0700). */
  dir: string;
  itemId: string;
  /** `node`, so the shim runs even when the filtered PATH lost it. */
  nodePath: string;
  bridgePath: string;
  socketPath: string;
  token: string;
}

/**
 * Write `<dir>/mcp-<itemId>.json` (mode 0600) for `--mcp-config` (spec 10). A file, never inline
 * JSON, because argv is visible in `ps`. Returns its path and a function that removes it.
 */
export function writeMcpConfig(input: McpConfigInput): { path: string; remove: () => void } {
  const path = join(input.dir, `mcp-${input.itemId}.json`);
  const config = {
    mcpServers: {
      donepm: {
        command: input.nodePath,
        args: [input.bridgePath],
        env: { DONEPM_SOCKET: input.socketPath, DONEPM_TOKEN: input.token },
      },
    },
  };
  // The mode applies only to a new file.
  rmSync(path, { force: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return { path, remove: () => rmSync(path, { force: true }) };
}
