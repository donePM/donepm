import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codex } from "./adapter.js";
import { codexArgv, tomlString } from "./argv.js";
import { codexTokens, subtractUsage } from "./usage.js";

const playbook = { model: "gpt-5.5", permissionMode: "acceptEdits" as const };

describe("codexArgv", () => {
  it("runs the app server over stdio without network for commands", () => {
    expect(codexArgv({})).toEqual(["app-server", "--listen", "stdio://", "-c", "sandbox_workspace_write.network_access=false"]);
  });

  it("turns web search off for a read-only playbook", () => {
    expect(codexArgv({ readOnly: true }).slice(-2)).toEqual(["-c", 'web_search="disabled"']);
  });

  it("adds donePM's MCP server as TOML, its tools approved", () => {
    const args = codexArgv({ mcp: { command: "/usr/bin/node", args: ["/a b/shim.js"], env: { DONEPM_SOCKET: "/s", DONEPM_TOKEN_FILE: "/t" } } });
    expect(args.slice(5)).toEqual([
      "-c", 'mcp_servers.donepm.command="/usr/bin/node"',
      "-c", 'mcp_servers.donepm.args=["/a b/shim.js"]',
      "-c", 'mcp_servers.donepm.env={"DONEPM_SOCKET"="/s","DONEPM_TOKEN_FILE"="/t"}',
      "-c", "mcp_servers.donepm.enabled=true",
      "-c", 'mcp_servers.donepm.default_tools_approval_mode="approve"',
    ]);
  });

  it("escapes TOML strings", () => {
    expect(tomlString('a"b\\c\n\u007f')).toBe('"a\\"b\\\\c\\n\\u007f"');
  });
});

describe("codex.launch", () => {
  it("puts the token in a 0600 file, never on argv, and removes it on cleanup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "donepm-codex-"));
    const launched = codex.launch({
      itemId: "item-1", cwd: "/wt", playbook,
      mcp: { command: "/usr/bin/node", args: ["shim.js"], env: { DONEPM_SOCKET: "/s", DONEPM_TOKEN: "secret-token" }, dir },
    });
    const file = join(dir, "token-item-1");
    expect(launched.args.join(" ")).not.toContain("secret-token");
    expect(launched.args).toContain(`mcp_servers.donepm.env={"DONEPM_SOCKET"="/s","DONEPM_TOKEN_FILE"=${JSON.stringify(file)}}`);
    expect((await readFile(file, "utf8")).trim()).toBe("secret-token");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    launched.cleanup?.();
    expect(existsSync(file)).toBe(false);
  });

  it("starts without an MCP server when none is given", () => {
    expect(codex.launch({ itemId: "i", cwd: "/wt", playbook: { ...playbook, readOnly: true } })).toEqual({ args: codexArgv({ readOnly: true }) });
  });
});

describe("codex usage", () => {
  it("maps Codex's breakdown and subtracts a baseline", () => {
    const total = codexTokens({ inputTokens: 100, cachedInputTokens: 60, cacheWriteInputTokens: 0, outputTokens: 7, reasoningOutputTokens: 3, totalTokens: 107 });
    expect(total).toEqual({ inputTokens: 100, outputTokens: 7, cacheReadInputTokens: 60, cacheWriteInputTokens: 0, reasoningTokens: 3 });
    expect(codexTokens("x")).toBeUndefined();
    expect(subtractUsage(total!, { inputTokens: 40, outputTokens: 9, cacheReadInputTokens: 10, cacheWriteInputTokens: 0 })).toEqual({
      inputTokens: 60, outputTokens: 0, cacheReadInputTokens: 50, cacheWriteInputTokens: 0, reasoningTokens: 3,
    });
  });
});
