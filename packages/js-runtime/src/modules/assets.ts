import {
  createSyntheticModule,
  setSyntheticModuleExport,
} from "./synthetic.ts";
import type { ModuleRecord } from "./records.ts";
import type { ModuleCompletion } from "./loading.ts";
import { createByteStorage, copyImmutableByteStorage } from "../bytes/index.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "../objects/errors.ts";
import { createObject, type ObjectHooks } from "../objects/operations.ts";
import type { ScriptPropertyKey } from "../objects/symbols.ts";
import { createTypedArrayView } from "../objects/typed-array-data.ts";

/** Resource values are realized at load time and retain identity across evaluations. */
export function createTextModule(
  source: string,
  realm: ErrorRealm,
  hostDefined: unknown,
): ModuleRecord {
  return createSyntheticModule(
    realm,
    ["default"],
    (module) => setSyntheticModuleExport(module, "default", source),
    hostDefined,
  );
}
export function createBytesModule(
  bytes: Uint8Array,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  hostDefined: unknown,
): ModuleCompletion {
  const created = createByteStorage(
    bytes.length,
    bytes.length,
    false,
    realm.bufferMaxBytes,
  );
  if (!created.ok)
    return { ok: false, error: createRuntimeError(realm, "range") };
  const data = created.value.data;
  if (data === undefined) throw "MODULE_BYTES_STORAGE_INVARIANT";
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    if (byte === undefined) throw "MODULE_BYTES_STORAGE_INVARIANT";
    data[index] = byte;
  }
  const immutable = copyImmutableByteStorage(
    created.value,
    0,
    bytes.length,
    bytes.length,
  );
  if (!immutable.ok) throw "MODULE_BYTES_STORAGE_INVARIANT";
  const parent = realm.typedArrayPrototypes.get("Uint8");
  if (parent === undefined) return rejectUnsupportedExecution(realm);
  const buffer = createObject<ScriptPropertyKey, unknown>(
    realm.arrayBufferPrototype,
  );
  buffer.internalArrayBufferData = immutable.value;
  const value = createTypedArrayView(
    parent,
    {
      buffer,
      storage: immutable.value,
      byteOffset: 0,
      length: bytes.length,
      kind: "Uint8",
      endian: "little",
    },
    realm,
    hooks,
  );
  return {
    ok: true,
    module: createSyntheticModule(
      realm,
      ["default"],
      (module) => setSyntheticModuleExport(module, "default", value),
      hostDefined,
    ),
  };
}
