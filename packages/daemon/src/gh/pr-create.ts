import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrDraftResult } from "@donepm/core";
import type { PrCreate, PrCreated } from "../providers/code-host.js";
import type { Exec } from "../process/exec.js";

const CREATE_TIMEOUT_MS = 120_000;

/**
 * `gh pr create` for an approved PR draft (spec 6.3), after the daemon pushed the branch. The body
 * goes through a 0600 temp file, not argv.
 */
export async function createPr(exec: Exec, input: PrCreate): Promise<PrCreated> {
  const dir = mkdtempSync(join(tmpdir(), "donepm-pr-"));
  try {
    const bodyFile = join(dir, "body.md");
    writeFileSync(bodyFile, input.body, { mode: 0o600 });
    const r = await exec(
      "gh",
      ["pr", "create", "--repo", input.origin, "--head", input.head, "--base", input.base, "--title", input.title, "--body-file", bodyFile],
      { cwd: input.cwd, timeoutMs: CREATE_TIMEOUT_MS },
    );
    if (r.code !== 0) {
      const out = (r.stderr || r.stdout).trim();
      return { ok: false, error: out ? `gh pr create failed: ${out}` : `gh pr create exited with code ${r.code}` };
    }
    const pr = prResult(r.stdout);
    return pr ? { ok: true, pr } : { ok: false, error: `gh pr create printed no pull request URL: ${r.stdout.trim() || "(nothing)"}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `gh pr create` prints the new pull request's URL as its last line. */
export function prResult(stdout: string): PrDraftResult | undefined {
  const url = stdout.trim().split("\n").at(-1)?.trim() ?? "";
  const m = /\/pull\/(\d+)$/.exec(url);
  return m ? { url, number: Number(m[1]) } : undefined;
}
