import { Buffer } from "node:buffer";
import { EventEmitter, addAbortListener } from "./events.ts";
import { nextTick } from "./process.ts";
import { abortError, codedError, invalidArgument } from "./coded-errors.ts";
import { StreamChange, waterMark } from "./stream-state.ts";

export type Completion = (error?: Error | null) => void;
type Listener = (...args: unknown[]) => unknown;
type Chunk = unknown;
interface StreamOptions {
  readonly objectMode?: boolean;
  readonly highWaterMark?: number;
  readonly emitClose?: boolean;
  readonly autoDestroy?: boolean;
  readonly signal?: AbortSignal;
  readonly destroy?: (error: Error | null, done: Completion) => void;
}
function turn(callback: () => void): void {
  if (typeof nextTick === "function") nextTick(callback);
  else void Promise.resolve().then(callback);
}
function failure(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
function premature(): Error {
  return codedError(new Error("Premature close"), "ERR_STREAM_PREMATURE_CLOSE");
}

export class Stream extends EventEmitter {
  destroyed = false;
  closed = false;
  errored: Error | null = null;
  readonly autoDestroy: boolean;
  readonly emitClose: boolean;
  readonly #closedChange = new StreamChange();
  readonly #destroyHook: StreamOptions["destroy"];
  constructor(options: StreamOptions = {}) {
    super();
    this.autoDestroy = options.autoDestroy !== false;
    this.emitClose = options.emitClose !== false;
    this.#destroyHook = options.destroy;
    if (options.signal !== undefined) addAbortSignal(options.signal, this);
  }
  _destroy(error: Error | null, done: Completion): void {
    if (this.#destroyHook !== undefined)
      this.#destroyHook.call(this, error, done);
    else done(error);
  }
  async waitClosed(): Promise<void> {
    while (!this.closed) await this.#closedChange.wait();
  }
  destroy(error?: Error | null): Stream {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.errored = error ?? null;
    let done = false;
    const complete = (result?: Error | null): void => {
      if (done) return;
      done = true;
      this.errored = result ?? this.errored;
      turn(() => {
        this.closed = true;
        try {
          if (this.errored !== null) this.emit("error", this.errored);
          if (this.emitClose) this.emit("close");
        } finally {
          this.#closedChange.notify();
        }
      });
    };
    try {
      this._destroy(this.errored, complete);
    } catch (err) {
      complete(failure(err));
    }
    return this;
  }
}
export function addAbortSignal<S extends Stream>(
  signal: AbortSignal,
  stream: S,
): S {
  if (!(signal instanceof AbortSignal))
    throw invalidArgument("signal", "an instance of AbortSignal", signal);
  if (signal.aborted)
    turn(() => {
      stream.destroy(abortError(signal.reason));
    });
  else {
    const subscription = addAbortListener(signal, () => {
      stream.destroy(abortError(signal.reason));
    });
    const cleanup = (): void => subscription[Symbol.dispose]?.();
    stream.once("close", cleanup);
    stream.once("end", () => {
      if (stream instanceof Readable) cleanup();
    });
    stream.once("finish", () => {
      if (stream instanceof Writable) cleanup();
    });
  }
  return stream;
}

interface Buffered {
  readonly value: Chunk;
  readonly size: number;
}
function normalize(
  chunk: Chunk,
  objectMode: boolean,
  encoding: string,
): Buffered {
  if (chunk === null)
    throw codedError(
      new TypeError("May not write null values to stream"),
      "ERR_STREAM_NULL_VALUES",
    );
  if (objectMode) return { value: chunk, size: 1 };
  if (typeof chunk === "string") {
    const bytes = Buffer.from(chunk, encoding);
    return { value: bytes, size: bytes.length };
  }
  if (chunk instanceof Uint8Array) return { value: chunk, size: chunk.length };
  throw invalidArgument("chunk", "a string or Uint8Array", chunk);
}

export interface WritableOptions extends StreamOptions {
  readonly write?: (chunk: Chunk, encoding: string, done: Completion) => void;
  readonly final?: (done: Completion) => void;
}
interface WriteEntry extends Buffered {
  readonly callback: Completion | undefined;
}

export class Writable extends Stream {
  readonly writableHighWaterMark: number;
  readonly writableObjectMode: boolean;
  writableLength = 0;
  writableNeedDrain = false;
  writableEnded = false;
  writableFinished = false;
  readonly #writeHook: WritableOptions["write"];
  readonly #finalHook: WritableOptions["final"];
  readonly #pending: WriteEntry[] = [];
  #active: WriteEntry | undefined = undefined;
  #finalizing = false;
  readonly #ending: Completion[] = [];
  constructor(options: WritableOptions = {}) {
    super(options);
    this.writableObjectMode = options.objectMode === true;
    this.writableHighWaterMark = waterMark(
      options.highWaterMark,
      this.writableObjectMode ? 16 : 65536,
    );
    this.#writeHook = options.write;
    this.#finalHook = options.final;
  }
  get writable(): boolean {
    return !this.destroyed && !this.writableEnded && this.errored === null;
  }
  _write(chunk: Chunk, encoding: string, done: Completion): void {
    if (this.#writeHook !== undefined)
      this.#writeHook.call(this, chunk, encoding, done);
    else
      done(
        codedError(
          new Error("_write() is not implemented"),
          "ERR_METHOD_NOT_IMPLEMENTED",
        ),
      );
  }
  _final(done: Completion): void {
    if (this.#finalHook !== undefined) this.#finalHook.call(this, done);
    else done();
  }
  write(
    chunk: Chunk,
    encoding?: string | Completion,
    callback?: Completion,
  ): boolean {
    const cb = typeof encoding === "function" ? encoding : callback;
    if (this.writableEnded || this.destroyed) {
      const error = this.destroyed
        ? codedError(
            new Error("Cannot call write after a stream was destroyed"),
            "ERR_STREAM_DESTROYED",
          )
        : codedError(
            new Error("write after end"),
            "ERR_STREAM_WRITE_AFTER_END",
          );
      turn(() => {
        cb?.(error);
        if (!this.destroyed) this.destroy(error);
      });
      return false;
    }
    const value = normalize(
      chunk,
      this.writableObjectMode,
      typeof encoding === "string" ? encoding : "utf8",
    );
    this.writableLength += value.size;
    const room = this.writableLength < this.writableHighWaterMark;
    this.#pending.push({ value: value.value, size: value.size, callback: cb });
    this.#pump();
    const accepted = room || this.writableLength === 0;
    if (!accepted && !this.destroyed) this.writableNeedDrain = true;
    return accepted && !this.destroyed;
  }
  #pump(): void {
    if (this.destroyed || this.#active !== undefined || this.#finalizing)
      return;
    const current = this.#pending.shift();
    if (current === undefined) {
      if (this.writableEnded && !this.writableFinished) this.#finish();
      return;
    }
    this.#active = current;
    let synchronous = true;
    let called = false;
    const done = (error?: Error | null): void => {
      if (called) return;
      called = true;
      if (this.#active !== current) return;
      this.writableLength -= current.size;
      const after = (): void => {
        if (this.#active !== current) return;
        this.#active = undefined;
        if (error !== undefined && error !== null) {
          current.callback?.(error);
          this.destroy(error);
          return;
        }
        if (
          this.writableNeedDrain &&
          this.writableLength === 0 &&
          !this.writableEnded
        ) {
          this.writableNeedDrain = false;
          this.emit("drain");
        }
        current.callback?.();
        this.#pump();
      };
      if (synchronous) turn(after);
      else after();
    };
    try {
      this._write(current.value, "buffer", done);
    } catch (error) {
      done(failure(error));
    }
    synchronous = false;
  }
  end(
    chunk?: Chunk,
    encoding?: string | Completion,
    callback?: Completion,
  ): Writable {
    let cb = typeof encoding === "function" ? encoding : callback;
    if (typeof chunk === "function") {
      const fn = chunk;
      cb = (error): void => {
        fn(error);
      };
    } else if (chunk !== undefined && chunk !== null)
      this.write(chunk, typeof encoding === "string" ? encoding : undefined);
    if (cb !== undefined) {
      const done = cb;
      if (this.writableFinished) turn(() => done());
      else this.#ending.push(done);
    }
    this.writableEnded = true;
    this.#pump();
    return this;
  }
  #finish(): void {
    this.#finalizing = true;
    let called = false;
    const done = (error?: Error | null): void => {
      if (called) return;
      called = true;
      if (error !== undefined && error !== null) {
        this.destroy(error);
        return;
      }
      if (!this.destroyed) {
        this.emit("prefinish");
        turn(() => {
          if (this.destroyed) return;
          this.writableFinished = true;
          for (const cb of this.#ending.splice(0)) if (cb !== undefined) cb();
          this.emit("finish");
          if (this.autoDestroy) this.destroy();
        });
      }
    };
    try {
      this._final(done);
    } catch (error) {
      done(failure(error));
    }
  }
  override destroy(error?: Error | null): Writable {
    if (!this.destroyed) {
      const active = this.#active;
      this.#active = undefined;
      const pending = this.#pending.splice(0);
      const ending = this.#ending.splice(0);
      this.writableLength = 0;
      this.writableNeedDrain = false;
      const cause =
        error ??
        codedError(new Error("Stream was destroyed"), "ERR_STREAM_DESTROYED");
      if (active !== undefined || pending.length > 0 || ending.length > 0)
        turn(() => {
          active?.callback?.(cause);
          for (const entry of pending) entry?.callback?.(cause);
          for (const callback of ending) callback?.(cause);
        });
    }
    super.destroy(error);
    return this;
  }
}

export interface ReadableOptions extends StreamOptions {
  readonly read?: (size: number) => void;
}
interface Pipe {
  readonly destination: Writable;
  readonly remove: () => void;
}
export class Readable<T = unknown> extends Stream {
  readonly readableHighWaterMark: number;
  readonly readableObjectMode: boolean;
  readableLength = 0;
  readableEnded = false;
  readableFlowing: boolean | null = null;
  readonly #readHook: ReadableOptions["read"];
  readonly #buffer: Buffered[] = [];
  readonly #change = new StreamChange();
  #ending = false;
  #endingQueued = false;
  #reading = false;
  #scheduled = false;
  readonly #pipes: Pipe[] = [];
  readonly #blocked = new Set<Writable>();
  constructor(options: ReadableOptions = {}) {
    super(options);
    this.readableObjectMode = options.objectMode === true;
    this.readableHighWaterMark = waterMark(
      options.highWaterMark,
      this.readableObjectMode ? 16 : 65536,
    );
    this.#readHook = options.read;
  }
  get readable(): boolean {
    return !this.destroyed && !this.readableEnded;
  }
  _read(size: number): void {
    if (this.#readHook !== undefined) this.#readHook.call(this, size);
    else
      this.destroy(
        codedError(
          new Error("_read() is not implemented"),
          "ERR_METHOD_NOT_IMPLEMENTED",
        ),
      );
  }
  #request(): void {
    if (this.#reading || this.#ending || this.destroyed) return;
    this.#reading = true;
    try {
      this._read(this.readableHighWaterMark);
    } catch (error) {
      this.destroy(failure(error));
    }
  }
  push(chunk: T | null, encoding: string = "utf8"): boolean {
    if (this.destroyed) return false;
    this.#reading = false;
    if (chunk === null) {
      this.#ending = true;
      this.#endIfEmpty();
    } else if (this.#ending) {
      this.destroy(
        codedError(
          new Error("stream.push() after EOF"),
          "ERR_STREAM_PUSH_AFTER_EOF",
        ),
      );
      return false;
    } else {
      const item = normalize(chunk, this.readableObjectMode, encoding);
      if (item.size !== 0) {
        this.#buffer.push(item);
        this.readableLength += item.size;
        if (this.listenerCount("readable") > 0)
          turn(() => {
            if (!this.destroyed) this.emit("readable");
          });
      }
    }
    this.#change.notify();
    if (this.readableFlowing === true) this.#scheduleFlow();
    return (
      !this.#ending &&
      (this.readableLength < this.readableHighWaterMark ||
        this.readableLength === 0)
    );
  }
  #endIfEmpty(): void {
    if (!this.#ending || this.#buffer.length > 0 || this.#endingQueued) return;
    this.#endingQueued = true;
    turn(() => {
      if (this.destroyed) return;
      this.readableEnded = true;
      this.emit("end");
      this.#change.notify();
      if (this.autoDestroy) this.destroy();
    });
  }
  read(): unknown {
    if (this.destroyed) return null;
    if (this.readableLength <= this.readableHighWaterMark) this.#request();
    const item = this.#buffer.shift();
    if (item !== undefined) this.readableLength -= item.size;
    this.#endIfEmpty();
    return item === undefined ? null : item.value;
  }
  #scheduleFlow(): void {
    if (this.#scheduled || this.destroyed) return;
    this.#scheduled = true;
    turn(() => {
      this.#scheduled = false;
      while (this.readableFlowing === true && !this.destroyed) {
        const chunk = this.read();
        if (chunk === null) break;
        this.emit("data", chunk);
      }
    });
  }
  override on(name: string | symbol, listener: Listener): Readable<T> {
    super.on(name, listener);
    if (name === "data" && this.readableFlowing !== false) this.resume();
    if (name === "readable")
      turn(() => {
        if (this.#buffer.length > 0 && !this.destroyed) this.emit("readable");
        else this.#request();
      });
    return this;
  }
  override addListener(name: string | symbol, listener: Listener): Readable<T> {
    return this.on(name, listener);
  }
  pause(): Readable<T> {
    if (this.readableFlowing !== false) {
      this.readableFlowing = false;
      this.emit("pause");
    }
    return this;
  }
  resume(): Readable<T> {
    if (this.readableFlowing !== true) {
      this.readableFlowing = true;
      turn(() => {
        if (!this.destroyed && this.readableFlowing === true)
          this.emit("resume");
      });
    }
    this.#scheduleFlow();
    return this;
  }
  isPaused(): boolean {
    return this.readableFlowing === false;
  }
  pipe<W extends Writable>(
    destination: W,
    options?: { readonly end?: boolean },
  ): W {
    const data = (chunk: unknown): void => {
      if (
        !destination.write(chunk) &&
        this.#pipes.some((entry) => entry?.destination === destination)
      ) {
        this.#blocked.add(destination);
        this.pause();
      }
    };
    const drain = (): void => {
      this.#blocked.delete(destination);
      if (this.#blocked.size === 0 && this.#pipes.length > 0) this.resume();
    };
    const end = (): void => {
      if (options?.end !== false) destination.end();
      else this.unpipe(destination);
    };
    const remove = (): void => {
      this.unpipe(destination);
    };
    const error = (cause: unknown): void => {
      remove();
      if (destination.listenerCount("error") === 0)
        destination.emit("error", cause);
    };
    this.#pipes.push({
      destination,
      remove: (): void => {
        this.off("data", data);
        this.off("end", end);
        this.off("close", remove);
        destination.off("drain", drain);
        destination.off("close", remove);
        destination.off("finish", remove);
        destination.off("error", error);
        this.#blocked.delete(destination);
      },
    });
    destination.prependListener("error", error);
    destination.on("drain", drain);
    destination.once("close", remove);
    destination.once("finish", remove);
    this.once("end", end);
    this.once("close", remove);
    this.on("data", data);
    destination.emit("pipe", this);
    if (this.readableEnded) turn(end);
    else this.resume();
    return destination;
  }
  unpipe(destination?: Writable): Readable<T> {
    for (const pipe of this.#pipes.slice()) {
      if (
        pipe === undefined ||
        (destination !== undefined && destination !== pipe.destination)
      )
        continue;
      const index = this.#pipes.indexOf(pipe);
      if (index >= 0) this.#pipes.splice(index, 1);
      pipe.remove();
      pipe.destination.emit("unpipe", this);
    }
    if (this.#pipes.length === 0) this.pause();
    else if (this.#blocked.size === 0) this.resume();
    return this;
  }
  override destroy(error?: Error | null): Readable<T> {
    super.destroy(error);
    this.#buffer.length = 0;
    this.readableLength = 0;
    this.#change.notify();
    return this;
  }
  async *[Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
    let completed = false;
    const observe = (): void => this.#change.notify();
    this.on("error", observe);
    try {
      for (;;) {
        if (this.errored !== null) throw this.errored;
        if (this.readableEnded) {
          completed = true;
          return;
        }
        if (this.destroyed) throw premature();
        const chunk = this.read();
        if (chunk !== null) yield chunk;
        else if (!this.destroyed && !this.readableEnded)
          await this.#change.wait();
      }
    } finally {
      if (!completed && !this.destroyed) this.destroy();
      if (!this.destroyed || this.closed) this.off("error", observe);
      else
        this.once("close", () => {
          this.off("error", observe);
        });
    }
  }
  static from<T>(
    source: Iterable<T> | AsyncIterable<T>,
    options: ReadableOptions = {},
  ): Readable<T> {
    let iterator: AsyncIterator<T> | Iterator<T>;
    if (Symbol.asyncIterator in Object(source))
      iterator = Reflect.apply(
        Reflect.get(source, Symbol.asyncIterator),
        source,
        [],
      );
    else
      iterator = Reflect.apply(
        Reflect.get(source, Symbol.iterator),
        source,
        [],
      );
    let ended = false;
    const stream = new Readable<T>({
      objectMode: true,
      highWaterMark: 1,
      ...options,
      read(): void {
        void (async (): Promise<void> => {
          try {
            const next = await iterator.next();
            if (stream.destroyed) return;
            if (next.done) {
              ended = true;
              stream.push(null);
            } else {
              const value = await next.value;
              if (value === null)
                throw codedError(
                  new TypeError("May not write null values to stream"),
                  "ERR_STREAM_NULL_VALUES",
                );
              stream.push(value);
            }
          } catch (error) {
            stream.destroy(failure(error));
          }
        })();
      },
      destroy(error, destroyed): void {
        if (ended) {
          destroyed(error);
          return;
        }
        ended = true;
        void (async (): Promise<void> => {
          try {
            await iterator.return?.();
            destroyed(error);
          } catch (cause) {
            destroyed(failure(cause));
          }
        })();
      },
    });
    return stream;
  }
}

export interface FinishedOptions {
  readonly readable?: boolean;
  readonly writable?: boolean;
  readonly signal?: AbortSignal;
  readonly cleanup?: boolean;
}
export function finished(
  stream: Readable | Writable,
  optionsOrCallback: FinishedOptions | Completion,
  callback?: Completion,
): () => void {
  const options =
    typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
  const done =
    typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
  if (done === undefined)
    throw invalidArgument("callback", "of type function", done);
  const complete = done;
  let settled = false;
  let subscription: Record<symbol, () => void> | undefined;
  const cleanup = (): void => {
    stream.off("end", check);
    stream.off("finish", check);
    stream.off("close", check);
    stream.off("error", error);
    subscription?.[Symbol.dispose]?.();
  };
  function settle(cause?: Error | null): void {
    if (settled) return;
    settled = true;
    subscription?.[Symbol.dispose]?.();
    if (options.cleanup === true) cleanup();
    complete(cause);
  }
  function error(cause: unknown): void {
    settle(failure(cause));
  }
  function check(): void {
    if (stream.errored !== null) {
      settle(stream.errored);
      return;
    }
    const ended =
      !(stream instanceof Readable) ||
      options.readable === false ||
      stream.readableEnded;
    const written =
      !(stream instanceof Writable) ||
      options.writable === false ||
      stream.writableFinished;
    if (
      ended &&
      written &&
      (!stream.autoDestroy || !stream.emitClose || stream.closed)
    )
      settle();
    else if (stream.closed) settle(ended && written ? undefined : premature());
  }
  stream.on("end", check);
  stream.on("finish", check);
  stream.on("close", check);
  stream.on("error", error);
  if (options.signal !== undefined) {
    const signal = options.signal;
    if (signal.aborted) turn(() => settle(abortError(signal.reason)));
    else
      subscription = addAbortListener(signal, () =>
        settle(abortError(signal.reason)),
      );
  }
  turn(check);
  return cleanup;
}

export interface PipelineOptions {
  readonly signal?: AbortSignal;
  readonly end?: boolean;
}
export function pump(
  source: Readable,
  destination: Writable,
  options: PipelineOptions = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const signal = options.signal;
    function finishPipeline(error?: Error | null): void {
      if (settled) return;
      settled = true;
      if (error !== undefined && error !== null) {
        source.destroy(error);
        destination.destroy(error);
        void Promise.all([source.waitClosed(), destination.waitClosed()]).then(
          () => reject(error),
        );
      } else resolve();
    }
    // Attach both error observers before starting the producer.
    finished(source, {}, (error): void => {
      if (error !== undefined && error !== null) finishPipeline(error);
      else if (options.end === false) finishPipeline();
    });
    finished(destination, {}, finishPipeline);
    if (signal !== undefined) {
      if (signal.aborted) {
        finishPipeline(abortError(signal.reason));
        return;
      }
      const abort = addAbortListener(signal, () =>
        finishPipeline(abortError(signal.reason)),
      );
      destination.once("close", () => abort[Symbol.dispose]?.());
      source.once("end", () => {
        if (options.end === false) abort[Symbol.dispose]?.();
      });
    }
    source.pipe(destination, options);
  });
}
export function pipeline(
  source: Readable | Iterable<unknown> | AsyncIterable<unknown>,
  destination: Writable,
  callback: Completion,
): Writable {
  const input = source instanceof Readable ? source : Readable.from(source);
  void pump(input, destination).then(
    () => callback(),
    (error: unknown) => callback(failure(error)),
  );
  return destination;
}

const streams = Object.assign(Stream, {
  Stream,
  Readable,
  Writable,
  finished,
  pipeline,
  addAbortSignal,
});
export default streams;
