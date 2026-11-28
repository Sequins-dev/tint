declare module "node:stream" {
  import { EventEmitter } from "node:events";
  export type Completion = (error?: Error | null) => void;
  export interface StreamOptions {
    objectMode?: boolean;
    highWaterMark?: number;
    emitClose?: boolean;
    autoDestroy?: boolean;
    signal?: AbortSignal;
    destroy?(error: Error | null, callback: Completion): void;
  }
  interface StreamEvents {
    error: [Error];
    close: [];
  }
  interface ReadableEvents<T> extends StreamEvents {
    data: [T];
    readable: [];
    end: [];
    pause: [];
    resume: [];
  }
  interface WritableEvents extends StreamEvents {
    drain: [];
    prefinish: [];
    finish: [];
    pipe: [Readable<unknown>];
    unpipe: [Readable<unknown>];
  }
  export class Stream<
    Events extends Record<keyof Events, unknown[]> = StreamEvents,
  > extends EventEmitter<Events> {
    constructor(options?: StreamOptions);
    readonly destroyed: boolean;
    readonly closed: boolean;
    readonly errored: Error | null;
    destroy(error?: Error | null): this;
  }
  export interface ReadableOptions<T> extends StreamOptions {
    read?(this: Readable<T>, size: number): void;
  }
  export class Readable<T = unknown>
    extends Stream<ReadableEvents<T>>
    implements AsyncIterable<T>
  {
    constructor(options?: ReadableOptions<T>);
    static from<T>(
      source: Iterable<T> | AsyncIterable<T>,
      options?: ReadableOptions<Awaited<T>>,
    ): Readable<Awaited<T>>;
    readonly readable: boolean;
    readonly readableHighWaterMark: number;
    readonly readableObjectMode: boolean;
    readonly readableLength: number;
    readonly readableEnded: boolean;
    readonly readableFlowing: boolean | null;
    push(chunk: T | null, encoding?: string): boolean;
    read(): T | null;
    pause(): this;
    resume(): this;
    isPaused(): boolean;
    pipe<W extends Writable<T>>(destination: W, options?: { end?: boolean }): W;
    unpipe(destination?: Writable<T>): this;
    [Symbol.asyncIterator](): AsyncIterableIterator<T>;
  }
  export interface WritableOptions<T> extends StreamOptions {
    write?(
      this: Writable<T>,
      chunk: T,
      encoding: string,
      done: Completion,
    ): void;
    final?(this: Writable<T>, done: Completion): void;
  }
  export class Writable<T = unknown> extends Stream<WritableEvents> {
    constructor(options?: WritableOptions<T>);
    readonly writable: boolean;
    readonly writableHighWaterMark: number;
    readonly writableObjectMode: boolean;
    readonly writableLength: number;
    readonly writableNeedDrain: boolean;
    readonly writableEnded: boolean;
    readonly writableFinished: boolean;
    write(
      chunk: T,
      encoding?: string | Completion,
      callback?: Completion,
    ): boolean;
    end(
      chunk?: T | Completion,
      encoding?: string | Completion,
      callback?: Completion,
    ): this;
  }
  export interface FinishedOptions {
    readable?: boolean;
    writable?: boolean;
    signal?: AbortSignal;
    cleanup?: boolean;
  }
  export interface PipelineOptions {
    signal?: AbortSignal;
    end?: boolean;
  }
  export function addAbortSignal<S>(signal: AbortSignal, stream: S): S;
  export function finished<T>(
    stream: Readable<T> | Writable<T>,
    callback: Completion,
  ): () => void;
  export function finished<T>(
    stream: Readable<T> | Writable<T>,
    options: FinishedOptions,
    callback: Completion,
  ): () => void;
  export function pipeline<T, W extends Writable<NoInfer<T>>>(
    source: Readable<T> | Iterable<T> | AsyncIterable<T>,
    destination: W,
    callback: Completion,
  ): W;
  const stream: typeof Stream & {
    Stream: typeof Stream;
    Readable: typeof Readable;
    Writable: typeof Writable;
    addAbortSignal: typeof addAbortSignal;
    finished: typeof finished;
    pipeline: typeof pipeline;
  };
  export default stream;
}

declare module "node:stream/promises" {
  import type {
    FinishedOptions,
    PipelineOptions,
    Readable,
    Writable,
  } from "node:stream";
  export function finished<T>(
    stream: Readable<T> | Writable<T>,
    options?: FinishedOptions,
  ): Promise<void>;
  export function pipeline<T>(
    source: Readable<T> | Iterable<T> | AsyncIterable<T>,
    destination: Writable<NoInfer<T>>,
    options?: PipelineOptions,
  ): Promise<void>;
  const streamPromises: {
    finished: typeof finished;
    pipeline: typeof pipeline;
  };
  export default streamPromises;
}
