/** `POST /api/x: message` → `message`, for showing API errors next to the button that caused them. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^\w+ \S+: /, "") : String(e);
}
