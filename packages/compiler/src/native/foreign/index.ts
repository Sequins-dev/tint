import type { HostOperation } from "@tint/ir/scalar";
import type { RuntimeSource } from "../runtime-contracts.ts";
import {
  cLibraryImage,
  linuxArm64CTarget,
  type CFunctionDeclaration,
  type CSignature,
  type CLibraryDeclaration,
  type CLibraryImage,
  type CLibraryManifestEntry,
  type CTarget,
} from "@tint/abi/c";
import {
  nodeBuiltins,
  registeredNodeBuiltins,
  type ImportMapping,
} from "@tint/source/resolver";
import { createSourceTextView } from "@tint/source/text";
import {
  requestModules,
  type ModuleRequest,
  type SourceInput,
} from "@tint/typescript/modules";
import type { SourceModule } from "@tint/typescript/modules/model";
import type { CViewRegistry, CViewShape } from "@tint/typescript/checker";
import { parseForeignDeclarations } from "./declarations.ts";
import { expandForeignLibrary, type ForeignStub } from "./expansion.ts";
import { foreignViews, type ForeignView } from "./views.ts";
export {
  foreignViews,
  foreignViewKey,
  type ForeignView,
  type ForeignViewsResult,
} from "./views.ts";
export {
  parseForeignDeclarations,
  type ForeignDeclarationError,
  type ForeignDeclarationResult,
} from "./declarations.ts";
export {
  expandForeignLibrary,
  foreignCall,
  type ForeignStub,
  type ForeignExpansion,
  type ForeignExpansionResult,
} from "./expansion.ts";
/** An expanded C binding: the declaration module's id (whose source is
 * replaced by the generated implementation), its parsed declarations, the
 * generated stubs that bind to c-calls and how the target loads the
 * library (from the manifest). */
export interface ForeignLibrary {
  readonly id: string;
  readonly declaration: CLibraryDeclaration;
  readonly stubs: readonly ForeignStub[];
  readonly image: CLibraryImage;
  /** The C view shapes of its records (docs/native-ffi.md, "C views"). */
  readonly views: readonly ForeignView[];
}
/** Explicit binding of a declared runtime export to a binding declaration
 * (like NativeHostBinding): the export's body becomes the c-call. */
export interface NativeForeignBinding {
  readonly module: string;
  readonly name: string;
  /** The binding module specifier, e.g. "tint:c/libsystem". */
  readonly library: string;
  readonly declaration: string;
}
/** Explicit binding of a declared runtime export to a `tint:ffi`
 * primitive (docs/native-ffi.md, "External storage", "Dynamic calls"): its
 * body becomes one c-memory `address`, `adopt` or `retarget` access, or
 * (`call`) the universal trampoline's dynamic c-call. */
export interface NativeForeignMemoryBinding {
  readonly module: string;
  readonly name: string;
  readonly operation:
    | "address"
    | "adopt"
    | "adopt-words"
    | "address-into"
    | "retarget"
    | "stable"
    | "callback-key"
    | "call"
    | "call-callbacks"
    | "call-scalar"
    | "call-scalar-callbacks"
    | "runtime-callback-address"
    | "call-direct-bytes"
    | "call-static-scalar"
    | "call-direct-scalar";
  readonly staticSignature?: CSignature;
}
/** The `tint:ffi` runtime: its trusted primitives and the weak-storage and
 * collection intrinsics its collector-registered storage uses. */
export const foreignRuntimeModules = {
  nodeFfi: nodeBuiltins.ffi.source,
  nodeBuffer: nodeBuiltins.buffer.source,
  nodeProcess: nodeBuiltins.process.source,
  processIntrinsics: "packages/native-runtime/src/intrinsics/process.ts",
  /** `tint:ffi` itself (its `View<R>` type names C views). */
  index: "packages/native-runtime/src/ffi/index.ts",
  /** `tint:ffi/unsafe`: views over memory C owns. */
  unsafe: "packages/native-runtime/src/ffi/unsafe.ts",
  /** The public loader with the SysV leaf call-frame implementation. */
  sysv: "packages/native-runtime/src/ffi/dynamic-sysv.ts",
  primitives: "packages/native-runtime/src/ffi/primitives.ts",
  addressWords: "packages/native-runtime/src/ffi/address-words.ts",
  callbackStubs: "packages/native-runtime/src/ffi/callback-stubs.ts",
  weak: "packages/native-runtime/src/intrinsics/weak.ts",
  memory: "packages/native-runtime/src/intrinsics/memory.ts",
};
/** The capabilities of the `tint:ffi` runtime for a program whose loaded
 * modules are `loaded`: none unless its primitives module is loaded, else
 * its primitives and the weak-storage and collection intrinsics its
 * collector-registered storage (`external`) uses. Weak cells work under
 * every collector, and only a created one makes collections trace them. */
export function foreignRuntimeBindings(loaded: ReadonlySet<string>): {
  readonly runtimes: readonly RuntimeSource[];
  readonly memoryBindings: readonly NativeForeignMemoryBinding[];
  readonly weakBindings: readonly {
    readonly module: string;
    readonly name: string;
    readonly operation: "new" | "key" | "clear" | "value" | "set-value";
  }[];
  readonly hostBindings: readonly {
    readonly module: string;
    readonly name: string;
    readonly operation: HostOperation;
  }[];
} {
  const modules = foreignRuntimeModules;
  if (!loaded.has(modules.primitives))
    return {
      runtimes: [],
      memoryBindings: [],
      weakBindings: [],
      hostBindings: [],
    };
  const bindings: NativeForeignMemoryBinding[] = [
    {
      module: modules.primitives,
      name: "externalAddress",
      operation: "address",
    },
    {
      module: modules.primitives,
      name: "externalBufferAddress",
      operation: "address",
    },
    { module: modules.primitives, name: "adoptExternal", operation: "adopt" },
    {
      module: modules.primitives,
      name: "retargetExternal",
      operation: "retarget",
    },
    { module: modules.primitives, name: "callForeign", operation: "call" },
    {
      module: modules.primitives,
      name: "callForeignCallbacks",
      operation: "call-callbacks",
    },
    { module: modules.primitives, name: "stableBytes", operation: "stable" },
    {
      module: modules.primitives,
      name: "callbackKey",
      operation: "callback-key",
    },
  ];
  const weakBindings: {
    readonly module: string;
    readonly name: string;
    readonly operation: "new" | "key" | "clear" | "value" | "set-value";
  }[] = [
    { module: modules.weak, name: "createWeakSlot", operation: "new" },
    { module: modules.weak, name: "weakSlotKey", operation: "key" },
    // The Worker message path's send cache of shared string bodies.
    { module: modules.weak, name: "weakSlotValue", operation: "value" },
  ];
  const runtimes: RuntimeSource[] = [
    { module: modules.primitives, namespace: "ffi" },
    { module: modules.weak, namespace: "ffi-weak" },
    { module: modules.memory, namespace: "ffi-memory" },
  ];
  const hostBindings: {
    module: string;
    name: string;
    operation: HostOperation;
  }[] = [
    {
      module: modules.memory,
      name: "collectGarbage",
      operation: "collect-garbage",
    },
  ];
  if (loaded.has(modules.nodeFfi))
    weakBindings.push(
      { module: modules.weak, name: "clearWeakSlot", operation: "clear" },
      {
        module: modules.weak,
        name: "setWeakSlotValue",
        operation: "set-value",
      },
    );
  if (loaded.has(modules.nodeFfi) && loaded.has(modules.addressWords)) {
    runtimes.push({
      module: modules.addressWords,
      namespace: "ffi-address-words",
      retainedExports: [
        "adoptExternalWords",
        "byteAddressInto",
        "callScalarForeign",
        "callScalarForeignCallbacks",
      ],
    });
    bindings.push(
      {
        module: modules.addressWords,
        name: "adoptExternalWords",
        operation: "adopt-words",
      },
      {
        module: modules.addressWords,
        name: "byteAddressInto",
        operation: "address-into",
      },
      {
        module: modules.addressWords,
        name: "callScalarForeign",
        operation: "call-scalar",
      },
      {
        module: modules.addressWords,
        name: "callScalarForeignCallbacks",
        operation: "call-scalar-callbacks",
      },
    );
  }
  if (loaded.has(modules.nodeFfi) && loaded.has(modules.callbackStubs)) {
    runtimes.push({
      module: modules.callbackStubs,
      namespace: "ffi-callback-stubs",
      retainedExports: [
        "runtimeCallbackAddress",
        "runtimeI32CallbackAddress",
        "mapCallbackMemory",
        "writeCallbackMemory",
        "unmapCallbackMemory",
      ],
    });
    bindings.push(
      {
        module: modules.callbackStubs,
        name: "runtimeCallbackAddress",
        operation: "runtime-callback-address",
      },
      {
        module: modules.callbackStubs,
        name: "runtimeI32CallbackAddress",
        operation: "runtime-callback-address",
        staticSignature: {
          parameters: [{ kind: "scalar", scalar: "i32" }],
          result: { kind: "scalar", scalar: "i32" },
          fixedParameters: 1,
          callClass: "leaf",
          errno: "none",
        },
      },
    );
    hostBindings.push(
      {
        module: modules.callbackStubs,
        name: "mapCallbackMemory",
        operation: "executable-callback-map",
      },
      {
        module: modules.callbackStubs,
        name: "writeCallbackMemory",
        operation: "executable-callback-write",
      },
      {
        module: modules.callbackStubs,
        name: "unmapCallbackMemory",
        operation: "executable-callback-unmap",
      },
    );
  }
  return { runtimes, memoryBindings: bindings, weakBindings, hostBindings };
}
/** How `target` loads binding module `module`: the library manifest
 * (`cLibraryManifest`, plus a build's `additional` entries) is the only
 * authority; names in source grant nothing. */
export function linkedForeignLibrary(
  module: string,
  target: CTarget,
  additional: readonly CLibraryManifestEntry[] = [],
): CLibraryImage | undefined {
  if (target.name !== "linux-x86_64")
    return cLibraryImage(module, target, additional);
  return cLibraryImage(module, linuxArm64CTarget, additional);
}
export type ForeignLibraryResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly library: ForeignLibrary;
        readonly text: string;
      };
    }
  | { readonly ok: false; readonly error: string };
function located(
  id: string,
  text: string,
  message: string,
  offset: number,
): string {
  const position = createSourceTextView(text).positionAt(offset);
  return (
    id +
    (position.ok
      ? ":" +
        String(position.value.line + 1) +
        ":" +
        String(position.value.column + 1)
      : "") +
    ": " +
    message
  );
}
/** Link the ABI-specific leaf adapter through the ordinary unsafe FFI
 * module. Its shared helpers still resolve to the default dynamic module. */
export function selectX64ForeignRuntime(
  request: ModuleRequest,
): ModuleRequest | string {
  const id = foreignRuntimeModules.unsafe;
  const unsafe = requestModules(request, [id])[0];
  if (unsafe === undefined) return request;
  const sysv = foreignRuntimeModules.sysv;
  const loader = request.moduleLoader;
  let available = requestModules(request);
  if (!available.some((source) => source?.id === sysv)) {
    const load = loader?.loadWithRoot;
    const expanded = load === undefined ? undefined : load(sysv);
    if (expanded === undefined)
      return "linux-x86_64: the SysV dynamic FFI runtime source is missing";
    if (!expanded.ok) return expanded.error.message;
    available = expanded.value;
  }
  const dependencies = new Map<string, string>();
  for (const [specifier, dependency] of unsafe.dependencies)
    dependencies.set(specifier, dependency);
  dependencies.set("./dynamic.ts", sysv);
  const modules: SourceModule[] = [];
  for (const source of available) {
    if (source === undefined) throw "FFI source invariant";
    modules.push(source.id === id ? { ...source, dependencies } : source);
  }
  return { modules };
}

/** Parse and expand one binding declaration module. */
export function prepareForeignLibrary(
  id: string,
  text: string,
  target: CTarget,
  manifest: readonly CLibraryManifestEntry[] = [],
): ForeignLibraryResult {
  const parsed = parseForeignDeclarations(text, target);
  if (!parsed.ok)
    return {
      ok: false,
      error: located(id, text, parsed.error.message, parsed.error.offset),
    };
  const image = linkedForeignLibrary(parsed.value.module, target, manifest);
  if (image === undefined)
    return {
      ok: false,
      error:
        id +
        ": " +
        parsed.value.module +
        " is not in the C library manifest for " +
        target.name,
    };
  for (const fn of parsed.value.functions) {
    if (fn === undefined) throw "foreign library function invariant";
    if (fn.signature.callClass === "async")
      return {
        ok: false,
        error:
          id +
          ": " +
          fn.name +
          " is a " +
          fn.signature.callClass +
          " call; only leaf and may-callback calls are supported",
      };
  }
  // Mach-O loads optional libraries weakly; ELF has no optional
  // DT_NEEDED, so their symbols resolve lazily through dlopen/dlsym.
  const expanded = expandForeignLibrary(
    parsed.value,
    target,
    image.runtimeResolved === true ||
      (image.optional && target.name !== "darwin-arm64")
      ? image.name
      : undefined,
  );
  if (!expanded.ok) return { ok: false, error: id + ": " + expanded.error };
  const views = foreignViews(parsed.value, target);
  if (!views.ok) return { ok: false, error: id + ": " + views.error };
  return {
    ok: true,
    value: {
      library: {
        id,
        declaration: parsed.value,
        stubs: expanded.value.stubs,
        image,
        views: views.value,
      },
      text: expanded.value.text,
    },
  };
}
/** Whether a source input is a C binding declaration module: a `.d.ts`
 * whose first statement is `declare module "tint:c/...`. */
export function foreignDeclarationInput(id: string, text: string): boolean {
  if (!id.endsWith(".d.ts")) return false;
  let index = 0;
  for (;;) {
    while (index < text.length && text.charCodeAt(index) <= 32) index++;
    if (text.startsWith("//", index)) {
      const end = text.indexOf("\n", index);
      index = end < 0 ? text.length : end + 1;
    } else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      if (end < 0) return false;
      index = end + 2;
    } else break;
  }
  return text.startsWith('declare module "tint:c/', index);
}
export interface ForeignInputs {
  readonly inputs: SourceInput[];
  readonly mappings: ImportMapping[];
  readonly libraries: ForeignLibrary[];
}
export type ForeignInputsResult =
  | { readonly ok: true; readonly value: ForeignInputs }
  | { readonly ok: false; readonly error: string };
/** Replace each binding declaration input by its generated implementation
 * (same module id) and grant its package the `tint:c/...` specifier (and
 * `tint:ffi`). Declarations of libraries the target does not load are
 * omitted. */
export function expandForeignInputs(
  inputs: readonly SourceInput[],
  target: CTarget,
  manifest: readonly CLibraryManifestEntry[] = [],
): ForeignInputsResult {
  const expanded: SourceInput[] = [],
    mappings: ImportMapping[] = [],
    libraries: ForeignLibrary[] = [];
  const decoder = new TextDecoder(),
    encoder = new TextEncoder();
  for (const input of inputs) {
    if (input === undefined) throw "foreign input invariant";
    if (!input.id.endsWith(".d.ts")) {
      expanded.push(input);
      continue;
    }
    const text = decoder.decode(input.bytes);
    if (!foreignDeclarationInput(input.id, text)) {
      expanded.push(input);
      continue;
    }
    // A library the target cannot load (CommonCrypto off Darwin) is left
    // out: importing its binding module then fails to resolve.
    const parsed = parseForeignDeclarations(text, target);
    if (
      parsed.ok &&
      linkedForeignLibrary(parsed.value.module, target, manifest) === undefined
    )
      continue;
    const prepared = prepareForeignLibrary(input.id, text, target, manifest);
    if (!prepared.ok) return prepared;
    const library = prepared.value.library;
    for (const other of libraries) {
      if (other === undefined) throw "foreign library invariant";
      if (other.declaration.module === library.declaration.module)
        return {
          ok: false,
          error: "duplicate binding module " + library.declaration.module,
        };
    }
    libraries.push(library);
    mappings.push({
      packageId: input.packageId,
      specifier: library.declaration.module,
      target: input.id,
    });
    // A package declaring bindings also uses `tint:ffi` (its marker and
    // view types, external storage) and `tint:ffi/unsafe` (foreign
    // memory), when the snapshot holds them.
    grantForeignRuntime(
      inputs,
      mappings,
      input.packageId,
      "tint:ffi",
      foreignRuntimeModules.index,
    );
    grantForeignRuntime(
      inputs,
      mappings,
      input.packageId,
      "tint:ffi/unsafe",
      foreignRuntimeModules.unsafe,
    );
    expanded.push({
      id: input.id,
      packageId: input.packageId,
      bytes: encoder.encode(prepared.value.text),
    });
  }
  if (
    target.name === "darwin-arm64" ||
    target.name === "linux-arm64" ||
    target.name === "linux-x86_64"
  ) {
    const packages = new Set<string>();
    for (const input of inputs) {
      if (input === undefined) throw "foreign input invariant";
      packages.add(input.packageId);
    }
    for (const packageId of packages) {
      if (packageId === undefined) throw "foreign package invariant";
      for (const builtin of registeredNodeBuiltins) {
        if (builtin.source === undefined) continue;
        grantForeignRuntime(
          inputs,
          mappings,
          packageId,
          builtin.specifier,
          builtin.source,
        );
      }
    }
  }
  return { ok: true, value: { inputs: expanded, mappings, libraries } };
}
/** Map `specifier` to runtime module `target` for package `packageId`
 * once, when `inputs` hold the module. */
function grantForeignRuntime(
  inputs: readonly SourceInput[],
  mappings: ImportMapping[],
  packageId: string,
  specifier: string,
  target: string,
): void {
  let present = false;
  for (const input of inputs) {
    if (input === undefined) throw "foreign input invariant";
    if (input.id === target) present = true;
  }
  if (!present) return;
  for (const mapping of mappings) {
    if (mapping === undefined) throw "foreign mapping invariant";
    if (mapping.packageId === packageId && mapping.specifier === specifier)
      return;
  }
  mappings.push({ packageId, specifier, target });
}
/** The declaration `name` of binding module `library`, if supplied. */
export function foreignDeclaration(
  libraries: readonly ForeignLibrary[],
  library: string,
  name: string,
): CFunctionDeclaration | undefined {
  for (const item of libraries) {
    if (item === undefined) throw "foreign library invariant";
    if (item.declaration.module !== library) continue;
    for (const fn of item.declaration.functions) {
      if (fn === undefined) throw "foreign declaration invariant";
      if (fn.name === name) return fn;
    }
  }
  return undefined;
}
/** The C view registry (docs/native-ffi.md, "C views") of a linked program:
 * `tint:ffi`'s `View` type and each binding record and Layout constant by
 * its linked name (from `exports`, the linker's export table); none when no
 * binding declares a record. Without `tint:ffi` in the program, `View<R>`
 * cannot be named but `R.view(bytes)` still makes views. */
export function foreignViewRegistry(
  libraries: readonly ForeignLibrary[],
  exports: readonly {
    readonly module: string;
    readonly namespace: string;
    readonly name: string;
    readonly linkedName: string;
  }[],
): CViewRegistry | undefined {
  function linked(
    module: string,
    namespace: string,
    name: string,
  ): string | undefined {
    for (const item of exports) {
      if (item === undefined) throw "linked export invariant";
      if (
        item.module === module &&
        item.namespace === namespace &&
        item.name === name
      )
        return item.linkedName;
    }
    return undefined;
  }
  // `View<R>` needs `tint:ffi` in the program; `R.view(bytes)` does not.
  const viewType = linked(foreignRuntimeModules.index, "type", "View") ?? "";
  // `tint:ffi/unsafe`'s record views at addresses, when loaded.
  const foreign = new Map<string, "view" | "array">();
  const viewAt = linked(foreignRuntimeModules.unsafe, "value", "viewAt"),
    arrayAt = linked(foreignRuntimeModules.unsafe, "value", "arrayAt");
  if (viewAt !== undefined) foreign.set(viewAt, "view");
  if (arrayAt !== undefined) foreign.set(arrayAt, "array");
  const records = new Map<string, string>(),
    layouts = new Map<string, string>(),
    shapes = new Map<string, CViewShape>();
  for (const library of libraries) {
    if (library === undefined) throw "foreign library invariant";
    for (const view of library.views) {
      if (view === undefined) throw "foreign view invariant";
      shapes.set(view.key, view.shape);
      const record = view.record;
      if (record === undefined) continue;
      const type = linked(library.id, "type", record);
      if (type !== undefined) records.set(type, view.key);
      if (library.declaration.layouts.includes(record)) {
        const layout = linked(library.id, "value", record);
        if (layout !== undefined) layouts.set(layout, view.key);
      }
    }
  }
  return shapes.size === 0
    ? undefined
    : { viewType, records, layouts, foreign, shapes };
}
