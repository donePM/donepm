import type { Playbook } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { fixture } from "../../test-support/fake-exec.js";
import type { AdapterLaunch, AgentStep, AgentWrite } from "../adapter.js";
import { CodexConnection } from "./connection.js";

const playbook: Pick<Playbook, "model" | "effort" | "permissionMode" | "readOnly"> = { model: "gpt-5.5", effort: "high", permissionMode: "acceptEdits" };
const launch: AdapterLaunch = { itemId: "item-1", cwd: "/wt", playbook };

const lines = (name: string) => fixture(`codex/${name}`).split("\n").filter((l) => l.trim() !== "");
const writes = (steps: AgentStep[]) => steps.filter((s): s is AgentWrite => s.type === "write").map((s) => JSON.parse(s.line) as Record<string, any>);
const events = (steps: AgentStep[]) => steps.filter((s) => s.type !== "write");
const decodeAll = (c: CodexConnection, ls: string[]) => ls.flatMap((l) => c.decode(l));

describe("CodexConnection", () => {
  it("initializes, starts a thread and a turn with the playbook's policy, and ends it", () => {
    const c = new CodexConnection(launch);
    const first = writes(c.firstTurn("Do it"));
    expect(first).toEqual([{
      id: 1, method: "initialize",
      params: { clientInfo: { name: "donepm", title: "donePM", version: "0" }, capabilities: expect.objectContaining({ experimentalApi: true, requestAttestation: false }) },
    }]);
    const all = lines("turn.ndjson");

    const init = c.decode(all[0]!);
    expect(writes(init)).toEqual([
      { method: "initialized" },
      { id: 2, method: "thread/start", params: { cwd: "/wt", approvalPolicy: "on-request", approvalsReviewer: "user", model: "gpt-5.5" } },
    ]);

    const thread = decodeAll(c, all.slice(1, 3));
    expect(events(thread)).toContainEqual({ type: "session_bound", sessionId: "01a02144-3b7e-7233-97f2-73ebd5105085" });
    const turnStart = thread.find((s): s is AgentWrite => s.type === "write")!;
    expect(turnStart.record?.kind).toBe("user");
    expect(JSON.parse(turnStart.line)).toEqual({
      id: 3, method: "turn/start",
      params: {
        threadId: "01a02144-3b7e-7233-97f2-73ebd5105085",
        input: [{ type: "text", text: "Do it", text_elements: [] }],
        cwd: "/wt", approvalPolicy: "on-request", approvalsReviewer: "user",
        model: "gpt-5.5", effort: "high",
      },
    });

    const rest = decodeAll(c, all.slice(3));
    const kinds = events(rest).map((e) => (e.type === "message" ? `message:${e.kind}` : e.type));
    expect(kinds).toContain("turn_started");
    expect(kinds.filter((k) => k === "live")).toHaveLength(2);
    expect(kinds).toContain("message:assistant_text");
    expect(kinds.slice(-2)).toEqual(["usage", "turn_ended"]);
    expect(rest.at(-2)).toEqual({ type: "usage", usage: { inputTokens: 16159, outputTokens: 6, cacheReadInputTokens: 11008, cacheWriteInputTokens: 0, reasoningTokens: 0 } });
    expect(rest.at(-1)).toEqual({ type: "turn_ended", isError: false, interrupted: false, detail: "completed" });
    // Nothing unknown fails: the rate limits, MCP status and the like are kept raw.
    expect(kinds).toContain("raw");
  });

  it("resumes the thread and counts only this process's usage", () => {
    const c = new CodexConnection({ ...launch, resumeSessionId: "01a02144-3b7e-7233-97f2-73ebd5105085" });
    c.firstTurn("Create note.txt");
    const all = lines("resume-file-approval.ndjson");
    const resume = writes(c.decode(all[0]!))[1];
    expect(resume).toMatchObject({ id: 2, method: "thread/resume", params: { threadId: "01a02144-3b7e-7233-97f2-73ebd5105085", cwd: "/wt" } });
    expect(resume).not.toHaveProperty("params.sandbox");
    const steps = decodeAll(c, all.slice(1, 36));
    const ask = steps.find((s) => s.type === "ask");
    expect(ask).toBeUndefined();
    const requested = c.decode(all[36]!);
    expect(events(requested).at(-1)).toEqual({
      type: "ask",
      ask: {
        requestId: "exec-dfa01654-b539-4b5e-955a-71f3915b1d46:0",
        toolName: "item/fileChange/requestApproval",
        input: expect.objectContaining({ itemId: "exec-dfa01654-b539-4b5e-955a-71f3915b1d46" }),
        subject: { kind: "file_change", path: "/tmp/codex-work/note.txt", diff: expect.stringContaining("+hi") },
      },
    });
    const declined = c.answerAsk({ requestId: "exec-dfa01654-b539-4b5e-955a-71f3915b1d46:0", toolName: "item/fileChange/requestApproval", input: {} }, { behavior: "deny", message: "Not that file" });
    expect(writes(declined)).toEqual([
      { id: 0, result: { decision: "decline" } },
      { id: 4, method: "turn/steer", params: { threadId: "01a02144-3b7e-7233-97f2-73ebd5105085", input: [{ type: "text", text: "Not that file", text_elements: [] }], expectedTurnId: "01a02145-01e1-7a60-8b66-9a343160c352" } },
    ]);
    const end = decodeAll(c, all.slice(37));
    // 84002 total now, 49375 before this process: only the difference is this run's.
    expect(end.at(-2)).toEqual({ type: "usage", usage: { inputTokens: 83752 - 49262, outputTokens: 250 - 113, cacheReadInputTokens: 74496 - 42240, cacheWriteInputTokens: 0, reasoningTokens: 48 } });
    expect(end.at(-1)).toMatchObject({ type: "turn_ended", isError: false });
  });

  it("answers an allow with accept, or acceptForSession for the run", () => {
    const c = started("command-approval.ndjson", 10);
    const ask = events(c.steps).find((s) => s.type === "ask");
    expect(ask).toMatchObject({ ask: { requestId: "call_rm:0", subject: { kind: "command", command: "rm -rf build", cwd: "/wt" }, reason: "Remove the old build output" } });
    const ref = { requestId: "call_rm:0", toolName: "item/commandExecution/requestApproval", input: {} };
    expect(writes(c.conn.answerAsk(ref, { behavior: "allow", forRun: true }))).toEqual([{ id: 0, result: { decision: "acceptForSession" } }]);
    // Answered once: a second answer has nothing to go to.
    expect(c.conn.answerAsk(ref, { behavior: "allow" })).toEqual([]);
  });

  it("declines gh itself and tells the agent to use the draft tools, without asking the user", () => {
    const c = started("command-approval.ndjson", 14);
    const steps = c.conn.decode(c.all[14]!);
    expect(steps.some((s) => s.type === "ask")).toBe(false);
    const sent = writes(steps);
    expect(sent[0]).toEqual({ id: 1, result: { decision: "decline" } });
    expect(sent[1]).toMatchObject({ method: "turn/steer", params: { expectedTurnId: "tu-1" } });
    expect(sent[1]!.params.input[0].text).toContain("`gh`");
  });

  it("maps tool items to tool events and drops the deltas it opted out of", () => {
    const c = started("command-approval.ndjson", 5);
    const steps = decodeAll(c.conn, c.all.slice(5, 9));
    expect(events(steps).map((e) => e.type)).toEqual(["message", "message", "message", "tool_started"]);
    expect(steps.at(-1)).toEqual({ type: "tool_started", id: "call_rm", name: "Bash", summary: "rm -rf build" });
    expect(events(c.conn.decode(c.all[12]!)).map((e) => e.type)).toEqual(["message", "tool_finished"]);
  });

  it("cancels on a deny that interrupts, and asks the turn to stop on interrupt()", () => {
    const c = started("command-approval.ndjson", 10);
    const ref = { requestId: "call_rm:0", toolName: "item/commandExecution/requestApproval", input: {} };
    expect(writes(c.conn.answerAsk(ref, { behavior: "deny", message: "stop", interrupt: true }))).toEqual([{ id: 0, result: { decision: "cancel" } }]);
    expect(writes(c.conn.interrupt())).toEqual([{ id: 4, method: "turn/interrupt", params: { threadId: "th-cmd", turnId: "tu-1" } }]);
  });

  it("ends an interrupted turn as interrupted", () => {
    const c = new CodexConnection({ ...launch, resumeSessionId: "01a02144-3b7e-7233-97f2-73ebd5105085" });
    c.firstTurn("Count");
    const all = lines("resume-interrupt.ndjson");
    decodeAll(c, all.slice(0, 18));
    expect(writes(c.interrupt())[0]).toMatchObject({ id: 4, method: "turn/interrupt" });
    const end = decodeAll(c, all.slice(18));
    expect(end.at(-1)).toEqual({ type: "turn_ended", isError: false, interrupted: true, detail: "interrupted" });
    expect(end.at(-2)).toEqual({ type: "usage", usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, reasoningTokens: 0 } });
  });

  it("steers a later message into the running turn, and starts a new turn when none runs", () => {
    const c = started("command-approval.ndjson", 5);
    expect(writes(c.conn.nextTurn("Also add a test"))).toEqual([
      { id: 4, method: "turn/steer", params: { threadId: "th-cmd", input: [{ type: "text", text: "Also add a test", text_elements: [] }], expectedTurnId: "tu-1" } },
    ]);
    // The turn ended before the steer arrived: the words start the next turn.
    decodeAll(c.conn, [c.all.at(-1)!]);
    const retried = c.conn.decode(JSON.stringify({ id: 4, error: { code: -32600, message: "no active turn" } }));
    expect(writes(retried)).toEqual([expect.objectContaining({ id: 5, method: "turn/start", params: expect.objectContaining({ input: [{ type: "text", text: "Also add a test", text_elements: [] }] }) })]);
    expect(writes(c.conn.nextTurn("And docs"))).toEqual([]);
  });

  it("queues words sent while the thread is opening into the first turn", () => {
    const c = new CodexConnection(launch);
    c.firstTurn("Do it");
    expect(c.nextTurn("And this")).toEqual([]);
    const all = lines("command-approval.ndjson");
    const steps = decodeAll(c, all.slice(0, 2));
    expect(writes(steps).at(-1)!.params.input.map((i: { text: string }) => i.text)).toEqual(["Do it", "And this"]);
  });

  it("ends the turn when the thread cannot be opened", () => {
    const c = new CodexConnection({ ...launch, resumeSessionId: "gone" });
    c.firstTurn("Go on");
    c.decode(lines("turn.ndjson")[0]!);
    const steps = c.decode(JSON.stringify({ id: 2, error: { code: -32600, message: "thread not found" } }));
    expect(steps.at(-1)).toEqual({ type: "turn_ended", isError: true, interrupted: false, detail: "thread/resume failed: thread not found" });
  });

  it("answers requests it does not handle with an error, and never grants more permissions", () => {
    const c = started("command-approval.ndjson", 5);
    expect(writes(c.conn.decode(JSON.stringify({ method: "item/tool/call", id: 7, params: {} })))).toEqual([
      { id: 7, error: { code: -32601, message: "donePM does not handle item/tool/call" } },
    ]);
    expect(writes(c.conn.decode(JSON.stringify({ method: "item/permissions/requestApproval", id: 8, params: { threadId: "th-cmd", turnId: "tu-1", itemId: "x" } })))).toEqual([
      { id: 8, result: { permissions: {}, scope: "turn" } },
    ]);
    expect(c.conn.decode("{oops")).toEqual([{ type: "malformed", line: "{oops" }]);
    expect(c.conn.decode("[1]")).toEqual([{ type: "raw", raw: [1] }]);
  });

  it("relays a question and its answers, but never a request for a secret", () => {
    const c = started("command-approval.ndjson", 5);
    const question = { threadId: "th-cmd", turnId: "tu-1", itemId: "q1", questions: [{ id: "lang", header: "Lang", question: "Which language?", isOther: false, isSecret: false, options: [{ label: "TS", description: "" }] }] };
    const asked = events(c.conn.decode(JSON.stringify({ method: "item/tool/requestUserInput", id: 2, params: question })));
    expect(asked.at(-1)).toMatchObject({ type: "ask", ask: { requestId: "q1:2", subject: { kind: "question" } } });
    expect(writes(c.conn.answerAsk({ requestId: "q1:2", toolName: "", input: {} }, { behavior: "allow", answers: { "Which language?": "TS" } }))).toEqual([
      { id: 2, result: { answers: { lang: { answers: ["TS"] } } } },
    ]);
    const secret = { ...question, itemId: "q2", questions: [{ ...question.questions[0], isSecret: true }] };
    const steps = c.conn.decode(JSON.stringify({ method: "item/tool/requestUserInput", id: 3, params: secret }));
    expect(steps.some((s) => s.type === "ask")).toBe(false);
    expect(writes(steps)[0]).toEqual({ id: 3, result: { answers: {} } });
  });
});

/** A connection fed the first `upTo` lines of a fixture, after `firstTurn`. */
function started(name: string, upTo: number) {
  const conn = new CodexConnection(launch);
  conn.firstTurn("Do it");
  const all = lines(name);
  const steps = decodeAll(conn, all.slice(0, upTo));
  return { conn, all, steps };
}
