import { askFlags, parseRules, sessionRules, type AskFlags, type PermissionRule, type TranscriptKind } from "@donepm/core";

/** One stdout line of `claude -p --output-format stream-json`, decoded as far as donePM needs it. */
export type Decoded =
  /** `system/init`: a turn starts. The first one binds the session. */
  | { type: "init"; sessionId: string; raw: unknown }
  /** Stored as a transcript message. */
  | { type: "message"; kind: TranscriptKind; sessionId: string | undefined; raw: unknown }
  /** Live typing only; pushed to the UI, never stored. */
  | { type: "stream"; sessionId: string | undefined; event: unknown }
  /**
   * `control_request/can_use_tool`: the CLI holds the turn until it gets an answer. `rules` are the
   * suggested allow rules "Allow for this run" may grant (`sessionRules`): only the asked tool's,
   * none when the request says to suppress them. `suggested` and `flags` are what the CLI sent, for
   * matching "Always allow" grants (D38).
   */
  | {
      type: "ask"; requestId: string; toolName: string; input: unknown; rules: PermissionRule[];
      suggested: PermissionRule[]; flags: AskFlags; reason?: string; raw: unknown;
    }
  /** Last line of a turn. */
  | { type: "result"; sessionId: string | undefined; isError: boolean; subtype: string | undefined; raw: unknown }
  /** Not JSON, e.g. a line cut off by a crash. Skipped. */
  | { type: "malformed"; line: string };

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * Decode one line. Never throws: unknown types and subtypes come back as `raw` messages so they are
 * stored and a renderer added later can show them (spec 9.3, Bloom PROTOCOL.md "Rules for the decoder").
 */
export function decodeLine(line: string): Decoded {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return { type: "malformed", line };
  }
  if (!isObject(msg)) return { type: "malformed", line };
  const sessionId = str(msg.session_id);
  const raw = msg;

  switch (msg.type) {
    case "system":
      if (msg.subtype === "init" && sessionId) return { type: "init", sessionId, raw };
      break;
    case "assistant":
      return { type: "message", kind: assistantKind(msg), sessionId, raw };
    case "user":
      return { type: "message", kind: userKind(msg), sessionId, raw };
    case "stream_event":
      return { type: "stream", sessionId, event: msg.event };
    case "result":
      return { type: "result", sessionId, isError: msg.is_error === true, subtype: str(msg.subtype), raw };
    case "control_request": {
      const req = msg.request;
      const requestId = str(msg.request_id);
      if (isObject(req) && req.subtype === "can_use_tool" && requestId) {
        const toolName = str(req.tool_name) ?? "unknown";
        const suggested = suggestedRules(req.permission_suggestions);
        const flags = askFlags(req);
        const rules = sessionRules(toolName, suggested, flags);
        const reason = str(req.decision_reason);
        return { type: "ask", requestId, toolName, input: req.input ?? {}, rules, suggested, flags, ...(reason ? { reason } : {}), raw };
      }
      break;
    }
  }
  return { type: "message", kind: "raw", sessionId, raw };
}

/**
 * Rules from `permission_suggestions`. Only "add allow rules" suggestions count; anything else
 * (other types, deny, malformed) is dropped. The suggested destination is ignored: grants are
 * always for the session (see `askAnswerLine`).
 */
function suggestedRules(suggestions: unknown): PermissionRule[] {
  if (!Array.isArray(suggestions)) return [];
  return (suggestions as unknown[]).flatMap((s) =>
    isObject(s) && s.type === "addRules" && s.behavior === "allow" ? parseRules(s.rules) : [],
  );
}

/** `assistant` events carry exactly one content block. */
function assistantKind(msg: Json): TranscriptKind {
  const block = firstBlock(msg);
  switch (block?.type) {
    case "text":
      return "assistant_text";
    case "thinking":
      return "assistant_thinking";
    case "tool_use":
      return "tool_use";
    default:
      return "raw";
  }
}

/** `user` events from the CLI are tool results; plain text is a message fed into the session. */
function userKind(msg: Json): TranscriptKind {
  const message = msg.message;
  if (isObject(message) && typeof message.content === "string") return "user";
  const block = firstBlock(msg);
  if (block?.type === "tool_result") return "tool_result";
  if (block?.type === "text") return "user";
  return "raw";
}

function firstBlock(msg: Json): Json | undefined {
  const message = msg.message;
  if (!isObject(message) || !Array.isArray(message.content)) return undefined;
  const first: unknown = message.content[0];
  return isObject(first) ? first : undefined;
}
