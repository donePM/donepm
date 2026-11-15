import type { Exec } from "../process/exec.js";
import type { Done } from "./result.js";

/** The Keychain service of donePM's items; the account is the connection's id (D8, D50). */
export const KEYCHAIN_SERVICE = "donepm";

/** `security` exits with this when the item does not exist. */
const NOT_FOUND = 44;

/**
 * Characters a token may have. `security -i` splits its input line on blanks and reads quotes and
 * backslashes itself, so a token with any of those would be stored wrong or leak into its error
 * output. API tokens are base64 or hex-like and never need them.
 */
const TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * API tokens of `api` connections (D8 as amended, D50). Only the daemon calls this, at call time;
 * a token is never logged, stored elsewhere, or put in an error.
 */
export interface TokenStore {
  /** The token, or undefined when none is set or the Keychain cannot be read. */
  read(id: string): Promise<string | undefined>;
  /** Whether a token is set, without reading it. This is all the UI learns. */
  has(id: string): Promise<boolean>;
  /** Set or replace the token. */
  write(id: string, token: string): Promise<Done>;
  /** Remove the token; removing one that is not set is fine. */
  remove(id: string): Promise<Done>;
}

/**
 * The macOS Keychain through the built-in `security` tool. Reading prints the token on the
 * daemon's own pipe (`-w`). Writing goes through `security -i` with the command on stdin, so the
 * token is never on a command line where `ps` would show it.
 */
export function keychainTokens(exec: Exec): TokenStore {
  const item = (id: string) => ["-s", KEYCHAIN_SERVICE, "-a", id];
  return {
    async read(id) {
      if (!ID.test(id)) return undefined;
      const r = await exec("security", ["find-generic-password", ...item(id), "-w"]);
      const token = r.stdout.replace(/\n$/, "");
      return r.code === 0 && token ? token : undefined;
    },

    async has(id) {
      if (!ID.test(id)) return false;
      // Without `-w` or `-g`, `security` prints the item's attributes, never its secret.
      return (await exec("security", ["find-generic-password", ...item(id)])).code === 0;
    },

    async write(id, token) {
      if (!ID.test(id)) return { ok: false, error: `not a connection id: ${id}` };
      if (!TOKEN.test(token)) return { ok: false, error: "the token has blanks, quotes or backslashes; paste it again without them" };
      const line = `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${id} -w "${token}"\n`;
      const r = await exec("security", ["-i"], { input: line });
      if (r.code === 0 && !r.stderr.trim()) return { ok: true };
      return { ok: false, error: scrub(r.stderr || r.stdout, token) || `security exited with ${r.code}` };
    },

    async remove(id) {
      if (!ID.test(id)) return { ok: false, error: `not a connection id: ${id}` };
      const r = await exec("security", ["delete-generic-password", ...item(id)]);
      if (r.code === 0 || r.code === NOT_FOUND) return { ok: true };
      return { ok: false, error: r.stderr.trim() || `security exited with ${r.code}` };
    },
  };
}

/** `security` may echo part of the command it failed on; no piece of the token leaves. */
function scrub(text: string, token: string): string {
  let out = text;
  for (let n = token.length; n >= 4; n--) {
    for (let i = 0; i + n <= token.length; i++) out = out.split(token.slice(i, i + n)).join("***");
  }
  return out.trim();
}
