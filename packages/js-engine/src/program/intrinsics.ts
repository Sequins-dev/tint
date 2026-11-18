import {
  rewriteModule,
  type ClassDefinition,
  type Expression,
  type Module,
  type Statement,
} from "@tint/typescript/syntax";
import { bindJavaScriptModule } from "@tint/typescript/binding";

/** The realm's intrinsic installers, in installation order. Each is an
 * `install*` export of the JavaScript runtime's objects module taking
 * `(global object, realm, hooks)`; the typed-array installer also takes the
 * byte order. */
export const intrinsicInstallers: readonly string[] = [
  "installErrorIntrinsics",
  "installDisposableStackIntrinsics",
  "installAsyncDisposableStackIntrinsics",
  "installArrayIntrinsics",
  "installArrayBufferIntrinsics",
  "installDataViewIntrinsics",
  "installTypedArrayIntrinsics",
  "installObjectIntrinsics",
  "installFunctionIntrinsics",
  "installEvalIntrinsic",
  "installPrimitiveIntrinsics",
  "installIteratorConstructor",
  "installMapIntrinsics",
  "installSetIntrinsics",
  "installRegExpIntrinsics",
  "installSymbolIntrinsics",
  "installMathIntrinsics",
  "installProxyIntrinsics",
  "installReflectIntrinsics",
  "installPromiseIntrinsics",
];

/** Installed in every realm: objects of these kinds arise from ordinary
 * syntax and runtime operations (errors, arrays, functions, strings,
 * numbers, symbols, iterators) without naming a global. */
const core = [
  "installErrorIntrinsics",
  "installArrayIntrinsics",
  "installObjectIntrinsics",
  "installFunctionIntrinsics",
  "installPrimitiveIntrinsics",
  "installIteratorConstructor",
  "installSymbolIntrinsics",
];

/** Installers needed when a global name is referenced. */
const byGlobal: ReadonlyMap<string, readonly string[]> = new Map<
  string,
  readonly string[]
>([
  ["Map", ["installMapIntrinsics"]],
  ["Set", ["installSetIntrinsics"]],
  ["RegExp", ["installRegExpIntrinsics"]],
  ["Math", ["installMathIntrinsics"]],
  ["Proxy", ["installProxyIntrinsics"]],
  ["Reflect", ["installReflectIntrinsics"]],
  ["Promise", ["installPromiseIntrinsics"]],
  ["DisposableStack", ["installDisposableStackIntrinsics"]],
  [
    "AsyncDisposableStack",
    ["installAsyncDisposableStackIntrinsics", "installPromiseIntrinsics"],
  ],
  ["ArrayBuffer", ["installArrayBufferIntrinsics"]],
  ["SharedArrayBuffer", ["installArrayBufferIntrinsics"]],
  ["DataView", ["installArrayBufferIntrinsics", "installDataViewIntrinsics"]],
]);
const typedArrayGlobals = new Set([
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
]);
/** Globals through which code can reach any intrinsic or compile new code
 * that can: every installer is needed. */
const dynamicGlobals = new Set(["globalThis", "eval", "Function"]);
/** Member names whose built-in implementations create objects of a kind
 * the program may not otherwise name: String.prototype.match/matchAll/
 * search create RegExps; Array.fromAsync and Atomics.waitAsync create
 * promises. */
const byMember: ReadonlyMap<string, string> = new Map<string, string>([
  ["match", "installRegExpIntrinsics"],
  ["matchAll", "installRegExpIntrinsics"],
  ["search", "installRegExpIntrinsics"],
  ["fromAsync", "installPromiseIntrinsics"],
  ["waitAsync", "installPromiseIntrinsics"],
]);

/** The intrinsic installers a general program needs, in installation order:
 * the core, plus installers for the globals the program names and the
 * object kinds its syntax creates. A name reaching arbitrary intrinsics
 * (`globalThis`, `eval`, `Function`) or a module the binder rejects selects
 * every installer. Objects of an uninstalled kind cannot arise: creating
 * one needs the global, the syntax or the member operation listed here. */
export function generalIntrinsics(
  modules: readonly Module[],
): readonly string[] {
  const needed = new Set<string>(core);
  let everything = false;
  function add(name: string): void {
    needed.add(name);
  }
  function addAll(names: readonly string[]): void {
    for (const name of names) if (name !== undefined) add(name);
  }
  function classMembers(definition: ClassDefinition): void {
    for (const element of definition.elements) {
      if (element === undefined) throw "general intrinsics invariant";
      if (
        (element.kind === "method" ||
          element.kind === "get" ||
          element.kind === "set") &&
        element.async === true
      )
        add("installPromiseIntrinsics");
    }
  }
  for (const module of modules) {
    if (module === undefined) throw "general intrinsics invariant";
    const bound = bindJavaScriptModule(module);
    if (!bound.ok) {
      everything = true;
      break;
    }
    for (const reference of bound.value.references) {
      if (reference === undefined) throw "general intrinsics invariant";
      const name = reference.global;
      if (name === undefined) continue;
      if (dynamicGlobals.has(name)) everything = true;
      const installers = byGlobal.get(name);
      if (installers !== undefined) addAll(installers);
      if (typedArrayGlobals.has(name)) {
        add("installArrayBufferIntrinsics");
        add("installTypedArrayIntrinsics");
      }
    }
    rewriteModule(module, {
      expression: (mapped: Expression, _original: Expression): Expression => {
        switch (mapped.kind) {
          case "regexp":
            add("installRegExpIntrinsics");
            break;
          case "await":
          case "import-call":
            add("installPromiseIntrinsics");
            break;
          case "arrow":
          case "function-expression":
            if (mapped.async === true) add("installPromiseIntrinsics");
            break;
          case "member": {
            const installer = byMember.get(mapped.property);
            if (installer !== undefined) add(installer);
            break;
          }
          case "class-expression":
            classMembers(mapped.definition);
            break;
          default:
            break;
        }
        return mapped;
      },
      statement: (mapped: Statement, _original: Statement): Statement => {
        switch (mapped.kind) {
          case "function":
            if (mapped.async === true) add("installPromiseIntrinsics");
            break;
          case "class":
            classMembers(mapped.definition);
            break;
          case "for-of":
          case "for-of-assignment":
            if (mapped.await === true) add("installPromiseIntrinsics");
            if (mapped.kind === "for-of" && mapped.disposal === "sync")
              add("installDisposableStackIntrinsics");
            if (mapped.kind === "for-of" && mapped.disposal === "async") {
              add("installAsyncDisposableStackIntrinsics");
              add("installPromiseIntrinsics");
            }
            break;
          case "variable":
            if (mapped.disposal === "sync")
              add("installDisposableStackIntrinsics");
            if (mapped.disposal === "async") {
              add("installAsyncDisposableStackIntrinsics");
              add("installPromiseIntrinsics");
            }
            break;
          default:
            break;
        }
        return mapped;
      },
    });
  }
  const result: string[] = [];
  for (const installer of intrinsicInstallers)
    if (installer !== undefined && (everything || needed.has(installer)))
      result.push(installer);
  return result;
}
