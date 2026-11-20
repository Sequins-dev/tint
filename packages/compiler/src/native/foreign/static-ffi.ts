import {
  canonicalNodeFfiType,
  nodeFfiCType,
  nodeFfiSignatureKey,
  type CSignature,
  type CType,
  type NodeFfiType,
} from "@tint/abi/c";
import { createSourceTextView } from "@tint/source/text";
import { createStringIndex } from "@tint/foundation/collections/key-index";
import {
  parseModule,
  rewriteModule,
  type Expression,
} from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";

export const staticFfiModule = "packages/native-runtime/src/node/ffi-static.ts";
const nodeFfiModule = "packages/native-runtime/src/node/ffi.ts";

export interface StaticFfiPlan {
  readonly key: string;
  readonly signature: CSignature;
}

function planSignature(
  definition: Expression,
  charSigned: boolean,
): StaticFfiPlan | undefined {
  if (definition.kind !== "object") return undefined;
  let result: NodeFfiType = "void";
  const parameters: CType[] = [];
  const spellings: NodeFfiType[] = [];
  const seen = new Set<string>();
  for (const field of definition.properties) {
    if (
      field === undefined ||
      field.kind === "spread" ||
      field.computed ||
      field.keyExpression !== undefined ||
      field.prototypeSetter ||
      field.method ||
      field.accessor !== undefined ||
      seen.has(field.name)
    )
      return undefined;
    seen.add(field.name);
    const value = field.value;
    if (field.name === "return") {
      if (value.kind !== "string") return undefined;
      const returned = canonicalNodeFfiType(value.value, charSigned);
      if (returned === undefined) return undefined;
      result = returned;
    } else if (field.name === "arguments") {
      if (value.kind !== "array" || value.elements.length > 256)
        return undefined;
      for (const argument of value.elements) {
        if (argument?.kind !== "string") return undefined;
        const type = canonicalNodeFfiType(argument.value, charSigned);
        if (type === undefined || type === "void") return undefined;
        parameters.push(nodeFfiCType(type));
        spellings.push(type);
      }
    }
  }
  return {
    key: nodeFfiSignatureKey(result, spellings),
    signature: {
      parameters,
      result: nodeFfiCType(result),
      fixedParameters: parameters.length,
      callClass: "leaf",
      errno: "none",
    },
  };
}

/** Only object/array/string literals contribute call shapes. The runtime still
 * reads and validates the actual signatures before it can select these plans. */
export function recognizeStaticFfi(
  modules: readonly SourceModule[],
  charSigned: boolean,
): StaticFfiPlan[] {
  const seen = createStringIndex<boolean>();
  const plans: StaticFfiPlan[] = [];
  for (const source of modules) {
    if (source === undefined) throw "static FFI source invariant";
    const direct = new Set<string>();
    const namespaces = new Set<string>();
    for (const imported of source.module.imports) {
      if (
        imported === undefined ||
        imported.typeOnly ||
        source.dependencies.get(imported.specifier) !== nodeFfiModule
      )
        continue;
      for (const binding of imported.bindings) {
        if (binding === undefined || binding.typeOnly) continue;
        if (binding.namespace || binding.imported === "default")
          namespaces.add(binding.local);
        else if (binding.imported === "dlopen") direct.add(binding.local);
      }
    }
    if (direct.size + namespaces.size === 0) continue;
    rewriteModule(source.module, {
      expression: (mapped, original): Expression => {
        if (original.kind !== "call" || original.optional) return mapped;
        const callee = original.callee;
        if (callee.kind === "identifier") {
          if (!direct.has(callee.name)) return mapped;
        } else {
          if (
            callee.kind !== "member" ||
            callee.optional ||
            callee.property !== "dlopen"
          )
            return mapped;
          const object = callee.object;
          if (object.kind !== "identifier" || !namespaces.has(object.name))
            return mapped;
        }
        const definitions = original.arguments[1];
        if (definitions === undefined || definitions.kind !== "object")
          return mapped;
        for (const property of definitions.properties) {
          if (
            property === undefined ||
            property.kind === "spread" ||
            property.computed ||
            property.keyExpression !== undefined ||
            property.prototypeSetter ||
            property.method ||
            property.accessor !== undefined
          )
            continue;
          const plan = planSignature(property.value, charSigned);
          if (plan !== undefined && !seen.has(plan.key)) {
            seen.set(plan.key, true);
            plans.push(plan);
          }
        }
        return mapped;
      },
    });
  }
  return plans;
}

export function staticFfiEntry(index: number): string {
  return "callStaticFfi" + String(index);
}

export function makeStaticFfiModule(
  plans: readonly StaticFfiPlan[],
  weakProcessing: boolean,
): SourceModule {
  let text =
    "export function ffiWeakProcessing():boolean { return " +
    String(weakProcessing) +
    "; }\n";
  let lookup = "export function staticFfiIndex(key:string):number {\n";
  let dispatch =
    "export function staticFfiCall(index:number,frame:Uint8Array):boolean {\n";
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index];
    if (plan === undefined) throw "static FFI plan invariant";
    const entry = staticFfiEntry(index);
    text +=
      "export function " +
      entry +
      "(frame:Uint8Array):boolean { throw 'UNBOUND_STATIC_FFI'; }\n";
    lookup += 'if(key==="' + plan.key + '")return ' + String(index) + ";\n";
    dispatch +=
      "if(index===" + String(index) + ")return " + entry + "(frame);\n";
  }
  const parsed = parseModule(
    createSourceTextView(
      text + lookup + "return -1;\n}" + dispatch + "return false;\n}",
    ),
  );
  if (!parsed.ok) throw "static FFI module invariant";
  return {
    id: staticFfiModule,
    module: parsed.value,
    dependencies: new Map<string, string>(),
  };
}
