import type { JiraConnectionConfig } from "../config/connections.js";
import type { HttpClient, HttpMethod } from "../providers/http.js";
import type { TokenStore } from "../providers/keychain.js";

/** Why a Jira call failed, in the terms the status and the poll use. */
export type JiraFailure = "no_token" | "unauthorized" | "unreachable" | "rate_limited" | "not_found" | "error";

export type JiraAnswer =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; failure: JiraFailure; error: string; retryAfterSeconds?: number };

/**
 * One Jira site over its REST API (D51). Cloud speaks v3 and signs in with Basic `email:API token`;
 * Data Center speaks v2 and takes its personal access token as a Bearer token. The token is read
 * from the Keychain per call and goes nowhere but the `authorization` header.
 */
export interface JiraClient {
  readonly config: JiraConnectionConfig;
  /** `3` on Cloud, `2` on Data Center: the version of `/rest/api/{v}/…` paths. */
  readonly apiVersion: "2" | "3";
  /** `path` starts with `/rest/`; `query` values are encoded here. */
  call(method: HttpMethod, path: string, options?: { query?: Record<string, string>; body?: unknown }): Promise<JiraAnswer>;
}

export function jiraClient(config: JiraConnectionConfig, http: HttpClient, tokens: TokenStore): JiraClient {
  const apiVersion = config.deployment === "cloud" ? "3" : "2";
  return {
    config,
    apiVersion,
    async call(method, path, options = {}) {
      const token = await tokens.read(config.id);
      if (!token) return { ok: false, status: 0, failure: "no_token", error: "no API token in the Keychain" };
      const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : "";
      const r = await http({
        method,
        url: `${config.baseUrl}${path}${query}`,
        headers: { authorization: authorization(config, token), accept: "application/json" },
        ...(options.body !== undefined ? { body: options.body } : {}),
      });
      if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status, body: parseBody(r.body) };
      return failed(r.status, r.body, r.headers["retry-after"]);
    },
  };
}

function authorization(config: JiraConnectionConfig, token: string): string {
  if (config.deployment === "cloud") return `Basic ${Buffer.from(`${config.email ?? ""}:${token}`).toString("base64")}`;
  return `Bearer ${token}`;
}

function parseBody(body: string): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function failed(status: number, body: string, retryAfter: string | undefined): JiraAnswer {
  if (status === 0) return { ok: false, status, failure: "unreachable", error: body ? `Jira did not answer: ${body}` : "Jira did not answer" };
  const failure: JiraFailure =
    status === 401 || status === 403 ? "unauthorized" : status === 429 ? "rate_limited" : status === 404 ? "not_found" : "error";
  const seconds = retryAfter !== undefined ? Number(retryAfter) : NaN;
  return {
    ok: false,
    status,
    failure,
    error: jiraError(status, body),
    ...(Number.isFinite(seconds) ? { retryAfterSeconds: seconds } : {}),
  };
}

/** Jira answers errors as `{errorMessages: [...], errors: {field: message}}`; anything else by status. */
export function jiraError(status: number, body: string): string {
  const parsed = parseBody(body) as { errorMessages?: unknown; errors?: unknown; message?: unknown } | undefined;
  const messages: string[] = [];
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.errorMessages)) messages.push(...parsed.errorMessages.filter((m): m is string => typeof m === "string"));
    if (parsed.errors && typeof parsed.errors === "object") {
      for (const [field, m] of Object.entries(parsed.errors)) if (typeof m === "string") messages.push(`${field}: ${m}`);
    }
    if (typeof parsed.message === "string") messages.push(parsed.message);
  }
  return messages.length ? `Jira answered ${status}: ${messages.join("; ")}` : `Jira answered ${status}`;
}
