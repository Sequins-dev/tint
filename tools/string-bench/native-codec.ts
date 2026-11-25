// Tint's side of the string benchmark codec (tools/string-bench/bench.ts).
// Tint has no TextEncoder, TextDecoder or structuredClone globals on main, so
// these call the runtime cores behind them: the foundation UTF-8 codec and
// the Worker structured-clone serializer (a string's message round trip).
import {
  createUTF8Decoder,
  decodeUTF8,
  encodeUTF8,
} from "@tint/foundation/text/text-encoding";
import {
  createErrorRealm,
  createObject,
  callObjectValue,
  deserializeWorkerValue,
  serializeWorkerValue,
  type ErrorRealm,
  type ObjectHooks,
  type ScriptPropertyKey,
  type WorkerCloneSink,
  type WorkerCloneSource,
} from "@tint/js-runtime/objects";

export function encodeText(text: string): Uint8Array {
  return encodeUTF8(text);
}
export function decodeText(bytes: Uint8Array): string {
  const text = decodeUTF8(createUTF8Decoder(false, false), bytes);
  if (text === undefined) throw new TypeError("invalid UTF-8");
  return text;
}
/** The two realms a Worker message crosses. */
export interface Cloner {
  readonly from: ErrorRealm;
  readonly to: ErrorRealm;
  readonly sink: WorkerCloneSink & { bytes: Uint8Array };
  readonly source: WorkerCloneSource & { bytes: Uint8Array };
}
export function createCloner(): Cloner {
  const first = createObject<ScriptPropertyKey, unknown>(undefined),
    second = createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: (a, b): boolean => a === b,
    call: (fn, receiver, args): unknown => {
      const result = callObjectValue(fn, receiver, args, first);
      if (result.error !== "none") throw new TypeError("call failed");
      return result.value;
    },
  };
  let storage = new Uint8Array(1024);
  const sink: WorkerCloneSink & { bytes: Uint8Array } = {
    bytes: storage,
    grow(used: number, needed: number): void {
      let next = storage.length;
      while (next < used + needed) next *= 2;
      const grown = new Uint8Array(next);
      grown.set(storage.subarray(0, used));
      storage = grown;
      sink.bytes = storage;
      source.bytes = storage;
    },
    writeFloat64(): void {
      throw new TypeError("unexpected float64");
    },
    writeString(offset: number, value: string): void {
      for (let i = 0; i < value.length; i++) {
        const unit = value.charCodeAt(i);
        storage[offset + i * 2] = unit % 256;
        storage[offset + i * 2 + 1] = Math.floor(unit / 256);
      }
    },
  };
  const source: WorkerCloneSource & { bytes: Uint8Array } = {
    bytes: storage,
    readFloat64(): number {
      throw new TypeError("unexpected float64");
    },
    readString(offset: number, units: number): string {
      const parts: string[] = [];
      for (let i = 0; i < units; i++)
        parts.push(
          String.fromCharCode(
            (storage[offset + i * 2] ?? 0) +
              (storage[offset + i * 2 + 1] ?? 0) * 256,
          ),
        );
      return parts.join("");
    },
  };
  return {
    from: createErrorRealm(first, hooks),
    to: createErrorRealm(second, hooks),
    sink,
    source,
  };
}
export function cloneString(cloner: Cloner, text: string): string {
  const end = serializeWorkerValue(text, cloner.from, cloner.sink, 0);
  const copy = deserializeWorkerValue(cloner.source, 0, end, cloner.to);
  if (typeof copy !== "string") throw new TypeError("clone failed");
  return copy;
}
