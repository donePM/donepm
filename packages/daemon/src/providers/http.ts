export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpRequest {
  method: HttpMethod;
  /** Absolute URL, `https://host/path?query`. */
  url: string;
  /** May carry the connection's token (D8); a client never logs headers. */
  headers?: Record<string, string>;
  /** A string is sent as is; anything else as JSON with `content-type: application/json`. */
  body?: unknown;
  timeoutMs?: number;
}

export interface HttpResponse {
  /** The HTTP status; 0 when no answer came (network error, timeout), with the reason in `body`. */
  status: number;
  /** Lower-case names. */
  headers: Record<string, string>;
  body: string;
}

/**
 * How an `api` backend (issue #138) talks to its provider: one request, one answer, never a throw.
 * Injected like `Exec`, so adapters are tested against `FakeHttpClient` and never reach the network.
 */
export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

const DEFAULT_TIMEOUT_MS = 30_000;

/** The client the daemon uses: `fetch`. Only the daemon calls it, never the agent. */
export const fetchHttp: HttpClient = async (request) => {
  const headers: Record<string, string> = { ...request.headers };
  let body: string | undefined;
  if (typeof request.body === "string") body = request.body;
  else if (request.body !== undefined) {
    body = JSON.stringify(request.body);
    if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
  }
  try {
    const r = await fetch(request.url, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    return { status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() };
  } catch (e) {
    return { status: 0, headers: {}, body: (e as Error).message };
  }
};
