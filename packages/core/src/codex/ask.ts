import type { Answers, Question } from "../ask/question.js";
import type { AskSubject } from "../ask/subject.js";
import { codexDiff, unwrapShell } from "./items.js";

// Codex's server requests that wait on the user (app-server protocol v2), as asks (issue #137).

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

export const CODEX_COMMAND_APPROVAL = "item/commandExecution/requestApproval";
export const CODEX_FILE_APPROVAL = "item/fileChange/requestApproval";
export const CODEX_USER_INPUT = "item/tool/requestUserInput";
export const CODEX_ELICITATION = "mcpServer/elicitation/request";

/** Server requests that become an ask; Codex holds the turn until each is answered. */
export const CODEX_ASK_METHODS: readonly string[] = [CODEX_COMMAND_APPROVAL, CODEX_FILE_APPROVAL, CODEX_USER_INPUT, CODEX_ELICITATION];

/**
 * The ask's request id. Codex numbers its requests per process from 0, so the number alone repeats
 * after a resume; the item (or turn) it belongs to makes it unique for the item.
 */
export function codexRequestId(params: unknown, id: string | number): string {
  const p = isObject(params) ? params : {};
  return `${str(p.itemId) ?? str(p.turnId) ?? str(p.threadId) ?? "-"}:${id}`;
}

/**
 * What a Codex ask is about. `item` is the thread item the request is for, as `item/started` sent
 * it: a file change's diff is there, not on the request.
 */
export function codexAskSubject(method: string, params: unknown, item?: unknown, cwd?: string): AskSubject {
  const p = isObject(params) ? params : {};
  switch (method) {
    case CODEX_COMMAND_APPROVAL: {
      const network = isObject(p.networkApprovalContext) ? str(p.networkApprovalContext.host) : undefined;
      if (network) return { kind: "network", host: network };
      const raw = str(p.command) ?? (isObject(item) ? str(item.command) : undefined);
      if (raw) {
        const where = str(p.cwd);
        return { kind: "command", command: unwrapShell(raw), ...(where ? { cwd: where } : {}) };
      }
      break;
    }
    case CODEX_FILE_APPROVAL: {
      const changes = isObject(item) && Array.isArray(item.changes) ? item.changes.filter(isObject) : [];
      const path = str(changes[0]?.path);
      if (path) return { kind: "file_change", path, diff: codexDiff(item, cwd) };
      break;
    }
    case CODEX_USER_INPUT:
      return { kind: "question", questions: codexQuestions(params) };
    case CODEX_ELICITATION: {
      const server = str(p.serverName) ?? "?";
      const url = str(p.url);
      return { kind: "tool", name: `mcp:${server}`, input: { message: str(p.message) ?? "", ...(url ? { url } : {}) } };
    }
  }
  return { kind: "tool", name: method, input: params };
}

/** The questions of `item/tool/requestUserInput` in donePM's shape, keyed by their text. */
export function codexQuestions(params: unknown): Question[] {
  const list = isObject(params) && Array.isArray(params.questions) ? params.questions.filter(isObject) : [];
  return list.flatMap((q) => {
    const question = str(q.question);
    if (!question) return [];
    const options = Array.isArray(q.options) ? q.options.filter(isObject) : [];
    return [{
      question,
      header: str(q.header) ?? "",
      multiSelect: false,
      options: options.flatMap((o) => (str(o.label) ? [{ label: o.label as string, description: str(o.description) ?? "" }] : [])),
    }];
  });
}

/**
 * Whether a user-input request asks for a secret. donePM never relays one: the answer would sit in
 * its event log, and the agent is not to be handed credentials.
 */
export function codexAsksSecret(params: unknown): boolean {
  return isObject(params) && Array.isArray(params.questions) && params.questions.some((q) => isObject(q) && q.isSecret === true);
}

/** The user's answers (by question text) as Codex wants them: by question id. */
export function codexAnswers(params: unknown, answers: Answers): { answers: Record<string, { answers: string[] }> } {
  const list = isObject(params) && Array.isArray(params.questions) ? params.questions.filter(isObject) : [];
  const out: Record<string, { answers: string[] }> = {};
  for (const q of list) {
    const id = str(q.id);
    const text = str(q.question);
    if (id && text && answers[text] !== undefined) out[id] = { answers: [answers[text]] };
  }
  return { answers: out };
}
