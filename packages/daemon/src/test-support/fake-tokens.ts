import type { TokenStore } from "../providers/keychain.js";

/** An in-memory `TokenStore` for tests; the Keychain is never touched. `tokens` is its content. */
export function memoryTokens(initial: Record<string, string> = {}): TokenStore & { tokens: Map<string, string> } {
  const tokens = new Map(Object.entries(initial));
  return {
    tokens,
    read: async (id) => tokens.get(id),
    has: async (id) => tokens.has(id),
    write: async (id, token) => {
      if (!token.trim()) return { ok: false, error: "the token is empty" };
      tokens.set(id, token);
      return { ok: true };
    },
    remove: async (id) => {
      tokens.delete(id);
      return { ok: true };
    },
  };
}
