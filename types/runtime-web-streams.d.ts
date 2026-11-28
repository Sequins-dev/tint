declare const TransformStream: typeof import("node:stream/web").TransformStream;
declare const TransformStreamDefaultController: typeof import("node:stream/web").TransformStreamDefaultController;
declare const ReadableStream: typeof import("node:stream/web").ReadableStream;
declare const WritableStream: typeof import("node:stream/web").WritableStream;
declare const ReadableStreamDefaultReader: typeof import("node:stream/web").ReadableStreamDefaultReader;
declare const WritableStreamDefaultWriter: typeof import("node:stream/web").WritableStreamDefaultWriter;
declare const ReadableStreamDefaultController: typeof import("node:stream/web").ReadableStreamDefaultController;
declare const WritableStreamDefaultController: typeof import("node:stream/web").WritableStreamDefaultController;
declare const CountQueuingStrategy: typeof import("node:stream/web").CountQueuingStrategy;
declare const ByteLengthQueuingStrategy: typeof import("node:stream/web").ByteLengthQueuingStrategy;

declare module "node:stream/web" {
  export interface QueuingStrategy<T> {
    highWaterMark?: number;
    size?(chunk: T): number;
  }
  export interface UnderlyingSource<T> {
    start?(controller: ReadableStreamDefaultController<T>): unknown;
    pull?(controller: ReadableStreamDefaultController<T>): unknown;
    cancel?(reason: unknown): unknown;
  }
  export interface UnderlyingSink<T> {
    start?(controller: WritableStreamDefaultController<T>): unknown;
    write?(chunk: T, controller: WritableStreamDefaultController<T>): unknown;
    close?(): unknown;
    abort?(reason: unknown): unknown;
  }
  export interface PipeOptions {
    preventAbort?: boolean;
    preventCancel?: boolean;
    preventClose?: boolean;
    signal?: AbortSignal;
  }
  export type ReadableStreamReadResult<T> =
    { done: false; value: T } | { done: true; value: undefined };
  export class ReadableStream<T = unknown> implements AsyncIterable<T> {
    constructor(source?: UnderlyingSource<T>, strategy?: QueuingStrategy<T>);
    readonly locked: boolean;
    getReader(): ReadableStreamDefaultReader<T>;
    cancel(reason?: unknown): Promise<void>;
    pipeTo(
      destination: WritableStream<T>,
      options?: PipeOptions,
    ): Promise<void>;
    pipeThrough<U>(
      transform: { writable: WritableStream<T>; readable: ReadableStream<U> },
      options?: PipeOptions,
    ): ReadableStream<U>;
    values(options?: { preventCancel?: boolean }): AsyncIterableIterator<T>;
    [Symbol.asyncIterator](): AsyncIterableIterator<T>;
  }
  export class ReadableStreamDefaultController<T = unknown> {
    private constructor();
    readonly desiredSize: number | null;
    enqueue(chunk: T): void;
    close(): void;
    error(reason?: unknown): void;
  }
  export class ReadableStreamDefaultReader<T = unknown> {
    constructor(stream: ReadableStream<T>);
    readonly closed: Promise<void>;
    read(): Promise<ReadableStreamReadResult<T>>;
    cancel(reason?: unknown): Promise<void>;
    releaseLock(): void;
  }
  export class WritableStream<T = unknown> {
    constructor(sink?: UnderlyingSink<T>, strategy?: QueuingStrategy<T>);
    readonly locked: boolean;
    getWriter(): WritableStreamDefaultWriter<T>;
    abort(reason?: unknown): Promise<void>;
    close(): Promise<void>;
  }
  export class WritableStreamDefaultController<T = unknown> {
    private constructor();
    readonly signal: AbortSignal;
    error(reason?: unknown): void;
  }
  export class WritableStreamDefaultWriter<T = unknown> {
    constructor(stream: WritableStream<T>);
    readonly closed: Promise<void>;
    readonly ready: Promise<void>;
    readonly desiredSize: number | null;
    write(chunk?: T): Promise<void>;
    close(): Promise<void>;
    abort(reason?: unknown): Promise<void>;
    releaseLock(): void;
  }
  export class CountQueuingStrategy implements QueuingStrategy<unknown> {
    constructor(options: { highWaterMark: number });
    readonly highWaterMark: number;
    size(): number;
  }
  export class ByteLengthQueuingStrategy implements QueuingStrategy<{
    byteLength: number;
  }> {
    constructor(options: { highWaterMark: number });
    readonly highWaterMark: number;
    size(chunk: { byteLength: number }): number;
  }

  export interface Transformer<I, O> {
    start?(controller: TransformStreamDefaultController<O>): unknown;
    transform?(
      chunk: I,
      controller: TransformStreamDefaultController<O>,
    ): unknown;
    flush?(controller: TransformStreamDefaultController<O>): unknown;
  }
  export class TransformStream<I = unknown, O = I> {
    constructor(
      transformer?: Transformer<I, O>,
      writableStrategy?: QueuingStrategy<I>,
      readableStrategy?: QueuingStrategy<O>,
    );
    readonly readable: ReadableStream<O>;
    readonly writable: WritableStream<I>;
  }
  export class TransformStreamDefaultController<T = unknown> {
    private constructor();
    readonly desiredSize: number | null;
    enqueue(chunk: T): void;
    error(reason?: unknown): void;
    terminate(): void;
  }
  const web: {
    TransformStream: typeof TransformStream;
    TransformStreamDefaultController: typeof TransformStreamDefaultController;
    ReadableStream: typeof ReadableStream;
    ReadableStreamDefaultController: typeof ReadableStreamDefaultController;
    ReadableStreamDefaultReader: typeof ReadableStreamDefaultReader;
    WritableStream: typeof WritableStream;
    WritableStreamDefaultController: typeof WritableStreamDefaultController;
    WritableStreamDefaultWriter: typeof WritableStreamDefaultWriter;
    CountQueuingStrategy: typeof CountQueuingStrategy;
    ByteLengthQueuingStrategy: typeof ByteLengthQueuingStrategy;
  };
  export default web;
}
