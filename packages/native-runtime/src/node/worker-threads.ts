import type { SharedBlockService } from "@tint/js-runtime/bytes/shared";
import {
  arrayLikeValues,
  builtinAccessor,
  builtinFunction,
  builtinFunctionMetadata,
  builtinProperty,
  callObjectValue,
  createCallableObject,
  createConstructorObject,
  createDataProperty,
  createObject,
  createRuntimeError,
  getProperty,
  isCallableObject,
  newPromiseCapability,
  ownKeys,
  scriptPropertyKeyOrder,
  viewObjectValue,
  type ErrorRealm,
  type ObjectCall,
  type OrdinaryObject,
  type ScriptPromiseCapability,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import type { EventLoopHandle } from "../event-loop.ts";
import type { ReactorEventLoop } from "../event-loop-reactor.ts";
import { createNativeWorkerBacking } from "../worker-backing.ts";
import {
  createNativeWorkerMessages,
  type NativeWorkerMessages,
} from "../worker-messages.ts";
import {
  createNativeMessagePorts,
  type NativeMessagePort,
  type NativeMessagePortGrant,
} from "../worker-ports.ts";
import type {
  NativeWorkerLifecycle,
  NativeWorkerThreadHost,
  NativeWorkerTurnControl,
} from "../worker-lifecycle.ts";
import type { NativeSharedMemoryHost } from "../shared-memory-host.ts";
import type { NativeWaiterParkingHost } from "../shared-waiters.ts";
import type { NativePacketMemory } from "../packet-memory.ts";
import type { NativeSharedStrings } from "../shared-strings.ts";

type ScriptObject = OrdinaryObject<ScriptPropertyKey, unknown>;

export interface WorkerResourceLimits {
  readonly maxYoungGenerationSizeMb: number | undefined;
  readonly maxOldGenerationSizeMb: number | undefined;
  readonly codeRangeSizeMb: number | undefined;
  readonly stackSizeMb: number | undefined;
}
export interface NodeWorkerLaunch {
  readonly parentPort: NativeMessagePortGrant;
  onUnclaimedParentPort(grant: NativeMessagePortGrant): void;
  onError(message: string): void;
  onExit(code: number): void;
}
export interface NodeWorkerPlan {
  readonly resourceLimits: WorkerResourceLimits;
  launch(request: NodeWorkerLaunch): NativeWorkerLifecycle;
}
export interface NodeWorkerChild {
  readonly lifecycle: NativeWorkerLifecycle;
  readonly resourceLimits: WorkerResourceLimits;
}
export interface NodeWorkerThreadsOptions {
  readonly threadId: number;
  readonly control: NativeWorkerTurnControl | undefined;
  readonly realm: ErrorRealm;
  readonly memory: NativeSharedMemoryHost;
  readonly parking: NativeWaiterParkingHost;
  readonly threads: NativeWorkerThreadHost;
  readonly reactor: ReactorEventLoop;
  readonly shared: SharedBlockService | undefined;
  /** See NativeWorkerMessageOptions.sharedBlockAt. */
  readonly sharedBlockAt?: (address: number) => number;
  readonly packets: NativePacketMemory;
  /** See NativeWorkerMessageOptions.strings. */
  readonly strings?: NativeSharedStrings;
  prepare(
    filename: string,
    resourceLimits: WorkerResourceLimits,
  ): NodeWorkerPlan;
}
export interface NodeWorkerThreads {
  readonly Worker: ScriptObject;
  readonly MessageChannel: ScriptObject;
  readonly MessagePort: ScriptObject;
  readonly threadId: number;
  readonly isMainThread: boolean;
  readonly parentPort: ScriptObject | null;
  readonly workerData: unknown;
  readonly resourceLimits: ScriptObject;
  /** Posts as `object.postMessage(value, transfer)` does when `method`, the
   * object's postMessage, is still the intrinsic one, without a realm call
   * (the typed facade's fast path). False, having done nothing, otherwise. */
  post(
    object: ScriptObject,
    method: unknown,
    value: unknown,
    transfer: readonly unknown[] | undefined,
  ): boolean;
  /** Registers a typed listener when `method`, the object's `on`/`once`, is
   * still the intrinsic one so delivery can call `listener` directly without
   * a realm trampoline. False, having done nothing, otherwise. */
  listen(
    object: ScriptObject,
    method: unknown,
    name: string,
    listener: (value: unknown) => void,
    once: boolean,
  ): boolean;
  close(): void;
}
/** An intrinsic postMessage, by its function object's identity, and the
 * endpoint of its receivers. */
interface PostMethod {
  readonly identity: number;
  readonly state: (receiver: unknown) => Endpoint;
}
interface ListenMethod {
  readonly identity: number;
  readonly once: boolean;
  readonly state: (receiver: unknown) => Endpoint;
}
interface Listener {
  readonly event: ScriptPropertyKey;
  readonly fn: ScriptObject;
  readonly typed?: ((value: unknown) => void) | undefined;
  readonly once: boolean;
  active: boolean;
}
interface Endpoint {
  readonly object: ScriptObject;
  readonly port: NativeMessagePort;
  readonly listeners: Listener[];
  readonly changed: () => void;
  watch: EventLoopHandle | undefined;
  started: boolean;
  closed: boolean;
  reference: number;
}
interface WorkerState {
  readonly endpoint: Endpoint;
  readonly child: NodeWorkerChild;
  readonly terminations: ScriptPromiseCapability[];
  exited: boolean;
}

const resourceNames: readonly string[] = [
  "maxYoungGenerationSizeMb",
  "maxOldGenerationSizeMb",
  "codeRangeSizeMb",
  "stackSizeMb",
];
const emptyTransfer: readonly unknown[] = [];
const emptyArgs: readonly unknown[] = [];

/** Create the public module in a fresh realm. A host selects image-local
 * worker entry modules and owns their per-isolate startup configuration. */
export function createNodeWorkerThreads(
  options: NodeWorkerThreadsOptions,
): NodeWorkerThreads {
  const { realm, reactor } = options;
  const hooks = realm.objectHooks;
  const backing = createNativeWorkerBacking(options.memory);
  const portPrototype = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const workerPrototype = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const channelPrototype = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const portObjects = new Map<number, Endpoint>();
  const workerObjects = new Map<number, WorkerState>();
  const endpoints: Endpoint[] = [];
  const postMethods: PostMethod[] = [];
  const listenMethods: ListenMethod[] = [];
  let cachedSingleArg: unknown[] | undefined;
  function read(object: ScriptObject, name: string): unknown {
    return getProperty<ScriptPropertyKey, unknown>(object, name, object, hooks);
  }
  function property(object: ScriptObject, name: string, value: unknown): void {
    if (
      !createDataProperty<ScriptPropertyKey, unknown>(
        object,
        name,
        value,
        hooks,
      )
    )
      throw "NODE_WORKER_PROPERTY";
  }
  function typeError(message: string): never {
    const error = createRuntimeError(realm, "type");
    builtinProperty(error, "message", message, true, true, hooks);
    throw error;
  }
  function method(
    object: ScriptObject,
    name: string,
    arity: number,
    call: ObjectCall<unknown>,
  ): ScriptObject {
    const fn = builtinFunction(
      realm.functionPrototype,
      name,
      arity,
      call,
      hooks,
    );
    builtinProperty(object, name, fn, true, true, hooks);
    return fn;
  }
  function getter(
    object: ScriptObject,
    name: string,
    call: ObjectCall<unknown>,
  ): void {
    builtinAccessor(
      object,
      name,
      builtinFunction(realm.functionPrototype, "get " + name, 0, call, hooks),
      undefined,
      hooks,
    );
  }
  function header(
    object: ScriptObject,
    prototype: ScriptObject,
    name: string,
    arity: number,
  ): void {
    builtinFunctionMetadata(object, name, arity, hooks);
    builtinProperty(object, "prototype", prototype, false, false, hooks);
    builtinProperty(prototype, "constructor", object, true, true, hooks);
  }
  function ensureObject(value: unknown): ScriptObject {
    const object = viewObjectValue(value, realm.objectPrototype);
    if (object === undefined) return typeError("Invalid worker receiver");
    return object;
  }
  function ensurePort(value: unknown): Endpoint {
    const port = portObjects.get(ensureObject(value).internalIdentity);
    if (port === undefined) return typeError("Invalid MessagePort receiver");
    return port;
  }
  function ensureWorker(value: unknown): WorkerState {
    const worker = workerObjects.get(ensureObject(value).internalIdentity);
    if (worker === undefined) return typeError("Invalid Worker receiver");
    return worker;
  }
  function transferList(value: unknown): readonly unknown[] {
    if (value === undefined) return emptyTransfer;
    const array = viewObjectValue(value, realm.objectPrototype);
    if (array === undefined || !array.internalArrayData)
      return typeError("transferList must be an array");
    return arrayLikeValues(array, realm, hooks);
  }
  function listenerCount(endpoint: Endpoint, event: ScriptPropertyKey): number {
    let count = 0;
    for (const listener of endpoint.listeners)
      if (listener.active && listener.event === event) count++;
    return count;
  }
  function invokeListener(
    endpoint: Endpoint,
    listener: Listener,
    args: readonly unknown[],
  ): void {
    if (listener.once) {
      listener.active = false;
      endpoint.changed();
    }
    const direct = listener.typed;
    if (direct !== undefined) {
      direct(args[0]);
      return;
    }
    const called = callObjectValue(
      listener.fn,
      endpoint.object,
      args,
      realm.objectPrototype,
    );
    if (called.error !== "none") throw called.value;
  }
  function invokeListenerOne(
    endpoint: Endpoint,
    listener: Listener,
    arg: unknown,
  ): void {
    if (listener.once) {
      listener.active = false;
      endpoint.changed();
    }
    const direct = listener.typed;
    if (direct !== undefined) {
      direct(arg);
      return;
    }
    let args: unknown[];
    if (cachedSingleArg !== undefined) {
      args = cachedSingleArg;
      cachedSingleArg = undefined;
    } else args = [undefined];
    args[0] = arg;
    try {
      const called = callObjectValue(
        listener.fn,
        endpoint.object,
        args,
        realm.objectPrototype,
      );
      if (called.error !== "none") throw called.value;
    } finally {
      args[0] = undefined;
      if (cachedSingleArg === undefined) cachedSingleArg = args;
    }
  }
  function emit(
    endpoint: Endpoint,
    event: string,
    args: readonly unknown[],
  ): void {
    const all = endpoint.listeners;
    let first: Listener | undefined;
    let snapshot: Listener[] | undefined;
    for (let index = 0; index < all.length; index++) {
      const entry = all[index];
      if (entry === undefined || !entry.active || entry.event !== event)
        continue;
      if (first === undefined) first = entry;
      else {
        if (snapshot === undefined) snapshot = [first];
        snapshot.push(entry);
      }
    }
    if (first === undefined) {
      if (event === "error") throw args[0];
      return;
    }
    if (snapshot === undefined) {
      invokeListener(endpoint, first, args);
      return;
    }
    for (let index = 0; index < snapshot.length; index++) {
      const listener = snapshot[index];
      if (listener !== undefined) invokeListener(endpoint, listener, args);
    }
  }
  function emitOne(endpoint: Endpoint, event: string, arg: unknown): void {
    const all = endpoint.listeners;
    let first: Listener | undefined;
    let snapshot: Listener[] | undefined;
    for (let index = 0; index < all.length; index++) {
      const entry = all[index];
      if (entry === undefined || !entry.active || entry.event !== event)
        continue;
      if (first === undefined) first = entry;
      else {
        if (snapshot === undefined) snapshot = [first];
        snapshot.push(entry);
      }
    }
    if (first === undefined) {
      if (event === "error") throw arg;
      return;
    }
    if (snapshot === undefined) {
      invokeListenerOne(endpoint, first, arg);
      return;
    }
    for (let index = 0; index < snapshot.length; index++) {
      const listener = snapshot[index];
      if (listener !== undefined) invokeListenerOne(endpoint, listener, arg);
    }
  }
  function eventMethods(
    prototype: ScriptObject,
    state: (receiver: unknown) => Endpoint,
  ): void {
    function add(
      receiver: unknown,
      args: readonly unknown[],
      once: boolean,
    ): unknown {
      const endpoint = state(receiver);
      const name = args[0];
      if (typeof name !== "string")
        return typeError("Worker event name must be a string");
      const fn = viewObjectValue(args[1], realm.objectPrototype);
      if (fn === undefined || !isCallableObject<ScriptPropertyKey, unknown>(fn))
        return typeError("Worker event listener must be a function");
      endpoint.listeners.push({ event: name, fn, once, active: true });
      endpoint.changed();
      return receiver;
    }
    const on: ObjectCall<unknown> = (receiver, args): unknown =>
      add(receiver, args, false);
    const onFn = method(prototype, "on", 2, on);
    onFn.internalIdentity = realm.agent.nextObjectIdentity++;
    listenMethods.push({ identity: onFn.internalIdentity, once: false, state });
    const addListenerFn = method(prototype, "addListener", 2, on);
    addListenerFn.internalIdentity = realm.agent.nextObjectIdentity++;
    listenMethods.push({
      identity: addListenerFn.internalIdentity,
      once: false,
      state,
    });
    const onceFn = method(prototype, "once", 2, (receiver, args): unknown =>
      add(receiver, args, true),
    );
    onceFn.internalIdentity = realm.agent.nextObjectIdentity++;
    listenMethods.push({
      identity: onceFn.internalIdentity,
      once: true,
      state,
    });
    const remove: ObjectCall<unknown> = (receiver, args): unknown => {
      const endpoint = state(receiver);
      for (let index = endpoint.listeners.length - 1; index >= 0; index--) {
        const listener = endpoint.listeners[index];
        if (
          listener !== undefined &&
          listener.active &&
          listener.event === args[0] &&
          listener.fn === args[1]
        ) {
          endpoint.listeners.splice(index, 1);
          endpoint.changed();
          break;
        }
      }
      return receiver;
    };
    method(prototype, "removeListener", 2, remove);
    method(prototype, "off", 2, remove);
    const post = method(
      prototype,
      "postMessage",
      2,
      (receiver, args): unknown => {
        messages.send(state(receiver).port, args[0], transferList(args[1]));
        return undefined;
      },
    );
    post.internalIdentity = realm.agent.nextObjectIdentity++;
    postMethods.push({ identity: post.internalIdentity, state });
  }
  function closePort(endpoint: Endpoint, notify: boolean): void {
    if (endpoint.closed) return;
    endpoint.closed = true;
    endpoint.watch = undefined;
    endpoint.port.close();
    if (notify)
      reactor.loop.enqueueClose((): void => emit(endpoint, "close", emptyArgs));
  }
  function watch(endpoint: Endpoint, onClose: () => void): void {
    if (
      endpoint.watch !== undefined ||
      endpoint.closed ||
      endpoint.port.inspect() === undefined
    )
      return;
    endpoint.watch = endpoint.port.watch((entry): void => {
      let value: unknown;
      try {
        value = messages.receive(endpoint.port, entry);
      } catch (error) {
        emitOne(endpoint, "messageerror", error);
        return;
      }
      emitOne(endpoint, "message", value);
    }, onClose);
  }
  function makePort(port: NativeMessagePort): ScriptObject {
    const object = createObject<ScriptPropertyKey, unknown>(portPrototype);
    object.internalIdentity = realm.agent.nextObjectIdentity++;
    const endpoint: Endpoint = {
      object,
      port,
      listeners: [],
      watch: undefined,
      started: false,
      closed: false,
      reference: 0,
      changed: (): void => {
        const count = listenerCount(endpoint, "message");
        if (count > 0) endpoint.started = true;
        if (
          endpoint.started ||
          endpoint.reference > 0 ||
          listenerCount(endpoint, "close") > 0
        )
          watch(endpoint, (): void => closePort(endpoint, true));
        const handle = endpoint.watch;
        if (handle !== undefined) {
          if (endpoint.reference > 0 || (endpoint.reference === 0 && count > 0))
            handle.ref();
          else handle.unref();
        }
      },
    };
    portObjects.set(object.internalIdentity, endpoint);
    endpoints.push(endpoint);
    return object;
  }
  const ports = createNativeMessagePorts(
    options.memory,
    options.parking,
    options.threads,
    reactor,
    (entry): void => messages.discard(entry),
  );
  const messages: NativeWorkerMessages = createNativeWorkerMessages({
    realm,
    shared: options.shared,
    ...(options.sharedBlockAt === undefined
      ? {}
      : { sharedBlockAt: options.sharedBlockAt }),
    backing,
    ports,
    packets: options.packets,
    ...(options.strings === undefined ? {} : { strings: options.strings }),
    portForObject: (object): NativeMessagePort | undefined =>
      portObjects.get(object.internalIdentity)?.port,
    objectForPort: makePort,
  });
  realm.bufferAllocator = backing.allocate;

  eventMethods(portPrototype, ensurePort);
  method(portPrototype, "start", 0, (receiver, _args): unknown => {
    const endpoint = ensurePort(receiver);
    endpoint.started = true;
    endpoint.changed();
    return undefined;
  });
  method(portPrototype, "close", 0, (receiver, args): unknown => {
    const port = ensurePort(receiver);
    const callback = args[0];
    if (callback !== undefined) {
      const fn = viewObjectValue(callback, realm.objectPrototype);
      if (fn === undefined || !isCallableObject<ScriptPropertyKey, unknown>(fn))
        return typeError("MessagePort close callback must be a function");
      port.listeners.push({ event: "close", fn, once: true, active: true });
    }
    closePort(port, true);
    return undefined;
  });
  method(portPrototype, "ref", 0, (receiver, _args): unknown => {
    const port = ensurePort(receiver);
    port.reference = 1;
    port.changed();
    return receiver;
  });
  method(portPrototype, "unref", 0, (receiver, _args): unknown => {
    const port = ensurePort(receiver);
    port.reference = -1;
    port.changed();
    return receiver;
  });
  method(
    portPrototype,
    "hasRef",
    0,
    (receiver, _args): unknown => ensurePort(receiver).watch?.hasRef() === true,
  );
  const MessagePort = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (_receiver, _args): unknown => typeError("Illegal MessagePort constructor"),
    (_receiver, _args): unknown => typeError("Illegal MessagePort constructor"),
  );
  header(MessagePort, portPrototype, "MessagePort", 0);
  const MessageChannel = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (_receiver, _args): unknown =>
      typeError("MessageChannel must be constructed with new"),
    (_args, target): unknown => {
      const parent =
        viewObjectValue(
          read(ensureObject(target), "prototype"),
          realm.objectPrototype,
        ) ?? channelPrototype;
      const object = createObject<ScriptPropertyKey, unknown>(parent);
      const pair = ports.create();
      property(object, "port1", makePort(pair.first));
      property(object, "port2", makePort(pair.second));
      return object;
    },
  );
  header(MessageChannel, channelPrototype, "MessageChannel", 0);

  function limits(value: unknown): WorkerResourceLimits {
    const object = value === undefined ? undefined : ensureObject(value);
    const names =
      object === undefined
        ? []
        : ownKeys<ScriptPropertyKey, unknown>(object, scriptPropertyKeyOrder);
    for (const name of names)
      if (typeof name !== "string" || !resourceNames.includes(name))
        return typeError("Unsupported Worker resource limit");
    function amount(name: string): number | undefined {
      const setting = object === undefined ? undefined : read(object, name);
      if (setting === undefined) return undefined;
      if (
        typeof setting !== "number" ||
        !Number.isFinite(setting) ||
        setting <= 0
      )
        return typeError("Invalid Worker resource limit " + name);
      return setting;
    }
    return {
      maxYoungGenerationSizeMb: amount("maxYoungGenerationSizeMb"),
      maxOldGenerationSizeMb: amount("maxOldGenerationSizeMb"),
      codeRangeSizeMb: amount("codeRangeSizeMb"),
      stackSizeMb: amount("stackSizeMb"),
    };
  }
  function limitsObject(
    limits: WorkerResourceLimits | undefined,
  ): ScriptObject {
    const object = createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    if (limits !== undefined) {
      if (limits.maxYoungGenerationSizeMb !== undefined)
        property(
          object,
          "maxYoungGenerationSizeMb",
          limits.maxYoungGenerationSizeMb,
        );
      if (limits.maxOldGenerationSizeMb !== undefined)
        property(
          object,
          "maxOldGenerationSizeMb",
          limits.maxOldGenerationSizeMb,
        );
      if (limits.codeRangeSizeMb !== undefined)
        property(object, "codeRangeSizeMb", limits.codeRangeSizeMb);
      if (limits.stackSizeMb !== undefined)
        property(object, "stackSizeMb", limits.stackSizeMb);
    }
    return object;
  }
  function createWorker(
    filename: unknown,
    settings: unknown,
    prototype: ScriptObject,
  ): ScriptObject {
    if (typeof filename !== "string" || filename.length === 0)
      return typeError("Worker requires an image-local module filename");
    const config = settings === undefined ? undefined : ensureObject(settings);
    if (config !== undefined) {
      const keys = ownKeys<ScriptPropertyKey, unknown>(
        config,
        scriptPropertyKeyOrder,
      );
      for (const key of keys)
        if (
          key !== "workerData" &&
          key !== "transferList" &&
          key !== "resourceLimits"
        )
          return typeError(
            "Unsupported Worker option " +
              (typeof key === "string" ? key : "symbol"),
          );
    }
    const selected = limits(
      config === undefined ? undefined : read(config, "resourceLimits"),
    );
    const data = config === undefined ? undefined : read(config, "workerData");
    const transfer = transferList(
      config === undefined ? undefined : read(config, "transferList"),
    );
    const plan = options.prepare(filename, selected);
    const boot = createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    property(boot, "data", data);
    property(boot, "limits", limitsObject(plan.resourceLimits));
    const pair = ports.create();
    const object = createObject<ScriptPropertyKey, unknown>(prototype);
    object.internalIdentity = realm.agent.nextObjectIdentity++;
    const endpoint: Endpoint = {
      object,
      port: pair.first,
      listeners: [],
      changed: (): void => {},
      watch: undefined,
      started: true,
      closed: false,
      reference: 1,
    };
    let status: number | undefined;
    let eof = false;
    let failure: string | undefined;
    function complete(): void {
      if (!eof || status === undefined) return;
      const worker = workerObjects.get(object.internalIdentity);
      if (worker === undefined || worker.exited) return;
      worker.exited = true;
      try {
        if (failure !== undefined) {
          const error = createRuntimeError(realm, "error");
          builtinProperty(error, "message", failure, true, true, hooks);
          emitOne(endpoint, "error", error);
        }
      } finally {
        for (const termination of worker.terminations)
          termination.resolve(status);
        worker.terminations.length = 0;
        emitOne(endpoint, "exit", status);
      }
    }
    let child: NodeWorkerChild;
    let grant: NativeMessagePortGrant | undefined;
    try {
      messages.send(pair.first, boot, transfer);
      grant = pair.second.transfer();
      const lifecycle = plan.launch({
        parentPort: grant,
        onUnclaimedParentPort: (port): void => ports.discard(port),
        onError: (message): void => {
          failure = message;
        },
        onExit: (code): void => {
          status = code;
          complete();
        },
      });
      child = { lifecycle, resourceLimits: plan.resourceLimits };
    } catch (error) {
      pair.first.close();
      if (grant === undefined) pair.second.close();
      else ports.discard(grant);
      throw error;
    }
    workerObjects.set(object.internalIdentity, {
      endpoint,
      child,
      terminations: [],
      exited: false,
    });
    endpoints.push(endpoint);
    watch(endpoint, (): void => {
      eof = true;
      closePort(endpoint, false);
      complete();
    });
    return object;
  }
  const Worker = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (_receiver, _args): unknown =>
      typeError("Worker must be constructed with new"),
    (args, target): unknown =>
      createWorker(
        args[0],
        args[1],
        viewObjectValue(
          read(ensureObject(target), "prototype"),
          realm.objectPrototype,
        ) ?? workerPrototype,
      ),
  );
  header(Worker, workerPrototype, "Worker", 1);
  eventMethods(
    workerPrototype,
    (receiver): Endpoint => ensureWorker(receiver).endpoint,
  );
  getter(workerPrototype, "threadId", (receiver, _args): unknown => {
    const worker = ensureWorker(receiver);
    return worker.exited ? -1 : worker.child.lifecycle.threadId;
  });
  getter(workerPrototype, "resourceLimits", (receiver, _args): unknown => {
    const worker = ensureWorker(receiver);
    return limitsObject(
      worker.exited ? undefined : worker.child.resourceLimits,
    );
  });
  method(workerPrototype, "ref", 0, (receiver, _args): unknown => {
    const worker = ensureWorker(receiver);
    worker.child.lifecycle.ref();
    worker.endpoint.watch?.ref();
    return receiver;
  });
  method(workerPrototype, "unref", 0, (receiver, _args): unknown => {
    const worker = ensureWorker(receiver);
    worker.child.lifecycle.unref();
    worker.endpoint.watch?.unref();
    return receiver;
  });
  method(workerPrototype, "terminate", 0, (receiver, _args): unknown => {
    const worker = ensureWorker(receiver),
      constructor = realm.promiseConstructor;
    if (constructor === undefined) throw "NODE_WORKER_PROMISE_CONSTRUCTOR";
    const result = newPromiseCapability(constructor, realm, hooks);
    if (worker.exited) result.resolve(undefined);
    else {
      worker.terminations.push(result);
      worker.child.lifecycle.ref();
      worker.endpoint.watch?.ref();
      worker.child.lifecycle.requestStop();
    }
    return result.promise;
  });
  const parent = options.control?.claimParentPort(ports);
  let data: unknown = null;
  let resources = limitsObject(undefined);
  if (parent !== undefined) {
    const entry = parent.take();
    if (entry === undefined) throw "NODE_WORKER_DATA_PACKET";
    const envelope = ensureObject(messages.receive(parent, entry));
    data = read(envelope, "data");
    resources = ensureObject(read(envelope, "limits"));
  }
  return {
    Worker,
    MessagePort,
    MessageChannel,
    threadId: options.threadId,
    isMainThread: options.threadId === 0,
    parentPort: parent === undefined ? null : makePort(parent),
    workerData: data,
    resourceLimits: resources,
    post: (object, method, value, transfer): boolean => {
      const fn = viewObjectValue(method, realm.objectPrototype);
      if (fn === undefined) return false;
      const identity = fn.internalIdentity;
      for (const entry of postMethods)
        if (entry.identity === identity) {
          messages.send(
            entry.state(object).port,
            value,
            transfer === undefined ? emptyTransfer : transfer,
          );
          return true;
        }
      return false;
    },
    listen: (object, method, name, listener, once): boolean => {
      const fn = viewObjectValue(method, realm.objectPrototype);
      if (fn === undefined) return false;
      const identity = fn.internalIdentity;
      for (const entry of listenMethods)
        if (entry.identity === identity && entry.once === once) {
          const endpoint = entry.state(object);
          const callback = createCallableObject<ScriptPropertyKey, unknown>(
            realm.functionPrototype,
            (_receiver, args): unknown => {
              listener(args[0]);
              return undefined;
            },
            realm.executionContext,
          );
          endpoint.listeners.push({
            event: name,
            fn: callback,
            typed: listener,
            once,
            active: true,
          });
          endpoint.changed();
          return true;
        }
      return false;
    },
    close: (): void => {
      for (const endpoint of endpoints) closePort(endpoint, false);
      backing.close();
    },
  };
}
