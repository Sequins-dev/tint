import {
  readTypedArrayBytes,
  writeTypedArrayBytes,
} from "./typed-array-storage.ts";
import {
  requireTypedArray,
  typedArrayWindow,
  typedArrayElementWidth,
} from "./typed-array-data.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";

export function installTypedArrayReverse(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  builtinProperty(
    realm.typedArrayPrototype,
    "reverse",
    builtinFunction(
      realm.functionPrototype,
      "reverse",
      0,
      (receiver, args): unknown => {
        const data = requireTypedArray(receiver, realm, "write"),
          window = typedArrayWindow(data, "write");
        if (window === undefined) throw createRuntimeError(realm, "type");
        const bytes = window.bytes;
        if (bytes !== undefined) {
          const width = typedArrayElementWidth(data.kind);
          for (let lower = 0; lower < Math.floor(window.length / 2); lower++) {
            const upper = window.length - lower - 1;
            for (let byte = 0; byte < width; byte++) {
              const left = data.byteOffset + lower * width + byte;
              const right = data.byteOffset + upper * width + byte;
              const a = bytes[left],
                b = bytes[right];
              if (a === undefined || b === undefined)
                throw "TYPED_ARRAY_REVERSE_INVARIANT";
              bytes[left] = b;
              bytes[right] = a;
            }
          }
          return receiver;
        }
        for (let lower = 0; lower < Math.floor(window.length / 2); lower++) {
          const upper = window.length - lower - 1;
          const left = readTypedArrayBytes(data, lower, window);
          const right = readTypedArrayBytes(data, upper, window);
          writeTypedArrayBytes(data, lower, right, window);
          writeTypedArrayBytes(data, upper, left, window);
        }
        return receiver;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
