import type {
  CFunctionDeclaration,
  CLibraryDeclaration,
  CTarget,
} from "@tint/abi/c";
import type { ImportMapping } from "@tint/source/resolver";
import { createSourceTextView } from "@tint/source/text";
import type { SourceInput } from "@tint/typescript/modules";
import { parseForeignDeclarations } from "./declarations.ts";
import { expandForeignLibrary, type ForeignStub } from "./expansion.ts";
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
 * replaced by the generated implementation), its parsed declarations and
 * the generated stubs that bind to c-calls. */
export interface ForeignLibrary {
  readonly id: string;
  readonly declaration: CLibraryDeclaration;
  readonly stubs: readonly ForeignStub[];
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
/** C libraries a binding module may name in this phase: the libSystem
 * family, bound at link time through the image's libSystem load command
 * (CommonCrypto resolves through libSystem's re-exports). */
export function linkedForeignLibrary(module: string): boolean {
  return module === "tint:c/libsystem" || module === "tint:c/commoncrypto";
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
/** Parse and expand one binding declaration module. */
export function prepareForeignLibrary(
  id: string,
  text: string,
  target: CTarget,
): ForeignLibraryResult {
  const parsed = parseForeignDeclarations(text);
  if (!parsed.ok)
    return {
      ok: false,
      error: located(id, text, parsed.error.message, parsed.error.offset),
    };
  if (!linkedForeignLibrary(parsed.value.module))
    return {
      ok: false,
      error:
        id +
        ": " +
        parsed.value.module +
        " is not a libSystem-family library (other libraries need load commands, a later phase)",
    };
  for (const fn of parsed.value.functions) {
    if (fn === undefined) throw "foreign library function invariant";
    if (fn.signature.callClass !== "leaf")
      return {
        ok: false,
        error:
          id +
          ": " +
          fn.name +
          " is a " +
          fn.signature.callClass +
          " call; only leaf calls are supported in this phase",
      };
  }
  const expanded = expandForeignLibrary(parsed.value, target);
  if (!expanded.ok) return { ok: false, error: id + ": " + expanded.error };
  return {
    ok: true,
    value: {
      library: { id, declaration: parsed.value, stubs: expanded.value.stubs },
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
 * (same module id) and grant its package the `tint:c/...` specifier. */
export function expandForeignInputs(
  inputs: readonly SourceInput[],
  target: CTarget,
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
    const prepared = prepareForeignLibrary(input.id, text, target);
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
    expanded.push({
      id: input.id,
      packageId: input.packageId,
      bytes: encoder.encode(prepared.value.text),
    });
  }
  return { ok: true, value: { inputs: expanded, mappings, libraries } };
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
