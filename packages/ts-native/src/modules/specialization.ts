import { syntaxHash } from "@tint/typescript/syntax";
import {
  createKeyIndex,
  createStringIndex,
} from "@tint/foundation/collections/key-index";
import {
  rewriteModule,
  type Module,
  type Statement,
  type Expression,
  type TypeNode,
  type Span,
  type BlockStatement,
} from "@tint/typescript/syntax";
import type { BoundModule, Reference } from "@tint/typescript/binding";
type FunctionNode = Statement & { readonly kind: "function" };
export interface FunctionSpecialization {
  readonly source: FunctionNode;
  readonly arguments: readonly TypeNode[];
  readonly name: string;
}
export interface SpecializationOptions {
  readonly maxSpecializations?: number;
  readonly roots?: readonly {
    readonly function: number;
    readonly arguments: readonly TypeNode[];
  }[];
}
export type SpecializationResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly module: Module;
        readonly specializations: readonly FunctionSpecialization[];
        readonly roots: readonly string[];
      };
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly message: string;
        readonly start: number;
        readonly end: number;
      };
    };
/** Specialize explicit direct generic calls in a bound, import-free module. Rebind and check the output. */
export function specializeModule(
  module: Module,
  bound: BoundModule,
  options: SpecializationOptions = {},
): SpecializationResult {
  const maxSpecializations = options.maxSpecializations ?? 256;
  const rootNames: string[] = [];
  const abort = {},
    templates = new Map<number, FunctionNode>(),
    refs = createKeyIndex<Span, Reference>(syntaxHash),
    names = createStringIndex<number>();
  for (const ref of bound.references) {
    if (ref === undefined) throw "missing bound reference";
    refs.set(ref.node, ref);
    if (ref.global !== undefined) names.set(ref.global, 1);
  }
  for (const binding of bound.bindings) {
    if (binding === undefined) throw "missing binding";
    names.set(binding.name, 1);
  }
  const instances: FunctionSpecialization[] = [],
    keys = createStringIndex<string>(),
    generated: Statement[] = [];
  const templateScopes = createKeyIndex<
    FunctionNode,
    BlockStatement | undefined
  >(syntaxHash);
  const blockOrigins = createKeyIndex<BlockStatement, BlockStatement>(
    syntaxHash,
  );
  const localGenerated = createKeyIndex<BlockStatement, Statement[]>(
    syntaxHash,
  );
  let failure = { message: "", start: 0, end: 0 };
  function fail(node: Span, message: string): never {
    failure = { message, start: node.start, end: node.end };
    throw abort;
  }
  let keyDepth = 0;
  function key(t: TypeNode): string {
    if (++keyDepth > 256) fail(t, "generic type nesting limit exceeded");
    try {
      switch (t.kind) {
        case "named":
          return (
            "n" +
            (String(t.name.length) + ":" + t.name) +
            "[" +
            (t.arguments ?? []).map(key).join(",") +
            "]"
          );
        case "literal": {
          const value = t.value;
          const text =
            typeof value === "number"
              ? String(value)
              : typeof value === "boolean"
                ? String(value)
                : value;
          return "l" + typeof value + ":" + String(text.length) + ":" + text;
        }
        case "group":
          return key(t.type);
        case "indexed-access":
          return "i[" + key(t.object) + "," + key(t.index) + "]";
        case "tuple":
          return (
            (t.readonly ? "rt[" : "t[") + t.elements.map(key).join(",") + "]"
          );
        case "array":
          return (t.readonly ? "ra" : "a") + key(t.element);
        case "union":
        case "intersection":
          return t.kind + "[" + t.members.map(key).join(",") + "]";
        case "object": {
          const index = t.indexSignature;
          return (
            "o[" +
            (index === undefined
              ? ""
              : (index.readonly ? "ri:" : "i:") +
                key(index.keyType) +
                ":" +
                key(index.valueType) +
                ";") +
            (t.call === undefined ? "" : "call:" + key(t.call) + ";") +
            (t.construct === undefined
              ? ""
              : "construct:" + key(t.construct) + ";") +
            t.properties
              .map(
                (p) =>
                  String(p.name.length) +
                  ":" +
                  p.name +
                  ":" +
                  String(p.readonly) +
                  ":" +
                  (p.optional === undefined
                    ? "undefined"
                    : String(p.optional)) +
                  ":" +
                  key(p.type),
              )
              .join(",") +
            "]"
          );
        }
        case "function":
          return (
            "f" +
            (t.receiver === undefined ? "" : "this[" + key(t.receiver) + "]") +
            "[" +
            t.parameters
              .map(
                (p) =>
                  (p.optional ? "?" : "") +
                  (p.type === undefined
                    ? fail(p, "function type parameters require annotations")
                    : key(p.type)),
              )
              .join(",") +
            "]" +
            key(t.returnType)
          );
      }
    } finally {
      keyDepth--;
    }
  }
  function instantiate(
    id: number,
    args: readonly TypeNode[],
    node: Span,
  ): string {
    const template = templates.get(id);
    if (template === undefined)
      return fail(node, "type arguments require a direct generic function");
    if (args.length !== template.typeParameters?.length)
      return fail(node, "generic type argument count mismatch");
    const identity = String(id) + ":" + args.map(key).join(";");
    const existing = keys.get(identity);
    if (existing !== undefined) return existing;
    if (instances.length >= maxSpecializations)
      return fail(
        node,
        "generic specialization limit exceeded (" +
          String(maxSpecializations) +
          " instantiations; " +
          template.name +
          ")",
      );
    let name = "__tint_specialized_" + String(instances.length);
    while (names.has(name)) name += "_";
    names.set(name, 1);
    keys.set(identity, name);
    instances.push({ source: template, arguments: args, name });
    return name;
  }
  function rewrite(
    statements: readonly Statement[],
    substitutions: ReadonlyMap<string, TypeNode>,
    root?: FunctionNode,
  ): readonly Statement[] {
    const allowed = createKeyIndex<Expression, number>(syntaxHash);
    // Mark the direct callee nodes before the postorder rewrite visits identifiers.
    rewriteModule(
      { ...module, statements },
      {
        descend: (node) =>
          node === root ||
          node.kind !== "function" ||
          !node.typeParameters?.length,
        expression: (mapped, original) => {
          if (original.kind === "call") {
            let callee = original.callee;
            while (callee.kind === "group") callee = callee.expression;
            allowed.set(callee, 1);
          }
          return mapped;
        },
      },
    );
    return rewriteModule(
      { ...module, statements },
      {
        descend: (node) =>
          node === root ||
          node.kind !== "function" ||
          !node.typeParameters?.length,
        type: (mapped, _original) => {
          if (mapped.kind !== "named") return mapped;
          const replacement = substitutions.get(mapped.name);
          if (replacement === undefined) return mapped;
          if (mapped.arguments?.length)
            return fail(mapped, "type parameters cannot take type arguments");
          return { ...replacement, start: mapped.start, end: mapped.end };
        },
        statement: (mapped, original) => {
          if (
            original !== root &&
            original.kind === "function" &&
            original.typeParameters?.length
          )
            return { kind: "empty", start: original.start, end: original.end };
          if (
            substitutions.size &&
            (original.kind === "interface" || original.kind === "type-alias")
          )
            fail(
              original,
              "nested type declarations in generic functions are unsupported",
            );
          const result: Statement = { ...mapped };
          if (result.kind === "block" && original.kind === "block")
            blockOrigins.set(result, original);
          return result;
        },
        expression: (mapped, original) => {
          if (original.kind === "identifier") {
            const binding = refs.get(original)?.binding;
            if (
              binding !== undefined &&
              templates.has(binding) &&
              !allowed.has(original)
            )
              fail(
                original,
                "generic function values require specialization at a direct call",
              );
          }
          if (original.kind !== "call" || mapped.kind !== "call")
            return { ...mapped };
          let callee = original.callee;
          while (callee.kind === "group") callee = callee.expression;
          const binding =
            callee.kind === "identifier"
              ? refs.get(callee)?.binding
              : undefined;
          const template =
            binding === undefined ? undefined : templates.get(binding);
          if (template === undefined) {
            if (mapped.typeArguments?.length)
              fail(
                original,
                "type arguments require a direct generic function",
              );
            return mapped;
          }
          const typeArguments = mapped.typeArguments;
          if (typeArguments === undefined || typeArguments.length === 0)
            fail(original, "generic calls require explicit type arguments");
          if (binding === undefined)
            fail(original, "specialization binding invariant");
          const name = instantiate(binding, typeArguments, original);
          return {
            ...mapped,
            typeArguments: [],
            callee: {
              kind: "identifier",
              name,
              start: original.callee.start,
              end: original.callee.end,
            },
          };
        },
      },
    ).statements;
  }
  try {
    if (module.imports.length)
      fail(module, "specialization requires resolved imports");
    if (!Number.isSafeInteger(maxSpecializations) || maxSpecializations < 0)
      fail(module, "invalid specialization limit");
    function register(
      nodes: readonly Statement[],
      scope: BlockStatement | undefined,
    ): void {
      for (const node of nodes) {
        if (node === undefined) throw "template statement invariant";
        if (node.kind !== "function") continue;
        const parameters = node.typeParameters;
        if (parameters === undefined || parameters.length === 0) continue;
        const unique = new Set<string>();
        for (const parameter of parameters) {
          if (parameter === undefined) throw "missing type parameter";
          if (unique.has(parameter)) fail(node, "duplicate type parameter");
          unique.add(parameter);
        }
        const binding = bound.bindings.find(
          (b) => b !== undefined && b.node === node && b.kind === "function",
        );
        if (binding === undefined)
          fail(node, "specialization binding graph mismatch");
        templates.set(binding.id, node);
        templateScopes.set(node, scope);
      }
    }
    register(module.statements, undefined);
    rewriteModule(module, {
      statement: (mapped, original) => {
        if (original.kind === "block") register(original.statements, original);
        return mapped;
      },
    });
    for (const binding of bound.bindings) {
      if (binding === undefined) throw "missing binding";
      const template = templates.get(binding.id);
      if (template === undefined) continue;
      let owner = binding.owner;
      while (owner !== undefined) {
        const fn = bound.functions[owner];
        if (fn === undefined) fail(template, "specialization owner invariant");
        for (const [id, parentTemplate] of templates)
          if (parentTemplate === fn.node)
            fail(
              template,
              "nested generic functions inside generic functions require contextual specialization",
            );
        owner = fn.parent;
      }
    }
    for (const request of options.roots ?? []) {
      if (request === undefined) throw "missing specialization root";
      const fn = bound.functions.find(
        (f) => f !== undefined && f.id === request.function,
      );
      const binding =
        fn === undefined
          ? undefined
          : bound.bindings.find(
              (b) =>
                b !== undefined && b.node === fn.node && b.kind === "function",
            );
      const template =
        binding === undefined ? undefined : templates.get(binding.id);
      if (
        binding === undefined ||
        template === undefined ||
        templateScopes.get(template) !== undefined
      )
        fail(
          module,
          "specialization root requires a top-level generic function",
        );
      rootNames.push(
        instantiate(binding.id, request.arguments, fn?.node ?? module),
      );
    }
    const statements = rewrite(
      module.statements.filter(
        (s) =>
          s !== undefined &&
          (s.kind !== "function" || !s.typeParameters?.length),
      ),
      new Map<string, TypeNode>(),
    );
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i];
      if (instance === undefined)
        fail(module, "specialization queue invariant");
      const parameters = instance.source.typeParameters;
      if (parameters === undefined)
        fail(instance.source, "specialization parameter invariant");
      const substitutions = new Map<string, TypeNode>();
      for (let index = 0; index < parameters.length; index++) {
        const name = parameters[index],
          argument = instance.arguments[index];
        if (name === undefined || argument === undefined)
          fail(instance.source, "specialization argument invariant");
        substitutions.set(name, argument);
      }
      const rewritten = rewrite(
        [instance.source],
        substitutions,
        instance.source,
      )[0];
      if (rewritten?.kind !== "function")
        fail(instance.source, "specialization function invariant");
      const concrete: FunctionNode = {
        ...rewritten,
        name: instance.name,
        exported: false,
        typeParameters: [],
      };
      const scope = templateScopes.get(instance.source);
      if (!templateScopes.has(instance.source))
        fail(instance.source, "template scope invariant");
      if (scope === undefined) generated.push(concrete);
      else {
        let declarations = localGenerated.get(scope);
        if (declarations === undefined) {
          declarations = [];
          localGenerated.set(scope, declarations);
        }
        declarations.push(concrete);
      }
    }
    const completedStatements: Statement[] = [];
    for (const statement of statements) {
      if (statement === undefined) throw "missing rewritten statement";
      completedStatements.push(statement);
    }
    for (const statement of generated) {
      if (statement === undefined) throw "missing generated statement";
      completedStatements.push(statement);
    }
    const completed = rewriteModule(
      { ...module, statements: completedStatements },
      {
        hashes: true,
        statement: (mapped, original) => {
          if (mapped.kind !== "block" || original.kind !== "block")
            return mapped;
          const scope = blockOrigins.get(original) ?? original;
          const declarations = localGenerated.get(scope);
          if (declarations === undefined) return mapped;
          const statements: Statement[] = [];
          for (const statement of mapped.statements) {
            if (statement === undefined) throw "missing block statement";
            if (statement.kind !== "empty") statements.push(statement);
          }
          for (const declaration of declarations) {
            if (declaration === undefined)
              throw "missing generated declaration";
            statements.push(declaration);
          }
          return { ...mapped, statements };
        },
      },
    );
    return {
      ok: true,
      value: {
        // Local declarations are inserted by the postorder block callback above,
        // after that traversal has already assigned hashes to existing children.
        // Rehash the completed tree before rebinding and indexing generated copies.
        module: rewriteModule(completed, { hashes: true }),
        specializations: instances,
        roots: rootNames,
      },
    };
  } catch (error) {
    if (error === "syntax rewrite nesting limit exceeded")
      return {
        ok: false,
        error: {
          message: "syntax rewrite nesting limit exceeded",
          start: module.start,
          end: module.end,
        },
      };
    if (error !== abort) throw error;
    return { ok: false, error: failure };
  }
}
