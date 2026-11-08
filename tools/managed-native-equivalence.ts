import { isDeepStrictEqual } from "node:util";
import type {
  NativeModule,
  NativeManagedPointerImport,
} from "@tint/codegen/aarch64/scalar";

/** Linked names carry graph-local numeric suffixes; code never refers to them. */
function unnumbered(name: string): string {
  return name.replace(/\$\d+$/, "");
}
/** Node-only test oracle. Two unresolved managed modules are equivalent when
 * every emitted byte, function, descriptor and relocation agrees, except that
 * runtime-entry import slots may be permuted: each slot is compared by the
 * image contract it binds, and each five-instruction slot load must reach a
 * slot with the same contract. Slot words are placeholders until linking, and
 * local function names may differ only in their graph-local numeric suffix. */
export function managedNativeDifference(
  expected: NativeModule,
  actual: NativeModule,
): string | undefined {
  if (expected.code.length !== actual.code.length) return "code length";
  if (expected.managedImports.length !== actual.managedImports.length)
    return "managed import count";
  const masked = new Uint8Array(expected.code.length);
  function identity(binding: NativeManagedPointerImport): string {
    return JSON.stringify([
      binding.role,
      binding.contract,
      binding.name.startsWith("$runtime") ? "$runtime" : binding.name,
      binding.byteLength,
      binding.parameters,
      binding.returnType,
      binding.recordLayout,
      binding.role === "function-entry" ? undefined : binding.witness,
    ]);
  }
  const permuted = new Map<number, number>(), // expected witness -> actual
    claimed = new Set<number>();
  for (let index = 0; index < expected.managedImports.length; index++) {
    const left = expected.managedImports[index],
      right = actual.managedImports[index];
    if (left === undefined || right === undefined) return "missing import";
    if (left.offset !== right.offset || left.role !== right.role)
      return "managed import slot " + String(index);
    if (left.role !== "function-entry") {
      if (identity(left) !== identity(right))
        return "managed import " + String(index);
    } else {
      const match = actual.managedImports.findIndex(
        (candidate, position) =>
          !claimed.has(position) &&
          candidate.role === "function-entry" &&
          identity(candidate) === identity(left),
      );
      const witness = actual.managedImports[match]?.witness;
      if (match < 0 || witness === undefined)
        return "runtime import contract " + left.contract;
      claimed.add(match);
      if (left.witness === undefined) return "runtime import witness";
      permuted.set(left.witness, witness);
    }
    masked.fill(1, left.offset, left.offset + left.byteLength);
  }
  const contract = (module: NativeModule, index: number): string | undefined =>
    module.managedImports[index]?.contract;
  const leftReferences = expected.managedReferences ?? [],
    rightReferences = actual.managedReferences ?? [];
  if (leftReferences.length !== rightReferences.length)
    return "managed reference count";
  for (let index = 0; index < leftReferences.length; index++) {
    const left = leftReferences[index],
      right = rightReferences[index];
    if (
      left === undefined ||
      right === undefined ||
      left.offset !== right.offset ||
      left.rd !== right.rd ||
      contract(expected, left.import) !== contract(actual, right.import)
    )
      return "managed reference " + String(index);
    masked.fill(1, left.offset, left.offset + 20);
  }
  for (let offset = 0; offset < expected.code.length; offset++)
    if (masked[offset] === 0 && expected.code[offset] !== actual.code[offset])
      return "code byte " + String(offset);
  if (expected.functions.length !== actual.functions.length)
    return "function count";
  for (let index = 0; index < expected.functions.length; index++) {
    const left = expected.functions[index],
      right = actual.functions[index];
    if (left === undefined || right === undefined) return "missing function";
    if (left.import === true) {
      const target = actual.functions.find(
        (candidate) => candidate.id === permuted.get(left.id),
      );
      if (
        right.import !== true ||
        target?.import !== true ||
        !isDeepStrictEqual(left.signature, target.signature)
      )
        return "runtime import function " + String(index);
    } else if (
      !isDeepStrictEqual(
        { ...left, name: unnumbered(left.name) },
        { ...right, name: unnumbered(right.name) },
      )
    )
      return "function " + String(index);
  }
  for (const key of [
    "linearAllocation",
    "generationalBarriers",
    "sourceRanges",
    "imports",
    "linkage",
    "functionDescriptorImport",
    "signatures",
    "functionDescriptor",
    "records",
    "roots",
    "strings",
    "cellHelpers",
    "helpers",
  ] as const)
    if (!isDeepStrictEqual(expected[key], actual[key])) return key;
  return undefined;
}
