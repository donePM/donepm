import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CiPr, DraftReply } from "@donepm/core";
import type { Exec } from "../process/exec.js";

const REPLY_TIMEOUT_MS = 60_000;

export type ReplyResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Post one approved reply to review feedback (decision D39), as the user, never from the agent's
 * process. With `inReplyTo` it answers in that inline comment thread, otherwise it is a comment in
 * the pull request's conversation.
 */
export async function postReply(exec: Exec, pr: CiPr, reply: DraftReply): Promise<ReplyResult> {
  const u = new URL(pr.url);
  const [owner, name] = u.pathname.split("/").filter(Boolean);
  if (!owner || !name) return { ok: false, error: `not a pull request URL: ${pr.url}` };
  const dir = mkdtempSync(join(tmpdir(), "donepm-reply-"));
  try {
    const bodyFile = join(dir, "body.md");
    writeFileSync(bodyFile, reply.body, { mode: 0o600 });
    const r =
      reply.inReplyTo === undefined
        ? await exec("gh", ["pr", "comment", String(pr.number), "--repo", `${u.host}/${owner}/${name}`, "--body-file", bodyFile], {
            timeoutMs: REPLY_TIMEOUT_MS,
          })
        : await exec(
            "gh",
            [
              "api", "--hostname", u.host, "--method", "POST",
              `repos/${owner}/${name}/pulls/${pr.number}/comments/${reply.inReplyTo}/replies`,
              "-F", `body=@${bodyFile}`, "--jq", ".html_url",
            ],
            { timeoutMs: REPLY_TIMEOUT_MS },
          );
    if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout).trim() || `gh exited with ${r.code}` };
    return { ok: true, url: r.stdout.trim().split("\n").at(-1)?.trim() ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
