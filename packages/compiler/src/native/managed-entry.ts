import {
  typeParameterCount,
  rewriteModule,
  type Module,
  type Statement,
  type TypeNode,
  type Expression,
  type PropertySignature,
} from "@tint/typescript/syntax";
import type { ManagedSurfaceTypeDescription } from "./managed-surfaces.ts";
export type ManagedSurfaceEntryAdaptation =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: {
        readonly module: Module;
        readonly entry: string;
        readonly frame: TypeNode;
        readonly view?: string;
      };
    };
/** Adapt explicit imports to an AOT helper table. Host-owned frames carry an
 * unknown table, checked by a compiler-bound record view before helper access.
 * The caller must bind and retain the returned view as an additional root, and
 * verify argument types against the checked host frame before native emission.
 * Factory entries scope supported module initialization inside each invocation;
 * ordinary runtime-compiled entries continue to reject it. */
export function adaptManagedSurfaceEntry(
  module: Module,
  entry: string,
  specifier: string | readonly string[],
  surface: ManagedSurfaceTypeDescription,
  options?: { readonly frame: string },
  initialization: "none" | "factory" = "none",
): ManagedSurfaceEntryAdaptation {
  const reject = (error: string): ManagedSurfaceEntryAdaptation => ({
    ok: false,
    error,
  });
  const selected = module.statements.find(
    (statement) =>
      statement !== undefined &&
      statement.kind === "function" &&
      statement.name === entry,
  );
  if (
    selected === undefined ||
    selected.kind !== "function" ||
    selected.returnType === undefined ||
    selected.async ||
    selected.generator ||
    selected.receiver !== undefined ||
    typeParameterCount(selected.typeParameters) !== 0
  )
    return reject(
      "managed entry requires a synchronous concrete annotated function",
    );
  const approved = new Set<string>();
  if (typeof specifier === "string") approved.add(specifier);
  else {
    for (const name of specifier) {
      if (name === undefined) return reject("missing managed entry specifier");
      approved.add(name);
    }
  }
  const requestedFrame = options?.frame;
  const hostFrame =
    requestedFrame === undefined
      ? undefined
      : surface.types.find(
          (type) => type !== undefined && type.name === requestedFrame,
        );
  if (options !== undefined && hostFrame === undefined)
    return reject("profile: entry parameter differs from surface frame");
  function resolveAlias(type: TypeNode | undefined): TypeNode | undefined {
    const seen = new Set<string>();
    while (type?.kind === "named" && !seen.has(type.name)) {
      const name = type.name;
      seen.add(name);
      const declaration = surface.declarations.find(
        (statement) =>
          statement !== undefined &&
          (statement.kind === "type-alias" || statement.kind === "interface") &&
          statement.name === name,
      );
      if (declaration?.kind === "type-alias") type = declaration.type;
      else if (declaration?.kind === "interface")
        return {
          start: 0,
          end: 0,
          kind: "object",
          properties: declaration.properties,
        };
      else break;
    }
    return type;
  }
  const frameShape = resolveAlias(hostFrame?.type);
  if (options !== undefined) {
    if (
      frameShape?.kind !== "object" ||
      frameShape.properties.length !== selected.parameters.length + 1
    )
      return reject("profile: entry parameter differs from surface frame");
    for (let index = 0; index < frameShape.properties.length; index++) {
      const property = frameShape.properties[index];
      if (
        property === undefined ||
        !property.readonly ||
        property.optional ||
        property.name !==
          (index === 0 ? "$imports" : "$argument" + String(index - 1))
      )
        return reject("profile: entry parameter differs from surface frame");
    }
    const importsType = resolveAlias(frameShape.properties[0]?.type);
    if (importsType?.kind !== "named" || importsType.name !== "unknown")
      return reject("profile: surface frame imports must be unknown");
  }
  const names = new Set<string>();
  const declarations: Statement[] = surface.declarations.map((statement) =>
      statement !== undefined &&
      options !== undefined &&
      (statement.kind === "type-alias" || statement.kind === "interface")
        ? { ...statement, exported: true }
        : statement,
    ),
    body: Statement[] = [];
  for (const statement of module.statements) {
    if (statement === undefined)
      return reject("missing managed entry statement");
    if (statement.kind === "import") continue;
    if (statement.kind === "interface" || statement.kind === "type-alias")
      declarations.push(statement);
    else if (statement.kind === "function")
      body.push({ ...statement, exported: false });
    else if (initialization === "factory" && statement.kind === "variable") {
      for (const binding of statement.declarations) {
        if (
          binding === undefined ||
          binding.kind === "object-binding" ||
          binding.kind === "array-binding" ||
          binding.initializer === undefined
        )
          return reject(
            "service initialization requires initialized named bindings",
          );
        names.add(binding.name);
      }
      body.push({ ...statement, exported: false });
      continue;
    } else if (
      initialization === "factory" &&
      (statement.kind === "expression" ||
        statement.kind === "empty" ||
        statement.kind === "debugger")
    ) {
      body.push(statement);
      continue;
    } else
      return reject("managed entry does not support module initialization");
    names.add(statement.name);
  }
  for (const declaration of module.imports) {
    if (declaration === undefined)
      return reject("missing managed entry import");
    for (const binding of declaration.bindings) {
      if (binding === undefined) return reject("missing managed entry binding");
      names.add(binding.local);
    }
  }
  for (const declaration of surface.declarations) {
    if (
      declaration === undefined ||
      (declaration.kind !== "type-alias" && declaration.kind !== "interface")
    )
      return reject("managed surface metadata requires type declarations");
    names.add(declaration.name);
  }
  let frameName = "$tint$managed$frame",
    entryName = "$tint$managed$entry",
    frameTypeName = "$tint$managed$Frame";
  while (names.has(frameName)) frameName += "$";
  while (names.has(entryName)) entryName += "$";
  while (names.has(frameTypeName)) frameTypeName += "$";
  let viewName = "$tint$managed$view",
    tableName = "$tint$managed$table";
  while (names.has(viewName)) viewName += "$";
  while (names.has(tableName)) tableName += "$";
  const identifier = (name: string): Expression => ({
    start: 0,
    end: 0,
    kind: "identifier",
    name,
  });
  const frameProperties: PropertySignature[] = [
    { start: 0, end: 0, name: "$imports", type: surface.table, readonly: true },
  ];
  const arguments_: Expression[] = [];
  function field(name: string): Expression {
    return {
      start: 0,
      end: 0,
      kind: "member",
      object: { start: 0, end: 0, kind: "identifier", name: frameName },
      property: name,
      optional: false,
    };
  }
  const imports: Statement[] = [];
  const importedNames = new Set<string>();
  const referenced = referencedValueNames(module);
  for (const declaration of module.imports) {
    if (
      declaration === undefined ||
      !approved.has(declaration.specifier) ||
      declaration.phase !== undefined ||
      (declaration.attributes?.length ?? 0) !== 0 ||
      declaration.bindings.length === 0
    )
      return reject(
        "managed entry requires named imports from its approved surface",
      );
    for (const binding of declaration.bindings) {
      if (
        binding === undefined ||
        binding.namespace ||
        importedNames.has(binding.local)
      )
        return reject("managed entry requires unique named imports");
      importedNames.add(binding.local);
      const type = surface.types.find(
        (type) => type !== undefined && type.name === binding.imported,
      );
      if (type !== undefined || declaration.typeOnly || binding.typeOnly) {
        if (type === undefined)
          return reject(
            "managed surface type export is missing: " + binding.imported,
          );
        declarations.push({
          start: 0,
          end: 0,
          kind: "type-alias",
          name: binding.local,
          exported: false,
          type: type.type,
        });
      } else {
        const helper = surface.entries.find(
          (helper) => helper !== undefined && helper.name === binding.imported,
        );
        if (helper === undefined)
          return reject(
            "managed surface helper is missing: " + binding.imported,
          );
        // Each binding becomes a guarded table read; skip helpers no
        // statement references (lowering imports a fixed vocabulary).
        if (referenced !== undefined && !referenced.has(binding.local))
          continue;
        imports.push({
          start: 0,
          end: 0,
          kind: "variable",
          mode: "const",
          exported: false,
          declarations: [
            {
              start: 0,
              end: 0,
              name: binding.local,
              type: helper.type,
              initializer: {
                start: 0,
                end: 0,
                kind: "member",
                object:
                  options === undefined
                    ? field("$imports")
                    : identifier(tableName),
                property: helper.name,
                optional: false,
              },
            },
          ],
        });
      }
    }
  }
  for (let index = 0; index < selected.parameters.length; index++) {
    const parameter = selected.parameters[index];
    if (
      parameter === undefined ||
      parameter.kind === "pattern-parameter" ||
      parameter.type === undefined ||
      parameter.optional ||
      parameter.rest ||
      parameter.initializer !== undefined
    )
      return reject("managed entry requires concrete required parameters");
    const name = "$argument" + String(index);
    frameProperties.push({
      start: 0,
      end: 0,
      name,
      type: parameter.type,
      readonly: true,
    });
    arguments_.push(field(name));
  }
  const frame: TypeNode = hostFrame?.type ?? {
    start: 0,
    end: 0,
    kind: "named",
    name: frameTypeName,
  };
  if (options === undefined)
    declarations.push({
      start: 0,
      end: 0,
      kind: "type-alias",
      name: frameTypeName,
      exported: false,
      type: { start: 0, end: 0, kind: "object", properties: frameProperties },
    });
  const entryBody: Statement[] = [];
  if (options !== undefined) {
    declarations.push({
      start: 0,
      end: 0,
      kind: "function",
      name: viewName,
      exported: false,
      parameters: [
        {
          start: 0,
          end: 0,
          name: "value",
          type: { start: 0, end: 0, kind: "named", name: "unknown" },
        },
      ],
      returnType: {
        start: 0,
        end: 0,
        kind: "union",
        members: [
          surface.table,
          { start: 0, end: 0, kind: "named", name: "undefined" },
        ],
      },
      body: {
        start: 0,
        end: 0,
        kind: "block",
        statements: [
          {
            start: 0,
            end: 0,
            kind: "throw",
            expression: {
              start: 0,
              end: 0,
              kind: "string",
              value: "UNBOUND_SURFACE_VIEW",
            },
          },
        ],
      },
    });
    entryBody.push(
      {
        start: 0,
        end: 0,
        kind: "variable",
        mode: "const",
        exported: false,
        declarations: [
          {
            start: 0,
            end: 0,
            name: tableName,
            type: undefined,
            initializer: {
              start: 0,
              end: 0,
              kind: "call",
              callee: identifier(viewName),
              arguments: [field("$imports")],
              typeArguments: [],
              optional: false,
            },
          },
        ],
      },
      {
        start: 0,
        end: 0,
        kind: "if",
        test: {
          start: 0,
          end: 0,
          kind: "binary",
          operator: "===",
          left: identifier(tableName),
          right: identifier("undefined"),
        },
        alternate: undefined,
        consequent: {
          start: 0,
          end: 0,
          kind: "throw",
          expression: {
            start: 0,
            end: 0,
            kind: "string",
            value: "MANAGED_SURFACE_TABLE",
          },
        },
      },
    );
  }
  for (const statement of imports) {
    if (statement === undefined) return reject("missing managed entry import");
    entryBody.push(statement);
  }
  for (const statement of body) {
    if (statement === undefined)
      return reject("missing managed entry function");
    entryBody.push(statement);
  }
  entryBody.push({
    start: 0,
    end: 0,
    kind: "return",
    expression: {
      start: 0,
      end: 0,
      kind: "call",
      callee: { start: 0, end: 0, kind: "identifier", name: entry },
      arguments: arguments_,
      typeArguments: [],
      optional: false,
    },
  });
  declarations.push({
    start: 0,
    end: 0,
    kind: "function",
    name: entryName,
    exported: true,
    parameters: [
      {
        start: 0,
        end: 0,
        name: frameName,
        type: frame,
        initializer: undefined,
      },
    ],
    returnType:
      options === undefined
        ? selected.returnType
        : { start: 0, end: 0, kind: "named", name: "unknown" },
    body: { start: 0, end: 0, kind: "block", statements: entryBody },
  });
  return {
    ok: true,
    value: {
      module: { ...module, imports: [], statements: declarations },
      entry: entryName,
      frame,
      ...(options === undefined ? {} : { view: viewName }),
    },
  };
}

/** Identifier names referenced by value syntax outside import declarations.
 * Type syntax cannot reference values. A same-named local only keeps an
 * import alive, never drops one; undefined keeps every import. */
function referencedValueNames(module: Module): Set<string> | undefined {
  const names = new Set<string>();
  const statements: Statement[] = [];
  for (const statement of module.statements)
    if (statement !== undefined && statement.kind !== "import")
      statements.push(statement);
  try {
    rewriteModule(
      { start: 0, end: 0, imports: [], statements },
      {
        expression: (mapped: Expression, _original: Expression): Expression => {
          if (mapped.kind === "identifier") names.add(mapped.name);
          return mapped;
        },
      },
    );
  } catch (caught) {
    if (typeof caught === "string") return undefined;
    throw caught;
  }
  return names;
}
