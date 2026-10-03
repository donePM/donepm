/** Injectable clock and id source so every core function stays pure and testable. */
export interface Clock {
  /** ISO 8601 timestamp. */
  now(): string;
}

export interface IdSource {
  newId(): string;
}

export type Ctx = Clock & IdSource;
