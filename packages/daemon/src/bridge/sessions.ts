import { randomBytes } from "node:crypto";
import type { DraftType } from "@donepm/core";

/** What a token stands for: one item, and the drafts its playbook allows. */
export interface BridgeSession {
  itemId: string;
  drafts: readonly DraftType[];
}

/**
 * Tokens minted per agent process, held in memory only, so a daemon restart retires them.
 * Not a secret (anything running as the user can read the config file); it ties a connection to
 * its item so no tool has to name one.
 */
export class BridgeSessions {
  private readonly byToken = new Map<string, BridgeSession>();

  mint(session: BridgeSession): string {
    const token = randomBytes(24).toString("base64url");
    this.byToken.set(token, session);
    return token;
  }

  get(token: string): BridgeSession | undefined {
    return this.byToken.get(token);
  }

  revoke(token: string): void {
    this.byToken.delete(token);
  }
}
