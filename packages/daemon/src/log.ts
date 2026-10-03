/** The subset of pino's logger the daemon modules use. Fastify's `app.log` satisfies it. */
export interface Log {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export const silentLog: Log = { info() {}, warn() {}, error() {} };
