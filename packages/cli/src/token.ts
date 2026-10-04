import type { Io } from "./lifecycle.js";

export interface TokenDeps extends Io {
  url: string;
  fetch: typeof fetch;
  /** The token from stdin, or typed at a prompt that does not echo. Never from argv, where `ps` shows it. */
  readSecret: (prompt: string) => Promise<string>;
}

/** `donepm token set <connection>`: hands the token to the daemon, which keeps it in the Keychain (D8). */
export async function setToken(deps: TokenDeps, id: string | undefined): Promise<number> {
  if (!id) return usage(deps);
  const token = (await deps.readSecret(`API token for ${id}: `)).trim();
  if (!token) {
    deps.err("No token given; nothing changed.");
    return 1;
  }
  const r = await call(deps, "PUT", id, { token });
  if (r === undefined) return 1;
  deps.out(`The token of ${id} is in the Keychain.`);
  return 0;
}

/** `donepm token delete <connection>`: removes the token from the Keychain. */
export async function deleteToken(deps: TokenDeps, id: string | undefined): Promise<number> {
  if (!id) return usage(deps);
  if ((await call(deps, "DELETE", id)) === undefined) return 1;
  deps.out(`${id} has no token any more.`);
  return 0;
}

function usage(deps: Io): number {
  deps.err("Usage: donepm token set <connection>   (reads the token from stdin or a hidden prompt)\n       donepm token delete <connection>");
  return 2;
}

async function call(deps: TokenDeps, method: "PUT" | "DELETE", id: string, body?: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await deps.fetch(`${deps.url}/api/connections/${encodeURIComponent(id)}/token`, {
      method,
      ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    deps.err(`donePM is not running (nothing at ${deps.url}). Start it with \`donepm start\`.`);
    return undefined;
  }
  const answer = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    deps.err(answer.error ?? `donePM answered ${res.status}`);
    return undefined;
  }
  return answer;
}
