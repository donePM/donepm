import { grantRevoked, type Ctx, type PermissionGrant } from "@donepm/core";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { GrantStore } from "./grants.js";

export class GrantError extends Error {
  constructor(
    readonly status: 404,
    message: string,
  ) {
    super(message);
    this.name = "GrantError";
  }
}

/**
 * The user's Remove on an "Always allow" grant (D38). The grant stops matching at once, also for
 * agents already running, because every ask reads the grants again. The removal is recorded on the
 * item the grant was made on, unless the retention purge deleted that item.
 */
export function revokeGrant(
  deps: { grants: GrantStore; items: ItemStore; writer: ItemWriter; ctx: Ctx },
  id: string,
): PermissionGrant {
  const grant = deps.grants.get(id);
  if (!grant || grant.revokedAt !== undefined) throw new GrantError(404, "grant not found");
  deps.grants.revoke(id, deps.ctx.now());
  const stored = deps.items.get(grant.itemId);
  if (stored) {
    deps.writer.commit(
      grantRevoked(stored.item, deps.ctx, {
        id: grant.id,
        repo: grant.repo,
        toolName: grant.toolName,
        ...(grant.ruleContent !== undefined ? { ruleContent: grant.ruleContent } : {}),
      }),
    );
  }
  return deps.grants.get(id)!;
}
