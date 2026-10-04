import type { AgentKind, MergeMethod, PermissionGrant } from "@donepm/core";
import type {
  AskAnswer, CloneResult, ConnectionTest, DaemonInfo, Draft, ItemDetail, ItemDiff, ItemView, MoveOutcome, OpenTarget, OrphanWorktree, PlaybookList, PrDraftPayload, RepoView, Settings, SourceTest, Status, TicketSourceTest,
  TranscriptMessage,
} from "./types";

export type WorktreeChoice = "move" | "leave";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const msg = (data as { error?: string } | undefined)?.error ?? res.statusText;
    throw new ApiError(`${method} ${path}: ${msg}`, res.status, data);
  }
  return data as T;
}

export const api = {
  items: () => call<ItemView[]>("GET", "/api/items"),
  archive: () => call<ItemView[]>("GET", "/api/archive"),
  item: (id: string) => call<ItemDetail>("GET", `/api/items/${encodeURIComponent(id)}`),
  diff: (id: string) => call<ItemDiff>("GET", `/api/items/${encodeURIComponent(id)}/diff`),
  open: (id: string, target: OpenTarget) => call<{ ok: true }>("POST", `/api/items/${encodeURIComponent(id)}/open`, { target }),
  editDraft: (id: string, payload: Partial<PrDraftPayload>) =>
    call<Draft>("POST", `/api/drafts/${encodeURIComponent(id)}/edit`, { payload }),
  approveDraft: (id: string) => call<Draft>("POST", `/api/drafts/${encodeURIComponent(id)}/approve`, {}),
  rejectDraft: (id: string, reason?: string) =>
    call<Draft>("POST", `/api/drafts/${encodeURIComponent(id)}/reject`, reason ? { reason } : {}),
  start: (id: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/start`),
  resume: (id: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/resume`),
  removeWorktree: (id: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/worktree/remove`),
  orphans: () => call<OrphanWorktree[]>("GET", "/api/worktrees/orphaned"),
  removeOrphan: (path: string) => call<{ ok: true }>("POST", "/api/worktrees/orphaned/remove", { path }),
  stop: (id: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/stop`),
  rerunCi: (id: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/ci/rerun`),
  markCiDone: (id: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/ci/done`),
  fixCi: (id: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/ci/fix`),
  resolveConflict: (id: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/conflict/resolve`),
  dismissConflict: (id: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/conflict/dismiss`),
  addressFeedback: (id: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/feedback/address`),
  dismissFeedback: (id: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/feedback/dismiss`),
  commentOnPr: (id: string, body: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/pr/comment`, { body }),
  updatePrBranch: (id: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/pr/update-branch`),
  mergePr: (id: string, method: MergeMethod) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/pr/merge`, { method }),
  setAutoMerge: (id: string, on: boolean) => call<ItemView>("PUT", `/api/items/${encodeURIComponent(id)}/auto-merge`, { on }),
  /** A ticket's repository, among its candidates; until the agent first starts (issue #139). */
  chooseRepo: (id: string, origin: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/repo`, { origin }),
  setPlaybook: (id: string, playbook: string) => call<ItemView>("PUT", `/api/items/${encodeURIComponent(id)}/playbook`, { playbook }),
  setAgent: (id: string, agent: AgentKind) => call<ItemView>("PUT", `/api/items/${encodeURIComponent(id)}/agent`, { agent }),
  /** A note to the running agent; it joins the running turn. */
  say: (id: string, text: string) => call<{ ok: true }>("POST", `/api/items/${encodeURIComponent(id)}/say`, { text }),
  dismiss: (id: string) => call<ItemView>("POST", `/api/items/${encodeURIComponent(id)}/dismiss`),
  transcript: (id: string, after?: string) =>
    call<TranscriptMessage[]>(
      "GET",
      `/api/items/${encodeURIComponent(id)}/transcript${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    ),
  answer: (askId: string, answer: AskAnswer) => call<{ ok: true }>("POST", `/api/asks/${encodeURIComponent(askId)}/answer`, answer),
  grants: () => call<PermissionGrant[]>("GET", "/api/grants"),
  revokeGrant: (id: string) => call<PermissionGrant>("POST", `/api/grants/${encodeURIComponent(id)}/revoke`),
  repos: () => call<RepoView[]>("GET", "/api/repos"),
  rescan: () => call<RepoView[]>("POST", "/api/repos/rescan"),
  /** Throws ApiError 409 when the target is occupied or a clone of the origin runs already. */
  cloneRepo: (origin: string) => call<CloneResult>("POST", "/api/repos/clone", { origin }),
  setManaged: (id: string, managed: boolean) =>
    call<{ repos: RepoView[]; settings: Settings }>("PUT", `/api/repos/${encodeURIComponent(id)}`, { managed }),
  status: () => call<Status>("GET", "/api/status"),
  recheck: () => call<Status>("POST", "/api/status/recheck"),
  settings: () => call<Settings>("GET", "/api/settings"),
  /** Throws ApiError 409 with `worktreesAtOldRoot` when the root changes and no choice is given (#93). */
  saveSettings: (patch: Partial<Omit<Settings, "previousWorktreeRoots">>, worktrees?: WorktreeChoice) =>
    call<{ settings: Settings; restartRequired: boolean; worktrees?: MoveOutcome }>(
      "PUT",
      `/api/settings${worktrees ? `?worktrees=${worktrees}` : ""}`,
      patch,
    ),
  playbooks: () => call<PlaybookList>("GET", "/api/playbooks"),
  daemon: () => call<DaemonInfo>("GET", "/api/daemon"),
  /** Throws ApiError 409 when the daemon was started by hand and cannot be restarted from here. */
  restartDaemon: () => call<{ ok: true }>("POST", "/api/daemon/restart", {}),
  /** Shows the log file or the global playbooks folder in Finder. */
  openDaemon: (what: "logs" | "playbooks") => call<{ ok: true }>("POST", "/api/daemon/open", { what }),
  testSource: (origin: string, query: string) => call<SourceTest>("POST", "/api/sources/test", { origin, query }),
  /** Runs a ticket source's query once (issue #139). */
  testTicketSource: (connection: string, query?: string, project?: string) =>
    call<TicketSourceTest>("POST", "/api/ticket-sources/test", { connection, ...(query ? { query } : {}), ...(project ? { project } : {}) }),
  /** The token goes to the Keychain; the answer says only that one is set. */
  setToken: (id: string, token: string) => call<{ id: string; tokenSet: boolean }>("PUT", `/api/connections/${encodeURIComponent(id)}/token`, { token }),
  deleteToken: (id: string) => call<{ id: string; tokenSet: boolean }>("DELETE", `/api/connections/${encodeURIComponent(id)}/token`),
  testConnection: (id: string) => call<ConnectionTest>("POST", `/api/connections/${encodeURIComponent(id)}/test`, {}),
};
