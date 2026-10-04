import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fail, fakeExec, ok, type FakeCall } from "../test-support/fake-exec.js";
import { postReply } from "./pr-replies.js";

const pr = { url: "https://github.com/o/r/pull/7", number: 7 };

describe("postReply", () => {
  it("comments on the pull request when the reply answers no thread", async () => {
    let body = "";
    const exec = fakeExec({
      "gh pr comment 7 --repo github.com/o/r --body-file": (c: FakeCall) => {
        body = readFileSync(c.args.at(-1)!, "utf8");
        return ok("https://github.com/o/r/pull/7#issuecomment-99\n");
      },
    });
    expect(await postReply(exec, pr, { body: "It does, see the test." })).toEqual({ ok: true, url: "https://github.com/o/r/pull/7#issuecomment-99" });
    expect(body).toBe("It does, see the test.");
  });

  it("answers in the inline thread through the replies endpoint", async () => {
    let body = "";
    const exec = fakeExec({
      "gh api --hostname github.com --method POST repos/o/r/pulls/7/comments/41/replies -F": (c: FakeCall) => {
        body = readFileSync(c.args[c.args.indexOf("-F") + 1]!.replace(/^body=@/, ""), "utf8");
        return ok("https://github.com/o/r/pull/7#discussion_r55\n");
      },
    });
    expect(await postReply(exec, pr, { body: "Renamed.", inReplyTo: 41 })).toEqual({ ok: true, url: "https://github.com/o/r/pull/7#discussion_r55" });
    expect(body).toBe("Renamed.");
    expect(exec.calls[0]!.args.slice(-2)).toEqual(["--jq", ".html_url"]);
  });

  it("reports what gh said when posting fails", async () => {
    expect(await postReply(fakeExec({ "gh pr comment": fail("HTTP 403: Resource not accessible") }), pr, { body: "x" })).toEqual({
      ok: false, error: "HTTP 403: Resource not accessible",
    });
  });
});
