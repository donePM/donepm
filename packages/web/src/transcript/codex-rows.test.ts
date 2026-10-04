import { codexItemKind, type TranscriptKind } from "@donepm/core";
import { describe, expect, it } from "vitest";
import type { PermissionAsk, TranscriptMessage } from "../api/types";
import commandApproval from "../../../daemon/fixtures/codex/command-approval.ndjson?raw";
import editPatch from "../../../daemon/fixtures/codex/edit-patch.ndjson?raw";
import { applyDelta, askOutcomeText, toRows, type Row, type ToolRow } from "./rows";

let n = 0;
const msg = (kind: TranscriptKind, raw: unknown): TranscriptMessage => ({
  id: `c${++n}`, itemId: "i1", sessionId: "th-cmd", at: `2026-10-03T12:00:${String(n % 60).padStart(2, "0")}.000Z`, kind, agentKind: "codex", raw,
});

/** Stored as the daemon stores a Codex line: items by kind, everything else raw, deltas not at all. */
function stored(ndjson: string): TranscriptMessage[] {
  return ndjson
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { method?: string; params?: { item?: unknown } })
    .filter((f) => !f.method?.endsWith("Delta") && !f.method?.endsWith("/delta"))
    .map((f) => msg(f.method === "item/started" || f.method === "item/completed" ? codexItemKind(f.params?.item) : "raw", f));
}

const sent = (method: string, id: number, text: string) => msg("user", { id, method, params: { threadId: "th-cmd", input: [{ type: "text", text, text_elements: [] }] } });
const answer = (id: number, decision: string) => msg("raw", { id, result: { decision } });

describe("Codex rows", () => {
  it("draws each item once, joins asks to their command and shows how they were answered", () => {
    const lines = stored(commandApproval);
    const askAt = (needle: string) => lines.findIndex((m) => JSON.stringify(m.raw).includes(needle));
    const rm = askAt('"method":"item/commandExecution/requestApproval","id":0');
    const gh = askAt('"method":"item/commandExecution/requestApproval","id":1');
    const messages = [
      sent("turn/start", 3, "Clean up"),
      ...lines.slice(0, rm + 1), answer(0, "acceptForSession"),
      ...lines.slice(rm + 1, gh + 1), answer(1, "decline"), sent("turn/steer", 4, "gh is not available"),
      ...lines.slice(gh + 1),
    ];
    const rows = toRows(messages, [], { cwd: "/wt" });
    expect(rows.map((r) => r.type)).toEqual(["task", "thinking", "tool", "ask", "tool", "ask", "user", "text", "result"]);

    const [task, thinking, rmTool, rmAsk, ghTool, ghAsk, steer, text, result] = rows as [Row, Row, ToolRow, Row, ToolRow, Row, Row, Row, Row];
    expect(task).toMatchObject({ text: "Clean up" });
    expect(thinking).toMatchObject({ text: "Clean the build first." });
    expect(rmTool).toMatchObject({ name: "Bash", summary: "rm -rf build", result: { text: "", isError: false } });
    expect(rmAsk).toMatchObject({ type: "ask", name: "Bash", summary: "rm -rf build", reason: "Remove the old build output", outcome: "allowed_run" });
    expect(askOutcomeText(rmAsk as Extract<Row, { type: "ask" }>)).toBe("allowed for this run");
    expect(ghTool.result).toEqual({ text: "declined", isError: true, at: expect.any(String) });
    expect(ghAsk).toMatchObject({ outcome: "denied" });
    expect(steer).toMatchObject({ type: "user", text: "gh is not available" });
    expect(text).toMatchObject({ text: "Build removed." });
    expect(result).toMatchObject({ ok: true, label: "Turn ended" });
  });

  it("puts a pending ask on its row so it can be answered there", () => {
    const lines = stored(commandApproval);
    const upTo = lines.findIndex((m) => JSON.stringify(m.raw).includes('/requestApproval","id":0'));
    const ask = { id: "a1", agentKind: "codex", requestId: "call_rm:0", state: "pending" } as PermissionAsk;
    const row = toRows(lines.slice(0, upTo + 1), [ask]).at(-1)!;
    expect(row).toMatchObject({ type: "ask", outcome: "pending", ask: { id: "a1" } });
  });

  it("shows a file change as a diff with its line counts", () => {
    const tool = toRows(stored(editPatch), [], { cwd: "/tmp/codex-work" }).find((r): r is ToolRow => r.type === "tool")!;
    expect(tool).toMatchObject({ name: "Edit", summary: "words.txt", diffStat: { added: 1, removed: 1 } });
    expect(tool.diff).toEqual([
      { op: " ", text: "alpha" },
      { op: "-", text: "beta" },
      { op: "+", text: "delta" },
      { op: " ", text: "gamma" },
    ]);
  });

  it("calls an interrupted turn stopped, not failed", () => {
    const rows = toRows([msg("raw", { method: "turn/completed", params: { turn: { id: "t", status: "interrupted" } } })]);
    expect(rows).toEqual([{ type: "result", id: expect.any(String), ok: true, label: "Turn stopped" }]);
  });

  it("types Codex's message deltas live", () => {
    const delta = (d: string) => ({ method: "item/agentMessage/delta", params: { itemId: "m", delta: d } });
    expect(applyDelta(applyDelta("", delta("b")), delta("loom"))).toBe("bloom");
  });
});
