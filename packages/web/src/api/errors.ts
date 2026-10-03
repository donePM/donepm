import { ApiError } from "./client";

/** `POST /api/x: message` → `message`, for showing API errors next to the button that caused them. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^\w+ \S+: /, "") : String(e);
}

/**
 * Publishing an approved draft failed (502). The item's attention carries the same error, so
 * views that show the attention need not show it twice.
 */
export function isPublishFailure(e: unknown): boolean {
  return e instanceof ApiError && e.status === 502;
}
