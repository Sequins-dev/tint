import type { SourceModule } from "@tint/typescript/modules/model";
import type {
  Module,
  Statement,
  ImportBinding,
  ImportDeclaration,
} from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { linkModules, locateSource } from "@tint/ts-native/modules";

export interface NativeServiceSourceRequest {
  readonly modules: readonly SourceModule[];
  readonly entry: string;
  readonly factory: string;
  readonly ownedModules: ReadonlySet<string>;
  readonly globals: readonly string[];
  readonly specifier: string;
  readonly hostImports: readonly {
    readonly module: string;
    readonly name: string;
    readonly imported: string;
  }[];
  readonly hostConstants: readonly {
    readonly module: string;
    readonly name: string;
  }[];
}
export type NativeServiceSourceResult =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: { readonly module: Module; readonly entry: string };
    };

/** Capture a closed service graph without copying host implementation bodies.
 * Linking supplies binding identity and module evaluation order. Host calls are
 * replaced only through an explicit named surface; approved primitive constants
 * are copied by value. All type declarations retain their linked identities. */
export function prepareNativeServiceSource(
  request: NativeServiceSourceRequest,
): NativeServiceSourceResult {
  const reject = (error: string): NativeServiceSourceResult => ({
    ok: false,
    error,
  });
  const linked = linkModules(request.modules, request.entry, request.globals, {
    evaluation: "instance",
  });
  if (!linked.ok) return reject(linked.error.message);
  const program = linked.value,
    bound = bindModule(program.module, request.globals);
  if (!bound.ok) return reject(bound.error.message);
  const factory = program.exports.find(
    (item) =>
      item.module === request.entry &&
      item.name === request.factory &&
      item.namespace === "value",
  );
  if (factory === undefined || !request.ownedModules.has(request.entry))
    return reject("service factory must belong to the owned graph");
  const imports = new Map<string, string>(),
    constants = new Set<string>();
  for (const reference of bound.value.references) {
    const origin = locateSource(program, reference.node);
    if (
      origin === undefined ||
      !request.ownedModules.has(origin.module) ||
      reference.binding === undefined
    )
      continue;
    const binding = bound.value.bindings[reference.binding];
    if (binding === undefined) return reject("missing service binding");
    const owner = locateSource(program, binding.node);
    if (owner === undefined || request.ownedModules.has(owner.module)) continue;
    const exported = program.exports.find(
      (item) =>
        item.module === owner.module &&
        item.namespace === "value" &&
        item.linkedName === binding.name,
    );
    if (exported === undefined)
      return reject("service references a private host value: " + binding.name);
    const approved = request.hostImports.find(
      (item) => item.module === exported.module && item.name === exported.name,
    );
    if (binding.kind === "function" && approved !== undefined) {
      const previous = [...imports].find(
        ([local, name]) => name === approved.imported && local !== binding.name,
      );
      if (previous !== undefined)
        return reject("duplicate host surface name: " + approved.imported);
      imports.set(binding.name, approved.imported);
    } else if (
      request.hostConstants.some(
        (item) =>
          item.module === exported.module && item.name === exported.name,
      )
    ) {
      constants.add(binding.name);
    } else
      return reject(
        "unapproved host value: " + exported.module + ":" + exported.name,
      );
  }
  const statements: Statement[] = [];
  const copied = new Set<string>();
  for (const statement of program.module.statements) {
    if (statement.kind === "interface" || statement.kind === "type-alias") {
      statements.push(statement);
      continue;
    }
    const owner = locateSource(program, statement);
    if (owner !== undefined && request.ownedModules.has(owner.module)) {
      if (statement.kind !== "import" && statement.kind !== "export")
        statements.push(statement);
    } else if (statement.kind === "variable") {
      const declarations = statement.declarations.filter(
        (binding) =>
          binding.kind !== "object-binding" &&
          binding.kind !== "array-binding" &&
          constants.has(binding.name),
      );
      for (const binding of declarations) {
        if (
          binding.kind === "object-binding" ||
          binding.kind === "array-binding"
        )
          return reject("host constant requires a named binding");
        const initializer = binding.initializer;
        if (
          statement.mode !== "const" ||
          initializer === undefined ||
          !["number", "string", "boolean", "null", "bigint"].includes(
            initializer.kind,
          )
        )
          return reject(
            "host constant must be immutable and primitive: " + binding.name,
          );
        copied.add(binding.name);
      }
      if (declarations.length !== 0)
        statements.push({ ...statement, declarations });
    }
  }
  if ([...constants].some((name) => !copied.has(name)))
    return reject("host constant declaration is missing");
  const bindings: ImportBinding[] = [...imports].map(([local, imported]) => ({
    namespace: false,
    imported,
    local,
    typeOnly: false,
  }));
  const declarations: ImportDeclaration[] =
    bindings.length === 0
      ? []
      : [
          {
            start: 0,
            end: 0,
            specifier: request.specifier,
            specifierSpan: { start: 0, end: 0 },
            typeOnly: false,
            bindings,
          },
        ];
  for (const declaration of declarations)
    statements.unshift({ start: 0, end: 0, kind: "import", declaration });
  return {
    ok: true,
    value: {
      module: { ...program.module, statements, imports: declarations },
      entry: factory.linkedName,
    },
  };
}
