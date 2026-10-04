/**
 * The frames of `codex app-server --listen stdio://`: JSON-RPC 2.0 in shape, one object per line,
 * without the `jsonrpc` member (Bloom PROTOCOL.md, codex app-server protocol v2).
 */
export type Frame =
  /** The answer to one of donePM's requests. */
  | { type: "response"; id: number | string; result?: unknown; error?: { code?: number; message: string }; raw: unknown }
  /** Codex asks donePM something and waits for the answer (an approval, a question). */
  | { type: "request"; id: number | string; method: string; params: unknown; raw: unknown }
  | { type: "notification"; method: string; params: unknown; raw: unknown }
  /** JSON, but none of the above. Kept, never an error. */
  | { type: "unknown"; raw: unknown }
  | { type: "malformed"; line: string };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number | string => typeof v === "number" || typeof v === "string";

export function parseFrame(line: string): Frame {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { type: "malformed", line };
  }
  if (!isObject(raw)) return { type: "unknown", raw };
  const method = typeof raw.method === "string" ? raw.method : undefined;
  if (method !== undefined) {
    return isId(raw.id) ? { type: "request", id: raw.id, method, params: raw.params, raw } : { type: "notification", method, params: raw.params, raw };
  }
  if (isId(raw.id) && ("result" in raw || "error" in raw)) {
    if ("error" in raw) {
      const e = isObject(raw.error) ? raw.error : {};
      const message = typeof e.message === "string" ? e.message : JSON.stringify(raw.error);
      return { type: "response", id: raw.id, error: { ...(typeof e.code === "number" ? { code: e.code } : {}), message }, raw };
    }
    return { type: "response", id: raw.id, result: raw.result, raw };
  }
  return { type: "unknown", raw };
}

/** A request from donePM, as a line. */
export function requestLine(id: number, method: string, params: unknown): string {
  return JSON.stringify({ id, method, params });
}

export function notificationLine(method: string, params?: unknown): string {
  return JSON.stringify(params === undefined ? { method } : { method, params });
}

/** donePM's answer to one of Codex's requests. */
export function resultLine(id: number | string, result: unknown): string {
  return JSON.stringify({ id, result });
}

export function errorLine(id: number | string, code: number, message: string): string {
  return JSON.stringify({ id, error: { code, message } });
}
