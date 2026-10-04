import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../config/config.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { connectionRoutes } from "./connection-routes.js";

const TOKEN = "ATATT3xFfGF0-synthetic";
const config = parseConfig(JSON.stringify({
  connections: [
    { id: "github", kind: "github", host: "github.com" },
    { id: "jira", kind: "jira", baseUrl: "https://acme.atlassian.net", deployment: "cloud", email: "dana@acme.com" },
  ],
}));

function app(tokens = memoryTokens()) {
  const recheck = vi.fn(async () => undefined);
  const testConnection = vi.fn(async () => ({ ok: true, state: "ready" as const, detail: "Dana Developer" }));
  const server = Fastify();
  connectionRoutes(server, { getConfig: () => config, tokens, recheck, testConnection });
  return { server, tokens, recheck, testConnection };
}

describe("connection routes", () => {
  it("stores a token in the Keychain once and never sends it back", async () => {
    const { server, tokens, recheck } = app();
    const r = await server.inject({ method: "PUT", url: "/api/connections/jira/token", payload: { token: `  ${TOKEN}\n` } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ id: "jira", tokenSet: true });
    expect(r.body).not.toContain(TOKEN);
    expect(tokens.tokens.get("jira")).toBe(TOKEN);
    expect(recheck).toHaveBeenCalled();
  });

  it("replaces and deletes a token", async () => {
    const { server, tokens } = app(memoryTokens({ jira: "old" }));
    await server.inject({ method: "PUT", url: "/api/connections/jira/token", payload: { token: TOKEN } });
    expect(tokens.tokens.get("jira")).toBe(TOKEN);
    const r = await server.inject({ method: "DELETE", url: "/api/connections/jira/token" });
    expect(r.json()).toEqual({ id: "jira", tokenSet: false });
    expect(tokens.tokens.has("jira")).toBe(false);
  });

  it("refuses an empty token, unknown fields, an unknown connection and a cli connection", async () => {
    const { server, tokens } = app();
    expect((await server.inject({ method: "PUT", url: "/api/connections/jira/token", payload: { token: "  " } })).statusCode).toBe(400);
    expect((await server.inject({ method: "PUT", url: "/api/connections/jira/token", payload: { token: TOKEN, echo: true } })).statusCode).toBe(400);
    expect((await server.inject({ method: "PUT", url: "/api/connections/nope/token", payload: { token: TOKEN } })).statusCode).toBe(404);
    const cli = await server.inject({ method: "PUT", url: "/api/connections/github/token", payload: { token: TOKEN } });
    expect(cli.statusCode).toBe(400);
    expect(cli.json().error).toBe("github signs in through its CLI and takes no API token");
    expect(tokens.tokens.size).toBe(0);
  });

  it("says why the Keychain refused, without the token", async () => {
    const tokens = { ...memoryTokens(), write: async () => ({ ok: false as const, error: "security: user canceled" }) };
    const { server } = app(tokens);
    const r = await server.inject({ method: "PUT", url: "/api/connections/jira/token", payload: { token: TOKEN } });
    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({ error: "security: user canceled" });
  });

  it("tests a connection as saved and says whether its token is set", async () => {
    const { server, testConnection } = app(memoryTokens({ jira: TOKEN }));
    const r = await server.inject({ method: "POST", url: "/api/connections/jira/test" });
    expect(r.json()).toEqual({ id: "jira", tokenSet: true, ok: true, state: "ready", detail: "Dana Developer" });
    expect(r.body).not.toContain(TOKEN);
    expect(testConnection).toHaveBeenCalledWith(expect.objectContaining({ id: "jira", baseUrl: "https://acme.atlassian.net" }));
    expect((await server.inject({ method: "POST", url: "/api/connections/nope/test" })).statusCode).toBe(404);
  });
});
