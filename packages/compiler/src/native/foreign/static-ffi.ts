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
export const ffiMemoryModule = "packages/native-runtime/src/node/ffi-memory.ts";
const nodeFfiModule = "packages/native-runtime/src/node/ffi.ts";

export interface StaticFfiPlan {
  readonly key: string;
  readonly signature: CSignature;
  readonly typedOnly?: boolean;
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

export function hasStaticFfiBytesEntry(plan: StaticFfiPlan): boolean {
  const signature = plan.signature;
  const result = signature.result;
  return (
    signature.parameters.length === 1 &&
    signature.parameters[0]?.kind === "pointer" &&
    result.kind === "scalar" &&
    result.scalar === "i32"
  );
}

export function staticFfiBytesEntry(index: number): string {
  return "callStaticFfiBytes" + String(index);
}

export function fixedFfiCallArities(
  modules: readonly SourceModule[],
): number[] {
  const arities = new Set<number>();
  for (const source of modules) {
    if (source === undefined) throw "fixed FFI source invariant";
    rewriteModule(source.module, {
      expression: (mapped, original): Expression => {
        if (
          original.kind === "call" &&
          !original.optional &&
          original.arguments.length <= 256 &&
          !original.arguments.some((argument) => argument?.kind === "spread")
        )
          arities.add(original.arguments.length);
        return mapped;
      },
    });
  }
  const ordered: number[] = [];
  for (let arity = 0; arity <= 256; arity++)
    if (arities.has(arity)) ordered.push(arity);
  return ordered;
}

/** Supply typed entries for common prototypes selected at binding time. */
export function addFixedFfiPlans(
  plans: readonly StaticFfiPlan[],
  arities: readonly number[],
): StaticFfiPlan[] {
  const combined = plans.slice();
  const seen = new Set(plans.map((plan) => plan.key));
  for (const arity of arities) {
    const spellings: NodeFfiType[] = [];
    const parameters: CType[] = [];
    for (let index = 0; index < arity; index++) {
      spellings.push("i32");
      parameters.push(nodeFfiCType("i32"));
    }
    const key = nodeFfiSignatureKey("i32", spellings);
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push({
      key,
      typedOnly: true,
      signature: {
        parameters,
        result: nodeFfiCType("i32"),
        fixedParameters: arity,
        callClass: "leaf",
        errno: "none",
      },
    });
  }
  if (arities.includes(1)) {
    const key = nodeFfiSignatureKey("i32", ["pointer"]);
    if (!seen.has(key))
      combined.push({
        key,
        typedOnly: true,
        signature: {
          parameters: [nodeFfiCType("pointer")],
          result: nodeFfiCType("i32"),
          fixedParameters: 1,
          callClass: "leaf",
          errno: "none",
        },
      });
  }
  return combined;
}

export function fixedFfiCallEntry(arity: number): string {
  return "tryFixedFfi" + String(arity);
}

export function mixedFfiCallEntry(arity: number): string {
  return "tryMixedFfi" + String(arity);
}

function fixedFfiSource(
  plans: readonly StaticFfiPlan[],
  arity: number,
  mixed: boolean,
): string {
  const parameters: string[] = ["callee:unknown"];
  const argumentsList: string[] = [];
  let numbers = "",
    general = "";
  for (let i = 0; i < arity; i++) {
    argumentsList.push("p" + i);
    parameters.push("p" + i + (mixed ? ":unknown" : ":number"));
    numbers += "plan.writeNumber(frame," + i + ",p" + i + ");\n";
    general += "plan.writeArgument(frame," + i + ",p" + i + ");\n";
  }
  let body =
    "const readRecord=viewTypeofObject(callee)?.internalMethods?.typedRecord;\n" +
    "if(readRecord===undefined)return undefined;\n" +
    "const plan=viewTypedFfiCall(readRecord());\n" +
    "if(plan===undefined||plan.arity!==" +
    arity +
    ")return undefined;\n";
  let direct = mixed && arity === 1;
  if (!mixed)
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      if (plan === undefined) throw "fixed FFI plan invariant";
      if (
        plan.signature.parameters.length !== arity ||
        plan.signature.result.kind === "void" ||
        !hasStaticFfiNumberEntry(plan)
      )
        continue;
      direct = true;
      const args = ["plan.address"];
      for (let p = 0; p < arity; p++) {
        const type = plan.signature.parameters[p];
        if (type?.kind !== "scalar") throw "fixed FFI parameter invariant";
        const argument = "p" + p;
        const checked =
          "plan.checkNumber(" +
          nodeFfiScalarKind(type.scalar) +
          "," +
          argument +
          "," +
          p +
          ")";
        // An i32 round trip accepts exactly the signed integral Number range.
        // The slow conversion still owns the coded error and its argument index.
        args.push(
          type.scalar === "i32"
            ? "((" +
                argument +
                "|0)===" +
                argument +
                "?" +
                argument +
                ":" +
                checked +
                ")"
            : checked,
        );
      }
      body +=
        "if(plan.staticIndex===" +
        i +
        "&&plan.lifetime.open&&!plan.nodeCallbacks.active&&!plan.nativeCallbacks.active" +
        ")return " +
        staticFfiNumberEntry(i) +
        "(" +
        args.join(",") +
        ");\n";
    }
  // Numeric entries keep only the direct checks in the entry itself, so a
  // direct call does not pay for the frame path's saved registers.
  const outlineMode = !mixed && direct;
  let modeBody = "const mode=plan.mode();if(mode===0)return undefined;\n";
  if (mixed && arity === 1)
    modeBody +=
      "const pointerLeaf=plan.unaryPointerLeaf;" +
      "if(mode===1&&pointerLeaf!==undefined)return pointerLeaf(p0);\n";
  if (mixed && arity === 2) {
    direct = true;
    // On a numeric guard miss the general entry validates the pointer first.
    modeBody +=
      "const callback=plan.pointerI32Callback;" +
      "if(mode===2&&callback!==undefined){" +
      "if(typeof p1!=='number'||(p1|0)!==p1)return undefined;" +
      "const result=callback(p0,p1);if(result!==undefined)return result;}\n";
  }
  const name = mixed ? mixedFfiCallEntry(arity) : fixedFfiCallEntry(arity);
  const frameBody =
    "const mayCallback=mode===2;const frame=plan.workspace(mayCallback);try{\n" +
    (arity === 0
      ? ""
      : mixed
        ? general
        : "if(plan.numbersOnly){\n" + numbers + "}else{\n" + general + "}\n") +
    "return plan.complete(frame,mayCallback);\n}finally{plan.release(frame);}\n";
  if (!outlineMode) body += modeBody;
  const guarded =
    "export function " +
    name +
    "(" +
    parameters.join(",") +
    "):number|undefined{\n" +
    body;
  if (!direct) return guarded + frameBody + "}\n";
  // Keep workspace cleanup and its root slots out of the managed frame of
  // a successful direct call.
  const invoke =
    "invoke" + (mixed ? "TryMixedFfi" : "TryFixedFfi") + arity + "Frame";
  const frameParameters = [
    "plan:TypedFfiCall",
    ...(outlineMode ? [] : ["mode:number"]),
    ...parameters.slice(1),
  ];
  return (
    guarded +
    "return " +
    invoke +
    "(" +
    ["plan", ...(outlineMode ? [] : ["mode"]), ...argumentsList].join(",") +
    ");\n}\n" +
    "function " +
    invoke +
    "(" +
    frameParameters.join(",") +
    "):number" +
    (outlineMode ? "|undefined{\n" + modeBody : "{\n") +
    frameBody +
    "}\n"
  );
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
      type.scalar === "i32"
        ? "checkedFfiI32(core,args[" + parameter + "]," + parameter + ")"
        : "checkedFfiNumber(core," +
            nodeFfiScalarKind(type.scalar) +
            ",args[" +
            parameter +
            "]," +
            parameter +
            ")",
    );
  }
  const returns = plan.signature.result.kind === "void" ? "void" : "number";
  const declaration =
    "export function " +
    name +
    "(" +
    parameters.join(",") +
    "):" +
    returns +
    " { throw 'UNBOUND_STATIC_FFI'; }\n";
  // Typed-only plans also get the general wrapper: a binding whose runtime
  // signature has the same key calls the same entry.
  return (
    declaration +
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
  fixedArities: readonly number[] = [],
): SourceModule {
  let text =
    'import type { ProgramRealmCore } from "objects";\n' +
    'import { checkedFfiI32, checkedFfiNumber } from "memory";\n' +
    "export type StaticFfiNumberCall=(core:ProgramRealmCore,target:number,args:readonly unknown[])=>unknown;\n" +
    "export type StaticFfiBytesCall=(target:number,bytes:Uint8Array)=>number;\n" +
    "export function ffiWeakProcessing():boolean { return " +
    String(weakProcessing) +
    "; }\n";
  let lookup = "export function staticFfiIndex(key:string):number {\n";
  let typed = "export function typedFfiIndex(key:string):number {\n";
  let dispatch =
    "export function staticFfiCall(index:number,frame:Uint8Array):boolean {\n";
  let numbers =
    "export function staticFfiNumberCall(index:number):StaticFfiNumberCall|undefined {\n";
  let bytes =
    "export function staticFfiBytesCall(index:number):StaticFfiBytesCall|undefined {\n";
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index];
    if (plan === undefined) throw "static FFI plan invariant";
    const byteEntry = fixedArities.includes(1) && hasStaticFfiBytesEntry(plan);
    if (byteEntry) {
      const name = staticFfiBytesEntry(index);
      text +=
        "export function " +
        name +
        "(target:number,bytes:Uint8Array):number { throw 'UNBOUND_STATIC_FFI'; }\n";
      text +=
        "function invoke" +
        name +
        "(target:number,bytes:Uint8Array):number {return " +
        name +
        "(target,bytes);}\n";
      bytes += "if(index===" + index + ")return invoke" + name + ";\n";
    }
    if (plan.typedOnly) {
      if (!byteEntry) {
        text += numericFfiSource(plan, index);
        if (hasStaticFfiNumberEntry(plan))
          numbers +=
            "if(index===" +
            index +
            ")return invoke" +
            staticFfiNumberEntry(index) +
            ";\n";
      }
      typed += 'if(key==="' + plan.key + '")return ' + String(index) + ";\n";
      continue;
    }
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
  if (fixedArities.length !== 0) {
    text =
      'import { viewTypeofObject } from "objects";\n' +
      'import { viewTypedFfiCall, type TypedFfiCall } from "memory";\n' +
      text;
    for (const arity of fixedArities) {
      if (arity === undefined) throw "fixed FFI arity invariant";
      text += fixedFfiSource(plans, arity, false);
      if (arity !== 0) text += fixedFfiSource(plans, arity, true);
    }
  }
  const parsed = parseModule(
    createSourceTextView(
      text +
        lookup +
        "return -1;\n}" +
        typed +
        "return -1;\n}" +
        dispatch +
        "return false;\n}" +
        numbers +
        "return undefined;\n}" +
        bytes +
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
