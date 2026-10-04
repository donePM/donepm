import { azureOrganizationUrl } from "@donepm/core";
import type { HttpClient, HttpMethod } from "../providers/http.js";
import type { TokenStore } from "../providers/keychain.js";
import type { Exec } from "../process/exec.js";

/** The `api-version` every call names, so a new default at Microsoft changes nothing here. */
export const AZURE_API_VERSION = "7.1";

/** The Microsoft Entra resource id of Azure DevOps, which `az rest` asks a token for. */
export const AZURE_DEVOPS_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";

/** One REST call to an organization, by path below `https://dev.azure.com/<org>/`. */
export interface AzureCall {
  method: HttpMethod;
  /** `Platform/_apis/git/repositories/legacy/pullrequests`, segments encoded already. */
  path: string;
  /** Besides `api-version`, which is always set. */
  query?: Record<string, string>;
  body?: unknown;
}

export type AzureAnswer = { ok: true; body: string } | { ok: false; error: string; reason?: "unauthorized" | "unreachable" };

/**
 * How the Azure DevOps adapter reaches one organization (issue #141): the same REST calls through
 * `az rest` with the user's `az login` (`cli`) or with a personal access token from the Keychain
 * (`api`). Never throws; the token never reaches an answer, an error or a log.
 */
export type AzureTransport = (call: AzureCall) => Promise<AzureAnswer>;

export function azureUrl(organization: string, call: Pick<AzureCall, "path" | "query">): string {
  const url = new URL(`${azureOrganizationUrl(organization)}/${call.path}`);
  for (const [k, v] of Object.entries(call.query ?? {})) url.searchParams.set(k, v);
  if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", AZURE_API_VERSION);
  return url.toString();
}

/** Encodes one path segment: a project or repository name may have blanks. */
export const seg = (s: string): string => encodeURIComponent(s);

/** The `message` of an Azure DevOps error body, if it has one. */
function messageOf(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The REST API with a personal access token (`api`), read from the Keychain at call time. A
 * refused token answers 401, or 203 with a sign-in page, so both read as refused.
 */
export function azureApiTransport(http: HttpClient, organization: string, tokens: TokenStore, id: string): AzureTransport {
  return async (call) => {
    const token = await tokens.read(id);
    if (!token) return { ok: false, error: `no API token for ${id} in the Keychain`, reason: "unauthorized" };
    const r = await http({
      method: call.method,
      url: azureUrl(organization, call),
      headers: { authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`, accept: "application/json" },
      ...(call.body !== undefined ? { body: call.body } : {}),
    });
    if (r.status === 0) return { ok: false, error: `Azure DevOps is unreachable: ${r.body}`, reason: "unreachable" };
    if (r.status === 401 || r.status === 203) return { ok: false, error: `Azure DevOps refused the API token of ${id} (HTTP ${r.status})`, reason: "unauthorized" };
    if (r.status < 200 || r.status > 299) return { ok: false, error: `Azure DevOps: ${messageOf(r.body) ?? "request failed"} (HTTP ${r.status})` };
    return { ok: true, body: r.body };
  };
}

/** Lines of `az` stderr kept for the user. */
const STDERR_TAIL_LINES = 10;

/**
 * The REST API through `az rest` (`cli`): `az` asks Microsoft Entra for a token with the user's
 * `az login` and keeps it to itself. Only the daemon runs `az`; it is blocked for the agent.
 */
export function azureCliTransport(exec: Exec, organization: string): AzureTransport {
  return async (call) => {
    const args = ["rest", "--method", call.method, "--url", azureUrl(organization, call), "--resource", AZURE_DEVOPS_RESOURCE, "--only-show-errors"];
    if (call.body !== undefined) args.push("--headers", "Content-Type=application/json", "--body", JSON.stringify(call.body));
    const r = await exec("az", args);
    if (r.code === -1) return { ok: false, error: "az is not installed" };
    if (r.code !== 0) {
      const tail = r.stderr.trimEnd().split("\n").slice(-STDERR_TAIL_LINES).join("\n").trim();
      return { ok: false, error: tail || `az rest exited with ${r.code}` };
    }
    return { ok: true, body: r.stdout };
  };
}
