import { describe, expect, it } from "vitest";
import { fail, fakeExec, ok } from "../test-support/fake-exec.js";
import { keychainTokens } from "./keychain.js";

const TOKEN = "ATATT3x=Fk_9-q.r/s+t";

describe("keychainTokens", () => {
  it("reads a connection's token with -w, from donePM's service and the connection's account", async () => {
    const exec = fakeExec({ "security find-generic-password": ok(`${TOKEN}\n`) });
    expect(await keychainTokens(exec).read("jira")).toBe(TOKEN);
    expect(exec.calls[0]!.args).toEqual(["find-generic-password", "-s", "donepm", "-a", "jira", "-w"]);
  });

  it("reads nothing when no token is set", async () => {
    const exec = fakeExec({ "security find-generic-password": fail("security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.", 44) });
    expect(await keychainTokens(exec).read("jira")).toBeUndefined();
    expect(await keychainTokens(exec).has("jira")).toBe(false);
  });

  it("says whether a token is set without asking for the secret", async () => {
    const exec = fakeExec({ "security find-generic-password": ok('keychain: "login.keychain-db"\nattributes:\n    "acct"<blob>="jira"\n') });
    expect(await keychainTokens(exec).has("jira")).toBe(true);
    expect(exec.calls[0]!.args).not.toContain("-w");
    expect(exec.calls[0]!.args).not.toContain("-g");
  });

  it("writes through security -i with the command on stdin, never on argv", async () => {
    const exec = fakeExec({ "security -i": ok("") });
    expect(await keychainTokens(exec).write("jira", TOKEN)).toEqual({ ok: true });
    const call = exec.calls[0]!;
    expect(call.args).toEqual(["-i"]);
    expect(call.args.join(" ")).not.toContain(TOKEN);
    expect(call.opts?.input).toBe(`add-generic-password -U -s donepm -a jira -w "${TOKEN}"\n`);
  });

  it("refuses a token the interactive command line would split or unquote", async () => {
    const exec = fakeExec({ "security -i": ok("") });
    for (const token of ["two words", 'quo"te', "back\\slash", "new\nline", ""]) {
      expect(await keychainTokens(exec).write("jira", token)).toMatchObject({ ok: false });
    }
    expect(exec.calls).toHaveLength(0);
  });

  it("refuses an id that is not a connection id, without calling security", async () => {
    const exec = fakeExec({});
    expect(await keychainTokens(exec).write("-s x", TOKEN)).toEqual({ ok: false, error: "not a connection id: -s x" });
    expect(await keychainTokens(exec).read("../x")).toBeUndefined();
    expect(exec.calls).toHaveLength(0);
  });

  it("keeps every piece of the token out of an error", async () => {
    const exec = fakeExec({
      "security -i": fail(`security: SecKeychainItemCreateFromContent (${TOKEN.slice(6)}"): The specified item already exists in the keychain.`, 45),
    });
    const r = await keychainTokens(exec).write("jira", TOKEN);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("already exists");
    expect(r.error).not.toContain(TOKEN.slice(6, 10));
  });

  it("removes a token; one that is not set is already removed", async () => {
    const exec = fakeExec({ "security delete-generic-password": fail("could not be found", 44) });
    expect(await keychainTokens(exec).remove("jira")).toEqual({ ok: true });
    expect(exec.calls[0]!.args).toEqual(["delete-generic-password", "-s", "donepm", "-a", "jira"]);
  });
});
