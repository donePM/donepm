import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { daemonUrl, fetchStatus } from "./api.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function home(config?: object): string {
  const h = mkdtempSync(join(tmpdir(), "donepm-cli-"));
  dirs.push(h);
  if (config) {
    mkdirSync(join(h, ".config", "donepm"), { recursive: true });
    writeFileSync(join(h, ".config", "donepm", "config.json"), JSON.stringify(config));
  }
  return h;
}

describe("daemonUrl", () => {
  it("uses the default port before the first start", async () => {
    expect(await daemonUrl(home())).toBe("http://127.0.0.1:6174");
  });

  it("uses the port from the config", async () => {
    expect(await daemonUrl(home({ port: 7000 }))).toBe("http://127.0.0.1:7000");
  });
});

describe("fetchStatus", () => {
  it("is undefined when nothing listens", async () => {
    const refused: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await fetchStatus("http://127.0.0.1:1", refused)).toBeUndefined();
  });

  it("returns the daemon's status", async () => {
    const ok: typeof fetch = async () => Response.json({ version: "1", pid: 7 });
    expect(await fetchStatus("http://x", ok)).toEqual({ version: "1", pid: 7 });
  });

  it("throws when something else answers on the port", async () => {
    const other: typeof fetch = async () => new Response("nope", { status: 404 });
    await expect(fetchStatus("http://x", other)).rejects.toThrow(/404/);
  });
});
