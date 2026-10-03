import type { IncomingHttpHeaders } from "node:http";

/**
 * Only the daemon's own UI may talk to it. Rejects requests whose Host is not localhost on our
 * port (DNS rebinding) and requests carrying a foreign Origin (other websites in the browser).
 * Requests without Origin (curl, the CLI) are allowed.
 */
export function makeGuard(port: () => number, extraOrigins: readonly string[] = []) {
  const extraHosts = extraOrigins.map((o) => new URL(o).host);
  return (headers: IncomingHttpHeaders): boolean => {
    const p = port();
    const host = headers.host;
    if (!host || !(host === `127.0.0.1:${p}` || host === `localhost:${p}` || extraHosts.includes(host))) return false;
    const origin = headers.origin;
    return (
      origin === undefined ||
      origin === `http://127.0.0.1:${p}` ||
      origin === `http://localhost:${p}` ||
      extraOrigins.includes(origin)
    );
  };
}
