import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("storage view fixture requires TINT_BUILD_ONLY=1");
process.env.TINT_GENERAL_FALLBACK = "0";

const objects = "packages/js-runtime/src/objects/index.ts";
const bytes = "packages/js-runtime/src/bytes/index.ts";

if (process.argv[2] !== "bytes")
  verifyHostedFixture(
    `import { programRealmCore, viewObjectValue, isArrayValue, getOwnProperty, setObjectValueProperty, deleteObjectValueProperty, type ScriptPropertyKey } from "objects";
export function run(): number {
  const list: number[] = [1, 20];
  const record: { delta: number; label: string } = { delta: 2, label: "live" };
  const table: Record<string, unknown> = { list, record };
  table.otherList = list;
  table.otherRecord = record;
  if (table.list !== table.otherList || table.record !== table.otherRecord) return 1;
  const core = programRealmCore();
  const arrayView = viewObjectValue(table.list, core.object);
  const recordView = viewObjectValue(table.record, core.object);
  if (arrayView === undefined || recordView === undefined || !isArrayValue(table.list, core.realm)) return 2;
  list[0] = 19;
  record.delta = 22;
  if (getOwnProperty<ScriptPropertyKey, unknown>(arrayView, "0")?.value !== 19) return 3;
  if (getOwnProperty<ScriptPropertyKey, unknown>(recordView, "delta")?.value !== 22) return 4;
  if (setObjectValueProperty(table.list, "0", 20, true, core.hooks, core.realm) !== "none") return 5;
  if (setObjectValueProperty(table.record, "delta", 20, true, core.hooks, core.realm) !== "none") return 6;
  if (deleteObjectValueProperty(table.list, "1", true, core.object).error !== "none") return 7;
  if (list.length !== 2 || (1 in list)) return 8;
  let rejected = false;
  try { setObjectValueProperty(table.record, "delta", "wrong", true, core.hooks, core.realm); }
  catch (error) { rejected = true; }
  if (!rejected || record.delta !== 20) return 9;
  if (setObjectValueProperty(table.list, "length", 1, true, core.hooks, core.realm) !== "none") return 10;
  return list.length === 1 ? (list[0] ?? 0) + record.delta + 2 : 11;
}`,
    "slice2b-storage-views",
    [["objects", objects]],
  );

if (process.argv[2] !== "aggregates")
  verifyHostedFixture(
    `import { createObject, createTypedArrayView, programRealmCore, projectArrayBufferViewRange, ensureExoticSlots, type ScriptPropertyKey } from "objects";
import { createByteStorage, resizeByteStorage, detachByteStorage } from "bytes";
export function run(): number {
  const core = programRealmCore();
  const allocated = createByteStorage(8, 16, true, 16);
  if (!allocated.ok) return 1;
  const storage = allocated.value;
  const buffer = createObject<ScriptPropertyKey, unknown>(core.realm.arrayBufferPrototype);
  ensureExoticSlots(buffer).internalArrayBufferData = storage;
  const array = createTypedArrayView(core.realm.objectPrototype, { buffer, storage, byteOffset: 2, length: 2, kind: "Uint16", endian: "little" }, core.realm, core.hooks);
  const data = createObject<ScriptPropertyKey, unknown>(core.realm.objectPrototype);
  ensureExoticSlots(data).internalDataViewData = { buffer, storage, byteOffset: 3, byteLength: 2 };
  const first = projectArrayBufferViewRange(array);
  const alias = projectArrayBufferViewRange(data);
  if (first === undefined || alias === undefined || first.kind !== "ordinary" || first.byteOffset !== 2 || first.byteLength !== 4) return 2;
  if (alias.byteOffset !== 3 || alias.byteLength !== 2 || alias.bytes !== first.bytes) return 3;
  const sharedBytes = first.bytes;
  if (sharedBytes === undefined) return 4;
  sharedBytes[3] = 42;
  if (alias.bytes?.[3] !== 42) return 5;
  if (resizeByteStorage(storage, 2) !== "none") return 6;
  const outside = projectArrayBufferViewRange(array);
  if (outside === undefined || outside.kind !== "ordinary" || outside.byteOffset !== 0 || outside.byteLength !== 0 || outside.bytes?.length !== 2) return 7;
  if (detachByteStorage(storage) !== "none") return 8;
  const detached = projectArrayBufferViewRange(array);
  return detached?.kind === "detached" && detached.bytes === undefined && !detached.writable ? 42 : 9;
}`,
    "slice2b-byte-ranges",
    [
      ["objects", objects],
      ["bytes", bytes],
    ],
    [],
    [
      { module: objects, name: "viewObjectValue", operation: "view" },
      { module: objects, name: "viewSymbolValue", operation: "view" },
      { module: objects, name: "viewBigIntValue", operation: "view" },
    ],
    [
      {
        module: objects,
        namespace: "byte-range-witness",
        retainedExports: [
          "viewObjectValue",
          "viewSymbolValue",
          "viewBigIntValue",
        ],
      },
    ],
  );
