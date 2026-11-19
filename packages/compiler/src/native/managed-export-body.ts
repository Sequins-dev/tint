import { typeParameterCount } from "@tint/typescript/syntax";
import type { RuntimeEntryStub } from "./managed-runtime-entries.ts";
import type {
  Module,
  Statement,
  Expression,
  ObjectProperty,
  TypeNode,
  BlockStatement,
} from "@tint/typescript/syntax";
import type { SerializedManagedSurfaceDirectory } from "./managed-directory-data.ts";
import { generatedIdentifier } from "./managed-surfaces.ts";
function identifier(name: string): Expression {
  return { kind: "identifier", name, start: 0, end: 0 };
}
function text(value: string): Expression {
  return { kind: "string", value, start: 0, end: 0 };
}
function number(value: number): Expression {
  return { kind: "number", value, raw: String(value), start: 0, end: 0 };
}
function array(elements: readonly Expression[]): Expression {
  return { kind: "array", elements, start: 0, end: 0 };
}
function object(
  fields: readonly { readonly name: string; readonly value: Expression }[],
): Expression {
  const properties: ObjectProperty[] = fields.map((field) => ({
    ...field,
    shorthand: false,
    start: 0,
    end: 0,
  }));
  return { kind: "object", properties, start: 0, end: 0 };
}
function call(name: string): Expression {
  return {
    kind: "call",
    callee: identifier(name),
    typeArguments: [],
    arguments: [],
    start: 0,
    end: 0,
  };
}
function field(
  name: string,
  value: Expression,
): { readonly name: string; readonly value: Expression } {
  return { name, value };
}
/** Typed syntax, not JSON parsing: all data remains UTF-16 and normal checking
 * validates each nested field against the export's declared directory type. */
function directoryLiteral(
  directory: SerializedManagedSurfaceDirectory,
): Expression {
  const frame = directory.frame;
  return object([
    field("version", number(directory.version)),
    field("name", text(directory.name)),
    field("frame", frame === undefined ? identifier("undefined") : text(frame)),
    field(
      "abi",
      object([
        field("signature", number(directory.abi.signature)),
        field("functionBrand", array(directory.abi.functionBrand.map(number))),
      ]),
    ),
    field(
      "types",
      object([
        field("version", number(directory.types.version)),
        field("declarations", text(directory.types.declarations)),
        field("table", text(directory.types.table)),
        field(
          "entries",
          array(
            directory.types.entries.map((entry) =>
              object([
                field("name", text(entry.name)),
                field("local", text(entry.local)),
                field("type", text(entry.type)),
              ]),
            ),
          ),
        ),
        field(
          "types",
          array(
            directory.types.types.map((entry) =>
              object([
                field("name", text(entry.name)),
                field("type", text(entry.type)),
              ]),
            ),
          ),
        ),
      ]),
    ),
    field(
      "signatures",
      array(
        directory.signatures.map((signature) =>
          object([
            field("alias", text(signature.alias)),
            field("aliases", array(signature.aliases.map(text))),
            field("function", number(signature.function)),
            field("parameters", array(signature.parameters.map(text))),
            field("returnType", text(signature.returnType)),
          ]),
        ),
      ),
    ),
    field(
      "records",
      array(
        directory.records.map((record) =>
          object([
            field("alias", text(record.alias)),
            field("aliases", array(record.aliases.map(text))),
            field(
              "layout",
              object([
                field("byteLength", number(record.layout.byteLength)),
                field(
                  "fields",
                  array(
                    record.layout.fields.map((layout) => {
                      const properties = [
                        field("offset", number(layout.offset)),
                        field("type", text(layout.type)),
                        field("mutable", {
                          kind: "boolean",
                          value: layout.mutable,
                          start: 0,
                          end: 0,
                        }),
                      ];
                      const presence = layout.presenceOffset,
                        state = layout.stateOffset;
                      if (presence !== undefined)
                        properties.push(
                          field("presenceOffset", number(presence)),
                        );
                      if (state !== undefined)
                        properties.push(field("stateOffset", number(state)));
                      return object(properties);
                    }),
                  ),
                ),
              ]),
            ),
          ]),
        ),
      ),
    ),
    field(
      "runtimes",
      array(
        directory.runtimes.map((provider) =>
          object([
            field("kind", text(provider.kind)),
            field("element", text(provider.element)),
            field("value", text(provider.value)),
            field(
              "operations",
              array(
                provider.operations.map((operation) =>
                  object([
                    field("operation", text(operation.operation)),
                    field("parameters", array(operation.parameters.map(text))),
                    field("returnType", text(operation.returnType)),
                  ]),
                ),
              ),
            ),
          ]),
        ),
      ),
    ),
    field("digest", text(directory.digest)),
  ]);
}
export type ManagedSurfaceExportMaterialization =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: Module };
/** Replace only an explicitly selected unbound stub. Function/record names are
 * compiler-selected retained declarations; spelling alone grants no native leaf
 * capability. The caller still authorizes identity stubs and proves AOT agreement. */
export function materializeManagedSurfaceExport(
  module: Module,
  bind: string,
  directory: SerializedManagedSurfaceDirectory,
  tableFactory: string,
  witnesses: readonly string[],
  identities: readonly string[],
  prefix: string,
  slots: readonly RuntimeEntryStub[] = [],
): ManagedSurfaceExportMaterialization {
  const reject = (error: string): ManagedSurfaceExportMaterialization => ({
    ok: false,
    error,
  });
  if (module.imports.length !== 0)
    return reject("surface exports require a linked module");
  if (!generatedIdentifier(prefix))
    return reject("surface export prefix must be a generated identifier");
  const selected = module.statements.find(
    (statement) =>
      statement !== undefined &&
      statement.kind === "function" &&
      statement.name === bind,
  );
  if (
    selected === undefined ||
    selected.kind !== "function" ||
    selected.async ||
    selected.generator ||
    selected.receiver !== undefined ||
    selected.parameters.length !== 0 ||
    typeParameterCount(selected.typeParameters) !== 0 ||
    selected.returnType === undefined
  )
    return reject(
      "surface export requires a concrete annotated zero-argument unbound function",
    );
  const returnType = selected.returnType;
  if (returnType === undefined)
    return reject("surface export requires an annotated result");
  const oldBody = selected.body;
  if (oldBody.kind !== "block" || oldBody.statements.length !== 1)
    return reject("surface export requires an unbound stub");
  const first = oldBody.statements[0];
  if (first === undefined || first.kind !== "throw")
    return reject("surface export requires an unbound stub");
  const marker = first.expression;
  if (marker.kind !== "string" || marker.value !== "MANAGED_SURFACE_UNBOUND")
    return reject("surface export requires an unbound stub");
  let runtimeCount = 0;
  for (const provider of directory.runtimes) {
    if (provider === undefined) throw "surface runtime provider invariant";
    runtimeCount += provider.operations.length;
  }
  if (runtimeCount !== slots.length)
    return reject("surface export runtime slot count mismatch");
  const functions = directory.types.entries.length + witnesses.length;
  if (identities.length !== directory.records.length)
    return reject("surface export record count mismatch");
  const witnessIndexes = new Set<number>();
  for (const signature of directory.signatures) {
    if (signature === undefined) throw "surface export signature invariant";
    if (
      signature.function < 0 ||
      signature.function >= functions ||
      !Number.isInteger(signature.function)
    )
      return reject("surface export function index out of range");
    if (signature.function >= directory.types.entries.length)
      witnessIndexes.add(signature.function);
  }
  if (witnessIndexes.size !== witnesses.length)
    return reject("surface export witness count mismatch");
  const functionNames = [tableFactory, ...witnesses, ...identities];
  for (const slot of slots) {
    if (slot === undefined) throw "surface runtime slot invariant";
    functionNames.push(slot.entry, slot.signature);
  }
  for (const name of functionNames) {
    if (name === undefined) throw "surface export function name invariant";
    if (
      !module.statements.some(
        (statement) =>
          statement !== undefined &&
          statement.kind === "function" &&
          statement.name === name,
      )
    )
      return reject("surface export function is missing: " + name);
  }
  const reserved = new Set([
    tableFactory,
    ...witnesses,
    ...identities,
    "undefined",
    "Float64Array",
  ]);
  function local(suffix: string): string {
    let name = prefix + suffix;
    while (reserved.has(name)) name += "$";
    reserved.add(name);
    return name;
  }
  const table = local("_table"),
    records = local("_records"),
    entries = local("_entries"),
    functionValues = local("_functions"),
    data = local("_directory");
  function variable(
    name: string,
    initializer: Expression,
    type?: TypeNode,
  ): Statement {
    return {
      kind: "variable",
      mode: "const",
      exported: false,
      declarations: [{ name, initializer, type, start: 0, end: 0 }],
      start: 0,
      end: 0,
    };
  }
  const body: Statement[] = [
    variable(table, call(tableFactory)),
    variable(records, {
      kind: "new",
      callee: identifier("Float64Array"),
      typeArguments: [],
      arguments: [number(identities.length)],
      start: 0,
      end: 0,
    }),
  ];
  for (let index = 0; index < identities.length; index++) {
    const name = identities[index];
    if (name === undefined) throw "surface export record identity invariant";
    body.push({
      kind: "expression",
      expression: {
        kind: "assignment",
        target: {
          kind: "index",
          object: identifier(records),
          index: number(index),
          optional: false,
          start: 0,
          end: 0,
        },
        value: {
          kind: "call",
          callee: identifier(name),
          typeArguments: [],
          arguments: [identifier("undefined")],
          start: 0,
          end: 0,
        },
        start: 0,
        end: 0,
      },
      start: 0,
      end: 0,
    });
  }
  body.push(
    variable(entries, {
      kind: "new",
      callee: identifier("Float64Array"),
      typeArguments: [],
      arguments: [number(slots.length * 2)],
      start: 0,
      end: 0,
    }),
  );
  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index];
    if (slot === undefined) throw "surface runtime slot invariant";
    for (let part = 0; part < 2; part++)
      body.push({
        kind: "expression",
        start: 0,
        end: 0,
        expression: {
          kind: "assignment",
          start: 0,
          end: 0,
          target: {
            kind: "index",
            object: identifier(entries),
            index: number(index * 2 + part),
            optional: false,
            start: 0,
            end: 0,
          },
          value: call(part === 0 ? slot.entry : slot.signature),
        },
      });
  }
  const values: Expression[] = directory.types.entries.map((entry) => ({
    kind: "member",
    object: identifier(table),
    property: entry.name,
    optional: false,
    start: 0,
    end: 0,
  }));
  for (const name of witnesses) {
    if (name === undefined) throw "surface export witness invariant";
    values.push(identifier(name));
  }
  body.push(
    variable(functionValues, array(values), {
      kind: "array",
      readonly: true,
      element: { kind: "named", name: "unknown", start: 0, end: 0 },
      start: 0,
      end: 0,
    }),
  );
  body.push(
    variable(data, directoryLiteral(directory), {
      kind: "indexed-access",
      object: returnType,
      index: { kind: "literal", value: "directory", start: 0, end: 0 },
      start: 0,
      end: 0,
    }),
  );
  body.push({
    kind: "return",
    expression: object([
      field("directory", identifier(data)),
      field("table", identifier(table)),
      field("functions", identifier(functionValues)),
      field("records", identifier(records)),
      field("entries", identifier(entries)),
    ]),
    start: 0,
    end: 0,
  });
  const replacement: BlockStatement = {
    kind: "block",
    statements: body,
    start: 0,
    end: 0,
  };
  return {
    ok: true,
    value: {
      ...module,
      statements: module.statements.map((statement) =>
        statement === selected ? { ...selected, body: replacement } : statement,
      ),
    },
  };
}
