import {
  canonicalNodeFfiType,
  nodeFfiCType,
  nodeFfiScalarKind,
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
const objectModule = "packages/js-runtime/src/objects/index.ts";
const ffiMemoryModule = "packages/native-runtime/src/node/ffi-memory.ts";
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

function numericFfiType(type: CType): boolean {
  return (
    type.kind === "scalar" && type.scalar !== "i64" && type.scalar !== "u64"
  );
}

export function hasStaticFfiNumberEntry(plan: StaticFfiPlan): boolean {
  const result = plan.signature.result;
  return (
    (result.kind === "void" || numericFfiType(result)) &&
    plan.signature.parameters.every(numericFfiType)
  );
}

export function staticFfiNumberEntry(index: number): string {
  return "callStaticFfiNumber" + String(index);
}

/** A trusted compiled wrapper unboxes and validates each argument before
 * calling a numeric C prototype at the binding's immutable symbol address. */
function numericFfiSource(plan: StaticFfiPlan, index: number): string {
  const name = staticFfiNumberEntry(index);
  const parameters = ["target:number"];
  const args = ["target"];
  for (
    let parameter = 0;
    parameter < plan.signature.parameters.length;
    parameter++
  ) {
    const type = plan.signature.parameters[parameter];
    if (type?.kind !== "scalar") throw "static numeric FFI parameter invariant";
    parameters.push("p" + parameter + ":number");
    args.push(
      "checkedFfiNumber(core," +
        nodeFfiScalarKind(type.scalar) +
        ",args[" +
        parameter +
        "]," +
        parameter +
        ")",
    );
  }
  const returns = plan.signature.result.kind === "void" ? "void" : "number";
  return (
    "export function " +
    name +
    "(" +
    parameters.join(",") +
    "):" +
    returns +
    " { throw 'UNBOUND_STATIC_FFI'; }\n" +
    "function invoke" +
    name +
    "(core:ProgramRealmCore,target:number,args:readonly unknown[]):unknown {" +
    (returns === "void"
      ? name + "(" + args.join(",") + ");return undefined;"
      : "return " + name + "(" + args.join(",") + ");") +
    "}\n"
  );
}

export function makeStaticFfiModule(
  plans: readonly StaticFfiPlan[],
  weakProcessing: boolean,
): SourceModule {
  let text =
    'import type { ProgramRealmCore } from "objects";\n' +
    'import { checkedFfiNumber } from "memory";\n' +
    "export type StaticFfiNumberCall=(core:ProgramRealmCore,target:number,args:readonly unknown[])=>unknown;\n" +
    "export function ffiWeakProcessing():boolean { return " +
    String(weakProcessing) +
    "; }\n";
  let lookup = "export function staticFfiIndex(key:string):number {\n";
  let dispatch =
    "export function staticFfiCall(index:number,frame:Uint8Array):boolean {\n";
  let numbers =
    "export function staticFfiNumberCall(index:number):StaticFfiNumberCall|undefined {\n";
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index];
    if (plan === undefined) throw "static FFI plan invariant";
    const entry = staticFfiEntry(index);
    text +=
      "export function " +
      entry +
      "(frame:Uint8Array):boolean { throw 'UNBOUND_STATIC_FFI'; }\n";
    if (hasStaticFfiNumberEntry(plan)) {
      text += numericFfiSource(plan, index);
      numbers +=
        "if(index===" +
        index +
        ")return invoke" +
        staticFfiNumberEntry(index) +
        ";\n";
    }
    lookup += 'if(key==="' + plan.key + '")return ' + String(index) + ";\n";
    dispatch +=
      "if(index===" + String(index) + ")return " + entry + "(frame);\n";
  }
  const parsed = parseModule(
    createSourceTextView(
      text +
        lookup +
        "return -1;\n}" +
        dispatch +
        "return false;\n}" +
        numbers +
        "return undefined;\n}",
    ),
  );
  if (!parsed.ok) throw "static FFI module invariant";
  const dependencies = new Map<string, string>();
  dependencies.set("objects", objectModule);
  dependencies.set("memory", ffiMemoryModule);
  return {
    id: staticFfiModule,
    module: parsed.value,
    dependencies,
  };
}
