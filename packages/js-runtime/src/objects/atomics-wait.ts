import {
  createObject,
  createDataProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import type { ScriptAgent } from "./jobs.ts";
import { newPromiseCapability } from "./promise-capability.ts";
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

/** Owned exclusively by the registering agent. Raw registries retain no Promise,
 * realm or managed callback; notification only publishes scalar terminal state. */
export interface PendingAtomicWait {
  readonly waiting: SharedBlockWaiting;
  readonly ticket: number;
  readonly deadline: number;
  readonly resolve: (result: string) => void;
}
export function atomicWaitResult(
  asynchronous: boolean,
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const result = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  if (
    !createDataProperty<ScriptPropertyKey, unknown>(
      result,
      "async",
      asynchronous,
      hooks,
    ) ||
    !createDataProperty<ScriptPropertyKey, unknown>(
      result,
      "value",
      value,
      hooks,
    )
  )
    throw "ATOMIC_WAIT_RESULT_INVARIANT";
  return result;
}
export function asynchronousAtomicWait(
  waiting: SharedBlockWaiting,
  handle: number,
  offset: number,
  width: 4 | 8,
  lo: number,
  hi: number,
  timeout: number,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  if (waiting.order === undefined || waiting.registryId === undefined)
    return rejectUnsupportedExecution(realm);
  const registered = waiting.register(handle, offset, width, lo, hi, false);
  if (!registered.ok) {
    if (registered.error === "allocation-limit")
      return rejectUnsupportedExecution(realm);
    throw "ATOMIC_WAIT_REGISTRATION_INVARIANT";
  }
  const registration = registered.value;
  if (registration.state !== "waiting")
    return atomicWaitResult(false, registration.state, realm, hooks);
  let retained = false;
  try {
    const started = waiting.now();
    if (!Number.isFinite(started)) throw "ATOMIC_WAIT_CLOCK_INVARIANT";
    const constructor = realm.promiseConstructor;
    if (constructor === undefined) return rejectUnsupportedExecution(realm);
    const capability = newPromiseCapability(constructor, realm, hooks),
      result = atomicWaitResult(true, capability.promise, realm, hooks);
    realm.agent.pendingAtomicWaits.push({
      waiting,
      ticket: registration.ticket,
      deadline: started + (timeout !== timeout ? Infinity : timeout),
      resolve: (value: string): void => capability.resolve(value),
    });
    retained = true;
    return result;
  } finally {
    if (!retained) {
      waiting.expire(registration.ticket);
      waiting.take(registration.ticket);
    }
  }
}
/** Same-agent notifications call with expireTimeouts=false before returning to
 * Script. Host checkpoints call with true after the current job has completed. */
export function processAtomicWaitEvents(
  agent: ScriptAgent,
  expireTimeouts: boolean,
  range?: {
    readonly registryId: number;
    readonly first: number;
    readonly last: number;
  },
): number {
  if (!expireTimeouts && range === undefined) return 0;
  const pending = agent.pendingAtomicWaits;
  if (expireTimeouts)
    for (let i = 0; i < pending.length; i++) {
      const entry = pending[i];
      if (entry === undefined) throw "ATOMIC_WAIT_PENDING_INVARIANT";
      const now = entry.waiting.now();
      if (!Number.isFinite(now)) throw "ATOMIC_WAIT_CLOCK_INVARIANT";
      if (now >= entry.deadline) {
        const expired = entry.waiting.expire(entry.ticket);
        if (!expired.ok) throw "ATOMIC_WAIT_TIMEOUT_INVARIANT";
      }
    }
  let completed = 0;
  while (true) {
    let chosen = -1,
      first = Infinity;
    for (let i = 0; i < pending.length; i++) {
      const entry = pending[i];
      if (entry === undefined) throw "ATOMIC_WAIT_PENDING_INVARIANT";
      if (range !== undefined && entry.waiting.registryId !== range.registryId)
        continue;
      const readOrder = entry.waiting.order;
      if (readOrder === undefined) throw "ATOMIC_WAIT_ORDER_INVARIANT";
      const order = readOrder(entry.ticket);
      if (!order.ok) throw "ATOMIC_WAIT_ORDER_INVARIANT";
      if (
        order.value > 0 &&
        order.value < first &&
        (range === undefined ||
          (order.value >= range.first && order.value <= range.last))
      ) {
        first = order.value;
        chosen = i;
      }
    }
    if (chosen < 0) return completed;
    const entry = pending[chosen];
    if (entry === undefined) throw "ATOMIC_WAIT_PENDING_INVARIANT";
    const result = entry.waiting.take(entry.ticket);
    if (!result.ok || result.value === "waiting")
      throw "ATOMIC_WAIT_COMPLETION_INVARIANT";
    pending.splice(chosen, 1);
    entry.resolve(result.value === "notified" ? "ok" : "timed-out");
    completed++;
  }
}
