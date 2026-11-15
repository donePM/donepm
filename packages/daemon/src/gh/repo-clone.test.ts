import { describe, expect, it } from "vitest";
import { fail, fakeExec, ok } from "../test-support/fake-exec.js";
import { cloneRepo } from "./repo-clone.js";

describe("cloneRepo", () => {
  it("names a github.com repository owner/repo", async () => {
    const exec = fakeExec({ "gh repo clone": ok("") });
    expect(await cloneRepo(exec, "github.com/acme/widgets", "/r/acme/widgets")).toEqual({ ok: true });
    expect(exec.calls[0]!.args).toEqual(["repo", "clone", "acme/widgets", "/r/acme/widgets"]);
  });

  it("names a repository on another GitHub host with its host (issue #140)", async () => {
    const exec = fakeExec({ "gh repo clone": ok("") });
    expect(await cloneRepo(exec, "github.acme.com/team/app", "/r/team/app")).toEqual({ ok: true });
    expect(exec.calls[0]!.args).toEqual(["repo", "clone", "github.acme.com/team/app", "/r/team/app"]);
  });

  it("keeps the end of gh's error", async () => {
    const exec = fakeExec({ "gh repo clone": fail("Cloning into 'x'...\nGraphQL: Could not resolve\n") });
    expect(await cloneRepo(exec, "github.com/acme/widgets", "/t")).toEqual({ ok: false, error: "Cloning into 'x'...\nGraphQL: Could not resolve" });
  });
});
