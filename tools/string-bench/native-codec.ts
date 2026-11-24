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
  return {
    from: createErrorRealm(first, hooks),
    to: createErrorRealm(second, hooks),
  };
}
export function cloneString(cloner: Cloner, text: string): string {
  const copy = deserializeWorkerValue(
    serializeWorkerValue(text, cloner.from),
    cloner.to,
  );
  if (typeof copy !== "string") throw new TypeError("clone failed");
  return copy;
}
