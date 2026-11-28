import { addAbortListener } from "./events.ts";
import { StreamChange } from "./stream-state.ts";

interface Strategy<T> {
  readonly highWaterMark?: number;
  readonly size?: (chunk: T) => number;
}
function highWater(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (Number.isNaN(Number(value)) || value < 0)
    throw new RangeError("Invalid highWaterMark");
  return Number(value);
}
function sizeOf<T>(chunk: T | undefined, strategy: Strategy<T>): number {
  const size =
    strategy.size === undefined
      ? 1
      : Number(Reflect.apply(strategy.size, undefined, [chunk]));
  if (!Number.isFinite(size) || size < 0)
    throw new RangeError("Invalid chunk size");
  return size;
}
interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}
function deferred(): Deferred {
  let resolve = (): void => {};
  let reject = (_error: unknown): void => {};
  const promise = new Promise<void>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
interface QueueEntry<T> {
  readonly value: T;
  readonly size: number;
}

export interface UnderlyingSource<T> {
  readonly start?: (controller: ReadableStreamDefaultController<T>) => unknown;
  readonly pull?: (controller: ReadableStreamDefaultController<T>) => unknown;
  readonly cancel?: (reason: unknown) => unknown;
}
export interface StreamRead<T> {
  readonly value: T | undefined;
  readonly done: boolean;
}
interface PipeOptions {
  readonly preventAbort?: boolean;
  readonly preventCancel?: boolean;
  readonly preventClose?: boolean;
  readonly signal?: AbortSignal;
}

export class ReadableStreamDefaultController<T = unknown> {
  readonly #stream: ReadableStream<T>;
  constructor(stream: ReadableStream<T>) {
    this.#stream = stream;
  }
  get desiredSize(): number | null {
    return this.#stream.desiredSize();
  }
  enqueue(chunk: T): void {
    this.#stream.enqueue(chunk);
  }
  close(): void {
    this.#stream.closeSource();
  }
  error(error?: unknown): void {
    this.#stream.errorSource(error);
  }
}

export class ReadableStream<T = unknown> {
  readonly #source: UnderlyingSource<T>;
  readonly #strategy: Strategy<T>;
  readonly #mark: number;
  readonly #queue: QueueEntry<T>[] = [];
  readonly #change = new StreamChange();
  readonly #closed = deferred();
  readonly #controller: ReadableStreamDefaultController<T>;
  #length = 0;
  #pending = 0;
  #state: "readable" | "closed" | "errored" = "readable";
  #reason: unknown;
  #reader: ReadableStreamDefaultReader<T> | undefined;
  #closing = false;
  #started = false;
  #pulling = false;
  #pullAgain = false;
  constructor(source: UnderlyingSource<T> = {}, strategy: Strategy<T> = {}) {
    this.#source = source;
    this.#strategy = strategy;
    this.#mark = highWater(strategy.highWaterMark, 1);
    this.#controller = new ReadableStreamDefaultController<T>(this);
    const started = source.start?.(this.#controller);
    void Promise.resolve(started).then(
      (): void => {
        this.#started = true;
        this.#pull();
      },
      (error: unknown): void => this.errorSource(error),
    );
  }
  get locked(): boolean {
    return this.#reader !== undefined;
  }
  getReader(): ReadableStreamDefaultReader<T> {
    return new ReadableStreamDefaultReader<T>(this);
  }
  acquire(reader: ReadableStreamDefaultReader<T>): Promise<void> {
    if (this.locked) throw new TypeError("ReadableStream is locked");
    this.#reader = reader;
    return this.#closed.promise;
  }
  release(reader: ReadableStreamDefaultReader<T>): void {
    if (this.#reader === reader) {
      this.#reader = undefined;
      this.#change.notify();
    }
  }
  desiredSize(): number | null {
    if (this.#state === "errored") return null;
    return this.#state === "closed" ? 0 : this.#mark - this.#length;
  }
  #pull(): void {
    if (
      !this.#started ||
      this.#closing ||
      this.#state !== "readable" ||
      (this.#pending <= this.#queue.length && this.#length >= this.#mark) ||
      this.#source.pull === undefined
    )
      return;
    if (this.#pulling) {
      this.#pullAgain = true;
      return;
    }
    this.#pulling = true;
    let result: unknown;
    try {
      result = this.#source.pull(this.#controller);
    } catch (error) {
      this.errorSource(error);
      return;
    }
    void Promise.resolve(result).then(
      (): void => {
        this.#pulling = false;
        if (this.#pullAgain) {
          this.#pullAgain = false;
          this.#pull();
        }
      },
      (error: unknown): void => this.errorSource(error),
    );
  }
  enqueue(chunk: T): void {
    if (this.#closing || this.#state !== "readable")
      throw new TypeError("ReadableStream cannot enqueue");
    try {
      const size =
        this.#pending > this.#queue.length ? 0 : sizeOf(chunk, this.#strategy);
      this.#queue.push({ value: chunk, size });
      this.#length += size;
      this.#change.notify();
      this.#pull();
    } catch (error) {
      this.errorSource(error);
      throw error;
    }
  }
  closeSource(): void {
    if (this.#closing || this.#state !== "readable")
      throw new TypeError("ReadableStream cannot close");
    this.#closing = true;
    this.#closeIfDrained();
  }
  #closeIfDrained(): void {
    if (!this.#closing || this.#queue.length !== 0) return;
    this.#state = "closed";
    this.#closed.resolve();
    this.#change.notify();
  }
  errorSource(error: unknown): void {
    if (this.#state !== "readable") return;
    this.#state = "errored";
    this.#reason = error;
    this.#queue.length = 0;
    this.#length = 0;
    this.#closed.reject(error);
    this.#change.notify();
  }
  async readFor(
    reader: ReadableStreamDefaultReader<T>,
  ): Promise<StreamRead<T>> {
    this.#pending++;
    try {
      for (;;) {
        if (this.#reader !== reader) throw new TypeError("Reader was released");
        if (this.#state === "errored") throw this.#reason;
        const entry = this.#queue.shift();
        if (entry !== undefined) {
          this.#length -= entry.size;
          this.#closeIfDrained();
          return { value: entry.value, done: false };
        }
        if (this.#state === "closed") return { value: undefined, done: true };
        const changed = this.#change.wait();
        this.#pull();
        await changed;
      }
    } finally {
      this.#pending--;
      this.#pull();
    }
  }
  async cancel(reason?: unknown): Promise<void> {
    if (this.locked) throw new TypeError("ReadableStream is locked");
    await this.cancelSource(reason);
  }
  async cancelSource(reason: unknown): Promise<void> {
    if (this.#state === "closed") return;
    if (this.#state === "errored") throw this.#reason;
    this.#closing = true;
    this.#queue.length = 0;
    this.#length = 0;
    this.#closeIfDrained();
    await this.#source.cancel?.(reason);
  }
  async *values(
    options: { readonly preventCancel?: boolean } = {},
  ): AsyncIterableIterator<T | undefined> {
    const reader = this.getReader();
    let complete = false;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) {
          complete = true;
          return;
        }
        yield result.value;
      }
    } finally {
      try {
        if (!complete && options.preventCancel !== true) await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
  }
  [Symbol.asyncIterator](): AsyncIterableIterator<T | undefined> {
    return this.values();
  }
  pipeThrough<U>(
    transform: {
      readonly writable: WritableStream<T>;
      readonly readable: ReadableStream<U>;
    },
    options?: PipeOptions,
  ): ReadableStream<U> {
    if (this.locked || transform.writable.locked)
      throw new TypeError("Stream is locked");
    void this.pipeTo(transform.writable, options).catch(() => {});
    return transform.readable;
  }
  async pipeTo(
    destination: WritableStream<T>,
    options: PipeOptions = {},
  ): Promise<void> {
    const reader = this.getReader();
    let writer: WritableStreamDefaultWriter<T>;
    try {
      writer = destination.getWriter();
    } catch (error) {
      reader.releaseLock();
      throw error;
    }
    const signal = options.signal;
    let rejectOperation: ((reason: unknown) => void) | undefined;
    let subscription: Record<symbol, () => void> | undefined;
    let reading = true;
    async function duringPipe<R>(operation: () => Promise<R>): Promise<R> {
      if (signal === undefined) return operation();
      if (signal.aborted) throw signal.reason;
      return new Promise<R>((resolve, reject) => {
        rejectOperation = reject;
        void operation().then(
          (value): void => {
            rejectOperation = undefined;
            resolve(value);
          },
          (error: unknown): void => {
            rejectOperation = undefined;
            reject(error);
          },
        );
      });
    }
    try {
      if (signal !== undefined) {
        if (signal.aborted) throw signal.reason;
        subscription = addAbortListener(signal, () =>
          rejectOperation?.(signal.reason),
        );
      }
      for (;;) {
        reading = true;
        const result = await duringPipe(() => reader.read());
        reading = false;
        if (result.done) break;
        await duringPipe(() => writer.write(result.value));
      }
      if (options.preventClose !== true) await duringPipe(() => writer.close());
    } catch (error) {
      const aborted = signal?.aborted === true;
      const cleanup: Promise<void>[] = [];
      if ((reading || aborted) && options.preventAbort !== true)
        cleanup.push(writer.abort(error));
      if ((!reading || aborted) && options.preventCancel !== true)
        cleanup.push(reader.cancel(error));
      await Promise.all(cleanup);
      throw error;
    } finally {
      subscription?.[Symbol.dispose]?.();
      reader.releaseLock();
      writer.releaseLock();
    }
  }
}

export class ReadableStreamDefaultReader<T = unknown> {
  #stream: ReadableStream<T> | undefined;
  #closed = deferred();
  constructor(stream: ReadableStream<T>) {
    this.#stream = stream;
    const closed = this.#closed;
    void stream.acquire(this).then(closed.resolve, closed.reject);
  }
  get closed(): Promise<void> {
    return this.#closed.promise;
  }
  async read(): Promise<StreamRead<T>> {
    const stream = this.#stream;
    if (stream === undefined) throw new TypeError("Reader was released");
    return stream.readFor(this);
  }
  async cancel(reason?: unknown): Promise<void> {
    const stream = this.#stream;
    if (stream === undefined) throw new TypeError("Reader was released");
    await stream.cancelSource(reason);
  }
  releaseLock(): void {
    if (this.#stream === undefined) return;
    this.#stream.release(this);
    this.#stream = undefined;
    const error = new TypeError("Reader was released");
    this.#closed.reject(error);
    const released = deferred();
    released.reject(error);
    this.#closed = released;
  }
}

export interface UnderlyingSink<T> {
  readonly start?: (controller: WritableStreamDefaultController<T>) => unknown;
  readonly write?: (
    chunk: T,
    controller: WritableStreamDefaultController<T>,
  ) => unknown;
  readonly close?: () => unknown;
  readonly abort?: (reason: unknown) => unknown;
}
export class WritableStreamDefaultController<T = unknown> {
  readonly #stream: WritableStream<T>;
  readonly #signal = new AbortController();
  constructor(stream: WritableStream<T>) {
    this.#stream = stream;
  }
  get signal(): AbortSignal {
    return this.#signal.signal;
  }
  error(error?: unknown): void {
    this.#stream.errorSink(error);
  }
  interrupt(reason: unknown): void {
    this.#signal.abort(reason);
  }
}

export class WritableStream<T = unknown> {
  readonly #sink: UnderlyingSink<T>;
  readonly #controller: WritableStreamDefaultController<T>;
  readonly #strategy: Strategy<T>;
  readonly #mark: number;
  readonly #closed = deferred();
  #ready = deferred();
  #chain: Promise<void>;
  #writer: WritableStreamDefaultWriter<T> | undefined;
  #state: "writable" | "closing" | "closed" | "errored" = "writable";
  #reason: unknown;
  #length = 0;
  #pressured = false;
  constructor(sink: UnderlyingSink<T> = {}, strategy: Strategy<T> = {}) {
    this.#sink = sink;
    this.#strategy = strategy;
    this.#mark = highWater(strategy.highWaterMark, 1);
    this.#controller = new WritableStreamDefaultController<T>(this);
    this.#pressured = this.#mark === 0;
    if (!this.#pressured) this.#ready.resolve();
    this.#chain = Promise.resolve(sink.start?.(this.#controller)).then(
      (): void => {},
      (error: unknown): void => this.errorSink(error),
    );
  }
  get locked(): boolean {
    return this.#writer !== undefined;
  }
  getWriter(): WritableStreamDefaultWriter<T> {
    return new WritableStreamDefaultWriter<T>(this);
  }
  acquire(writer: WritableStreamDefaultWriter<T>): void {
    if (this.locked) throw new TypeError("WritableStream is locked");
    this.#writer = writer;
  }
  release(writer: WritableStreamDefaultWriter<T>): void {
    if (this.#writer === writer) this.#writer = undefined;
  }
  get closedPromise(): Promise<void> {
    return this.#closed.promise;
  }
  get readyPromise(): Promise<void> {
    return this.#ready.promise;
  }
  get desired(): number | null {
    if (this.#state === "errored") return null;
    return this.#state === "closed" ? 0 : this.#mark - this.#length;
  }
  errorSink(error: unknown): void {
    if (this.#state === "errored" || this.#state === "closed") return;
    this.#state = "errored";
    this.#reason = error;
    this.#closed.reject(error);
    if (!this.#pressured) this.#ready = deferred();
    this.#ready.reject(error);
  }
  async writeSink(chunk: T | undefined): Promise<void> {
    if (this.#state === "errored") throw this.#reason;
    if (this.#state !== "writable")
      throw new TypeError("WritableStream is closing");
    let size: number;
    try {
      size = sizeOf(chunk, this.#strategy);
    } catch (error) {
      this.errorSink(error);
      throw error;
    }
    this.#length += size;
    if (!this.#pressured && this.#length >= this.#mark) {
      this.#pressured = true;
      this.#ready = deferred();
    }
    const write = this.#chain.then(async () => {
      if (this.#state === "errored") throw this.#reason;
      try {
        // An omitted write argument is delivered to the underlying sink.
        if (this.#sink.write !== undefined)
          await Reflect.apply(this.#sink.write, this.#sink, [
            chunk,
            this.#controller,
          ]);
      } catch (error) {
        this.errorSink(error);
        throw error;
      } finally {
        this.#length -= size;
        if (
          this.#pressured &&
          this.#length < this.#mark &&
          this.#state === "writable"
        ) {
          this.#pressured = false;
          this.#ready.resolve();
        }
      }
    });
    this.#chain = write.catch(() => {});
    await write;
  }
  async close(): Promise<void> {
    if (this.locked) throw new TypeError("WritableStream is locked");
    await this.closeSink();
  }
  async closeSink(): Promise<void> {
    if (this.#state === "errored") throw this.#reason;
    if (this.#state !== "writable")
      throw new TypeError("WritableStream is closing");
    this.#state = "closing";
    this.#ready.resolve();
    await this.#chain;
    if (this.#closedStateIsError()) throw this.#reason;
    try {
      await this.#sink.close?.();
      if (this.#closedStateIsError()) throw this.#reason;
      this.#state = "closed";
      this.#closed.resolve();
    } catch (error) {
      this.errorSink(error);
      throw error;
    }
  }
  #closedStateIsError(): boolean {
    return this.#state === "errored";
  }
  async abort(reason?: unknown): Promise<void> {
    if (this.locked) throw new TypeError("WritableStream is locked");
    await this.abortSink(reason);
  }
  async abortSink(reason: unknown): Promise<void> {
    if (this.#state === "closed" || this.#state === "errored") return;
    this.#controller.interrupt(reason);
    this.errorSink(reason);
    await this.#chain;
    await this.#sink.abort?.(reason);
  }
}
export class WritableStreamDefaultWriter<T = unknown> {
  #stream: WritableStream<T> | undefined;
  readonly #released = deferred();
  constructor(stream: WritableStream<T>) {
    this.#stream = stream;
    stream.acquire(this);
  }
  get closed(): Promise<void> {
    return this.#stream?.closedPromise ?? this.#released.promise;
  }
  get ready(): Promise<void> {
    return this.#stream?.readyPromise ?? this.#released.promise;
  }
  get desiredSize(): number | null {
    const stream = this.#stream;
    if (stream === undefined) throw new TypeError("Writer was released");
    return stream.desired;
  }
  async write(chunk?: T): Promise<void> {
    if (this.#stream === undefined) throw new TypeError("Writer was released");
    await this.#stream.writeSink(chunk);
  }
  async close(): Promise<void> {
    if (this.#stream === undefined) throw new TypeError("Writer was released");
    await this.#stream.closeSink();
  }
  async abort(reason?: unknown): Promise<void> {
    if (this.#stream === undefined) throw new TypeError("Writer was released");
    await this.#stream.abortSink(reason);
  }
  releaseLock(): void {
    if (this.#stream === undefined) return;
    this.#stream.release(this);
    this.#stream = undefined;
    this.#released.reject(new TypeError("Writer was released"));
  }
}

export class CountQueuingStrategy {
  readonly highWaterMark: number;
  constructor(init: { readonly highWaterMark: number }) {
    this.highWaterMark = Number(init.highWaterMark);
  }
  size(): number {
    return 1;
  }
}
export class ByteLengthQueuingStrategy {
  readonly highWaterMark: number;
  constructor(init: { readonly highWaterMark: number }) {
    this.highWaterMark = Number(init.highWaterMark);
  }
  size(chunk: { readonly byteLength: number }): number {
    return chunk.byteLength;
  }
}

export interface Transformer<I, O> {
  readonly start?: (controller: TransformStreamDefaultController<O>) => unknown;
  readonly transform?: (
    chunk: I,
    controller: TransformStreamDefaultController<O>,
  ) => unknown;
  readonly flush?: (controller: TransformStreamDefaultController<O>) => unknown;
}

export class TransformStreamDefaultController<T = unknown> {
  readonly #readable: ReadableStreamDefaultController<T>;
  readonly #failure: (error: unknown) => void;
  readonly #terminate: () => void;
  constructor(
    readable: ReadableStreamDefaultController<T>,
    failure: (error: unknown) => void,
    terminate: () => void,
  ) {
    this.#readable = readable;
    this.#failure = failure;
    this.#terminate = terminate;
  }
  get desiredSize(): number | null {
    return this.#readable.desiredSize;
  }
  enqueue(chunk: T): void {
    this.#readable.enqueue(chunk);
  }
  error(reason?: unknown): void {
    this.#failure(reason);
  }
  terminate(): void {
    this.#terminate();
  }
}

export class TransformStream<I = unknown, O = I> {
  readonly readable: ReadableStream<O>;
  readonly writable: WritableStream<I>;
  constructor(
    transformer: Transformer<I, O> = {},
    writableStrategy: Strategy<I> = {},
    readableStrategy: Strategy<O> = {},
  ) {
    const changed = new StreamChange();
    let readController: ReadableStreamDefaultController<O> | undefined;
    let writeController: WritableStreamDefaultController<I> | undefined;
    let demanded = false;
    let failed = false;
    let reason: unknown;
    function fail(error: unknown): void {
      if (failed) return;
      failed = true;
      reason = error;
      readController?.error(error);
      writeController?.error(error);
      changed.notify();
    }
    this.readable = new ReadableStream<O>(
      {
        start(controller): void {
          readController = controller;
        },
        pull(): void {
          demanded = true;
          changed.notify();
        },
        cancel: fail,
      },
      { highWaterMark: 0, ...readableStrategy },
    );
    const readable = readController;
    if (readable === undefined) throw new Error("Missing transform controller");
    const controller = new TransformStreamDefaultController<O>(
      readable,
      fail,
      (): void => {
        readable.close();
        fail(new TypeError("TransformStream terminated"));
      },
    );
    this.writable = new WritableStream<I>(
      {
        start(sink): unknown {
          writeController = sink;
          sink.signal.addEventListener(
            "abort",
            () => fail(sink.signal.reason),
            { once: true },
          );
          return transformer.start?.(controller);
        },
        async write(chunk): Promise<void> {
          while (!demanded && !failed && (readable.desiredSize ?? 0) <= 0)
            await changed.wait();
          if (failed) throw reason;
          demanded = false;
          try {
            if (transformer.transform === undefined)
              Reflect.apply(controller.enqueue, controller, [chunk]);
            else await transformer.transform(chunk, controller);
          } catch (error) {
            fail(error);
            throw error;
          }
        },
        async close(): Promise<void> {
          try {
            await transformer.flush?.(controller);
            if (failed) throw reason;
            readable.close();
          } catch (error) {
            fail(error);
            throw error;
          }
        },
        abort: fail,
      },
      writableStrategy,
    );
  }
}

const web = {
  ReadableStream,
  ReadableStreamDefaultReader,
  ReadableStreamDefaultController,
  WritableStream,
  WritableStreamDefaultWriter,
  WritableStreamDefaultController,
  CountQueuingStrategy,
  ByteLengthQueuingStrategy,
  TransformStream,
  TransformStreamDefaultController,
};
for (const name of Object.keys(web))
  if (name !== undefined && !Object.hasOwn(globalThis, name))
    Object.defineProperty(globalThis, name, {
      value: Reflect.get(web, name),
      writable: true,
      configurable: true,
    });
export default web;
