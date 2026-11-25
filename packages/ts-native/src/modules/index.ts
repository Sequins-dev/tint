import type { SourceModule } from "@tint/typescript/modules/model";
import { syntaxHash } from "@tint/typescript/syntax";
import {
  resolveModuleExports,
  createModuleExportMetadata,
  describeModuleExportDeclaration,
  type ModuleExportState,
  type ResolvedModuleExport,
} from "@tint/typescript/modules/exports";
import { isPureNumericInitializer } from "./constants.ts";
import {
  createKeyIndex,
  type ReadonlyKeyIndex,
} from "@tint/foundation/collections/key-index";
import type {
  Module,
  Statement,
  Expression,
  TypeNode,
  TypeParameter,
  Span,
  Parameter,
  Binding,
  VariableBinding,
  ObjectBinding,
  PropertySignature,
  IndexSignature,
  BlockStatement,
  ObjectProperty,
  CatchClause,
  SwitchClause,
  ArrayBindingPattern,
  ClassDefinition,
  ClassElement,
} from "@tint/typescript/syntax";
import {
  bindModule,
  type BoundModule,
  type BindingFallback,
} from "@tint/typescript/binding";
export interface LinkedExport {
  readonly module: string;
  readonly name: string;
  readonly namespace: "value" | "type";
  readonly linkedName: string;
}
export interface SourceOrigin {
  readonly module: string;
  readonly node: Span;
}
export interface SourceRange {
  readonly module: string;
  readonly start: number;
  readonly end: number;
  readonly offset: number;
}
export interface LinkedProgram {
  readonly evaluationOrder?: readonly string[];
  readonly module: Module;
  readonly exports: readonly LinkedExport[];
  /** Each linked node's original node; empty when the link was asked not to
   * record origins (LinkOptions.origins). */
  readonly origins: ReadonlyKeyIndex<Span, SourceOrigin>;
  /** Linker-owned ranges ordered by start, disjoint including their endpoints. */
  readonly ranges: readonly SourceRange[];
  readonly sourceNames?: ReadonlyMap<string, string> | undefined;
}
export function locateSource(
  program: LinkedProgram,
  span: { readonly start: number; readonly end: number },
):
  | { readonly module: string; readonly start: number; readonly end: number }
  | undefined {
  return locateSourceRange(program.ranges, span);
}
/** Locates a linked span by the linker's ranges alone, so later stages can
 * keep the ranges without the linked syntax. */
export function locateSourceRange(
  ranges: readonly SourceRange[],
  span: { readonly start: number; readonly end: number },
):
  | { readonly module: string; readonly start: number; readonly end: number }
  | undefined {
  if (!(span.end >= span.start)) return undefined;
  let low = 0,
    high = ranges.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2),
      candidate = ranges[middle];
    if (candidate === undefined) throw "linked source range invariant";
    if (candidate.start <= span.start) low = middle + 1;
    else high = middle;
  }
  const range = ranges[low - 1];
  if (range !== undefined && span.end > range.end) return undefined;
  return range === undefined
    ? undefined
    : {
        module: range.module,
        start: span.start - range.offset,
        end: span.end - range.offset,
      };
}
export type LinkResult =
  | { readonly ok: true; readonly value: LinkedProgram }
  | {
      readonly ok: false;
      readonly error: LinkDiagnostic;
    };
interface LinkDiagnostic extends Span {
  readonly module: string;
  readonly message: string;
  readonly fallback?: LinkFallback;
  readonly code?: string;
}
export interface LinkFallback {
  readonly capability:
    | BindingFallback["capability"]
    | "module-evaluation"
    | "nested-type-declaration";
  readonly ownerKind: BindingFallback["ownerKind"];
  readonly owner: Span;
}
interface ModuleState {
  readonly source: SourceModule;
  readonly bound: BoundModule;
  readonly values: Map<string, string>;
  readonly types: Map<string, string>;
  readonly names: Map<number, string>;
  readonly exports: LinkedExport[];
}
export interface LinkOptions {
  /** Preserve runtime initializers for an explicitly instantiated closed module graph. */
  readonly evaluation?: "instance";
  /** Record each linked node's original (default true). The table keeps every
   * input node reachable for as long as the linked program is; compilers that
   * locate spans through `ranges` pass false. */
  readonly origins?: boolean;
  /** Preserve source spellings when callable views expose Function#name. */
  readonly sourceNames?: boolean;
}
/** Most modules one link accepts. */
export const maxLinkedModules = 1048576;
/** Resolve bindings; instance mode also schedules synchronous dependency evaluation. */
export function linkModules(
  inputs: readonly SourceModule[],
  entry: string,
  globals: readonly string[],
  options?: LinkOptions,
): LinkResult {
  const abort = {},
    byId = new Map<string, SourceModule>(),
    states = new Map<string, ModuleState>(),
    order: SourceModule[] = [],
    origins = createKeyIndex<Span, SourceOrigin>(syntaxHash),
    recordOrigins = options?.origins !== false;
  const sourceNames =
    options?.sourceNames === true ? new Map<string, string>() : undefined;
  let error: LinkDiagnostic | undefined;
  function reject(
    module: string,
    node: Span,
    message: string,
    fallback: LinkFallback | undefined,
  ): never {
    error = {
      module,
      message,
      start: node.start,
      end: node.end,
      ...(fallback === undefined ? {} : { fallback }),
    };
    throw abort;
  }
  function fail(module: string, node: Span, message: string): never {
    return reject(module, node, message, undefined);
  }
  function unsupportedEvaluation(
    source: SourceModule,
    node: Span,
    message: string,
  ): never {
    return reject(source.id, node, message, {
      capability: "module-evaluation",
      ownerKind: "module",
      owner: source.module,
    });
  }
  function unsupportedNestedType(state: ModuleState, node: Span): never {
    let owner: Span | undefined;
    for (const frame of state.bound.functions)
      if (
        frame !== undefined &&
        frame.node.start <= node.start &&
        node.end <= frame.node.end &&
        (owner === undefined ||
          frame.node.end - frame.node.start < owner.end - owner.start)
      )
        owner = frame.node;
    return reject(
      state.source.id,
      node,
      "nested type declarations are not supported",
      {
        capability: "nested-type-declaration",
        ownerKind: owner === undefined ? "module" : "function",
        owner: owner ?? state.source.module,
      },
    );
  }
  try {
    // A sanity bound on the input graph, not a representation limit: one
    // whole-program Test262 suite image links about two modules per variant.
    if (inputs.length > maxLinkedModules)
      fail(entry, { start: 0, end: 0 }, "module count limit exceeded");
    for (const input of inputs) {
      if (input === undefined) throw "missing input";
      if (byId.has(input.id))
        fail(input.id, input.module, "duplicate module identity");
      byId.set(input.id, input);
    }
    const root = byId.get(entry);
    if (root === undefined)
      fail(entry, { start: 0, end: 0 }, "missing entry module");
    order.push(root);
    const reachable = new Set([entry]);
    for (let i = 0; i < order.length; i++) {
      const source = order[i];
      if (source === undefined) throw "module order invariant";
      for (const imp of source.module.imports) {
        if (imp === undefined) throw "missing imp";
        if (imp.phase !== undefined)
          fail(source.id, imp, "phased module evaluation is not implemented");
        if (imp.attributes !== undefined && imp.attributes.length !== 0)
          fail(source.id, imp, "module import attributes are not implemented");
        const id = source.dependencies.get(imp.specifier),
          dependency = id === undefined ? undefined : byId.get(id);
        if (dependency === undefined)
          fail(source.id, imp, "unresolved module: " + imp.specifier);
        if (!reachable.has(dependency.id)) {
          reachable.add(dependency.id);
          order.push(dependency);
        }
      }
      const bound = bindModule(source.module, globals);
      if (!bound.ok) {
        const diagnostic = bound.error;
        const fallback = diagnostic.fallback;
        if (fallback === undefined)
          fail(source.id, diagnostic, diagnostic.message);
        const located: LinkDiagnostic = {
          module: source.id,
          message: diagnostic.message,
          start: diagnostic.start,
          end: diagnostic.end,
          fallback,
          code: diagnostic.code,
        };
        error = located;
        throw abort;
      }
      const names = new Map<number, string>(),
        valueNames = new Map<string, string>(),
        typeNames = new Map<string, string>();
      // Internal names cannot collide with any identifier accepted by the source parser.
      for (const binding of bound.value.bindings) {
        if (binding === undefined) throw "missing binding";
        const name =
          binding.scope === 0 && binding.name.startsWith("__tint_spec_loop_")
            ? "@" +
              String(i) +
              ":value:" +
              String(binding.id) +
              ":" +
              binding.name
            : "@" + String(i) + ":value:" + String(binding.id);
        names.set(binding.id, name);
        sourceNames?.set(name, binding.name);
        if (binding.scope === 0 && binding.kind !== "import")
          valueNames.set(binding.name, name);
      }
      for (const statement of source.module.statements) {
        if (statement === undefined) throw "missing statement";
        if (statement.kind === "interface" || statement.kind === "type-alias")
          typeNames.set(
            statement.name,
            "@" + String(i) + ":type:" + statement.name,
          );
      }
      const exportNames = { values: valueNames, types: typeNames };
      const metadata = createModuleExportMetadata(
        source,
        bound.value,
        exportNames,
        fail,
      );
      const values = metadata.values,
        types = metadata.types,
        exports: LinkedExport[] = [];
      for (const statement of source.module.statements) {
        if (statement === undefined) throw "missing statement";
        if (statement.kind === "class") {
          if (options?.evaluation !== "instance")
            unsupportedEvaluation(
              source,
              statement,
              "module evaluation is required for class definitions",
            );
        } else if (statement.kind === "variable") {
          if (statement.mode !== "const" && options?.evaluation !== "instance")
            unsupportedEvaluation(
              source,
              statement,
              "module evaluation is required for mutable declarations",
            );
          for (const declaration of statement.declarations) {
            if (declaration === undefined) throw "missing declaration";
            if (
              options?.evaluation !== "instance" &&
              (declaration.kind === "object-binding" ||
                declaration.kind === "array-binding")
            )
              unsupportedEvaluation(
                source,
                declaration,
                "module evaluation is required for binding patterns",
              );
            const value = declaration.initializer;
            if (
              value === undefined ||
              (options?.evaluation !== "instance" &&
                value.kind !== "number" &&
                value.kind !== "boolean" &&
                value.kind !== "string" &&
                !(
                  value.kind === "array" &&
                  value.elements.every(isPureNumericInitializer)
                ))
            )
              unsupportedEvaluation(
                source,
                declaration,
                "module evaluation is required for this initializer",
              );
          }
        } else if (
          !(
            options?.evaluation === "instance" &&
            statement.kind === "expression"
          ) &&
          statement.kind !== "interface" &&
          statement.kind !== "type-alias" &&
          statement.kind !== "function" &&
          statement.kind !== "import" &&
          statement.kind !== "export" &&
          statement.kind !== "empty" &&
          statement.kind !== "debugger"
        )
          unsupportedEvaluation(
            source,
            statement,
            "module evaluation is required for this statement",
          );
        describeModuleExportDeclaration(metadata, exportNames, statement, fail);
      }
      for (const item of metadata.exports) {
        if (item === undefined) throw "module export metadata invariant";
        exports.push({
          module: item.module,
          name: item.name,
          namespace: item.namespace,
          linkedName: item.identity,
        });
      }
      states.set(source.id, {
        source,
        bound: bound.value,
        values,
        types,
        names,
        exports,
      });
    }
    const evaluated = new Set<string>(),
      evaluation: SourceModule[] = [];
    if (options?.evaluation === "instance") {
      // Iterative DFS preserves source dependency order, visits shared dependencies once,
      // and completes cyclic back-edges without evaluating a module twice.
      const stack = [{ source: root, next: 0 }];
      evaluated.add(root.id);
      while (stack.length > 0) {
        const frame = stack.at(-1);
        if (frame === undefined) throw "evaluation stack invariant";
        const dependency = frame.source.module.imports[frame.next];
        frame.next = frame.next + 1;
        if (dependency === undefined) {
          evaluation.push(frame.source);
          stack.length--;
          continue;
        }
        if (dependency.typeOnly) continue;
        const id = frame.source.dependencies.get(dependency.specifier);
        const source = id === undefined ? undefined : byId.get(id);
        if (source === undefined)
          throw "resolved evaluation dependency invariant";
        if (!evaluated.has(source.id)) {
          evaluated.add(source.id);
          stack.push({ source, next: 0 });
        }
      }
    }
    const emissionOrder: SourceModule[] = [];
    for (const source of order) {
      if (source === undefined) throw "missing ordered module";
      if (
        options?.evaluation === "instance" &&
        !evaluated.has(source.id) &&
        source.module.statements.some((node) => node.kind === "class")
      )
        fail(
          source.id,
          source.module,
          "type-only class dependencies require class declaration contracts",
        );
      if (options?.evaluation !== "instance" || !evaluated.has(source.id))
        emissionOrder.push(source);
    }
    if (options?.evaluation === "instance") {
      for (const source of evaluation) {
        if (source === undefined) throw "missing evaluated module";
        emissionOrder.push(source);
      }
    }
    // Semantic export identities retain the native linker's exact renamed symbols.
    const exportStates = new Map<string, ModuleExportState>();
    for (const [id, state] of states) {
      const exports: ResolvedModuleExport[] = [];
      for (const item of state.exports) {
        if (item === undefined) throw "export adapter invariant";
        exports.push({
          module: item.module,
          name: item.name,
          namespace: item.namespace,
          identity: item.linkedName,
        });
      }
      exportStates.set(id, {
        source: state.source,
        values: state.values,
        types: state.types,
        exports,
      });
    }
    const semanticExports = resolveModuleExports(exportStates, fail);
    const resolvedExports = new Map<string, readonly LinkedExport[]>();
    for (const [id, items] of semanticExports) {
      const exports: LinkedExport[] = [];
      for (const item of items) {
        if (item === undefined) throw "resolved export adapter invariant";
        exports.push({
          module: item.module,
          name: item.name,
          namespace: item.namespace,
          linkedName: item.identity,
        });
      }
      resolvedExports.set(id, exports);
    }
    const statements: Statement[] = [],
      exports: LinkedExport[] = [],
      ranges: SourceRange[] = [];
    let cursor = 0,
      nextNodeHash = 0;
    for (const inputSource of emissionOrder) {
      if (inputSource === undefined) throw "missing source";
      const source = inputSource;
      const foundState = states.get(source.id);
      if (foundState === undefined) throw "module state invariant";
      const state = foundState;
      for (const entry of resolvedExports.get(source.id) ?? []) {
        if (entry === undefined) throw "resolved export invariant";
        if (
          options?.evaluation !== "instance" ||
          evaluated.has(source.id) ||
          entry.namespace === "type"
        )
          exports.push(entry);
      }
      const offset = cursor - source.module.start,
        end = source.module.end + offset;
      if (
        !Number.isInteger(end) ||
        end < cursor ||
        end >= Number.MAX_SAFE_INTEGER
      )
        fail(source.id, source.module, "linked source span exceeds limits");
      ranges.push({ module: source.id, start: cursor, end, offset });
      cursor = end + 1;
      const typeNames = new Map<string, string>(),
        valueImports = new Map<string, string>();
      for (const [name, value] of state.types) typeNames.set(name, value);
      for (const imp of source.module.imports) {
        if (imp === undefined) throw "missing imp";
        const id = source.dependencies.get(imp.specifier),
          dep = id === undefined ? undefined : states.get(id);
        if (dep === undefined) throw "resolved dependency invariant";
        for (const imported of imp.bindings) {
          if (imported === undefined) throw "missing imported";
          if (imported.namespace)
            fail(
              source.id,
              imp,
              "namespace imports require module namespace objects",
            );
          const dependencyExports = resolvedExports.get(dep.source.id);
          const value =
            dependencyExports === undefined
              ? undefined
              : dependencyExports.find(
                  (e) =>
                    e !== undefined &&
                    e.namespace === "value" &&
                    e.name === imported.imported,
                );
          const type =
            dependencyExports === undefined
              ? undefined
              : dependencyExports.find(
                  (e) =>
                    e !== undefined &&
                    e.namespace === "type" &&
                    e.name === imported.imported,
                );
          const onlyType = imp.typeOnly || imported.typeOnly;
          if (type === undefined && (onlyType || value === undefined))
            fail(source.id, imp, "missing export: " + imported.imported);
          if (type !== undefined) {
            if (typeNames.has(imported.local))
              fail(
                source.id,
                imp,
                "duplicate imported type: " + imported.local,
              );
            typeNames.set(imported.local, type.linkedName);
          }
          if (!onlyType && value !== undefined)
            valueImports.set(imported.local, value.linkedName);
        }
      }
      const declarations = createKeyIndex<Span, string>(syntaxHash),
        references = createKeyIndex<Expression, string>(syntaxHash),
        bindingNames = new Map<number, string>();
      for (const binding of state.bound.bindings) {
        if (binding === undefined) throw "missing binding";
        const name =
          binding.kind === "import"
            ? valueImports.get(binding.name)
            : state.names.get(binding.id);
        if (name !== undefined) {
          bindingNames.set(binding.id, name);
          if (binding.kind !== "import") declarations.set(binding.node, name);
        }
      }
      for (const alias of state.bound.aliases ?? []) {
        if (alias === undefined) throw "binding alias invariant";
        const name = bindingNames.get(alias.binding);
        if (name !== undefined) declarations.set(alias.node, name);
      }
      for (const ref of state.bound.references) {
        if (ref === undefined) throw "missing bound reference";
        if (ref.binding !== undefined) {
          const name = bindingNames.get(ref.binding);
          if (name === undefined)
            fail(
              source.id,
              ref.node,
              "type-only export cannot be used as a value",
            );
          references.set(ref.node, name);
        }
      }
      function mark<T>(node: T, original: Span): T {
        const result = {
          ...node,
          start: original.start + offset,
          end: original.end + offset,
          // Source hashes are local to their original graph. Generated nodes
          // may all share a span; give every linked copy its own index hash.
          nodeHash: nextNodeHash++,
        };
        if (recordOrigins)
          origins.set(result, { module: source.id, node: original });
        return result;
      }
      let depth = 0;
      function enter(node: Span): void {
        if (++depth > 256)
          fail(source.id, node, "module transformation depth exceeded");
      }
      function renamed(node: Span): string {
        const name = declarations.get(node);
        if (name === undefined) throw "declaration rename invariant";
        return name;
      }
      function parameterSet(
        parameters: readonly TypeParameter[] | undefined,
        outer?: ReadonlySet<string>,
      ): Set<string> {
        const result = new Set<string>();
        if (outer !== undefined) for (const name of outer) result.add(name);
        if (parameters !== undefined)
          for (const parameter of parameters) {
            if (parameter === undefined) throw "missing type parameter";
            result.add(parameter.name);
          }
        return result;
      }
      function typeParameters(
        values: readonly TypeParameter[],
        scope: ReadonlySet<string>,
      ): readonly TypeParameter[] {
        return values.map((value) =>
          mark<TypeParameter>(
            {
              ...value,
              constraint:
                value.constraint === undefined
                  ? undefined
                  : type(value.constraint, scope),
              defaultType:
                value.defaultType === undefined
                  ? undefined
                  : type(value.defaultType, scope),
            },
            value,
          ),
        );
      }
      function generics(
        node: {
          readonly typeParameters?: readonly TypeParameter[] | undefined;
        },
        scope: ReadonlySet<string>,
      ): { typeParameters?: readonly TypeParameter[] } {
        const values = node.typeParameters;
        return values === undefined
          ? {}
          : { typeParameters: typeParameters(values, scope) };
      }
      function property(
        node: PropertySignature,
        parameters: ReadonlySet<string>,
      ): PropertySignature {
        return mark<PropertySignature>(
          { ...node, type: type(node.type, parameters) },
          node,
        );
      }
      function parameter(
        node: Parameter,
        parameters: ReadonlySet<string>,
        valueBinding: boolean,
      ): Parameter {
        if (node.kind === "pattern-parameter") {
          const pattern = variableBinding(node.pattern);
          if (
            pattern.kind !== "object-binding" &&
            pattern.kind !== "array-binding"
          )
            throw "parameter pattern invariant";
          return mark<Parameter>(
            {
              ...node,
              pattern,
              type:
                node.type === undefined
                  ? undefined
                  : type(node.type, parameters),
              initializer:
                node.initializer === undefined
                  ? undefined
                  : expression(node.initializer),
            },
            node,
          );
        }
        return mark<Parameter>(
          {
            ...node,
            name: valueBinding ? renamed(node) : node.name,
            initializer:
              node.initializer === undefined
                ? undefined
                : expression(node.initializer),
            type:
              node.type === undefined ? undefined : type(node.type, parameters),
          },
          node,
        );
      }
      function indexSignature(
        node: IndexSignature,
        parameters: ReadonlySet<string>,
      ): IndexSignature {
        return mark<IndexSignature>(
          {
            ...node,
            keyType: type(node.keyType, parameters),
            valueType: type(node.valueType, parameters),
          },
          node,
        );
      }
      function type(node: TypeNode, parameters: ReadonlySet<string>): TypeNode {
        enter(node);
        try {
          switch (node.kind) {
            case "named": {
              const name = parameters.has(node.name)
                ? node.name
                : (localTypes.get(node.name) ??
                  typeNames.get(node.name) ??
                  node.name);
              return node.arguments === undefined
                ? mark<TypeNode>({ ...node, name }, node)
                : mark<TypeNode>(
                    {
                      ...node,
                      name,
                      arguments: node.arguments.map((a) => type(a, parameters)),
                    },
                    node,
                  );
            }
            case "literal":
              return mark<TypeNode>({ ...node }, node);
            case "indexed-access":
              return mark<TypeNode>(
                {
                  ...node,
                  object: type(node.object, parameters),
                  index: type(node.index, parameters),
                },
                node,
              );
            case "tuple":
              return mark<TypeNode>(
                {
                  ...node,
                  elements: node.elements.map((part) => type(part, parameters)),
                },
                node,
              );
            case "array":
              return mark<TypeNode>(
                { ...node, element: type(node.element, parameters) },
                node,
              );
            case "group":
              return mark<TypeNode>(
                { ...node, type: type(node.type, parameters) },
                node,
              );
            case "union":
            case "intersection":
              return mark<TypeNode>(
                {
                  ...node,
                  members: node.members.map((m) => type(m, parameters)),
                },
                node,
              );
            case "object":
              return mark<TypeNode>(
                {
                  ...node,
                  ...(node.indexSignature === undefined
                    ? {}
                    : {
                        indexSignature: indexSignature(
                          node.indexSignature,
                          parameters,
                        ),
                      }),
                  ...(node.call === undefined
                    ? {}
                    : { call: type(node.call, parameters) }),
                  ...(node.construct === undefined
                    ? {}
                    : { construct: type(node.construct, parameters) }),
                  properties: node.properties.map((p) =>
                    property(p, parameters),
                  ),
                },
                node,
              );
            case "function": {
              const scope =
                node.typeParameters === undefined
                  ? parameters
                  : parameterSet(node.typeParameters, parameters);
              return mark<TypeNode>(
                {
                  ...node,
                  ...generics(node, scope),
                  parameters: node.parameters.map((p) =>
                    parameter(p, scope, false),
                  ),
                  returnType: type(node.returnType, scope),
                  ...(node.receiver === undefined
                    ? {}
                    : { receiver: type(node.receiver, scope) }),
                },
                node,
              );
            }
          }
        } finally {
          depth--;
        }
      }
      let noParameters: Set<string> = new Set<string>();
      let localTypes: Map<string, string> = new Map<string, string>();
      function copyTypeScope(): void {
        const types = new Map<string, string>(),
          parameters = new Set<string>();
        for (const [name, linked] of localTypes) types.set(name, linked);
        for (const name of noParameters) parameters.add(name);
        localTypes = types;
        noParameters = parameters;
      }
      function classDefinition(node: ClassDefinition): ClassDefinition {
        const previousTypes = localTypes,
          previousParameters = noParameters;
        copyTypeScope();
        const sourceName = node.name;
        const name = sourceName === undefined ? undefined : renamed(node);
        if (sourceName !== undefined && name !== undefined) {
          localTypes.set(sourceName, name);
          noParameters.delete(sourceName);
        }
        for (const parameter of node.typeParameters) {
          if (parameter === undefined) throw "class type parameter invariant";
          noParameters.add(parameter.name);
        }
        try {
          return mark<ClassDefinition>(
            {
              ...node,
              sourceStart:
                node.sourceStart === undefined
                  ? undefined
                  : node.sourceStart + offset,
              decorators: node.decorators?.map(expression),
              name,
              typeParameters: typeParameters(node.typeParameters, noParameters),
              heritage:
                node.heritage === undefined
                  ? undefined
                  : expression(node.heritage),
              elements: node.elements.map((element): ClassElement => {
                if (element.kind === "static-block")
                  return mark<ClassElement>(
                    { ...element, body: block(element.body) },
                    element,
                  );
                const key = expression(element.key);
                if (element.kind === "field")
                  return mark<ClassElement>(
                    {
                      ...element,
                      decorators: element.decorators?.map(expression),
                      key,
                      type:
                        element.type === undefined
                          ? undefined
                          : type(element.type, noParameters),
                      initializer:
                        element.initializer === undefined
                          ? undefined
                          : expression(element.initializer),
                    },
                    element,
                  );
                const previous = noParameters;
                if (element.typeParameters !== undefined)
                  noParameters = parameterSet(element.typeParameters, previous);
                try {
                  return mark<ClassElement>(
                    {
                      ...element,
                      ...generics(element, noParameters),
                      sourceStart:
                        element.sourceStart === undefined
                          ? undefined
                          : element.sourceStart + offset,
                      decorators: element.decorators?.map(expression),
                      key,
                      parameters: element.parameters.map((p) =>
                        parameter(p, noParameters, true),
                      ),
                      returnType:
                        element.returnType === undefined
                          ? undefined
                          : type(element.returnType, noParameters),
                      body: block(element.body),
                    },
                    element,
                  );
                } finally {
                  noParameters = previous;
                }
              }),
            },
            node,
          );
        } finally {
          localTypes = previousTypes;
          noParameters = previousParameters;
        }
      }
      function expression(node: Expression): Expression {
        enter(node);
        try {
          switch (node.kind) {
            case "class-expression":
              return mark<Expression>(
                { ...node, definition: classDefinition(node.definition) },
                node,
              );
            case "identifier":
              return mark<Expression>(
                { ...node, name: references.get(node) ?? node.name },
                node,
              );
            case "bigint":
            case "regexp":
            case "number":
            case "boolean":
            case "string":
            case "elision":
              return mark<Expression>({ ...node }, node);
            case "private-in":
              return mark<Expression>(
                { ...node, object: expression(node.object) },
                node,
              );
            case "new-target":
            case "import-meta":
            case "super":
            case "this":
            case "null":
              return mark<Expression>({ ...node }, node);
            case "import-call":
              return mark<Expression>(
                {
                  ...node,
                  specifier: expression(node.specifier),
                  options:
                    node.options === undefined
                      ? undefined
                      : expression(node.options),
                },
                node,
              );
            case "await":
              return mark<Expression>(
                { ...node, expression: expression(node.expression) },
                node,
              );
            case "yield":
              return mark<Expression>(
                {
                  ...node,
                  expression:
                    node.expression === undefined
                      ? undefined
                      : expression(node.expression),
                },
                node,
              );
            case "spread":
              return mark<Expression>(
                { ...node, value: expression(node.value) },
                node,
              );
            case "tagged-template":
              return mark<Expression>(
                {
                  ...node,
                  tag: expression(node.tag),
                  template: {
                    ...node.template,
                    substitutions: node.template.substitutions.map(expression),
                  },
                },
                node,
              );
            case "template-expression":
              return mark<Expression>(
                { ...node, substitutions: node.substitutions.map(expression) },
                node,
              );
            case "array":
              return mark<Expression>(
                { ...node, elements: node.elements.map(expression) },
                node,
              );
            case "object":
              return mark<Expression>(
                {
                  ...node,
                  properties: node.properties.map((p) =>
                    mark<ObjectProperty>(
                      p.kind === "spread"
                        ? { ...p, value: expression(p.value) }
                        : {
                            ...p,
                            shorthand: false,
                            ...(p.keyExpression === undefined
                              ? {}
                              : { keyExpression: expression(p.keyExpression) }),
                            value: expression(p.value),
                          },
                      p,
                    ),
                  ),
                },
                node,
              );
            case "function-expression":
            case "arrow": {
              const previous = noParameters;
              if (node.typeParameters !== undefined)
                noParameters = parameterSet(node.typeParameters, previous);
              try {
                const originalBody = node.body;
                const body =
                  originalBody.kind === "block"
                    ? block(originalBody)
                    : expression(originalBody);
                const parameters = node.parameters.map((p) =>
                  parameter(p, noParameters, true),
                );
                const returnType =
                  node.returnType === undefined
                    ? undefined
                    : type(node.returnType, noParameters);
                if (node.kind === "function-expression") {
                  if (body.kind !== "block")
                    throw "function expression body invariant";
                  return mark<Expression>(
                    {
                      ...node,
                      ...generics(node, noParameters),
                      parameters,
                      returnType,
                      body,
                      ...(node.receiver === undefined
                        ? {}
                        : { receiver: type(node.receiver, noParameters) }),
                    },
                    node,
                  );
                }
                return mark<Expression>(
                  {
                    ...node,
                    ...generics(node, noParameters),
                    parameters,
                    returnType,
                    body,
                  },
                  node,
                );
              } finally {
                noParameters = previous;
              }
            }
            case "satisfies":
              return mark<Expression>(
                {
                  ...node,
                  expression: expression(node.expression),
                  type: type(node.type, noParameters),
                },
                node,
              );
            case "group":
              return mark<Expression>(
                { ...node, expression: expression(node.expression) },
                node,
              );
            case "unary":
              return mark<Expression>(
                { ...node, operand: expression(node.operand) },
                node,
              );
            case "binary":
              return mark<Expression>(
                {
                  ...node,
                  left: expression(node.left),
                  right: expression(node.right),
                },
                node,
              );
            case "assignment":
            case "compound":
              return mark<Expression>(
                {
                  ...node,
                  target: expression(node.target),
                  value: expression(node.value),
                },
                node,
              );
            case "update":
              return mark<Expression>(
                { ...node, target: expression(node.target) },
                node,
              );
            case "conditional":
              return mark<Expression>(
                {
                  ...node,
                  test: expression(node.test),
                  consequent: expression(node.consequent),
                  alternate: expression(node.alternate),
                },
                node,
              );
            case "new":
              return mark<Expression>(
                {
                  ...node,
                  callee: expression(node.callee),
                  typeArguments: node.typeArguments.map((t) =>
                    type(t, noParameters),
                  ),
                  arguments: node.arguments.map(expression),
                },
                node,
              );
            case "call":
              return mark<Expression>(
                {
                  ...node,
                  ...(node.typeArguments === undefined
                    ? {}
                    : {
                        typeArguments: node.typeArguments.map((t) =>
                          type(t, noParameters),
                        ),
                      }),
                  callee: expression(node.callee),
                  arguments: node.arguments.map(expression),
                },
                node,
              );
            case "member":
              return mark<Expression>(
                { ...node, object: expression(node.object) },
                node,
              );
            case "index":
              return mark<Expression>(
                {
                  ...node,
                  object: expression(node.object),
                  index: expression(node.index),
                },
                node,
              );
          }
        } finally {
          depth--;
        }
      }
      function binding(node: Binding): Binding {
        return mark<Binding>(
          {
            ...node,
            name: renamed(node),
            type:
              node.type === undefined
                ? undefined
                : type(node.type, noParameters),
            initializer:
              node.initializer === undefined
                ? undefined
                : expression(node.initializer),
          },
          node,
        );
      }
      function variableBinding(node: VariableBinding): VariableBinding {
        if (node.kind === "array-binding")
          return mark<ArrayBindingPattern>(
            {
              ...node,
              type:
                node.type === undefined
                  ? undefined
                  : type(node.type, noParameters),
              initializer:
                node.initializer === undefined
                  ? undefined
                  : expression(node.initializer),
              elements: node.elements.map((element) =>
                element === undefined ? undefined : variableBinding(element),
              ),
              ...(node.rest === undefined
                ? {}
                : { rest: variableBinding(node.rest) }),
            },
            node,
          );
        if (node.kind !== "object-binding") return binding(node);
        return mark<ObjectBinding>(
          {
            ...node,
            type:
              node.type === undefined
                ? undefined
                : type(node.type, noParameters),
            initializer:
              node.initializer === undefined
                ? undefined
                : expression(node.initializer),
            properties: node.properties.map((property) => ({
              ...property,
              ...(property.keyExpression === undefined
                ? {}
                : { keyExpression: expression(property.keyExpression) }),
              binding: variableBinding(property.binding),
            })),
            rest: node.rest === undefined ? undefined : binding(node.rest),
          },
          node,
        );
      }
      function declareClassTypes(statements: readonly Statement[]): void {
        for (const child of statements) {
          if (child === undefined || child.kind !== "class") continue;
          const name = child.name;
          localTypes.set(name, renamed(child));
          noParameters.delete(name);
        }
      }
      function block(
        node: Statement & { readonly kind: "block" },
      ): Statement & { readonly kind: "block" } {
        if (!node.statements.some((child) => child.kind === "class"))
          return mark<BlockStatement>(
            { ...node, statements: node.statements.map(statement) },
            node,
          );
        const previousTypes = localTypes,
          previousParameters = noParameters;
        copyTypeScope();
        declareClassTypes(node.statements);
        try {
          return mark<BlockStatement>(
            { ...node, statements: node.statements.map(statement) },
            node,
          );
        } finally {
          localTypes = previousTypes;
          noParameters = previousParameters;
        }
      }
      function statement(node: Statement): Statement {
        enter(node);
        try {
          switch (node.kind) {
            case "export-default":
              return mark<Statement>(
                { ...node, value: expression(node.value) },
                node,
              );
            case "class":
              return mark<Statement>(
                {
                  ...node,
                  name: renamed(node),
                  exported: false,
                  definition: classDefinition(node.definition),
                },
                node,
              );
            case "try": {
              const handler = node.handler;
              const catchBinding =
                handler === undefined ? undefined : handler.binding;
              return mark<Statement>(
                {
                  ...node,
                  body: block(node.body),
                  handler:
                    handler === undefined
                      ? undefined
                      : mark<CatchClause>(
                          {
                            ...handler,
                            binding:
                              catchBinding === undefined
                                ? undefined
                                : variableBinding(catchBinding),
                            body: block(handler.body),
                          },
                          handler,
                        ),
                  finalizer:
                    node.finalizer === undefined
                      ? undefined
                      : block(node.finalizer),
                },
                node,
              );
            }
            case "block":
              return block(node);
            case "interface": {
              if (!source.module.statements.includes(node))
                unsupportedNestedType(state, node);
              const name = state.types.get(node.name);
              if (name === undefined)
                fail(
                  source.id,
                  node,
                  "nested type declarations are not supported",
                );
              const params = parameterSet(node.typeParameters);
              const properties = node.properties.map((p) =>
                property(p, params),
              );
              return mark<Statement>(
                {
                  ...node,
                  name,
                  exported: false,
                  properties,
                  ...generics(node, params),
                  ...(node.indexSignature === undefined
                    ? {}
                    : {
                        indexSignature: indexSignature(
                          node.indexSignature,
                          params,
                        ),
                      }),
                  ...(node.bases === undefined
                    ? {}
                    : { bases: node.bases.map((b) => type(b, params)) }),
                  ...(node.call === undefined
                    ? {}
                    : { call: type(node.call, params) }),
                  ...(node.construct === undefined
                    ? {}
                    : { construct: type(node.construct, params) }),
                },
                node,
              );
            }
            case "type-alias": {
              if (!source.module.statements.includes(node))
                unsupportedNestedType(state, node);
              const name = state.types.get(node.name);
              if (name === undefined)
                fail(
                  source.id,
                  node,
                  "nested type declarations are not supported",
                );
              const params = parameterSet(node.typeParameters);
              return mark<Statement>(
                {
                  ...node,
                  name,
                  exported: false,
                  ...generics(node, params),
                  type: type(node.type, params),
                },
                node,
              );
            }
            case "function": {
              const previous = noParameters;
              noParameters = parameterSet(node.typeParameters);
              for (const name of previous) noParameters.add(name);
              try {
                return mark<Statement>(
                  {
                    ...node,
                    sourceStart:
                      node.sourceStart === undefined
                        ? undefined
                        : node.sourceStart + offset,
                    name: renamed(node),
                    exported: false,
                    ...generics(node, noParameters),
                    parameters: node.parameters.map((p) =>
                      parameter(p, noParameters, true),
                    ),
                    returnType:
                      node.returnType === undefined
                        ? undefined
                        : type(node.returnType, noParameters),
                    ...(node.receiver === undefined
                      ? {}
                      : { receiver: type(node.receiver, noParameters) }),
                    body: statement(node.body),
                  },
                  node,
                );
              } finally {
                noParameters = previous;
              }
            }
            case "variable":
              return mark<Statement>(
                {
                  ...node,
                  exported: false,
                  declarations: node.declarations.map(variableBinding),
                },
                node,
              );
            case "if":
              return mark<Statement>(
                {
                  ...node,
                  test: expression(node.test),
                  consequent: statement(node.consequent),
                  alternate:
                    node.alternate === undefined
                      ? undefined
                      : statement(node.alternate),
                },
                node,
              );
            case "switch": {
              // The discriminant is outside the shared CaseBlock scope.
              const discriminant = expression(node.expression);
              const previousTypes = localTypes,
                previousParameters = noParameters;
              if (
                node.clauses.some((clause) =>
                  clause.statements.some((child) => child.kind === "class"),
                )
              ) {
                copyTypeScope();
                for (const clause of node.clauses) {
                  if (clause === undefined) throw "switch clause invariant";
                  declareClassTypes(clause.statements);
                }
              }
              try {
                return mark<Statement>(
                  {
                    ...node,
                    expression: discriminant,
                    clauses: node.clauses.map((c) =>
                      mark<SwitchClause>(
                        {
                          ...c,
                          test:
                            c.test === undefined
                              ? undefined
                              : expression(c.test),
                          statements: c.statements.map(statement),
                        },
                        c,
                      ),
                    ),
                  },
                  node,
                );
              } finally {
                localTypes = previousTypes;
                noParameters = previousParameters;
              }
            }
            case "label":
              return mark<Statement>(
                { ...node, body: statement(node.body) },
                node,
              );
            case "with":
              return mark<Statement>(
                {
                  ...node,
                  object: expression(node.object),
                  body: statement(node.body),
                },
                node,
              );
            case "do-while":
            case "while":
              return mark<Statement>(
                {
                  ...node,
                  test: expression(node.test),
                  body: statement(node.body),
                },
                node,
              );
            case "for-of-assignment":
            case "for-in-assignment":
              return mark<Statement>(
                {
                  ...node,
                  target: expression(node.target),
                  iterable: expression(node.iterable),
                  body: statement(node.body),
                },
                node,
              );
            case "for-in":
            case "for-of": {
              const loopBinding = node.binding;
              return mark<Statement>(
                {
                  ...node,
                  binding: variableBinding(loopBinding),
                  iterable: expression(node.iterable),
                  body: statement(node.body),
                },
                node,
              );
            }
            case "for":
              return mark<Statement>(
                {
                  ...node,
                  initializer:
                    node.initializer === undefined
                      ? undefined
                      : statement(node.initializer),
                  test:
                    node.test === undefined ? undefined : expression(node.test),
                  update:
                    node.update === undefined
                      ? undefined
                      : expression(node.update),
                  body: statement(node.body),
                },
                node,
              );
            case "return":
              return mark<Statement>(
                {
                  ...node,
                  expression:
                    node.expression === undefined
                      ? undefined
                      : expression(node.expression),
                },
                node,
              );
            case "throw":
            case "expression":
              return mark<Statement>(
                { ...node, expression: expression(node.expression) },
                node,
              );
            case "break":
            case "continue":
            case "debugger":
            case "empty":
              return mark<Statement>({ ...node }, node);
            case "export":
            case "import":
              return fail(source.id, node, "nested import is not supported");
          }
        } finally {
          depth--;
        }
      }
      for (const node of source.module.statements) {
        if (node === undefined) throw "missing module statement";
        if (
          node.kind !== "import" &&
          node.kind !== "export" &&
          (options?.evaluation !== "instance" ||
            evaluated.has(source.id) ||
            node.kind === "interface" ||
            node.kind === "type-alias")
        )
          statements.push(statement(node));
      }
    }
    return {
      ok: true,
      value: {
        ...(options?.evaluation === "instance"
          ? { evaluationOrder: evaluation.map((source) => source.id) }
          : {}),
        module: { statements, imports: [], start: 0, end: cursor },
        exports,
        origins,
        sourceNames,
        ranges,
      },
    };
  } catch (e) {
    if (e !== abort) throw e;
  }
  if (error === undefined) throw "link failure invariant";
  return { ok: false, error };
}
export {
  prepareNumericModule,
  type InitializedNumericModule,
  type InitializationResult,
} from "./initialization.ts";

export {
  specializeModule,
  type FunctionSpecialization,
  type SpecializationResult,
  type SpecializationCapability,
  type SpecializationOptions,
} from "./specialization.ts";

export {
  prepareModuleInstance,
  type ModuleInstance,
  type ModuleInstanceResult,
  type ModuleInstanceFallback,
  type ModuleInstanceExport,
} from "./instance.ts";
export {
  specializeCheckedRoots,
  reifyCheckedRoots,
  specializeReifiedRoots,
  type CheckedSpecializationRoot,
  type ReifiedSpecializationRoots,
} from "./checked-specialization.ts";
export {
  prepareModuleInvocation,
  type ModuleInvocation,
  type InvocationResult,
} from "./invocation.ts";
export {
  prepareNativeGlobals,
  type NativeConstructor,
  type NativeGlobalsResult,
} from "./native-globals.ts";
