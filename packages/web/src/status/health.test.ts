import { describe, expect, it } from "vitest";
import type { Status } from "../api/types";
import { health, problems, summary, tools } from "./health";

const base: Status = {
  version: "0.1.0",
  pid: 1,
  startedAt: "2026-10-01T00:00:00.000Z",
  pollErrors: [],
  gh: { state: "ready" },
  claude: { state: "ready" },
  runningAgents: 0,
};
const withStatus = (patch: Partial<Status>): Status => ({ ...base, ...patch });

describe("problems", () => {
  it("is empty when everything works", () => {
    expect(problems(base, true)).toEqual([]);
    expect(problems(withStatus({ lastPoll: { at: "2026-01-01T00:00:00Z", ok: true } }), true)).toEqual([]);
  });

  it("names each bad state of each required tool", () => {
    expect(problems(withStatus({ gh: { state: "not_installed" } }), true)).toEqual(["gh is not installed"]);
    expect(problems(withStatus({ gh: { state: "not_logged_in" } }), true)).toEqual(["gh is not logged in"]);
    expect(problems(withStatus({ claude: { state: "not_installed" } }), true)).toEqual(["claude is not installed"]);
    expect(problems(withStatus({ claude: { state: "not_logged_in" } }), true)).toEqual(["claude is not logged in"]);
  });

  it("reports a failed poll, but not a missing one", () => {
    expect(problems(withStatus({ lastPoll: { at: "2026-01-01T00:00:00Z", ok: false, error: "boom" } }), true)).toEqual(["last poll failed"]);
    expect(problems(withStatus({ lastPoll: undefined }), true)).toEqual([]);
  });

  it("lists several problems in a stable order", () => {
    const s = withStatus({ gh: { state: "not_logged_in" }, claude: { state: "not_installed" }, lastPoll: { at: "x", ok: false } });
    expect(problems(s, true)).toEqual(["gh is not logged in", "claude is not installed", "last poll failed"]);
  });

  it("does not count a tool whose state is not known yet", () => {
    expect(problems(withStatus({ gh: undefined, claude: undefined }), true)).toEqual([]);
    expect(problems(undefined, true)).toEqual([]);
  });

  it("reports only the unreachable daemon, since the last status is stale", () => {
    expect(problems(withStatus({ gh: { state: "not_installed" } }), false)).toEqual(["daemon is not reachable"]);
    expect(problems(undefined, false)).toEqual(["daemon is not reachable"]);
  });

  it("ignores an optional tool in a bad state", () => {
    const registry = [...tools, { name: "extra", required: false, state: () => "not_installed" as const }];
    expect(problems(base, true, registry)).toEqual([]);
    expect(health(base, true, registry)).toBe("ok");
  });
});

describe("health", () => {
  it("is ok when all required tools are ready", () => {
    expect(health(base, true)).toBe("ok");
    expect(health(withStatus({ lastPoll: undefined }), true)).toBe("ok");
  });

  it("is unknown until a status with every required tool state has arrived", () => {
    expect(health(undefined, true)).toBe("unknown");
    expect(health(withStatus({ gh: undefined }), true)).toBe("unknown");
    expect(health(withStatus({ claude: undefined }), true)).toBe("unknown");
  });

  it("is a problem for a bad tool, a failed poll or an unreachable daemon", () => {
    expect(health(withStatus({ gh: { state: "not_installed" } }), true)).toBe("problem");
    expect(health(withStatus({ lastPoll: { at: "x", ok: false } }), true)).toBe("problem");
    expect(health(base, false)).toBe("problem");
    expect(health(undefined, false)).toBe("problem");
  });

  it("prefers a known problem over unknown tools", () => {
    expect(health(withStatus({ gh: { state: "not_logged_in" }, claude: undefined }), true)).toBe("problem");
  });
});

describe("a subset of the tools", () => {
  const agents = tools.filter((t) => t.section === "agents");

  it("puts claude under Agents & access and gh under Tools", () => {
    expect(agents.map((t) => t.name)).toEqual(["claude"]);
    expect(tools.filter((t) => t.section === "tools").map((t) => t.name)).toEqual(["gh"]);
  });

  it("can leave a failed poll out", () => {
    const failed = withStatus({ lastPoll: { at: "x", ok: false }, gh: { state: "not_installed" } });
    expect(problems(failed, true, agents, false)).toEqual([]);
    expect(health(failed, true, agents, false)).toBe("ok");
  });
});

describe("summary", () => {
  it("words one problem and several", () => {
    expect(summary(["gh is not logged in"])).toBe("Problem: gh is not logged in");
    expect(summary(["gh is not logged in", "claude is not installed"])).toBe("2 problems: gh is not logged in; claude is not installed");
  });
});
