import type { ModuleEntryOptions } from "../closure/lowering/index.ts";

export type RuntimeFunctionKind =
  | "list"
  | "set"
  | "map"
  | "primitive"
  | "number-text"
  | "bigint"
  | "shared-buffer";
export type RuntimeFunctionVisitor = (
  id: number,
  kind: RuntimeFunctionKind,
  binding: number,
  operation: string,
) => void;

/** Visit operation identities before deduplication. Collection indices refer to
 * their respective options array; non-collection services use -1. No type IDs
 * or record/host capabilities are executable runtime function identities. */
export function visitRuntimeFunctions(
  options: ModuleEntryOptions,
  visit: RuntimeFunctionVisitor,
): void {
  function add(
    id: number | undefined,
    kind: RuntimeFunctionKind,
    binding: number,
    operation: string,
  ): void {
    if (id !== undefined) visit(id, kind, binding, operation);
  }
  const lists = options.lists ?? [];
  for (let index = 0; index < lists.length; index++) {
    const binding = lists[index];
    if (binding === undefined) throw "list runtime binding invariant";
    const runtime = binding.runtime;
    add(runtime.create, "list", index, "create");
    add(runtime.read, "list", index, "read");
    add(runtime.write, "list", index, "write");
    add(runtime.push, "list", index, "push");
    add(runtime.length, "list", index, "length");
    add(runtime.has, "list", index, "has");
    add(runtime.delete, "list", index, "delete");
    add(runtime.resize, "list", index, "resize");
    add(runtime.pop, "list", index, "pop");
    add(runtime.wrap, "list", index, "wrap");
    add(runtime.empty, "list", index, "empty");
    add(runtime.sort, "list", index, "sort");
  }
  const sets = options.sets ?? [];
  for (let index = 0; index < sets.length; index++) {
    const binding = sets[index];
    if (binding === undefined) throw "set runtime binding invariant";
    const runtime = binding.runtime;
    add(runtime.create, "set", index, "create");
    add(runtime.has, "set", index, "has");
    add(runtime.add, "set", index, "add");
    add(runtime.delete, "set", index, "delete");
    add(runtime.clear, "set", index, "clear");
    add(runtime.size, "set", index, "size");
    const iterator = runtime.iterator;
    if (iterator !== undefined) {
      add(iterator.create, "set", index, "iterator.create");
      add(iterator.advance, "set", index, "iterator.advance");
      add(iterator.read, "set", index, "iterator.read");
    }
    add(runtime.clone, "set", index, "clone");
  }
  const maps = options.maps ?? [];
  for (let index = 0; index < maps.length; index++) {
    const binding = maps[index];
    if (binding === undefined) throw "map runtime binding invariant";
    const runtime = binding.runtime;
    add(runtime.create, "map", index, "create");
    add(runtime.get, "map", index, "get");
    add(runtime.has, "map", index, "has");
    add(runtime.set, "map", index, "set");
    add(runtime.delete, "map", index, "delete");
    add(runtime.clear, "map", index, "clear");
    add(runtime.size, "map", index, "size");
    const iterator = runtime.iterator;
    if (iterator !== undefined) {
      add(iterator.create, "map", index, "iterator.create");
      add(iterator.advance, "map", index, "iterator.advance");
      add(iterator.key, "map", index, "iterator.key");
      add(iterator.value, "map", index, "iterator.value");
    }
  }
  const primitives = options.primitives;
  if (primitives !== undefined) {
    add(primitives.fromNull, "primitive", -1, "fromNull");
    add(primitives.isNullish, "primitive", -1, "isNullish");
    add(primitives.fromUndefined, "primitive", -1, "fromUndefined");
    add(primitives.fromNumber, "primitive", -1, "fromNumber");
    add(primitives.fromBoolean, "primitive", -1, "fromBoolean");
    add(primitives.fromString, "primitive", -1, "fromString");
    add(primitives.fromOptionalNumber, "primitive", -1, "fromOptionalNumber");
    add(primitives.fromOptionalString, "primitive", -1, "fromOptionalString");
    add(primitives.fromOptionalBoolean, "primitive", -1, "fromOptionalBoolean");
    add(primitives.fromOptionalBox, "primitive", -1, "fromOptionalBox");
    add(primitives.readNumber, "primitive", -1, "readNumber");
    add(primitives.readBoolean, "primitive", -1, "readBoolean");
    add(primitives.readString, "primitive", -1, "readString");
    add(primitives.readOptionalNumber, "primitive", -1, "readOptionalNumber");
    add(primitives.readOptionalString, "primitive", -1, "readOptionalString");
    add(primitives.readOptionalBoolean, "primitive", -1, "readOptionalBoolean");
    add(primitives.kindOf, "primitive", -1, "kindOf");
    add(primitives.truthy, "primitive", -1, "truthy");
    add(primitives.strictEqual, "primitive", -1, "strictEqual");
    add(primitives.canonicalKey, "primitive", -1, "canonicalKey");
    add(
      primitives.canonicalOptionalNumber,
      "primitive",
      -1,
      "canonicalOptionalNumber",
    );
  }
  const bigints = options.bigints;
  if (bigints !== undefined) {
    add(bigints.literal, "bigint", -1, "literal");
    add(bigints.literalInline, "bigint", -1, "literalInline");
    const binary = bigints.binary;
    add(binary["+"], "bigint", -1, "binary+");
    add(binary["-"], "bigint", -1, "binary-");
    add(binary["*"], "bigint", -1, "binary*");
    add(binary["/"], "bigint", -1, "binary/");
    add(binary["%"], "bigint", -1, "binary%");
    add(binary["**"], "bigint", -1, "binary**");
    add(binary["&"], "bigint", -1, "binary&");
    add(binary["|"], "bigint", -1, "binary|");
    add(binary["^"], "bigint", -1, "binary^");
    add(binary["<<"], "bigint", -1, "binary<<");
    add(binary[">>"], "bigint", -1, "binary>>");
    add(bigints.negate, "bigint", -1, "negate");
    add(bigints.not, "bigint", -1, "not");
    add(bigints.compare, "bigint", -1, "compare");
    add(bigints.compareNumber, "bigint", -1, "compareNumber");
    add(bigints.equal, "bigint", -1, "equal");
    add(bigints.truthy, "bigint", -1, "truthy");
    add(bigints.toString, "bigint", -1, "toString");
    add(bigints.toNumber, "bigint", -1, "toNumber");
    add(bigints.fromNumber, "bigint", -1, "fromNumber");
    add(bigints.fromBoolean, "bigint", -1, "fromBoolean");
    add(bigints.asWidth, "bigint", -1, "asWidth");
    add(bigints.toWord64, "bigint", -1, "toWord64");
    add(bigints.fromWord64, "bigint", -1, "fromWord64");
    add(bigints.hash, "bigint", -1, "hash");
  }
  add(options.numberToString, "number-text", -1, "toString");
  add(options.numberFromString, "number-text", -1, "fromString");
  add(options.sharedBlock, "shared-buffer", -1, "create");
  add(options.atomicsWait, "shared-buffer", -1, "atomicsWait");
  add(options.atomicsNotify, "shared-buffer", -1, "atomicsNotify");
}

/** Keep first-use order stable when representations share one helper. */
export function runtimeFunctionIds(
  options: ModuleEntryOptions,
): readonly number[] {
  const ids: number[] = [],
    seen = new Set<number>();
  visitRuntimeFunctions(options, (id, _kind, _binding, _operation) => {
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}
