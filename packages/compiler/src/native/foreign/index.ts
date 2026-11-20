import {
  cLibraryImage,
  linuxArm64CTarget,
  type CFunctionDeclaration,
  type CLibraryDeclaration,
  type CLibraryImage,
  type CLibraryManifestEntry,
  type CTarget,
} from "@tint/abi/c";
import {
  indirectCallClass,
  indirectCallTargets,
  type ModuleIR,
  type Span,
} from "@tint/ir/scalar";
import type { ImportMapping } from "@tint/source/resolver";
import { createSourceTextView } from "@tint/source/text";
import type { SourceInput } from "@tint/typescript/modules";
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
    | "retarget"
    | "stable"
    | "callback-key"
    | "call"
    | "call-callbacks";
}
/** The `tint:ffi` runtime: its trusted primitives and the weak-storage and
 * collection intrinsics its collector-registered storage uses. */
export const foreignRuntimeModules = {
  /** `tint:ffi` itself (its `View<R>` type names C views). */
  index: "packages/native-runtime/src/ffi/index.ts",
  /** `tint:ffi/unsafe`: views over memory C owns. */
  unsafe: "packages/native-runtime/src/ffi/unsafe.ts",
  primitives: "packages/native-runtime/src/ffi/primitives.ts",
  weak: "packages/native-runtime/src/intrinsics/weak.ts",
  memory: "packages/native-runtime/src/intrinsics/memory.ts",
};
/** The capabilities of the `tint:ffi` runtime for a program whose loaded
 * modules are `loaded`: none unless its primitives module is loaded, else
 * its primitives and the weak-storage and collection intrinsics its
 * collector-registered storage (`external`) uses. Weak cells work under
 * every collector, and only a created one makes collections trace them. */
export function foreignRuntimeBindings(
  loaded: ReadonlySet<string>,
  target?: CTarget,
): {
  readonly runtimes: readonly { module: string; namespace: string }[];
  readonly memoryBindings: readonly NativeForeignMemoryBinding[];
  readonly weakBindings: readonly {
    readonly module: string;
    readonly name: string;
    readonly operation: "new" | "key";
  }[];
  readonly hostBindings: readonly {
    readonly module: string;
    readonly name: string;
    readonly operation: "collect-garbage";
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
  // Callback capabilities are reserved for F2, including in a program
  // whose leaf uses load the shared runtime module.
  const memoryBindings =
    target?.name === "linux-x86_64"
      ? bindings.filter(
          (binding) =>
            binding !== undefined &&
            binding.operation !== "callback-key" &&
            binding.operation !== "call-callbacks",
        )
      : bindings;
  return {
    runtimes: [
      { module: modules.primitives, namespace: "ffi" },
      { module: modules.weak, namespace: "ffi-weak" },
      { module: modules.memory, namespace: "ffi-memory" },
    ],
    memoryBindings,
    weakBindings: [
      { module: modules.weak, name: "createWeakSlot", operation: "new" },
      { module: modules.weak, name: "weakSlotKey", operation: "key" },
    ],
    hostBindings: [
      {
        module: modules.memory,
        name: "collectGarbage",
        operation: "collect-garbage",
      },
    ],
  };
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
  // The built-in zlib binding describes allocator callbacks. An explicit
  // manifest entry can still provide a leaf-only declaration for libz.
  if (
    module === "tint:c/zlib" &&
    !additional.some((entry) => entry?.module === module)
  )
    return undefined;
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
const x64Callbacks: string =
  "C callbacks are not supported on linux-x86_64 (needs F2)";
const x64ManagedSuffix: string =
  " is not yet supported on linux-x86_64 (needs managed emission from x64 slice 7a–7b)";
const x64DynamicFFI: string = "packages/native-runtime/src/ffi/dynamic.ts:";

/** Diagnose public wrappers by linked identity. Raw leaf stubs have their
 * own identities, so aggregate images and the C trampoline stay available
 * even when their managed wrappers are unavailable. */
export function x64ForeignDiagnostic(
  reachable: ModuleIR,
  optimized: ModuleIR,
  names: ReadonlyMap<string, string>,
  libraries: readonly ForeignLibrary[],
  sourceModule: (span: Span) => string | undefined,
): string | undefined {
  const used = new Set<string>();
  const calls = indirectCallTargets(reachable, true, Infinity);
  const runtime = foreignRuntimeModules.index + ":";
  const unsafe = foreignRuntimeModules.unsafe + ":";
  function recordCallee(target: number): void {
    const callee = reachable.functions[target];
    if (callee === undefined) throw "reachable FFI call invariant";
    const sourceName = names.get(callee.name);
    if (sourceName !== undefined) used.add(sourceName);
  }
  for (const fn of reachable.functions) {
    if (fn === undefined) throw "reachable FFI function invariant";
    const name = names.get(fn.name) ?? "";
    // Module instances retain support functions even if the application
    // uses only one export. Report the boundary the caller actually uses.
    if (
      name.startsWith(x64DynamicFFI) ||
      name.startsWith(runtime) ||
      name.startsWith(unsafe)
    )
      continue;
    for (const block of fn.blocks) {
      if (block === undefined) throw "reachable FFI block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "reachable FFI instruction invariant";
        if (op.kind === "call") recordCallee(op.target);
        if (op.kind !== "call-indirect" || calls === undefined) continue;
        // The witness identifies a calling convention, not the callee.
        const targets =
          calls.classes[indirectCallClass(calls, fn.id, block.id, op)];
        if (targets === undefined) continue;
        for (const target of targets) {
          if (target === undefined) throw "indirect FFI call invariant";
          recordCallee(target);
        }
      }
    }
  }
  if (
    used.has(x64DynamicFFI + "setCallback") ||
    used.has(runtime + "registerCallback") ||
    used.has(runtime + "noteCallback") ||
    used.has(runtime + "releaseCallback") ||
    used.has(runtime + "callbackState") ||
    used.has(runtime + "callbackDispatcher") ||
    used.has(runtime + "rethrowCallbackFailure")
  )
    return x64Callbacks;
  if (used.has(x64DynamicFFI + "foreignFunction"))
    return "foreignFunction" + x64ManagedSuffix;

  // A wrapper can also survive as a first-class value without a call site.
  const retained = new Set<string>();
  for (const fn of optimized.functions) {
    if (fn === undefined) throw "reachable FFI function invariant";
    const name = names.get(fn.name);
    if (name !== undefined) retained.add(name);
  }
  let retainedWrapper: string | undefined;
  const layouts = new Set<string>();
  const optional = "Optional C library loading" + x64ManagedSuffix;
  for (const library of libraries) {
    if (library === undefined) throw "foreign library invariant";
    const prefix = library.id + ":";
    if (library.declaration.layouts.length > 0) layouts.add(library.id);
    for (const fn of library.declaration.functions) {
      if (fn === undefined) throw "foreign declaration invariant";
      const name = prefix + fn.name;
      const called = used.has(name);
      if (!called && !retained.has(name)) continue;
      let diagnostic: string | undefined;
      if (fn.signature.callClass === "may-callback") diagnostic = x64Callbacks;
      else if (library.image.optional) diagnostic = optional;
      else if (fn.resultForm === "record")
        diagnostic =
          "C record-by-value results are not yet supported on linux-x86_64 (needs x64 slice 7a-3)";
      else if (fn.parameterForms.includes("record"))
        diagnostic =
          "C record-by-value arguments are not yet supported on linux-x86_64 (needs x64 slice 7a-3)";
      else if (fn.parameterForms.includes("string"))
        diagnostic =
          "CString conversion" + x64ManagedSuffix + "; use CStringBytes";
      if (diagnostic === undefined) continue;
      if (called) return diagnostic;
      if (retainedWrapper === undefined) retainedWrapper = diagnostic;
    }
    if (library.image.optional)
      for (const query of library.declaration.availability) {
        if (query === undefined) throw "foreign availability invariant";
        const name = prefix + query.name;
        if (used.has(name)) return optional;
        if (retainedWrapper === undefined && retained.has(name))
          retainedWrapper = optional;
      }
  }

  if (
    used.has(x64DynamicFFI + "openLibrary") ||
    used.has(x64DynamicFFI + "openProgram") ||
    used.has(x64DynamicFFI + "findSymbol") ||
    used.has(x64DynamicFFI + "closeLibrary") ||
    used.has(x64DynamicFFI + "optionalSymbol")
  )
    return "Dynamic C library loading" + x64ManagedSuffix;
  if (used.has(unsafe + "cStringAt"))
    return "Foreign C string reading" + x64ManagedSuffix;
  for (const name of used) {
    if (name === undefined) throw "foreign source name invariant";
    if (name.startsWith(x64DynamicFFI))
      return "foreignFunction" + x64ManagedSuffix;
    if (name.startsWith(unsafe))
      return "Foreign memory view creation" + x64ManagedSuffix;
    if (name.startsWith(runtime))
      return "Managed FFI storage" + x64ManagedSuffix;
  }
  // The dynamic runtime retains its own C wrappers for the platform loader.
  // A retained public factory is the boundary before those wrappers.
  if (retained.has(x64DynamicFFI + "foreignFunction"))
    return "foreignFunction" + x64ManagedSuffix;
  if (retainedWrapper !== undefined) return retainedWrapper;

  for (const fn of optimized.functions) {
    if (fn === undefined) throw "reachable FFI function invariant";
    for (const block of fn.blocks) {
      if (block === undefined) throw "reachable FFI block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "reachable FFI instruction invariant";
        if (op.kind === "c-call" && op.call.mayCallback === true)
          return x64Callbacks;
        if (
          op.kind === "c-memory" &&
          (op.access.operation === "callback-key" ||
            op.access.operation === "callback-address")
        )
          return x64Callbacks;
        if (op.kind === "record-new" && layouts.size !== 0) {
          const id = sourceModule(op);
          if (id !== undefined && layouts.has(id))
            return "C Layout view creation" + x64ManagedSuffix;
        }
      }
    }
  }
  return undefined;
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
  if (
    target.name === "linux-x86_64" &&
    ((parsed.value.callbackTypes?.length ?? 0) !== 0 ||
      parsed.value.functions.some(
        (fn) => fn?.signature.callClass === "may-callback",
      ))
  )
    return {
      ok: false,
      error: id + ": " + x64Callbacks,
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
    image.optional && target.name !== "darwin-arm64" ? image.name : undefined,
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
