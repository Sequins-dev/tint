import { bindModule } from "@tint/typescript/binding";
import {
  rewriteModule,
  type Module,
  type TypeNode,
  type Statement,
  type Span,
} from "@tint/typescript/syntax";
import type { ManagedSurfaceTypeDescription } from "./managed-surfaces.ts";
interface SurfaceImport {
  readonly exported: string;
  readonly value: boolean;
  readonly type: boolean;
}
export type ManagedSurfaceApplicationNormalization =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: { readonly module: Module; readonly erased: number };
    };
/** Registry arguments describe concrete surface exports. Erasure never substitutes
 * for checking the resulting program against those exact aliases. */
export function normalizeManagedSurfaceApplications(
  module: Module,
  specifiers: ReadonlySet<string>,
  instantiations: ReadonlyMap<string, readonly string[]>,
  surface: ManagedSurfaceTypeDescription,
): ManagedSurfaceApplicationNormalization {
  const reject = (message: string): ManagedSurfaceApplicationNormalization => ({
    ok: false,
    error: "profile: " + message,
  });
  const imports = new Map<string, SurfaceImport>();
  for (const declaration of module.imports) {
    if (
      declaration === undefined ||
      !specifiers.has(declaration.specifier) ||
      declaration.phase !== undefined ||
      (declaration.attributes?.length ?? 0) > 0 ||
      declaration.bindings.length === 0
    )
      return reject(
        "managed surface requires named imports from approved specifiers",
      );
    for (const binding of declaration.bindings) {
      if (
        binding === undefined ||
        binding.namespace ||
        imports.has(binding.local)
      )
        return reject("managed surface requires unique named imports");
      const value = surface.entries.some(
          (entry) => entry !== undefined && entry.name === binding.imported,
        ),
        type = surface.types.some(
          (entry) => entry !== undefined && entry.name === binding.imported,
        );
      if (!value && !type)
        return reject("managed surface export is missing: " + binding.imported);
      const typeOnly = declaration.typeOnly || binding.typeOnly;
      if (typeOnly && !type)
        return reject(
          "managed surface binding kind differs: " + binding.imported,
        );
      imports.set(binding.local, {
        exported: binding.imported,
        value: value && !typeOnly,
        type,
      });
    }
  }
  // Resolve value heads by declaration identity. Unknown globals remain the later
  // checker's concern; admitting their names here cannot make them imports.
  const globals: string[] = [],
    seen = new Set<string>(),
    protectedTypes = new Set<Span>();
  function protect(scope: Statement, names: ReadonlySet<string>): void {
    if (names.size === 0) return;
    rewriteModule(
      { start: 0, end: 0, imports: [], statements: [scope] },
      {
        type: (mapped, original) => {
          if (original.kind === "named" && names.has(original.name))
            protectedTypes.add(original);
          return mapped;
        },
      },
    );
  }
  rewriteModule(module, {
    expression: (mapped, _original) => {
      if (mapped.kind === "identifier" && !seen.has(mapped.name)) {
        seen.add(mapped.name);
        globals.push(mapped.name);
      }
      return mapped;
    },
    statement: (mapped, original) => {
      const names = new Set<string>();
      let parameters: readonly string[] = [];
      if (
        original.kind === "function" ||
        original.kind === "interface" ||
        original.kind === "type-alias"
      )
        parameters = original.typeParameters ?? [];
      else if (original.kind === "class")
        parameters = original.definition.typeParameters;
      for (const name of parameters) {
        if (name !== undefined && imports.get(name)?.type === true)
          names.add(name);
      }
      if (original.kind === "block")
        for (const child of original.statements) {
          if (
            child !== undefined &&
            (child.kind === "type-alias" ||
              child.kind === "interface" ||
              child.kind === "class") &&
            imports.get(child.name)?.type === true
          )
            names.add(child.name);
        }
      protect(original, names);
      return mapped;
    },
  });
  const bound = bindModule(module, globals);
  if (!bound.ok)
    return reject("managed surface binding: " + bound.error.message);
  const bindings = bound.value;
  function argument(node: TypeNode): string | undefined {
    while (node.kind === "group") node = node.type;
    if (
      node.kind !== "named" ||
      (node.arguments?.length ?? 0) !== 0 ||
      protectedTypes.has(node)
    )
      return undefined;
    const name = node.name;
    const imported = imports.get(name);
    if (imported !== undefined && imported.type) return imported.exported;
    return name === "unknown" ||
      name === "string" ||
      name === "number" ||
      name === "boolean" ||
      name === "undefined" ||
      name === "null" ||
      name === "never" ||
      name === "void"
      ? name
      : undefined;
  }
  let error = "",
    erased = 0;
  function approved(head: SurfaceImport, args: readonly TypeNode[]): boolean {
    const expected = instantiations.get(head.exported);
    if (expected === undefined || expected.length !== args.length) return false;
    for (let index = 0; index < args.length; index++) {
      const node = args[index];
      if (node === undefined || argument(node) !== expected[index])
        return false;
    }
    return true;
  }
  const normalized = rewriteModule(module, {
    type: (mapped, original) => {
      if (
        original.kind !== "named" ||
        mapped.kind !== "named" ||
        (original.arguments?.length ?? 0) === 0 ||
        protectedTypes.has(original)
      )
        return mapped;
      const head = imports.get(original.name);
      if (head === undefined) return mapped;
      if (!head.type || !approved(head, original.arguments ?? [])) {
        error = "instantiation not in surface " + head.exported;
        return mapped;
      }
      erased++;
      return { ...mapped, arguments: [] };
    },
    expression: (mapped, original) => {
      if (
        original.kind !== "call" ||
        mapped.kind !== "call" ||
        (original.typeArguments?.length ?? 0) === 0
      )
        return mapped;
      const callee = original.callee;
      if (callee.kind !== "identifier") return mapped;
      const head = imports.get(callee.name);
      if (head === undefined) return mapped;
      const reference = bindings.references.find(
        (ref) => ref !== undefined && ref.node === callee,
      );
      const bindingId = reference?.binding;
      const binding =
        bindingId === undefined ? undefined : bindings.bindings[bindingId];
      if (binding === undefined || binding.kind !== "import") return mapped;
      if (!head.value || !approved(head, original.typeArguments ?? [])) {
        error = "instantiation not in surface " + head.exported;
        return mapped;
      }
      erased++;
      return { ...mapped, typeArguments: [] };
    },
  });
  return error.length === 0
    ? { ok: true, value: { module: normalized, erased } }
    : reject(error);
}
