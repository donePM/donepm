import { describe, expect, it } from "vitest";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { ghKnownHosts } from "./known-hosts.js";

describe("ghKnownHosts", () => {
  it("lists the hosts gh is logged in to, without the one whose token fails", async () => {
    const exec = fakeExec({ "gh auth status": ok(fixture("gh/auth-status-hosts.json")) });
    expect(await ghKnownHosts(exec)).toEqual(["github.acme.com", "github.com"]);
    expect(exec.calls[0]!.args).toEqual(["auth", "status", "--json", "hosts"]);
    expect(exec.calls[0]!.args).not.toContain("--show-token");
  });

  it("lists nothing when gh is missing, too old for --json, or answers something else", async () => {
    expect(await ghKnownHosts(fakeExec({ gh: fail("unknown flag: --json") }))).toEqual([]);
    expect(await ghKnownHosts(fakeExec({ gh: ok("not json") }))).toEqual([]);
    expect(await ghKnownHosts(fakeExec({ gh: ok('{"hosts":[]}') }))).toEqual([]);
  });
});
