/// <reference lib="esnext.disposable" />

declare module "node:events" {
  type Name = string | symbol;
  type Listener = (...args: any[]) => unknown;
  type EventMap<Events> = Record<keyof Events, unknown[]>;
  type DefaultEvents = Record<Name, any[]>;
  type Key<Events> =
    | Extract<keyof Events, Name>
    | "newListener"
    | "removeListener"
    | typeof errorMonitor;
  type Args<Events, EventName> = EventName extends keyof Events
    ? Events[EventName] extends unknown[]
      ? Events[EventName]
      : never
    : EventName extends "newListener" | "removeListener"
      ? [Name, Listener]
      : EventName extends typeof errorMonitor
        ? [unknown]
        : never;
  type Handler<Events, EventName> = (
    ...args: Args<Events, EventName>
  ) => unknown;

  interface WaitOptions {
    signal?: AbortSignal;
  }
  interface IteratorOptions extends WaitOptions {
    close?: readonly Name[];
    highWaterMark?: number;
    lowWaterMark?: number;
    highWatermark?: number;
    lowWatermark?: number;
  }

  export const errorMonitor: unique symbol;
  export const captureRejectionSymbol: unique symbol;
  export const captureRejections: boolean;
  export const defaultMaxListeners: number;

  export class EventEmitter<Events extends EventMap<Events> = DefaultEvents> {
    constructor(options?: { captureRejections?: boolean });
    on<K extends Key<Events>>(name: K, listener: Handler<Events, K>): this;
    addListener<K extends Key<Events>>(
      name: K,
      listener: Handler<Events, K>,
    ): this;
    once<K extends Key<Events>>(name: K, listener: Handler<Events, K>): this;
    prependListener<K extends Key<Events>>(
      name: K,
      listener: Handler<Events, K>,
    ): this;
    prependOnceListener<K extends Key<Events>>(
      name: K,
      listener: Handler<Events, K>,
    ): this;
    off<K extends Key<Events>>(name: K, listener: Handler<Events, K>): this;
    removeListener<K extends Key<Events>>(
      name: K,
      listener: Handler<Events, K>,
    ): this;
    removeAllListeners(name?: Key<Events>): this;
    emit<K extends Key<Events>>(name: K, ...args: Args<Events, K>): boolean;
    listeners<K extends Key<Events>>(name: K): Handler<Events, K>[];
    rawListeners<K extends Key<Events>>(
      name: K,
    ): (Handler<Events, K> & { listener?: Handler<Events, K> })[];
    listenerCount<K extends Key<Events>>(
      name: K,
      listener?: Handler<Events, K>,
    ): number;
    eventNames(): Key<Events>[];
    setMaxListeners(n: number): this;
    getMaxListeners(): number;
    static defaultMaxListeners: number;
    static captureRejections: boolean;
    static readonly errorMonitor: typeof errorMonitor;
    static readonly captureRejectionSymbol: typeof captureRejectionSymbol;
    static readonly EventEmitter: typeof EventEmitter;
    static readonly once: typeof once;
    static readonly on: typeof on;
    static readonly addAbortListener: typeof addAbortListener;
    static readonly getEventListeners: typeof getEventListeners;
    static readonly setMaxListeners: typeof setMaxListeners;
    static readonly getMaxListeners: typeof getMaxListeners;
    static readonly listenerCount: typeof listenerCount;
  }
  export function once<Events extends EventMap<Events>, K extends Key<Events>>(
    emitter: EventEmitter<Events>,
    name: K,
    options?: WaitOptions,
  ): Promise<Args<Events, K>>;
  export function once<
    Events extends Record<keyof Events, Event>,
    K extends Extract<keyof Events, string>,
  >(
    target: EventTarget<Events>,
    name: K,
    options?: WaitOptions,
  ): Promise<[Events[K]]>;
  export function on<Events extends EventMap<Events>, K extends Key<Events>>(
    emitter: EventEmitter<Events>,
    name: K,
    options?: IteratorOptions,
  ): AsyncIterableIterator<Args<Events, K>>;
  export function on<
    Events extends Record<keyof Events, Event>,
    K extends Extract<keyof Events, string>,
  >(
    target: EventTarget<Events>,
    name: K,
    options?: IteratorOptions,
  ): AsyncIterableIterator<[Events[K]]>;
  export function addAbortListener(
    signal: AbortSignal,
    listener: (event?: Event) => unknown,
  ): Disposable;
  export function getEventListeners<
    Events extends EventMap<Events>,
    K extends Key<Events>,
  >(emitter: EventEmitter<Events>, name: K): Handler<Events, K>[];
  export function getEventListeners<
    Events extends Record<keyof Events, Event>,
    K extends Extract<keyof Events, string>,
  >(target: EventTarget<Events>, name: K): EventListenerFor<Events[K]>[];
  export function getMaxListeners(target: object): number;
  export function setMaxListeners(n?: number, ...targets: object[]): void;
  export function listenerCount<
    Events extends EventMap<Events>,
    K extends Key<Events>,
  >(emitter: EventEmitter<Events>, name: K): number;
  export default EventEmitter;
}
