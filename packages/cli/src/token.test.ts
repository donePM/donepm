import { describe, expect, it } from "vitest";
import { deleteToken, setToken, type TokenDeps } from "./token.js";

const TOKEN = "ATATT3xFfGF0-synthetic";

function fakeToken(answer: { status: number; body: unknown } | "down", secret = `${TOKEN}\n`) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const deps: TokenDeps = {
    url: "http://127.0.0.1:6174",
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (answer === "down") throw new TypeError("fetch failed");
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }) as typeof fetch,
    readSecret: async () => secret,
    out: (l) => void out.push(l),
    err: (l) => void err.push(l),
  };
  return { deps, out, err, calls };
}

describe("donepm token", () => {
  it("sends the token to the daemon in the body, never printing it", async () => {
    const t = fakeToken({ status: 200, body: { id: "jira", tokenSet: true } });
    expect(await setToken(t.deps, "jira")).toBe(0);
    expect(t.calls[0]!.url).toBe("http://127.0.0.1:6174/api/connections/jira/token");
    expect(t.calls[0]!.init?.method).toBe("PUT");
    expect(JSON.parse(String(t.calls[0]!.init?.body))).toEqual({ token: TOKEN });
    expect(t.out).toEqual(["The token of jira is in the Keychain."]);
    expect([...t.out, ...t.err].join("\n")).not.toContain(TOKEN);
  });

  it("changes nothing without a token", async () => {
    const t = fakeToken({ status: 200, body: {} }, "  \n");
    expect(await setToken(t.deps, "jira")).toBe(1);
    expect(t.calls).toEqual([]);
  });

  it("says what the daemon refused, or that it does not run", async () => {
    const refused = fakeToken({ status: 400, body: { error: "github signs in through its CLI and takes no API token" } });
    expect(await setToken(refused.deps, "github")).toBe(1);
    expect(refused.err).toEqual(["github signs in through its CLI and takes no API token"]);
    const down = fakeToken("down");
    expect(await deleteToken(down.deps, "jira")).toBe(1);
    expect(down.err[0]).toMatch(/not running/);
  });

  it("deletes a token", async () => {
    const t = fakeToken({ status: 200, body: { id: "jira", tokenSet: false } });
    expect(await deleteToken(t.deps, "jira")).toBe(0);
    expect(t.calls[0]!.init?.method).toBe("DELETE");
    expect(t.out).toEqual(["jira has no token any more."]);
  });

  it("needs a connection id", async () => {
    const t = fakeToken({ status: 200, body: {} });
    expect(await setToken(t.deps, undefined)).toBe(2);
    expect(t.calls).toEqual([]);
  });
});
