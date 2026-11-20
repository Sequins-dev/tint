import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

// These names describe the constructors installed by the program realm.
// The library, independently, supplies their types.
const groups: Record<string, string[]> = {
  installErrorIntrinsics: [
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "EvalError",
    "URIError",
    "AggregateError",
    "SuppressedError",
  ],
  installArrayIntrinsics: ["Array"],
  installObjectIntrinsics: ["Object"],
  installFunctionIntrinsics: ["Function"],
  installPrimitiveIntrinsics: ["Date", "Boolean", "Number", "String", "BigInt"],
  installSymbolIntrinsics: ["Symbol"],
  installIteratorConstructor: ["Iterator"],
  installMapIntrinsics: ["Map"],
  installSetIntrinsics: ["Set"],
  installWeakCollectionIntrinsics: ["WeakMap", "WeakSet"],
  installRegExpIntrinsics: ["RegExp"],
  installProxyIntrinsics: ["Proxy"],
  installPromiseIntrinsics: ["Promise"],
  installArrayBufferIntrinsics: ["ArrayBuffer"],
  installDataViewIntrinsics: ["DataView"],
  installDisposableStackIntrinsics: ["DisposableStack"],
  installAsyncDisposableStackIntrinsics: ["AsyncDisposableStack"],
  installTypedArrayIntrinsics: [
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array",
  ],
};
const anchor = resolve(".tint-realm-library-anchor.ts");
const options: ts.CompilerOptions = {
  lib: ["lib.esnext.d.ts"],
  strict: true,
  types: [],
};
const host = ts.createCompilerHost(options);
const getSource = host.getSourceFile.bind(host);
host.getSourceFile = (file, version, ...rest) =>
  file === anchor
    ? ts.createSourceFile(file, "", version)
    : getSource(file, version, ...rest);
const program = ts.createProgram([anchor], options, host);
const anchorSource = program.getSourceFile(anchor);
if (anchorSource === undefined) throw Error("Missing library anchor");
const source: ts.SourceFile = anchorSource;
const checker = program.getTypeChecker();
const globals = checker.getSymbolsInScope(source, ts.SymbolFlags.Value);
const installed = new Set(Object.values(groups).flat());
const installedNonConstructors = [
  "globalThis",
  "eval",
  "Math",
  "JSON",
  "Reflect",
  "isNaN",
  "isFinite",
  "parseInt",
  "parseFloat",
  "encodeURI",
  "decodeURI",
  "encodeURIComponent",
  "decodeURIComponent",
  "escape",
  "unescape",
];
const noConstructor = globals
  .map((s) => s.name)
  .filter(
    (name) => !installed.has(name) && !installedNonConstructors.includes(name),
  )
  .sort();

const scalars = new Set([
  "number",
  "string",
  "boolean",
  "bigint",
  "void",
  "undefined",
]);
function signatureText(signature: ts.Signature): string {
  return checker.signatureToString(
    signature,
    source,
    ts.TypeFormatFlags.NoTruncation,
  );
}
function plainMethod(signature: ts.Signature) {
  if (signature.typeParameters?.length || signature.thisParameter)
    return undefined;
  const parameters: string[] = [];
  if (signature.parameters.length > 3) return undefined;
  for (const parameter of signature.parameters) {
    const declaration = parameter.valueDeclaration;
    if (
      !declaration ||
      !ts.isParameter(declaration) ||
      declaration.questionToken ||
      declaration.dotDotDotToken
    )
      return undefined;
    const type = checker.typeToString(
      checker.getTypeOfSymbolAtLocation(parameter, source),
    );
    if (!scalars.has(type) || type === "void" || type === "undefined")
      return undefined;
    parameters.push(type);
  }
  const result = checker.typeToString(
    checker.getReturnTypeOfSignature(signature),
  );
  return scalars.has(result) ? { parameters, result } : undefined;
}
const records = Object.entries(groups)
  .flatMap(([installer, names]) =>
    names.map((name) => {
      const global = globals.find((symbol) => symbol.name === name);
      if (!global)
        throw Error(name + " is absent from TypeScript " + ts.version);
      const value = checker.getTypeOfSymbolAtLocation(global, source);
      const construct = value.getConstructSignatures();
      const call = value.getCallSignatures();
      const prototype = value.getProperty("prototype");
      const instance = prototype
        ? checker.getTypeOfSymbolAtLocation(prototype, source)
        : construct[0] === undefined
          ? undefined
          : checker.getReturnTypeOfSignature(construct[0]);
      const instanceName = instance?.getSymbol()?.name ?? "";
      const members =
        instance
          ?.getProperties()
          .filter((p) => !p.name.startsWith("__@"))
          .map((member) => {
            const type = checker.getTypeOfSymbolAtLocation(member, source);
            const calls = type.getCallSignatures();
            const propertyType = checker.typeToString(type);
            const methods = calls.map(plainMethod);
            return {
              name: member.name,
              type:
                calls.length === 0 && scalars.has(propertyType)
                  ? propertyType
                  : "",
              methods: methods.every((m) => m !== undefined) ? methods : [],
            };
          }) ?? [];
      return {
        name,
        installer,
        constructorType: value.getSymbol()?.name ?? "",
        instanceName,
        instanceType: instance
          ? checker.typeToString(
              instance,
              source,
              ts.TypeFormatFlags.NoTruncation,
            )
          : "{}",
        bases:
          instance
            ?.getBaseTypes()
            ?.flatMap((base) => base.getSymbol()?.name ?? []) ?? [],
        prototype: prototype !== undefined,
        construct: construct.map(signatureText),
        call: call.map(signatureText),
        members: members.map((member) =>
          [
            member.name,
            member.type,
            ...member.methods.map((method) =>
              method!.parameters.concat(method!.result).join(","),
            ),
          ].join("|"),
        ),
      };
    }),
  )
  .sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(
  process.argv[2] ?? "packages/typescript/src/binding/realm-library.ts",
  `// Generated by tools/generate-realm-library.ts from TypeScript ${ts.version}, lib.esnext.d.ts.
export interface RealmLibraryConstructor {
  readonly name: string;
  readonly installer: string;
  readonly constructorType: string;
  readonly instanceName: string;
  readonly instanceType: string;
  readonly bases: readonly string[];
  readonly prototype: boolean;
  readonly construct: readonly string[];
  readonly call: readonly string[];
  readonly members: readonly string[];
}
export const realmLibrary: readonly RealmLibraryConstructor[] = ${JSON.stringify(records, null, 2)};
export const installedNonConstructorGlobals: readonly string[] = ${JSON.stringify(installedNonConstructors)};
export const otherLibraryGlobals: readonly string[] = ${JSON.stringify(noConstructor, null, 2)};
export function realmLibraryConstructor(name: string): RealmLibraryConstructor | undefined {
  return realmLibrary.find((entry) => entry !== undefined && entry.name === name);
}
`,
);
