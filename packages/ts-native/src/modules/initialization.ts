import { syntaxHash } from "@tint/typescript/syntax";
import {
  createKeyIndex,
  type ReadonlyKeyIndex,
} from "@tint/foundation/collections/key-index";
import { isPureNumericInitializer } from "./constants.ts";
import {
  rewriteModule,
  type Module,
  type Expression,
  type Statement,
  type Binding,
  type Parameter,
  type Span,
  type TypeNode,
} from "@tint/typescript/syntax";
import type { BoundModule, Reference } from "@tint/typescript/binding";
type FunctionNode = Statement & { readonly kind: "function" };
export interface InitializedNumericModule {
  readonly module: Module;
  readonly initializer: FunctionNode | undefined;
  readonly stateful: readonly number[];
  readonly functions: ReadonlyKeyIndex<Span, Span>;
  readonly stateParameter: string | undefined;
  readonly globals: ReadonlyMap<number, string>;
}
export type InitializationResult =
  | { readonly ok: true; readonly value: InitializedNumericModule }
  | { readonly ok: false; readonly error: string };
/** Prepare a linked module's pure numeric-array constants. Rebind/check the returned AST. */
export function prepareNumericModule(
  module: Module,
  bound: BoundModule,
): InitializationResult {
  const abort = {},
    globals = new Map<number, Binding>(),
    functions = createKeyIndex<Span, Span>(syntaxHash);
  let error = "";
  function fail(message: string): never {
    error = message;
    throw abort;
  }

  try {
    if (module.imports.length !== 0)
      fail("module initialization requires resolved imports");
    for (const s of module.statements) {
      if (s === undefined) throw "missing module statement";
      if (s.kind === "variable")
        for (const d of s.declarations) {
          if (d === undefined) throw "missing declaration";
          if (d.kind === "object-binding" || d.kind === "array-binding")
            fail("typed binding patterns are not implemented");
          const initial = d.initializer;
          if (initial?.kind !== "array") continue;
          if (
            s.mode !== "const" ||
            !initial.elements.every(isPureNumericInitializer)
          )
            fail(
              "module arrays require const bindings and pure numeric literal initializers",
            );
          const b = bound.bindings.find((b) => b !== undefined && b.node === d);
          if (b === undefined || b.owner !== undefined)
            fail("module binding graph mismatch");
          globals.set(b.id, d);
        }
    }
    if (globals.size === 0)
      return {
        ok: true,
        value: {
          module,
          initializer: undefined,
          stateful: [],
          functions,
          stateParameter: undefined,
          globals: new Map<number, string>(),
        },
      };
    const refs = createKeyIndex<Span, Reference>(syntaxHash);
    for (const r of bound.references) {
      if (r === undefined) throw "missing bound reference";
      refs.set(r.node, r);
    }
    const direct = new Map<number, number>();
    for (const b of bound.bindings) {
      if (b === undefined) throw "missing binding";
      if (b.kind === "function") {
        const fn = bound.functions.find(
          (f) => f !== undefined && f.node === b.node,
        );
        if (fn !== undefined) direct.set(b.id, fn.id);
      }
    }
    const needed = new Set<number>(),
      calls = new Map<
        Expression,
        { target: number; owner: number | undefined }
      >(),
      callees = new Set<Expression>();
    for (const r of bound.references) {
      if (r === undefined) throw "missing bound reference";
      if (r.binding !== undefined && globals.has(r.binding)) {
        const owner = bound.scopes[r.scope]?.owner;
        if (owner === undefined)
          fail(
            "runtime module values cannot be read by other initializers yet",
          );
        needed.add(owner);
      }
    }
    rewriteModule(module, {
      expression: (mapped, original) => {
        if (original.kind === "call") {
          let callee = original.callee;
          while (callee.kind === "group") callee = callee.expression;
          const ref = refs.get(callee),
            target =
              ref === undefined || ref.binding === undefined
                ? undefined
                : direct.get(ref.binding);
          if (target !== undefined && ref !== undefined) {
            calls.set(original, {
              target,
              owner: bound.scopes[ref.scope]?.owner,
            });
            callees.add(callee);
          }
        }
        return mapped;
      },
    });
    let changed = true;
    while (changed) {
      changed = false;
      for (const [expression, call] of calls)
        if (needed.has(call.target)) {
          const owner = call.owner;
          if (owner === undefined)
            fail("stateful calls in module initializers are not supported");
          if (!needed.has(owner)) {
            needed.add(owner);
            changed = true;
          }
        }
    }
    for (const id of needed) {
      const fn = bound.functions[id];
      if (
        fn === undefined ||
        !module.statements.some(
          (s) => s !== undefined && s.kind === "function" && s === fn.node,
        )
      )
        fail(
          "nested or value-based stateful functions require managed closures",
        );
    }
    for (const r of bound.references) {
      if (r === undefined) throw "missing bound reference";
      const id = r.binding === undefined ? undefined : direct.get(r.binding);
      if (id !== undefined && needed.has(id) && !callees.has(r.node))
        fail("stateful function values require managed closures");
    }
    const names = new Set<string>();
    for (const b of bound.bindings) {
      if (b === undefined) throw "missing binding";
      names.add(b.name);
    }
    for (const s of module.statements) {
      if (s === undefined) throw "missing module statement";
      if (s.kind === "interface" || s.kind === "type-alias") names.add(s.name);
    }
    function fresh(prefix: string): string {
      let name = prefix;
      let i = 0;
      while (names.has(name)) name = prefix + String(++i);
      names.add(name);
      return name;
    }
    const stateName = fresh("__tint_state"),
      typeName = fresh("__tint_module_state"),
      initializerName = fresh("__tint_initialize"),
      span = { start: module.start, end: module.start };
    const stateType: TypeNode = { kind: "named", name: typeName, ...span };
    function state(node: Span): Expression {
      return {
        kind: "identifier",
        name: stateName,
        start: node.start,
        end: node.end,
      };
    }
    const rewritten = rewriteModule(module, {
      expression: (mapped, original) => {
        const reference = refs.get(original),
          global =
            reference === undefined || reference.binding === undefined
              ? undefined
              : globals.get(reference.binding);
        if (global !== undefined)
          return {
            kind: "member",
            object: state(original),
            property: global.name,
            start: original.start,
            end: original.end,
          };
        const call = calls.get(original);
        if (
          mapped.kind === "call" &&
          call !== undefined &&
          needed.has(call.target)
        ) {
          const originalArguments = mapped.arguments;
          const args: Expression[] = [state(original)];
          for (const argument of originalArguments) {
            if (argument === undefined) throw "missing call argument";
            args.push(argument);
          }
          return { ...mapped, arguments: args };
        }
        return mapped;
      },
      statement: (mapped, original) => {
        if (mapped.kind === "function") {
          const fn = bound.functions.find(
            (f) => f !== undefined && f.node === original,
          );
          let result: FunctionNode = mapped;
          if (fn !== undefined && needed.has(fn.id)) {
            const parameters: Parameter[] = [
              { name: stateName, type: stateType, ...span },
            ];
            for (const parameter of mapped.parameters) {
              if (parameter === undefined) throw "missing function parameter";
              parameters.push(parameter);
            }
            result = { ...mapped, parameters };
          }
          functions.set(original, result);
          return result;
        }
        if (
          module.statements.includes(original) &&
          mapped.kind === "variable" &&
          original.kind === "variable"
        ) {
          const originalDeclarations = original.declarations;
          const declarations = mapped.declarations.filter((_, i): boolean => {
            const source = originalDeclarations[i];
            for (const [id, declaration] of globals)
              if (declaration === source) return false;
            return true;
          });
          return declarations.length === 0
            ? { kind: "empty", start: mapped.start, end: mapped.end }
            : { ...mapped, declarations };
        }
        return mapped;
      },
    });
    const declarations: Binding[] = [];
    for (const [id, declaration] of globals) declarations.push(declaration);
    const shape: Statement = {
      kind: "interface",
      name: typeName,
      exported: false,
      properties: declarations.map((d) => ({
        name: d.name,
        readonly: true,
        type: d.type ?? {
          kind: "array",
          element: {
            kind: "named",
            name: "number",
            start: d.start,
            end: d.end,
          },
          start: d.start,
          end: d.end,
        },
        start: d.start,
        end: d.end,
      })),
      ...span,
    };
    const initializer: FunctionNode = {
      kind: "function",
      name: initializerName,
      exported: true,
      parameters: [],
      returnType: stateType,
      body: {
        kind: "block",
        statements: [
          {
            kind: "variable",
            mode: "const",
            exported: false,
            declarations,
            ...span,
          },
          {
            kind: "return",
            expression: {
              kind: "object",
              properties: declarations.map((d) => ({
                name: d.name,
                shorthand: false,
                value: {
                  kind: "identifier",
                  name: d.name,
                  start: d.start,
                  end: d.end,
                },
                start: d.start,
                end: d.end,
              })),
              ...span,
            },
            ...span,
          },
        ],
        ...span,
      },
      ...span,
    };
    const globalNames = new Map<number, string>();
    for (const [id, binding] of globals) globalNames.set(id, binding.name);
    const statements: Statement[] = [shape];
    for (const statement of rewritten.statements) {
      if (statement === undefined) throw "missing rewritten statement";
      statements.push(statement);
    }
    statements.push(initializer);
    return {
      ok: true,
      value: {
        module: {
          ...rewritten,
          statements,
        },
        initializer,
        stateful: [...needed],
        functions,
        stateParameter: stateName,
        globals: globalNames,
      },
    };
  } catch (e) {
    if (e !== abort) throw e;
  }
  return { ok: false, error };
}
