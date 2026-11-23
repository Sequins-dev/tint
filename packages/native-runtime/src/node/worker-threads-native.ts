import {
  callObjectValue,
  constructObject,
  createArrayFromList,
  createCallableObject,
  getProperty,
  viewObjectValue,
  type ErrorRealm,
  type OrdinaryObject,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import type { NodeWorkerThreads } from "./worker-threads.ts";

type ScriptObject = OrdinaryObject<ScriptPropertyKey, unknown>;
type WorkerListener = (value: unknown) => void;
export interface ResourceLimits {
  readonly maxYoungGenerationSizeMb?: number | undefined;
  readonly maxOldGenerationSizeMb?: number | undefined;
  readonly codeRangeSizeMb?: number | undefined;
  readonly stackSizeMb?: number | undefined;
}
export interface WorkerOptions {
  readonly [key: string]: unknown;
  readonly resourceLimits?: ResourceLimits;
  readonly transferList?: readonly unknown[];
  readonly workerData?: unknown;
}
interface TypedWorkerHost {
  readonly bindings: NodeWorkerThreads;
  readonly realm: ErrorRealm;
}
let current: TypedWorkerHost | undefined = undefined;
export let threadId: number = 0;
export let isMainThread: boolean = true;
export let parentPort: MessagePort | null = null;
export let workerData: unknown = null;
export let resourceLimits: ResourceLimits | undefined = undefined;

/** The typed import facade uses the same owning realm and endpoints as the
 * synthetic Node module. Install it before invoking the typed application. */
export function initializeWorkerThreads(
  bindings: NodeWorkerThreads,
  realm: ErrorRealm,
): void {
  current = { bindings, realm };
  threadId = bindings.threadId;
  isMainThread = bindings.isMainThread;
  workerData = bindings.workerData;
  const parent = bindings.parentPort;
  parentPort = parent === null ? null : wrapPort(parent);
  resourceLimits = readLimits(bindings.resourceLimits, realm);
}
function host(): TypedWorkerHost {
  const active = current;
  if (active === undefined) throw "WORKER_THREADS_HOST_NOT_INITIALIZED";
  return active;
}
function read(object: ScriptObject, key: string, realm: ErrorRealm): unknown {
  return getProperty<ScriptPropertyKey, unknown>(
    object,
    key,
    object,
    realm.objectHooks,
  );
}
function requireObject(value: unknown, realm: ErrorRealm): ScriptObject {
  const result = viewObjectValue(value, realm.objectPrototype);
  if (result === undefined) throw "WORKER_THREADS_NATIVE_OBJECT";
  return result;
}
function invoke(
  object: ScriptObject,
  method: string,
  arguments_: readonly unknown[],
): unknown {
  const { realm } = host();
  const call = callObjectValue(
    read(object, method, realm),
    object,
    arguments_,
    realm.objectPrototype,
  );
  if (call.error !== "none") throw call.value;
  return call.value;
}
function make(
  constructor: ScriptObject,
  arguments_: readonly unknown[],
  realm: ErrorRealm,
): ScriptObject {
  const result = constructObject<ScriptPropertyKey, unknown>(
    constructor,
    arguments_,
    { object: constructor, value: constructor },
    undefined,
  );
  if (result.error !== "none") throw result.value;
  return requireObject(result.value, realm);
}
function readLimits(object: ScriptObject, realm: ErrorRealm): ResourceLimits {
  const young = read(object, "maxYoungGenerationSizeMb", realm);
  const old = read(object, "maxOldGenerationSizeMb", realm);
  const code = read(object, "codeRangeSizeMb", realm);
  const stack = read(object, "stackSizeMb", realm);
  return {
    maxYoungGenerationSizeMb: typeof young === "number" ? young : undefined,
    maxOldGenerationSizeMb: typeof old === "number" ? old : undefined,
    codeRangeSizeMb: typeof code === "number" ? code : undefined,
    stackSizeMb: typeof stack === "number" ? stack : undefined,
  };
}
function transferList(
  list: readonly unknown[],
  realm: ErrorRealm,
): ScriptObject {
  return createArrayFromList(
    list,
    0,
    realm.arrayPrototype,
    realm,
    realm.objectHooks,
  );
}
function send(
  object: ScriptObject,
  value: unknown,
  list: readonly unknown[] | undefined,
): void {
  const { bindings, realm } = host();
  // The object's own postMessage, which untyped code may have replaced; the
  // intrinsic one posts without a realm call.
  const method = read(object, "postMessage", realm);
  if (bindings.post(object, method, value, list)) return;
  const args: unknown[] = [value];
  if (list !== undefined) args.push(transferList(list, realm));
  const call = callObjectValue(method, object, args, realm.objectPrototype);
  if (call.error !== "none") throw call.value;
}
function listen(
  object: ScriptObject,
  name: string,
  listener: WorkerListener,
  once: boolean,
): void {
  const { realm } = host();
  const callback = createCallableObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (_receiver, args): unknown => {
      listener(args[0]);
      return undefined;
    },
    realm.executionContext,
  );
  invoke(object, once ? "once" : "on", [name, callback]);
}
export interface MessagePort {
  readonly object: ScriptObject;
  postMessage(value: unknown, list?: readonly unknown[]): void;
  on(name: string, listener: WorkerListener): MessagePort;
  once(name: string, listener: WorkerListener): MessagePort;
  start(): void;
  close(): void;
  ref(): MessagePort;
  unref(): MessagePort;
  hasRef(): boolean;
}
function wrapPort(object: ScriptObject): MessagePort {
  const port: MessagePort = {
    object,
    postMessage(value: unknown, list?: readonly unknown[]): void {
      send(object, value, list);
    },
    on(name: string, listener: WorkerListener): MessagePort {
      listen(object, name, listener, false);
      return port;
    },
    once(name: string, listener: WorkerListener): MessagePort {
      listen(object, name, listener, true);
      return port;
    },
    start(): void {
      invoke(object, "start", []);
    },
    close(): void {
      invoke(object, "close", []);
    },
    ref(): MessagePort {
      invoke(object, "ref", []);
      return port;
    },
    unref(): MessagePort {
      invoke(object, "unref", []);
      return port;
    },
    hasRef(): boolean {
      return invoke(object, "hasRef", []) === true;
    },
  };
  return port;
}
export interface Worker {
  readonly object: ScriptObject;
  threadId: number;
  resourceLimits: ResourceLimits;
  postMessage(value: unknown, list?: readonly unknown[]): void;
  on(name: string, listener: WorkerListener): Worker;
  once(name: string, listener: WorkerListener): Worker;
  ref(): Worker;
  unref(): Worker;
  terminate(): unknown;
}
export function Worker(_filename: string, _options?: WorkerOptions): never {
  throw new TypeError("Class constructor Worker cannot be invoked without new");
}

/** Implements construction for the linked Worker binding. */
export function constructWorker(
  filename: string,
  options?: WorkerOptions,
): Worker {
  const active = host();
  const { realm, bindings } = active;
  const args: unknown[] = [filename];
  if (options !== undefined) args.push(options);
  const object = make(bindings.Worker, args, realm);
  const identity = read(object, "threadId", realm);
  if (typeof identity !== "number") throw "WORKER_THREADS_NATIVE_IDENTITY";
  const worker: Worker = {
    object,
    threadId: identity,
    resourceLimits: readLimits(
      requireObject(read(object, "resourceLimits", realm), realm),
      realm,
    ),
    postMessage(value: unknown, list?: readonly unknown[]): void {
      send(object, value, list);
    },
    on(name: string, listener: WorkerListener): Worker {
      listen(object, name, listener, false);
      return worker;
    },
    once(name: string, listener: WorkerListener): Worker {
      listen(object, name, listener, true);
      return worker;
    },
    ref(): Worker {
      invoke(object, "ref", []);
      return worker;
    },
    unref(): Worker {
      invoke(object, "unref", []);
      return worker;
    },
    terminate(): unknown {
      return invoke(object, "terminate", []);
    },
  };
  listen(
    object,
    "exit",
    (_status: unknown): void => {
      worker.threadId = -1;
      worker.resourceLimits = {};
    },
    true,
  );
  return worker;
}
