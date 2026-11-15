import type { HttpClient, HttpMethod, HttpRequest, HttpResponse } from "../providers/http.js";

export interface FakeRequest {
  method: HttpMethod;
  /** Path and query, `/repos/acme/widgets/issues?state=open`. */
  path: string;
  /** Parsed JSON when the request sent JSON, else the string sent; undefined without a body. */
  body?: unknown;
  headers: Record<string, string>;
  host: string;
}

type Responder = HttpResponse | ((request: FakeRequest) => HttpResponse);

/**
 * Fake `HttpClient` for `api` adapters (issue #138): routes are matched on `METHOD path` by
 * prefix ending at a `/` or `?`, the longest first, like `fakeExec`. Unmatched requests answer 404. Every request is
 * recorded with its method, path and body.
 */
export function fakeHttp(routes: Record<string, Responder>): HttpClient & { requests: FakeRequest[] } {
  const requests: FakeRequest[] = [];
  const fn = (async (request: HttpRequest) => {
    const u = new URL(request.url);
    const recorded: FakeRequest = {
      method: request.method,
      path: u.pathname + u.search,
      ...(request.body !== undefined ? { body: request.body } : {}),
      headers: Object.fromEntries(Object.entries(request.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
      host: u.host,
    };
    requests.push(recorded);
    const line = `${recorded.method} ${recorded.path}`;
    const key = Object.keys(routes)
      .filter((k) => line === k || (line.startsWith(k) && "/?".includes(line[k.length]!)))
      .sort((a, b) => b.length - a.length)[0];
    if (key === undefined) return { status: 404, headers: {}, body: `fake: no route for ${line}` };
    const r = routes[key]!;
    return typeof r === "function" ? r(recorded) : r;
  }) as HttpClient & { requests: FakeRequest[] };
  fn.requests = requests;
  return fn;
}

export function json(body: unknown, status = 200): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) };
}

export function status(code: number, body = ""): HttpResponse {
  return { status: code, headers: {}, body };
}
