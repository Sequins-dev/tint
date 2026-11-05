import { bindingIdentifiers } from "@tint/typescript/syntax";
import { createStringIndex } from "@tint/foundation/collections/key-index";
import {
  rewriteModule,
  type Module,
  type Statement,
  type Parameter,
  type Expression,
} from "@tint/typescript/syntax";
import type { ModuleInstance } from "./instance.ts";
export interface ModuleInvocation {
  readonly module: Module;
  readonly entry: Statement & { readonly kind: "function" };
}
export type InvocationResult =
  | { readonly ok: true; readonly value: ModuleInvocation }
  | { readonly ok: false; readonly error: string };
/** A one-shot entrypoint: initialize a fresh instance, then invoke one selected export. */
export function prepareModuleInvocation(
  instance: ModuleInstance,
  exportName: string,
): InvocationResult {
  const result = instance.initializer.returnType;
  if (result?.kind !== "object")
    return {
      ok: false,
      error: "module initializer must return its export record",
    };
  const property = result.properties.find(
    (p) => p !== undefined && p.name === exportName,
  );
  const signature = property?.type;
  if (signature?.kind !== "function")
    return { ok: false, error: "invoked export must be a function" };
  const names = createStringIndex<number>();
  for (const statement of instance.module.statements) {
    if (statement === undefined) throw "module statement invariant";
    if (statement.kind === "function") names.set(statement.name, 1);
    else if (statement.kind === "variable")
      for (const declaration of statement.declarations) {
        if (declaration === undefined) throw "module declaration invariant";
        for (const identifier of bindingIdentifiers(declaration)) {
          if (identifier === undefined) throw "binding identifier invariant";
          names.set(identifier.name, 1);
        }
      }
  }
  rewriteModule(instance.module, {
    expression: (node, _original) => {
      if (node.kind === "identifier") names.set(node.name, 1);
      return node;
    },
  });
  let name = "__tint_invoke";
  while (names.has(name)) name += "_";
  const start = instance.module.end,
    end = start;
  const parameters: Parameter[] = [],
    args: Expression[] = [];
  for (let index = 0; index < signature.parameters.length; index++) {
    const parameter = signature.parameters[index];
    if (parameter === undefined) throw "export parameter invariant";
    let local = "$argument" + String(index);
    while (local === instance.initializer.name) local += "_";
    parameters.push({
      name: local,
      type: parameter.type,
      optional: parameter.optional === true,
      start,
      end,
    });
    args.push({ kind: "identifier", name: local, start, end });
  }
  const invocation: Expression = {
    kind: "call",
    callee: {
      kind: "member",
      object: {
        kind: "call",
        callee: {
          kind: "identifier",
          name: instance.initializer.name,
          start,
          end,
        },
        arguments: [],
        start,
        end,
      },
      property: exportName,
      start,
      end,
    },
    arguments: args,
    start,
    end,
  };
  const entry: Statement & { readonly kind: "function" } = {
    kind: "function",
    name,
    exported: true,
    parameters,
    returnType: signature.returnType,
    body: {
      kind: "block",
      statements: [{ kind: "return", expression: invocation, start, end }],
      start,
      end,
    },
    start,
    end,
  };
  const statements: Statement[] = instance.module.statements.slice();
  statements.push(entry);
  return {
    ok: true,
    value: {
      module: {
        ...instance.module,
        statements,
      },
      entry,
    },
  };
}
