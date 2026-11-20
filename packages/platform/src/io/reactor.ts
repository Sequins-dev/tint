/** Owner-thread readiness. Tokens identify a registration even if its file
 * descriptor is later reused. Token zero is reserved for the control wake. */
export interface NativeReactor {
  /** Scalar control grant for producers. Stop all producers before close. */
  readonly control: number;
  /** The caller owns the fd and makes it nonblocking before registration. */
  watchReadable(fd: number, token: number): void;
  unwatchReadable(fd: number): void;
  /** Relative milliseconds, or Infinity. publish only enqueues owner work. */
  poll(timeout: number, publish: (token: number) => void): void;
  close(): void;
}
