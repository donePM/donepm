import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Write the MCP session token to `<dir>/token-<itemId>` (mode 0600) for Codex, whose MCP config is
 * on its command line: the shim reads it from there (`DONEPM_TOKEN_FILE`), so the token is never on
 * argv. `dir` is the daemon's own (mode 0700). Returns its path and a function that removes it.
 */
export function writeTokenFile(dir: string, itemId: string, token: string): { path: string; remove: () => void } {
  const path = join(dir, `token-${itemId}`);
  // The mode applies only to a new file.
  rmSync(path, { force: true });
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  return { path, remove: () => rmSync(path, { force: true }) };
}
