export type PromiseCompletion<Value> =
  | { readonly kind: "normal"; readonly value: Value }
  | { readonly kind: "throw"; readonly value: Value };
export interface PromiseResolvingFunctions<Value> {
  readonly resolve: (value: Value) => void;
  readonly reject: (reason: Value) => void;
}
interface PromiseReaction<Value> {
  readonly kind: "fulfill" | "reject";
  readonly handler: Value | undefined;
  readonly capability: PromiseResolvingFunctions<Value> | undefined;
}
export interface PromiseRecord<Value> {
  readonly promise: Value;
  state: "pending" | "fulfilled" | "rejected";
  result: Value;
  fulfillReactions: PromiseReaction<Value>[] | undefined;
  rejectReactions: PromiseReaction<Value>[] | undefined;
  handled: boolean;
}
export interface PromiseHooks<Value> {
  readonly sameValue: (left: Value, right: Value) => boolean;
  readonly isObject: (value: Value) => boolean;
  readonly isCallable: (value: Value) => boolean;
  readonly getThen: (value: Value) => PromiseCompletion<Value>;
  readonly callThen: (
    method: Value,
    receiver: Value,
    functions: PromiseResolvingFunctions<Value>,
  ) => PromiseCompletion<Value>;
  readonly callHandler: (
    handler: Value,
    value: Value,
  ) => PromiseCompletion<Value>;
  readonly typeError: () => Value;
  /** Capture the job realm from callback (or null for an absent handler), and
   * the active Script/module, before placing the job on the host's FIFO queue. */
  readonly enqueue: (job: () => void, callback: Value | undefined) => void;
  readonly rejectionTracker: (
    promise: PromiseRecord<Value>,
    operation: "reject" | "handle",
  ) => void;
}
export function createPromiseRecord<Value>(
  promise: Value,
  undefinedValue: Value,
): PromiseRecord<Value> {
  return {
    promise,
    state: "pending",
    result: undefinedValue,
    fulfillReactions: [],
    rejectReactions: [],
    handled: false,
  };
}
export function createResolvingFunctions<Value>(
  promise: PromiseRecord<Value>,
  hooks: PromiseHooks<Value>,
): PromiseResolvingFunctions<Value> {
  let alreadyResolved = false;
  function reject(reason: Value): void {
    if (alreadyResolved) return;
    alreadyResolved = true;
    settle<Value>(promise, "rejected", reason, hooks);
  }
  function resolve(resolution: Value): void {
    if (alreadyResolved) return;
    alreadyResolved = true;
    if (hooks.sameValue(resolution, promise.promise)) {
      settle<Value>(promise, "rejected", hooks.typeError(), hooks);
      return;
    }
    if (!hooks.isObject(resolution)) {
      settle<Value>(promise, "fulfilled", resolution, hooks);
      return;
    }
    const then = hooks.getThen(resolution);
    if (then.kind === "throw") {
      settle<Value>(promise, "rejected", then.value, hooks);
      return;
    }
    const method = then.value;
    if (!hooks.isCallable(method)) {
      settle<Value>(promise, "fulfilled", resolution, hooks);
      return;
    }
    hooks.enqueue((): void => {
      const functions = createResolvingFunctions<Value>(promise, hooks);
      const completion = hooks.callThen(method, resolution, functions);
      if (completion.kind === "throw") functions.reject(completion.value);
    }, method);
  }
  return { resolve, reject };
}
export function performPromiseThen<Value>(
  promise: PromiseRecord<Value>,
  onFulfilled: Value,
  onRejected: Value,
  capability: PromiseResolvingFunctions<Value> | undefined,
  hooks: PromiseHooks<Value>,
): void {
  const fulfill: PromiseReaction<Value> = {
    kind: "fulfill",
    handler: hooks.isCallable(onFulfilled) ? onFulfilled : undefined,
    capability,
  };
  const reject: PromiseReaction<Value> = {
    kind: "reject",
    handler: hooks.isCallable(onRejected) ? onRejected : undefined,
    capability,
  };
  if (promise.state === "pending") {
    const fulfills = promise.fulfillReactions;
    const rejects = promise.rejectReactions;
    if (fulfills === undefined || rejects === undefined)
      throw "PROMISE_PENDING_REACTIONS_INVARIANT";
    fulfills.push(fulfill);
    rejects.push(reject);
  } else if (promise.state === "fulfilled") {
    enqueueReaction<Value>(fulfill, promise.result, hooks);
  } else {
    if (!promise.handled) hooks.rejectionTracker(promise, "handle");
    enqueueReaction<Value>(reject, promise.result, hooks);
  }
  promise.handled = true;
}

function settle<Value>(
  promise: PromiseRecord<Value>,
  state: "fulfilled" | "rejected",
  value: Value,
  hooks: PromiseHooks<Value>,
): void {
  if (promise.state !== "pending") throw "PROMISE_SETTLEMENT_INVARIANT";
  const reactions =
    state === "fulfilled" ? promise.fulfillReactions : promise.rejectReactions;
  if (reactions === undefined) throw "PROMISE_PENDING_REACTIONS_INVARIANT";
  promise.result = value;
  promise.fulfillReactions = undefined;
  promise.rejectReactions = undefined;
  promise.state = state;
  if (state === "rejected" && !promise.handled)
    hooks.rejectionTracker(promise, "reject");
  for (const reaction of reactions) {
    if (reaction === undefined) throw "PROMISE_REACTION_INVARIANT";
    enqueueReaction<Value>(reaction, value, hooks);
  }
}

function enqueueReaction<Value>(
  reaction: PromiseReaction<Value>,
  value: Value,
  hooks: PromiseHooks<Value>,
): void {
  hooks.enqueue((): void => {
    const handler = reaction.handler;
    let completion: PromiseCompletion<Value>;
    if (handler === undefined) {
      if (reaction.kind === "fulfill") completion = { kind: "normal", value };
      else completion = { kind: "throw", value };
    } else completion = hooks.callHandler(handler, value);
    const capability = reaction.capability;
    if (capability === undefined) {
      if (completion.kind === "throw")
        throw "PROMISE_INTERNAL_REACTION_INVARIANT";
    } else if (completion.kind === "throw") capability.reject(completion.value);
    else capability.resolve(completion.value);
  }, reaction.handler);
}
