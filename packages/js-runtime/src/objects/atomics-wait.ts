import type { SharedBlockWaiting } from "../bytes/shared.ts";
import { rejectUnsupportedExecution, type ErrorRealm } from "./errors.ts";
/** No user code executes after enrollment. Kernel returns are advisory: only the
 * registry's terminal state completes the operation. Long finite waits use bounded
 * kernel intervals while retaining their original absolute monotonic deadline. */
export function blockingAtomicWait(
  waiting: SharedBlockWaiting,
  handle: number,
  offset: number,
  width: 4 | 8,
  lo: number,
  hi: number,
  timeout: number,
  realm: ErrorRealm,
): string {
  const registered = waiting.register(handle, offset, width, lo, hi, false);
  if (!registered.ok) {
    if (registered.error === "allocation-limit")
      return rejectUnsupportedExecution(realm);
    throw "ATOMIC_WAIT_REGISTRATION_INVARIANT";
  }
  const registration = registered.value;
  if (registration.state !== "waiting") return registration.state;
  const ticket = registration.ticket;
  let live = true;
  try {
    const started = waiting.now();
    if (!Number.isFinite(started)) throw "ATOMIC_WAIT_CLOCK_INVARIANT";
    const duration = timeout !== timeout ? Infinity : timeout,
      deadline = started + duration;
    while (true) {
      const observed = waiting.poll(ticket);
      if (!observed.ok) throw "ATOMIC_WAIT_POLL_INVARIANT";
      if (observed.value !== "waiting") {
        const completed = waiting.take(ticket);
        if (!completed.ok || completed.value === "waiting")
          throw "ATOMIC_WAIT_COMPLETION_INVARIANT";
        live = false;
        return completed.value === "notified" ? "ok" : "timed-out";
      }
      const now = waiting.now();
      if (!Number.isFinite(now) || now < started)
        throw "ATOMIC_WAIT_CLOCK_INVARIANT";
      if (now >= deadline) {
        const expired = waiting.expire(ticket);
        if (!expired.ok) throw "ATOMIC_WAIT_TIMEOUT_INVARIANT";
        continue;
      }
      const nanoseconds =
        deadline === Infinity
          ? 0
          : Math.min(
              Number.MAX_SAFE_INTEGER,
              Math.max(1, Math.ceil((deadline - now) * 1000000)),
            );
      const parked = waiting.park(ticket, nanoseconds);
      if (!parked.ok) throw "ATOMIC_WAIT_PARK_INVARIANT";
    }
  } finally {
    if (live) {
      waiting.expire(ticket);
      waiting.take(ticket);
    }
  }
}
