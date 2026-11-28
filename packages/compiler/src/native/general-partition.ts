import {
  describeDynamicBoundary,
  type DynamicBoundaryType,
} from "./dynamic-boundaries.ts";
import { nodeBuiltins } from "@tint/source/resolver";
import type { SourceModule } from "@tint/typescript/modules/model";
import {
  rewriteModule,
  typeParameterCount,
  typeOnlyDeclarations,
  type Expression,
  type Parameter,
  type Statement,
  type TypeNode,
} from "@tint/typescript/syntax";

/** Value classes a checked boundary accepts, as a bit set. `unknown`
 * accepts every value unchanged: typed `unknown` and general values share
 * one representation, so such values cross with their identity. */
export const boundaryNumber = 1,
  boundaryString = 2,
  boundaryBoolean = 4,
  boundaryUndefined = 8,
  boundaryNull = 16,
  boundaryUnknown = 32;

/** A typed export that general code may use through a checked boundary:
 * a function whose parameters and result are primitives or `unknown`, or a
 * constant of such a type. Arguments are checked against the declared types
 * on entry (an explicit cast; `unknown` accepts any value); results need no
 * conversion. */
export type BoundaryExport =
  | {
      readonly kind: "function";
      readonly name: string;
      readonly local: string;
      /** Accepted classes per parameter; optional parameters accept undefined.
       * A record parameter has no classes (0) and a record use. */
      readonly parameters: readonly number[];
      /** Present when a parameter or the result is a record type, which
       * crosses as a JavaScript view (see BoundaryRecord). */
      readonly records?: {
        readonly parameters: readonly (BoundaryRecordUse | undefined)[];
        readonly result: BoundaryRecordUse | undefined;
      };
    }
  | {
      readonly kind: "constant";
      readonly name: string;
      readonly local: string;
    };

/** A record type that crosses a checked boundary as a JavaScript view: an
 * exported interface whose fields are primitives, `unknown` or such records
 * (docs/unified-pipeline.md, the value bridge). */
export interface BoundaryRecord {
  /** The declaring module and interface name, joined by a NUL. */
  readonly key: string;
  readonly module: string;
  readonly name: string;
  readonly fields: readonly BoundaryField[];
}
export interface BoundaryField {
  readonly name: string;
  readonly readonly: boolean;
  /** Accepted value classes; 0 for a record field. */
  readonly classes: number;
  readonly record?: BoundaryRecordUse;
}
/** A record type use; optional uses also accept undefined. */
export interface BoundaryRecordUse {
  readonly key: string;
  readonly dynamic?: DynamicBoundaryType;
  readonly error?: "Error" | "TypeError" | "RangeError";
  readonly optional: boolean;
}

/** Resolves interface types used at a boundary to boundary records, across
 * the modules it can see; unsupported types resolve to undefined. */
export interface BoundaryRecords {
  readonly resolve: (
    module: SourceModule,
    type: TypeNode | undefined,
  ) => BoundaryRecordUse | undefined;
  readonly records: () => readonly BoundaryRecord[];
}
export function createBoundaryRecords(
  modules: ReadonlyMap<string, SourceModule>,
): BoundaryRecords {
  // Records by key, and their keys in resolution order.
  const table = new Map<string, BoundaryRecord>(),
    order: string[] = [],
    failed = new Set<string>();
  let dynamicSerial = 0;
  function declared(
    module: SourceModule,
    name: string,
    depth: number,
  ):
    | { readonly module: SourceModule; readonly statement: Statement }
    | undefined {
    if (depth > 16) return undefined;
    for (const statement of module.module.statements)
      if (
        statement !== undefined &&
        statement.kind === "interface" &&
        statement.name === name
      )
        return statement.exported ? { module, statement } : undefined;
    for (const declaration of module.module.imports) {
      if (declaration === undefined) throw "boundary import invariant";
      for (const binding of declaration.bindings) {
        if (
          binding === undefined ||
          binding.namespace ||
          binding.local !== name
        )
          continue;
        const target = module.dependencies.get(declaration.specifier);
        const source = target === undefined ? undefined : modules.get(target);
        return source === undefined
          ? undefined
          : declared(source, binding.imported, depth + 1);
      }
    }
    return undefined;
  }
  function resolve(
    module: SourceModule,
    type: TypeNode | undefined,
  ): BoundaryRecordUse | undefined {
    if (type === undefined) return undefined;
    const dynamic = describeDynamicBoundary(
      modules,
      module,
      type,
      "__tint_dynamic_boundary_" + String(dynamicSerial),
    );
    if (dynamic !== undefined) {
      dynamicSerial++;
      return { key: "", optional: false, dynamic };
    }
    if (type.kind === "group") return resolve(module, type.type);
    if (type.kind === "union") {
      let use: BoundaryRecordUse | undefined,
        optional = false;
      for (const member of type.members) {
        if (member === undefined) throw "boundary union invariant";
        if (primitiveClasses(member) === boundaryUndefined) {
          optional = true;
          continue;
        }
        if (use !== undefined) return undefined;
        use = resolve(module, member);
        if (use === undefined) return undefined;
      }
      if (use === undefined) return undefined;
      const error = use.error;
      return error === undefined
        ? { key: use.key, optional }
        : { key: use.key, optional, error };
    }
    if (type.kind !== "named") return undefined;
    if (type.arguments !== undefined && type.arguments.length !== 0)
      return undefined;
    const found = declared(module, type.name, 0);
    if (found === undefined) {
      const name = type.name;
      if (name !== "Error" && name !== "TypeError" && name !== "RangeError")
        return undefined;
      for (const statement of module.module.statements) {
        if (
          (statement?.kind === "interface" ||
            statement?.kind === "type-alias" ||
            statement?.kind === "class") &&
          statement.name === name
        )
          return undefined;
      }
      for (const declaration of module.module.imports) {
        if (declaration?.bindings.some((binding) => binding?.local === name))
          return undefined;
      }
      return { key: "", optional: false, error: name };
    }
    const statement = found.statement;
    if (statement.kind !== "interface") return undefined;
    const key = found.module.id + "\u0000" + statement.name;
    if (failed.has(key)) return undefined;
    if (table.has(key)) return { key, optional: false };
    if (
      statement.call !== undefined ||
      statement.construct !== undefined ||
      statement.indexSignature !== undefined ||
      typeParameterCount(statement.typeParameters) !== 0 ||
      (statement.bases?.length ?? 0) !== 0
    ) {
      failed.add(key);
      return undefined;
    }
    // Recursive uses see the record while its fields are resolved.
    const fields: BoundaryField[] = [];
    table.set(key, {
      key,
      module: found.module.id,
      name: statement.name,
      fields,
    });
    order.push(key);
    for (const property of statement.properties) {
      if (property === undefined) throw "boundary property invariant";
      const classes = primitiveClasses(property.type);
      const field: BoundaryField | undefined =
        property.method === true || property.computed === true
          ? undefined
          : classes !== 0
            ? {
                name: property.name,
                readonly: property.readonly,
                classes:
                  property.optional === true
                    ? classes | boundaryUndefined
                    : classes,
              }
            : recordField(found.module, property.name, property);
      if (field === undefined) {
        table.delete(key);
        failed.add(key);
        return undefined;
      }
      fields.push(field);
    }
    return { key, optional: false };
  }
  function recordField(
    module: SourceModule,
    name: string,
    property: {
      readonly type: TypeNode;
      readonly readonly: boolean;
      readonly optional?: boolean;
    },
  ): BoundaryField | undefined {
    const use = resolve(module, property.type);
    if (use === undefined || use.dynamic !== undefined) return undefined;
    return {
      name,
      readonly: property.readonly,
      classes: 0,
      record: {
        key: use.key,
        optional: use.optional || property.optional === true,
      },
    };
  }
  return {
    resolve,
    records: (): readonly BoundaryRecord[] => {
      const result: BoundaryRecord[] = [];
      for (const key of order) {
        if (key === undefined) throw "boundary record order invariant";
        const record = table.get(key);
        if (record !== undefined) result.push(record);
      }
      return result;
    },
  };
}

/** A typed module that general code imports, and the exports it uses. */
export interface TypedBoundaryModule {
  readonly id: string;
  readonly exports: readonly BoundaryExport[];
}

function primitiveClasses(type: TypeNode | undefined): number {
  if (type === undefined) return 0;
  switch (type.kind) {
    case "group":
      return primitiveClasses(type.type);
    case "named":
      if (type.arguments !== undefined && type.arguments.length !== 0) return 0;
      switch (type.name) {
        case "number":
          return boundaryNumber;
        case "string":
          return boundaryString;
        case "boolean":
          return boundaryBoolean;
        case "undefined":
        case "void":
          return boundaryUndefined;
        case "null":
          return boundaryNull;
        case "unknown":
          return boundaryUnknown;
        default:
          return 0;
      }
    case "literal":
      return 0;
    default:
      if (type.kind === "union") {
        let classes = 0;
        for (const member of type.members) {
          const next = primitiveClasses(member);
          if (next === 0) return 0;
          classes |= next;
        }
        return classes;
      }
      return 0;
  }
}

function parameterClasses(parameter: Parameter): number {
  if (parameter.kind === "pattern-parameter" || parameter.rest === true)
    return 0;
  const classes = primitiveClasses(parameter.type);
  if (classes === 0) return 0;
  return parameter.optional === true || parameter.initializer !== undefined
    ? classes | boundaryUndefined
    : classes;
}

/** The boundary form of a module export, or undefined when values of its
 * type cannot cross between general and typed code without conversion. */
export function boundaryExport(
  module: SourceModule,
  exported: string,
  records?: BoundaryRecords,
): BoundaryExport | undefined {
  let local = exported;
  for (const statement of module.module.statements) {
    if (statement === undefined || statement.kind !== "export") continue;
    const declaration = statement.declaration;
    if (declaration.source !== undefined || declaration.typeOnly) continue;
    for (const binding of declaration.bindings ?? [])
      if (
        binding !== undefined &&
        binding.exported === exported &&
        !binding.typeOnly
      )
        local = binding.local;
  }
  let found: Statement | undefined;
  for (const statement of module.module.statements) {
    if (statement === undefined) continue;
    if (
      (statement.kind === "function" || statement.kind === "variable") &&
      declares(statement, local)
    )
      found = statement;
  }
  if (found === undefined) return undefined;
  if (found.kind === "function") {
    if (found.async === true || found.generator === true) return undefined;
    if (typeParameterCount(found.typeParameters) !== 0) return undefined;
    const result = primitiveClasses(found.returnType);
    const resultRecord =
      result === 0 ? records?.resolve(module, found.returnType) : undefined;
    if (result === 0 && resultRecord === undefined) return undefined;
    const parameters: number[] = [],
      parameterRecords: (BoundaryRecordUse | undefined)[] = [];
    let recordUse = resultRecord !== undefined;
    for (const parameter of found.parameters) {
      if (parameter === undefined) throw "boundary parameter invariant";
      const classes = parameterClasses(parameter);
      let use: BoundaryRecordUse | undefined;
      if (
        classes === 0 &&
        records !== undefined &&
        parameter.kind !== "pattern-parameter" &&
        parameter.rest !== true
      ) {
        const resolved = records.resolve(module, parameter.type);
        use =
          resolved === undefined
            ? undefined
            : {
                ...resolved,
                optional:
                  resolved.optional ||
                  parameter.optional === true ||
                  parameter.initializer !== undefined,
              };
      }
      if (classes === 0 && use === undefined) return undefined;
      if (use !== undefined) recordUse = true;
      parameters.push(classes);
      parameterRecords.push(use);
    }
    return recordUse
      ? {
          kind: "function",
          name: exported,
          local,
          parameters,
          records: { parameters: parameterRecords, result: resultRecord },
        }
      : { kind: "function", name: exported, local, parameters };
  }
  if (found.kind === "variable" && found.mode === "const") {
    for (const declaration of found.declarations) {
      if (declaration === undefined || declaration.kind === "object-binding")
        continue;
      if (declaration.kind === "array-binding") continue;
      if (declaration.name !== local) continue;
      const initializer = declaration.initializer;
      const literal =
        initializer !== undefined &&
        (initializer.kind === "number" ||
          initializer.kind === "string" ||
          initializer.kind === "boolean");
      if (
        primitiveClasses(declaration.type) !== 0 ||
        literal ||
        records?.resolve(module, declaration.type)?.dynamic !== undefined ||
        records?.resolve(module, declaration.type)?.error !== undefined
      )
        return { kind: "constant", name: exported, local };
    }
  }
  return undefined;
}

function declares(statement: Statement, name: string): boolean {
  if (statement.kind === "function") return statement.name === name;
  if (statement.kind !== "variable") return false;
  for (const declaration of statement.declarations)
    if (
      declaration !== undefined &&
      declaration.kind !== "object-binding" &&
      declaration.kind !== "array-binding" &&
      declaration.name === name
    )
      return true;
  return false;
}

export interface GeneralPartition {
  /** Application modules compiled with general semantics. */
  readonly general: readonly SourceModule[];
  /** Typed modules general code imports, with their checked exports. */
  readonly boundaries: readonly TypedBoundaryModule[];
  /** A trusted module general code uses through exports that cannot cross a
   * checked boundary; trusted modules always stay typed. */
  readonly blocked?: { readonly module: string; readonly exports: string };
  /** Record types the boundaries' exports use (crossing as views). */
  readonly records?: readonly BoundaryRecord[];
}

function isPureLiteralExpression(expression: Expression): boolean {
  switch (expression.kind) {
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "bigint":
      return true;
    case "identifier":
      return expression.name === "undefined";
    case "unary":
      return (
        (expression.operator === "-" || expression.operator === "+") &&
        expression.operand.kind === "number"
      );
    case "group":
      return isPureLiteralExpression(expression.expression);
    default:
      return false;
  }
}

/** Closes a set of general modules: every importer of a general module is
 * general (typed code consumes only typed values), and a typed module whose
 * imported exports cannot cross a checked boundary — or whose top-level body
 * has observable evaluation effects — is general too. The remaining typed
 * modules keep full type-based compilation. */
export function closeGeneralPartition(
  application: readonly SourceModule[],
  seed: ReadonlySet<string>,
  /** Trusted runtime modules general code imports: typed boundaries only. */
  trusted: readonly SourceModule[] = [],
  typeSources: readonly SourceModule[] = [],
): GeneralPartition {
  const byId = new Map<string, SourceModule>();
  for (const module of application)
    if (module !== undefined) byId.set(module.id, module);
  const trustedIds = new Set<string>();
  for (const module of trusted)
    if (module !== undefined) {
      byId.set(module.id, module);
      trustedIds.add(module.id);
    }
  let blocked: { module: string; exports: string } | undefined = undefined;
  const typeModules = new Map<string, SourceModule>();
  for (const [name, module] of byId) typeModules.set(name, module);
  for (const module of typeSources)
    if (module !== undefined) typeModules.set(module.id, module);
  const records = createBoundaryRecords(typeModules);
  const observableCache = new Map<string, boolean>();
  const realmExports = new Map<string, readonly string[]>();
  for (const builtin of [nodeBuiltins.buffer, nodeBuiltins.ffi])
    if (trustedIds.has(builtin.source) && builtin.realmExports !== undefined)
      realmExports.set(builtin.source, builtin.realmExports);
  /** Whether evaluating a non-trusted module at program startup would have
   * observable top-level effects (e.g., side effects, throws, or non-literal
   * initializers) instead of being purely declarative. Such modules must stay
   * in the general module graph so ESM evaluation order and lazy dynamic
   * `import()` semantics are preserved. */
  function hasObservableTopLevel(
    module: SourceModule,
    visiting: Set<string>,
  ): boolean {
    if (trustedIds.has(module.id)) return false;
    const cached = observableCache.get(module.id);
    if (cached !== undefined) return cached;
    if (visiting.has(module.id)) return false;
    visiting.add(module.id);
    let observable = false;
    for (const statement of module.module.statements) {
      if (statement === undefined) continue;
      if (
        statement.kind === "interface" ||
        statement.kind === "type-alias" ||
        statement.kind === "function" ||
        statement.kind === "empty"
      )
        continue;
      if (statement.kind === "import") {
        if (statement.declaration.typeOnly) continue;
        const target = module.dependencies.get(statement.declaration.specifier);
        const dependency = target === undefined ? undefined : byId.get(target);
        if (
          dependency !== undefined &&
          hasObservableTopLevel(dependency, visiting)
        ) {
          observable = true;
          break;
        }
        continue;
      }
      if (statement.kind === "export") {
        const source = statement.declaration.source;
        if (source === undefined || source.typeOnly) continue;
        const target = module.dependencies.get(source.specifier);
        const dependency = target === undefined ? undefined : byId.get(target);
        if (
          dependency !== undefined &&
          hasObservableTopLevel(dependency, visiting)
        ) {
          observable = true;
          break;
        }
        continue;
      }
      if (statement.kind === "variable") {
        for (const declaration of statement.declarations) {
          if (declaration === undefined) continue;
          if (
            declaration.kind === "object-binding" ||
            declaration.kind === "array-binding"
          ) {
            observable = true;
            break;
          }
          const initializer = declaration.initializer;
          if (
            initializer !== undefined &&
            !isPureLiteralExpression(initializer)
          ) {
            observable = true;
            break;
          }
        }
        if (observable) break;
        continue;
      }
      observable = true;
      break;
    }
    visiting.delete(module.id);
    observableCache.set(module.id, observable);
    return observable;
  }
  const dynamicSpecifiers = new Map<string, readonly string[]>();
  function importCallSpecifiers(module: SourceModule): readonly string[] {
    const cached = dynamicSpecifiers.get(module.id);
    if (cached !== undefined) return cached;
    const found: string[] = [];
    rewriteModule(module.module, {
      expression: (mapped: Expression, original: Expression): Expression => {
        if (original.kind === "import-call") {
          const specifier = original.specifier;
          if (specifier.kind === "string") found.push(specifier.value);
        }
        return mapped;
      },
    });
    dynamicSpecifiers.set(module.id, found);
    return found;
  }
  const general = new Set<string>(seed);
  for (let changed = true; changed;) {
    changed = false;
    for (const module of application) {
      if (module === undefined || general.has(module.id)) continue;
      let importsGeneral = false;
      for (const declaration of module.module.imports) {
        if (declaration === undefined || declaration.typeOnly) continue;
        const target = module.dependencies.get(declaration.specifier);
        if (target !== undefined && general.has(target)) {
          importsGeneral = true;
          break;
        }
      }
      if (!importsGeneral)
        for (const statement of module.module.statements) {
          if (statement === undefined || statement.kind !== "export") continue;
          const source = statement.declaration.source;
          if (source === undefined || source.typeOnly) continue;
          const target = module.dependencies.get(source.specifier);
          if (target !== undefined && general.has(target)) {
            importsGeneral = true;
            break;
          }
        }
      if (importsGeneral) {
        general.add(module.id);
        changed = true;
      }
    }
    for (const module of application) {
      if (module === undefined || !general.has(module.id)) continue;
      for (const specifier of importCallSpecifiers(module)) {
        if (specifier === undefined) continue;
        const target = module.dependencies.get(specifier);
        if (
          target !== undefined &&
          !general.has(target) &&
          byId.has(target) &&
          !trustedIds.has(target)
        ) {
          general.add(target);
          changed = true;
        }
      }
      for (const statement of module.module.statements) {
        if (statement === undefined) continue;
        const declaration =
          statement.kind === "import"
            ? statement.declaration
            : statement.kind === "export"
              ? statement.declaration.source
              : undefined;
        if (declaration === undefined || declaration.typeOnly) continue;
        const target = module.dependencies.get(declaration.specifier);
        if (target === undefined || general.has(target)) continue;
        const typed = byId.get(target);
        if (typed === undefined) continue;
        const types = typeOnlyDeclarations(typed.module);
        let crossing = true;
        if (
          !trustedIds.has(target) &&
          ((statement.kind === "import" && declaration.bindings.length === 0) ||
            hasObservableTopLevel(typed, new Set<string>()))
        )
          crossing = false;
        if (statement.kind === "export") {
          const bindings = statement.declaration.bindings;
          if (bindings === undefined) crossing = realmExports.has(target);
          else
            for (const binding of bindings)
              if (
                binding !== undefined &&
                !binding.typeOnly &&
                !types.has(binding.local) &&
                (binding.namespace
                  ? !realmExports.has(target)
                  : boundaryExport(typed, binding.local, records) === undefined)
              )
                crossing = false;
        } else
          for (const binding of declaration.bindings)
            if (
              binding !== undefined &&
              !binding.typeOnly &&
              !types.has(binding.imported) &&
              (binding.namespace
                ? !realmExports.has(target)
                : boundaryExport(typed, binding.imported, records) ===
                  undefined)
            )
              crossing = false;
        if (!crossing) {
          if (trustedIds.has(target)) {
            if (blocked === undefined)
              blocked = { module: target, exports: crossingNames(statement) };
            continue;
          }
          general.add(target);
          changed = true;
        }
      }
    }
  }
  const generalModules: SourceModule[] = [];
  for (const module of application)
    if (module !== undefined && general.has(module.id))
      generalModules.push(module);
  const boundaries: TypedBoundaryModule[] = [];
  const used = new Map<string, BoundaryExport[]>();
  function retainBoundary(typed: SourceModule, names: readonly string[]): void {
    const target = typed.id;
    let exports = used.get(target);
    if (exports === undefined) {
      exports = [];
      used.set(target, exports);
      boundaries.push({ id: target, exports });
    }
    for (const name of names) {
      if (name === undefined) continue;
      const boundary = boundaryExport(typed, name, records);
      if (
        boundary !== undefined &&
        !exports.some((item) => item !== undefined && item.name === name)
      )
        exports.push(boundary);
    }
  }
  for (const module of generalModules) {
    if (module === undefined) throw "general partition invariant";
    for (const specifier of importCallSpecifiers(module)) {
      const target = module.dependencies.get(specifier);
      if (target === undefined) continue;
      const typed = byId.get(target);
      const names = realmExports.get(target);
      if (typed !== undefined && names !== undefined)
        retainBoundary(typed, names);
    }
    for (const statement of module.module.statements) {
      if (statement === undefined) continue;
      const declaration =
        statement.kind === "import"
          ? statement.declaration
          : statement.kind === "export"
            ? statement.declaration.source
            : undefined;
      if (declaration === undefined || declaration.typeOnly) continue;
      const target = module.dependencies.get(declaration.specifier);
      if (target === undefined || general.has(target)) continue;
      const typed = byId.get(target);
      if (typed === undefined) continue;
      if (statement.kind === "export") {
        const bindings = statement.declaration.bindings;
        if (
          bindings === undefined ||
          bindings.some((binding) => binding?.namespace === true)
        ) {
          retainBoundary(typed, realmExports.get(target) ?? []);
          continue;
        }
      } else if (
        declaration.bindings.some((binding) => binding?.namespace === true)
      ) {
        retainBoundary(typed, realmExports.get(target) ?? []);
        continue;
      }
      const names: string[] = [];
      if (statement.kind === "export")
        for (const binding of statement.declaration.bindings ?? []) {
          if (binding !== undefined && !binding.typeOnly)
            names.push(binding.local);
        }
      else
        for (const binding of declaration.bindings)
          if (binding !== undefined && !binding.typeOnly)
            names.push(binding.imported);
      retainBoundary(typed, names);
    }
  }
  // Eligibility checks can resolve a return record before discovering an
  // unsupported parameter. Only publish records reachable from exports that
  // actually cross the boundary.
  const resolved = records.records();
  const required = new Set<string>();
  const pending: string[] = [];
  function retainRecord(use: BoundaryRecordUse | undefined): void {
    if (use === undefined || use.key === "" || required.has(use.key)) return;
    required.add(use.key);
    pending.push(use.key);
  }
  for (const boundary of boundaries) {
    if (boundary === undefined) continue;
    for (const item of boundary.exports) {
      if (
        item === undefined ||
        item.kind !== "function" ||
        item.records === undefined
      )
        continue;
      retainRecord(item.records.result);
      for (const parameter of item.records.parameters) retainRecord(parameter);
    }
  }
  const recordByKey = new Map<string, BoundaryRecord>();
  for (const record of resolved)
    if (record !== undefined) recordByKey.set(record.key, record);
  for (let index = 0; index < pending.length; index++) {
    const key = pending[index];
    if (key === undefined) continue;
    for (const field of recordByKey.get(key)?.fields ?? [])
      retainRecord(field?.record);
  }
  const crossing = resolved.filter(
    (record) => record !== undefined && required.has(record.key),
  );
  const result: GeneralPartition =
    crossing.length === 0
      ? { general: generalModules, boundaries }
      : { general: generalModules, boundaries, records: crossing };
  return blocked === undefined ? result : { ...result, blocked };
}

/** The value names an import or re-export statement uses, for diagnostics. */
function crossingNames(statement: Statement): string {
  const names: string[] = [];
  if (statement.kind === "export")
    for (const binding of statement.declaration.bindings ?? []) {
      if (binding !== undefined && !binding.typeOnly) names.push(binding.local);
    }
  else if (statement.kind === "import")
    for (const binding of statement.declaration.bindings)
      if (binding !== undefined && !binding.typeOnly)
        names.push(
          binding.namespace ? "* as " + binding.local : binding.imported,
        );
  return names.join(", ");
}
