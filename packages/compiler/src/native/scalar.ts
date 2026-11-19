import {
  emitModule as emitArm64,
  type Emission,
} from "@tint/codegen/aarch64/scalar";
import {
  appendExitEntry,
  emitModule as emitX64,
  type X64Emission,
} from "@tint/codegen/x86_64/scalar";
import type { ModuleIR } from "@tint/ir/scalar";
import type { NativeTarget } from "@tint/platform/target";
import {
  writeExecutableImage,
  type ImageWriteResult,
} from "../image-writer.ts";

export type ScalarCompilation =
  | { readonly arch: "aarch64"; readonly emission: Emission }
  | { readonly arch: "x86_64"; readonly emission: X64Emission };

/** Dispatch verified scalar IR by output architecture. Hosted and live
 * compilation continue through their own entry points until they have the
 * startup, tracing and publication primitives required by each target. */
export function compileScalarModule(
  module: ModuleIR,
  target: NativeTarget,
): ScalarCompilation {
  if (target.arch === "x86_64")
    return { arch: "x86_64", emission: emitX64(module) };
  return {
    arch: "aarch64",
    emission: emitArm64(module, { hostABI: target.hostABI }),
  };
}

/** Package a closed scalar entry with an exit-only Linux process boundary.
 * Number results truncate toward zero and must fit the 0–255 exit range.
 * An out-of-range status or uncaught Throw exits 1.
 * The ELF uses the standard Linux loader with no Tint runtime or startup. */
export function buildFreestandingScalarProgram(
  module: ModuleIR,
  entry: number,
  target: NativeTarget,
): ImageWriteResult {
  if (target.arch !== "x86_64")
    return {
      ok: false,
      error: "freestanding scalar image requires linux-x86_64",
    };
  const fn = module.functions[entry];
  const returnType = fn?.returnType;
  if (
    fn === undefined ||
    fn.import === true ||
    fn.parameters.length !== 0 ||
    (returnType !== "number" &&
      returnType !== "boolean" &&
      returnType !== "void")
  )
    return {
      ok: false,
      error:
        "freestanding entry must be a local zero-argument Number, Boolean or void function",
    };

  const compiled = compileScalarModule(module, target);
  if (compiled.arch !== "x86_64") throw "freestanding scalar backend invariant";
  const emitted = compiled.emission;
  if (!emitted.ok) return { ok: false, error: emitted.error.message };
  const native = emitted.value;
  const entryFunction = native.functions[entry];
  if (entryFunction === undefined) throw "entry function invariant";
  let code: Uint8Array;
  try {
    code = appendExitEntry(native.code, entryFunction.offset, returnType);
  } catch (caught) {
    return {
      ok: false,
      error:
        typeof caught === "string" ? caught : "x86-64 entry encoding failed",
    };
  }
  const symbols = native.functions.map((item) => {
    if (item === undefined) throw "scalar symbol invariant";
    return { name: item.name, offset: item.offset };
  });
  return writeExecutableImage(
    target,
    {
      code,
      entryOffset: native.code.length,
      symbols,
      maxByteLength: Number.MAX_SAFE_INTEGER,
      data: native.data,
      addressFixups: native.addressFixups,
      patchAddress: native.patchAddress,
    },
    "tint.freestanding",
    [],
  );
}
