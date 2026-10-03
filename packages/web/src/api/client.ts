import type { ItemView, Repo, Settings, Status } from "./types";

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
  repos: () => call<Repo[]>("GET", "/api/repos"),
  rescan: () => call<Repo[]>("POST", "/api/repos/rescan"),
  status: () => call<Status>("GET", "/api/status"),
  recheck: () => call<Status>("POST", "/api/status/recheck"),
  settings: () => call<Settings>("GET", "/api/settings"),
  saveSettings: (patch: Partial<Settings>) =>
    call<{ settings: Settings; restartRequired: boolean }>("PUT", "/api/settings", patch),
};
