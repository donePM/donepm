import { parseCloneOrigin, qualifiedRepository } from "@donepm/core";
import type { Done } from "../providers/result.js";
import type { Exec } from "../process/exec.js";

/** A clone can take minutes. */
const CLONE_TIMEOUT_MS = 30 * 60_000;

/** Lines of `gh repo clone` stderr kept for the user. */
const STDERR_TAIL_LINES = 20;

/**
 * `gh repo clone <owner>/<repo> <target>` (issue #37): `gh` uses the user's auth and protocol and
 * sets `upstream` for forks. Read-only towards GitHub.
 */
export async function cloneRepo(exec: Exec, origin: string, target: string): Promise<Done> {
  const parsed = parseCloneOrigin(origin);
  if (!parsed) return { ok: false, error: `${origin} is not host/owner/repo` };
  const r = await exec("gh", ["repo", "clone", qualifiedRepository(parsed.host, `${parsed.owner}/${parsed.repo}`), target], { timeoutMs: CLONE_TIMEOUT_MS });
  if (r.code !== 0) return { ok: false, error: tail(r.stderr) || `gh repo clone exited with ${r.code}` };
  return { ok: true };
}

function tail(stderr: string): string {
  return stderr.trimEnd().split("\n").slice(-STDERR_TAIL_LINES).join("\n").trim();
}
