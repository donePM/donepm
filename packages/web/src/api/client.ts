import type { PermissionGrant } from "@donepm/core";
import type { AskAnswer, Draft, ItemDetail, ItemDiff, ItemView, OpenTarget, OrphanWorktree, PrDraftPayload, RepoView, Settings, SourceTest, Status, TranscriptMessage } from "./types";

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
  setIgnored: (id: string, ignored: boolean) =>
    call<{ repos: RepoView[]; settings: Settings }>("PUT", `/api/repos/${encodeURIComponent(id)}`, { ignored }),
  status: () => call<Status>("GET", "/api/status"),
  recheck: () => call<Status>("POST", "/api/status/recheck"),
  settings: () => call<Settings>("GET", "/api/settings"),
  saveSettings: (patch: Partial<Settings>) =>
    call<{ settings: Settings; restartRequired: boolean }>("PUT", "/api/settings", patch),
  testSource: (origin: string, query: string) => call<SourceTest>("POST", "/api/sources/test", { origin, query }),
};
