import type { SourceModule } from "@tint/typescript/modules/model";
import type {
  ClassDefinition,
  ExportBinding,
  Expression,
  ImportDeclaration,
  Statement,
} from "@tint/typescript/syntax";

/** Modules a program never needs to instantiate.
 *
 * A module reached only through re-exports (`export {a} from "./m"`,
 * `export * from "./m"`) whose re-exported names nothing uses need not be
 * evaluated when evaluating its own body is unobservable: the body only
 * declares functions, classes and variables with effect-free initializers.
 * Modules in its import graph whose bodies are observable still run, in
 * the order they would have: the skipped re-export is replaced by
 * side-effect imports of them, in the original depth-first evaluation
 * order. Skipping is the as-if rule applied to module evaluation; it keeps
 * a barrel module (a framework entrypoint re-exporting many implementation
 * modules) from pulling every implementation into an image.
 *
 * Imports always keep their target, including type-only imports (the
 * checker needs the declarations), so only re-export edges are pruned. */
export function pruneUnusedModules(
  modules: readonly SourceModule[],
  entry: string,
  /** Modules the entry imports for their effects whose callers use only
   * these exports (runtimes with retained exports); other modules the
   * entry imports are used entirely. */
  rootExports: ReadonlyMap<string, readonly string[]> = new Map<
    string,
    readonly string[]
  >(),
): readonly SourceModule[] {
  const byId = new Map<string, SourceModule>();
  for (const module of modules) {
    if (module === undefined) throw "module pruning invariant";
    byId.set(module.id, module);
  }

  // Import-graph components: a module outside the importer's component is
  // evaluated before it, so its exported constants are initialized when the
  // importer's body runs (no TDZ).
  const component = new Map<string, number>();
  {
    const index = new Map<string, number>(),
      low = new Map<string, number>(),
      stack: string[] = [],
      onStack = new Set<string>();
    let next = 0,
      components = 0;
    function connect(id: string): void {
      index.set(id, next);
      low.set(id, next);
      next++;
      stack.push(id);
      onStack.add(id);
      const module = byId.get(id);
      if (module !== undefined)
        for (const declaration of module.module.imports) {
          if (declaration === undefined) throw "module pruning invariant";
          const target = module.dependencies.get(declaration.specifier);
          if (target === undefined || !byId.has(target)) continue;
          if (!index.has(target)) {
            connect(target);
            low.set(id, Math.min(low.get(id) ?? 0, low.get(target) ?? 0));
          } else if (onStack.has(target))
            low.set(id, Math.min(low.get(id) ?? 0, index.get(target) ?? 0));
        }
      if (low.get(id) === index.get(id)) {
        for (;;) {
          const member = stack.pop();
          if (member === undefined) throw "module pruning invariant";
          onStack.delete(member);
          component.set(member, components);
          if (member === id) break;
        }
        components++;
      }
    }
    for (const module of modules)
      if (module !== undefined && !index.has(module.id)) connect(module.id);
  }
  /** Local names of imports bound to primitive constants of modules
   * evaluated earlier. */
  function importedPrimitives(module: SourceModule): Set<string> {
    const names = new Set<string>();
    for (const declaration of module.module.imports) {
      if (declaration === undefined) throw "module pruning invariant";
      const target = module.dependencies.get(declaration.specifier);
      if (target === undefined) continue;
      if (component.get(target) === component.get(module.id)) continue;
      const exported = exportedPrimitives(target);
      for (const binding of declaration.bindings)
        if (
          binding !== undefined &&
          !binding.namespace &&
          exported.has(binding.imported)
        )
          names.add(binding.local);
    }
    return names;
  }
  const primitiveCache = new Map<string, Set<string>>();
  /** Exported names bound to primitive constants. Component order makes
   * the recursion well-founded: only earlier components are consulted. */
  function exportedPrimitives(id: string): Set<string> {
    const known = primitiveCache.get(id);
    if (known !== undefined) return known;
    const exported = new Set<string>();
    primitiveCache.set(id, exported);
    const module = byId.get(id);
    if (module === undefined) return exported;
    const locals = new Set<string>();
    if (!pureBody(module.module.statements, importedPrimitives(module), locals))
      return exported;
    for (const statement of module.module.statements) {
      if (statement === undefined) throw "module pruning invariant";
      if (statement.kind === "variable" && statement.exported) {
        for (const declaration of statement.declarations)
          if (
            declaration !== undefined &&
            declaration.kind !== "object-binding" &&
            declaration.kind !== "array-binding" &&
            locals.has(declaration.name)
          )
            exported.add(declaration.name);
      } else if (statement.kind === "export") {
        const bindings = statement.declaration.bindings;
        if (bindings === undefined) continue;
        const source = statement.declaration.source;
        const target =
          source === undefined
            ? undefined
            : module.dependencies.get(source.specifier);
        for (const binding of bindings) {
          if (binding === undefined || binding.namespace) continue;
          if (source === undefined) {
            if (locals.has(binding.local)) exported.add(binding.exported);
          } else if (
            target !== undefined &&
            component.get(target) !== component.get(id) &&
            exportedPrimitives(target).has(binding.local)
          )
            exported.add(binding.exported);
        }
      }
    }
    return exported;
  }
  const purity = new Map<string, boolean>();
  /** Whether evaluating the module's own body (not its imports) is
   * unobservable. */
  function bodyPure(id: string): boolean {
    const known = purity.get(id);
    if (known !== undefined) return known;
    const module = byId.get(id);
    const result =
      module !== undefined &&
      pureBody(module.module.statements, importedPrimitives(module));
    purity.set(id, result);
    return result;
  }
  const effectCache = new Map<string, readonly string[]>();
  /** Modules with observable bodies that evaluating `id` evaluates, in
   * depth-first post-order (module evaluation order). */
  function effects(id: string): readonly string[] {
    const known = effectCache.get(id);
    if (known !== undefined) return known;
    const order: string[] = [],
      visited = new Set<string>();
    function visit(current: string): void {
      if (visited.has(current)) return;
      visited.add(current);
      const module = byId.get(current);
      if (module === undefined) return;
      for (const declaration of module.module.imports) {
        if (declaration === undefined) throw "module pruning invariant";
        const target = module.dependencies.get(declaration.specifier);
        if (target !== undefined) visit(target);
      }
      if (!bodyPure(current)) order.push(current);
    }
    visit(id);
    effectCache.set(id, order);
    return order;
  }
  const exportNameCache = new Map<string, Set<string>>();
  function exportNames(id: string): Set<string> {
    const known = exportNameCache.get(id);
    if (known !== undefined) return known;
    const names = new Set<string>();
    exportNameCache.set(id, names);
    const module = byId.get(id);
    if (module === undefined) return names;
    for (const statement of module.module.statements) {
      if (statement === undefined) throw "module pruning invariant";
      switch (statement.kind) {
        case "function":
        case "class":
        case "interface":
        case "type-alias":
          if (statement.exported) names.add(statement.name);
          break;
        case "variable":
          if (statement.exported)
            for (const declaration of statement.declarations)
              if (
                declaration !== undefined &&
                declaration.kind !== "object-binding" &&
                declaration.kind !== "array-binding"
              )
                names.add(declaration.name);
          break;
        case "export-default":
          names.add("default");
          break;
        case "export": {
          const bindings = statement.declaration.bindings;
          const source = statement.declaration.source;
          if (bindings === undefined) {
            const target =
              source === undefined
                ? undefined
                : module.dependencies.get(source.specifier);
            if (target !== undefined)
              for (const name of exportNames(target))
                if (name !== "default") names.add(name);
          } else
            for (const binding of bindings)
              if (binding !== undefined) names.add(binding.exported);
          break;
        }
        default:
          break;
      }
    }
    return names;
  }

  const typeNameCache = new Map<string, Set<string>>();
  /** Exported names in the type namespace (interfaces, type aliases and
   * their re-exports). */
  function typeExportNames(id: string): Set<string> {
    const known = typeNameCache.get(id);
    if (known !== undefined) return known;
    const names = new Set<string>();
    typeNameCache.set(id, names);
    const module = byId.get(id);
    if (module === undefined) return names;
    const local = new Set<string>();
    for (const statement of module.module.statements) {
      if (statement === undefined) throw "module pruning invariant";
      if (statement.kind === "interface" || statement.kind === "type-alias") {
        local.add(statement.name);
        if (statement.exported) names.add(statement.name);
      }
    }
    for (const statement of module.module.statements) {
      if (statement === undefined) throw "module pruning invariant";
      if (statement.kind !== "export") continue;
      const bindings = statement.declaration.bindings;
      const source = statement.declaration.source;
      const target =
        source === undefined
          ? undefined
          : module.dependencies.get(source.specifier);
      if (bindings === undefined) {
        if (target !== undefined)
          for (const name of typeExportNames(target)) names.add(name);
        continue;
      }
      for (const binding of bindings) {
        if (binding === undefined || binding.namespace) continue;
        if (
          target === undefined
            ? local.has(binding.local)
            : typeExportNames(target).has(binding.local)
        )
          names.add(binding.exported);
      }
    }
    return names;
  }
  /** The linker requires evaluation of modules declaring classes. */
  function declaresClass(id: string): boolean {
    const module = byId.get(id);
    if (module === undefined) return false;
    for (const statement of module.module.statements)
      if (statement !== undefined && statement.kind === "class") return true;
    return false;
  }

  // Retained modules are needed as values (their re-exports are kept and
  // the linker may evaluate them), with the export names they must provide;
  // a module is requeued when its set grows, so its re-exports forward the
  // new names. Linked modules are reached only through type-only edges
  // (including the type-only re-exports this pass creates): the linker
  // links them without evaluating them, so their own imports must still
  // resolve, and they are processed like retained modules.
  const all = "*all*",
    none: readonly string[] = [];
  const used = new Map<string, Set<string>>(),
    retained = new Set<string>(),
    processed = new Set<string>(),
    queue: string[] = [];
  function link(id: string): void {
    if (processed.has(id)) return;
    processed.add(id);
    queue.push(id);
  }
  function retain(id: string, names: readonly string[]): void {
    const existing = used.get(id);
    const fresh = existing === undefined;
    const set = existing ?? new Set<string>();
    if (fresh) used.set(id, set);
    let grew = false;
    for (const name of names)
      if (name !== undefined && !set.has(name)) {
        set.add(name);
        grew = true;
      }
    if (fresh || grew) {
      retained.add(id);
      processed.add(id);
      queue.push(id);
    }
  }
  retain(entry, [all]);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (id === undefined) throw "module pruning invariant";
    const module = byId.get(id);
    if (module === undefined) continue;
    const names = used.get(id) ?? new Set<string>();
    const everything = names.has(all);
    for (const statement of module.module.statements) {
      if (statement === undefined) throw "module pruning invariant";
      if (statement.kind === "import") {
        const declaration = statement.declaration;
        const target = module.dependencies.get(declaration.specifier);
        if (target === undefined) continue;
        // A type-only import is linked but not evaluated.
        if (declaration.typeOnly) {
          link(target);
          continue;
        }
        if (declaration.bindings.length === 0) {
          // A side-effect import evaluates its target and uses no export;
          // the entry's imports are the program's roots.
          retain(
            target,
            id !== entry ? none : (rootExports.get(target) ?? [all]),
          );
          continue;
        }
        const imported: string[] = [];
        let namespace = false;
        for (const binding of declaration.bindings) {
          if (binding === undefined) throw "module pruning invariant";
          if (binding.typeOnly) continue;
          if (binding.namespace) namespace = true;
          else imported.push(binding.imported);
        }
        retain(target, namespace ? [all] : imported);
        continue;
      }
      if (statement.kind !== "export") continue;
      const source = statement.declaration.source;
      if (source === undefined) continue;
      const target = module.dependencies.get(source.specifier);
      if (target === undefined) continue;
      if (source.typeOnly || statement.declaration.typeOnly) {
        link(target);
        continue;
      }
      const bindings = statement.declaration.bindings;
      const forwarded: string[] = [];
      let namespace = false;
      if (bindings === undefined) {
        if (everything) namespace = true;
        else {
          const provided = exportNames(target);
          for (const name of names)
            if (name !== "default" && provided.has(name)) forwarded.push(name);
        }
      } else
        for (const binding of bindings) {
          if (binding === undefined) throw "module pruning invariant";
          if (binding.typeOnly) continue;
          if (!everything && !names.has(binding.exported)) continue;
          if (binding.namespace) namespace = true;
          else forwarded.push(binding.local);
        }
      if (namespace) retain(target, [all]);
      else if (forwarded.length !== 0) retain(target, forwarded);
      else if (!retained.has(target))
        if (declaresClass(target)) retain(target, none);
        else {
          for (const effect of effects(target)) {
            if (effect === undefined) throw "module pruning invariant";
            retain(effect, none);
          }
          // The rewrite keeps its type names as a type-only re-export.
          if (typeExportNames(target).size !== 0) link(target);
        }
    }
  }

  // Re-exports of skipped modules become side-effect imports of the
  // observable modules they would have evaluated, in evaluation order.
  const result: SourceModule[] = [];
  for (const module of modules) {
    if (module === undefined) throw "module pruning invariant";
    if (!processed.has(module.id)) {
      result.push(module);
      continue;
    }
    // Each removed re-export source maps to the declarations replacing it,
    // which take its place in import (evaluation) order.
    const replaced = new Map<ImportDeclaration, ImportDeclaration[]>(),
      statements: Statement[] = [],
      dependencies = new Map<string, string>();
    for (const [specifier, target] of module.dependencies)
      dependencies.set(specifier, target);
    // Names a star re-export may forward as types: unique among the
    // module's star targets and not declared or re-exported explicitly.
    const explicit = new Set<string>(),
      starCounts = new Map<string, number>();
    for (const statement of module.module.statements) {
      if (statement === undefined) throw "module pruning invariant";
      if (
        statement.kind === "interface" ||
        statement.kind === "type-alias" ||
        statement.kind === "function" ||
        statement.kind === "class"
      )
        explicit.add(statement.name);
      if (statement.kind !== "export") continue;
      const bindings = statement.declaration.bindings;
      if (bindings !== undefined) {
        for (const binding of bindings)
          if (binding !== undefined) explicit.add(binding.exported);
        continue;
      }
      const source = statement.declaration.source;
      const target =
        source === undefined
          ? undefined
          : module.dependencies.get(source.specifier);
      if (target !== undefined)
        for (const name of typeExportNames(target))
          starCounts.set(name, (starCounts.get(name) ?? 0) + 1);
    }
    for (const statement of module.module.statements) {
      if (statement === undefined) throw "module pruning invariant";
      if (statement.kind !== "export") {
        statements.push(statement);
        continue;
      }
      const declaration = statement.declaration;
      const source = declaration.source;
      const target =
        source === undefined
          ? undefined
          : module.dependencies.get(source.specifier);
      if (
        source === undefined ||
        target === undefined ||
        source.typeOnly ||
        declaration.typeOnly ||
        retained.has(target)
      ) {
        statements.push(statement);
        continue;
      }
      const added: ImportDeclaration[] = [];
      replaced.set(source, added);
      for (const effect of effects(target)) {
        if (effect === undefined) throw "module pruning invariant";
        // A reserved specifier cannot collide with a source specifier.
        const specifier = "\u0000effect:" + effect;
        dependencies.set(specifier, effect);
        const effectImport: ImportDeclaration = {
          specifier,
          specifierSpan: { start: statement.start, end: statement.start },
          typeOnly: false,
          bindings: [],
          start: statement.start,
          end: statement.start,
        };
        added.push(effectImport);
        statements.push({
          kind: "import",
          declaration: effectImport,
          start: statement.start,
          end: statement.start,
        });
      }
      // Type names stay resolvable through a type-only re-export, which
      // the linker links without evaluating the target.
      const types = typeExportNames(target);
      const bindings: ExportBinding[] = [];
      if (declaration.bindings === undefined) {
        for (const name of types)
          if (
            name !== "default" &&
            !explicit.has(name) &&
            starCounts.get(name) === 1
          )
            bindings.push({
              namespace: false,
              local: name,
              exported: name,
              typeOnly: true,
            });
      } else
        for (const binding of declaration.bindings)
          if (
            binding !== undefined &&
            !binding.namespace &&
            types.has(binding.local)
          )
            bindings.push({ ...binding, typeOnly: true });
      if (bindings.length === 0) continue;
      const typeSource: ImportDeclaration = { ...source, typeOnly: true };
      added.push(typeSource);
      statements.push({
        ...statement,
        declaration: {
          ...declaration,
          bindings,
          source: typeSource,
          typeOnly: true,
        },
      });
    }
    if (replaced.size === 0) {
      result.push(module);
      continue;
    }
    const imports: ImportDeclaration[] = [];
    for (const declaration of module.module.imports) {
      if (declaration === undefined) throw "module pruning invariant";
      const replacement = replaced.get(declaration);
      if (replacement === undefined) imports.push(declaration);
      else
        for (const item of replacement) {
          if (item === undefined) throw "module pruning invariant";
          imports.push(item);
        }
    }
    result.push({
      ...module,
      module: { ...module.module, statements, imports },
      dependencies,
    });
  }
  return result;
}

const effectFreeGlobals = new Set(["undefined", "NaN", "Infinity"]);
const emptyCollections = new Set(["Map", "Set", "WeakMap", "WeakSet"]);
const typedArrays = new Set([
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Float16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
]);

/** Whether evaluating a module body (excluding its imports) is unobservable:
 * it can neither throw nor have an effect, so skipping it is invisible when
 * none of its bindings are used. */
function pureBody(
  statements: readonly Statement[],
  importedPrimitives: ReadonlySet<string>,
  primitive: Set<string> = new Set<string>(),
): boolean {
  // Names a global constructor test must not see shadowed: every top-level
  // declaration and import binding.
  const shadowing = new Set<string>();
  // Bindings an initializer may read: hoisted functions, and classes and
  // variables once declared (an earlier read would be a TDZ error).
  const readable = new Set<string>(importedPrimitives);
  // `const` bindings whose initializers are primitive literal arithmetic
  // (and imported ones, see importedPrimitives): reading them yields a
  // primitive, so arithmetic over them cannot call user code.
  for (const name of importedPrimitives) primitive.add(name);
  for (const statement of statements) {
    if (statement === undefined) throw "module pruning invariant";
    if (statement.kind === "function") {
      shadowing.add(statement.name);
      readable.add(statement.name);
    } else if (statement.kind === "class") shadowing.add(statement.name);
    else if (statement.kind === "variable")
      for (const declaration of statement.declarations) {
        if (declaration === undefined) throw "module pruning invariant";
        if (
          declaration.kind !== "object-binding" &&
          declaration.kind !== "array-binding"
        )
          shadowing.add(declaration.name);
      }
    else if (statement.kind === "import")
      for (const binding of statement.declaration.bindings)
        if (binding !== undefined) shadowing.add(binding.local);
  }
  function literal(expression: Expression): boolean {
    switch (expression.kind) {
      case "number":
      case "string":
      case "boolean":
      case "null":
        return true;
      case "identifier":
        return primitive.has(expression.name);
      case "group":
        return literal(expression.expression);
      case "unary":
        return (
          (expression.operator === "-" ||
            expression.operator === "+" ||
            expression.operator === "!" ||
            expression.operator === "~" ||
            expression.operator === "typeof") &&
          literal(expression.operand)
        );
      case "binary":
        return (
          expression.operator !== "in" &&
          expression.operator !== "instanceof" &&
          literal(expression.left) &&
          literal(expression.right)
        );
      default:
        return false;
    }
  }
  function global(name: string): boolean {
    return !shadowing.has(name);
  }
  function smallLength(expression: Expression): boolean {
    return (
      expression.kind === "number" &&
      Number.isInteger(expression.value) &&
      expression.value >= 0 &&
      expression.value <= 1048576
    );
  }
  function numericArray(expression: Expression): boolean {
    if (expression.kind !== "array") return false;
    for (const element of expression.elements) {
      if (element === undefined) throw "module pruning invariant";
      if (!literal(element)) return false;
    }
    return true;
  }
  function pureClass(definition: ClassDefinition): boolean {
    if (
      definition.decorators !== undefined &&
      definition.decorators.length !== 0
    )
      return false;
    const heritage = definition.heritage;
    if (
      heritage !== undefined &&
      !(heritage.kind === "identifier" && readable.has(heritage.name))
    )
      return false;
    for (const element of definition.elements) {
      if (element === undefined) throw "module pruning invariant";
      if (element.kind === "static-block") return false;
      if (element.decorators !== undefined && element.decorators.length !== 0)
        return false;
      if (element.computed && !literal(element.key)) return false;
      if (
        element.kind === "field" &&
        element.static &&
        element.initializer !== undefined &&
        !pureExpression(element.initializer)
      )
        return false;
    }
    return true;
  }
  function pureExpression(expression: Expression): boolean {
    switch (expression.kind) {
      case "number":
      case "bigint":
      case "string":
      case "boolean":
      case "null":
      case "regexp":
      case "arrow":
      case "function-expression":
        return true;
      case "template-expression":
        for (const substitution of expression.substitutions) {
          if (substitution === undefined) throw "module pruning invariant";
          if (!literal(substitution)) return false;
        }
        return true;
      case "identifier":
        return (
          readable.has(expression.name) ||
          (effectFreeGlobals.has(expression.name) && global(expression.name))
        );
      case "class-expression":
        return pureClass(expression.definition);
      case "array":
        for (const element of expression.elements) {
          if (element === undefined) throw "module pruning invariant";
          if (element.kind === "spread") return false;
          if (element.kind !== "elision" && !pureExpression(element))
            return false;
        }
        return true;
      case "object":
        for (const property of expression.properties) {
          if (property === undefined) throw "module pruning invariant";
          if (property.kind === "spread") return false;
          if (
            property.keyExpression !== undefined &&
            !literal(property.keyExpression)
          )
            return false;
          if (!pureExpression(property.value)) return false;
        }
        return true;
      case "group":
      case "satisfies":
        return pureExpression(expression.expression);
      case "unary":
      case "binary":
        return literal(expression);
      case "conditional":
        return (
          pureExpression(expression.test) &&
          pureExpression(expression.consequent) &&
          pureExpression(expression.alternate)
        );
      case "new": {
        const callee = expression.callee;
        if (callee.kind !== "identifier" || !global(callee.name)) return false;
        const args = expression.arguments;
        if (emptyCollections.has(callee.name)) return args.length === 0;
        if (!typedArrays.has(callee.name)) return false;
        if (args.length === 0) return true;
        const first = args[0];
        return (
          args.length === 1 &&
          first !== undefined &&
          (smallLength(first) || numericArray(first))
        );
      }
      default:
        return false;
    }
  }
  for (const statement of statements) {
    if (statement === undefined) throw "module pruning invariant";
    switch (statement.kind) {
      case "import":
      case "export":
      case "interface":
      case "type-alias":
      case "function":
      case "empty":
        break;
      case "class":
        if (!pureClass(statement.definition)) return false;
        readable.add(statement.name);
        break;
      case "variable":
        for (const declaration of statement.declarations) {
          if (declaration === undefined) throw "module pruning invariant";
          if (
            declaration.kind === "object-binding" ||
            declaration.kind === "array-binding"
          )
            return false;
          const initializer = declaration.initializer;
          if (initializer !== undefined && !pureExpression(initializer))
            return false;
          readable.add(declaration.name);
          if (
            statement.mode === "const" &&
            initializer !== undefined &&
            literal(initializer)
          )
            primitive.add(declaration.name);
        }
        break;
      case "export-default":
        if (!pureExpression(statement.value)) return false;
        break;
      case "expression":
        // Directive prologues ("use strict").
        if (statement.expression.kind !== "string") return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

/** The modules reachable from `roots` through imports (value and type-only),
 * in discovery order: what a link rooted there reads. */
export function reachableModules(
  modules: readonly SourceModule[],
  roots: readonly string[],
): SourceModule[] {
  const byId = new Map<string, SourceModule>();
  for (const module of modules) {
    if (module === undefined) throw "module reachability invariant";
    byId.set(module.id, module);
  }
  const seen = new Set<string>(),
    result: SourceModule[] = [];
  function visit(id: string): void {
    if (seen.has(id)) return;
    seen.add(id);
    const module = byId.get(id);
    if (module !== undefined) result.push(module);
  }
  for (const root of roots) {
    if (root === undefined) throw "module reachability root invariant";
    visit(root);
  }
  for (let index = 0; index < result.length; index++) {
    const module = result[index];
    if (module === undefined) throw "module reachability order invariant";
    for (const declaration of module.module.imports) {
      if (declaration === undefined) throw "module reachability invariant";
      const target = module.dependencies.get(declaration.specifier);
      if (target !== undefined) visit(target);
    }
  }
  return result;
}
