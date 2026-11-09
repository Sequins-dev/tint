// Node-only semantic oracle for Script lowering. It prints the lowered module
// as plain JavaScript and executes it against the portable runtime, so lowering
// semantics can be tested red-first without a native image. This does not
// replace native validation: codegen, managed agreement and native runtime
// bindings are not exercised here.
import type {
  Expression,
  Module,
  Parameter,
  Statement,
  VariableBinding,
} from "@tint/typescript/syntax";

function fail(kind: string): never {
  throw new Error("lowered-node-host cannot print " + kind);
}
function bindingName(binding: VariableBinding): string {
  if (binding.kind === "object-binding" || binding.kind === "array-binding")
    fail(binding.kind);
  return binding.name;
}
function parameterName(parameter: Parameter): string {
  if (parameter.kind === "pattern-parameter") fail(parameter.kind);
  return (parameter.rest ? "..." : "") + parameter.name;
}
function stringLiteral(value: string): string {
  return JSON.stringify(value);
}

export function printExpression(node: Expression): string {
  switch (node.kind) {
    case "identifier":
      return node.name;
    case "number":
      return (
        "(" + (Object.is(node.value, -0) ? "-0" : String(node.value)) + ")"
      );
    case "string":
      return stringLiteral(node.value);
    case "boolean":
      return String(node.value);
    case "null":
      return "null";
    case "this":
      return "this";
    case "elision":
      return "";
    case "spread":
      return "..." + printExpression(node.value);
    case "array":
      return "[" + node.elements.map(printExpression).join(",") + "]";
    case "object":
      return (
        "({" +
        node.properties
          .map((property) => {
            if (property.kind === "spread")
              return "..." + printExpression(property.value);
            if (property.accessor !== undefined || property.method === true)
              fail("object method");
            const key =
              property.keyExpression === undefined
                ? stringLiteral(property.name)
                : "[" + printExpression(property.keyExpression) + "]";
            return key + ":" + printExpression(property.value);
          })
          .join(",") +
        "})"
      );
    case "arrow": {
      const body =
        node.body.kind === "block"
          ? printBlock(node.body.statements)
          : "(" + printExpression(node.body) + ")";
      return (
        "((" + node.parameters.map(parameterName).join(",") + ")=>" + body + ")"
      );
    }
    case "unary":
      return "(" + node.operator + " " + printExpression(node.operand) + ")";
    case "binary":
      return (
        "(" +
        printExpression(node.left) +
        " " +
        node.operator +
        " " +
        printExpression(node.right) +
        ")"
      );
    case "update":
      return node.prefix
        ? "(" + node.operator + printExpression(node.target) + ")"
        : "(" + printExpression(node.target) + node.operator + ")";
    case "compound":
      return (
        "(" +
        printExpression(node.target) +
        " " +
        node.operator +
        " " +
        printExpression(node.value) +
        ")"
      );
    case "assignment":
      return (
        "(" +
        printExpression(node.target) +
        "=" +
        printExpression(node.value) +
        ")"
      );
    case "conditional":
      return (
        "(" +
        printExpression(node.test) +
        "?" +
        printExpression(node.consequent) +
        ":" +
        printExpression(node.alternate) +
        ")"
      );
    case "call":
      return (
        printExpression(node.callee) +
        (node.optional === true ? "?.(" : "(") +
        node.arguments.map(printExpression).join(",") +
        ")"
      );
    case "new":
      return (
        "(new " +
        printExpression(node.callee) +
        "(" +
        node.arguments.map(printExpression).join(",") +
        "))"
      );
    case "member":
      if (node.private === true) fail("private member");
      return (
        printExpression(node.object) +
        (node.optional === true ? "?." : ".") +
        node.property
      );
    case "index":
      return (
        printExpression(node.object) +
        (node.optional === true ? "?.[" : "[") +
        printExpression(node.index) +
        "]"
      );
    case "group":
      return "(" + printExpression(node.expression) + ")";
    case "satisfies":
      return printExpression(node.expression);
    default:
      return fail(node.kind);
  }
}

function printBlock(statements: readonly Statement[]): string {
  return "{\n" + statements.map(printStatement).join("\n") + "\n}";
}

export function printStatement(node: Statement): string {
  switch (node.kind) {
    case "block":
      return printBlock(node.statements);
    case "expression":
      return printExpression(node.expression) + ";";
    case "variable":
      return (
        node.mode +
        " " +
        node.declarations
          .map(
            (declaration) =>
              bindingName(declaration) +
              (declaration.initializer === undefined
                ? ""
                : "=" + printExpression(declaration.initializer)),
          )
          .join(",") +
        ";"
      );
    case "function":
      return (
        "function " +
        node.name +
        "(" +
        node.parameters.map(parameterName).join(",") +
        ")" +
        (node.body.kind === "block"
          ? printBlock(node.body.statements)
          : fail("function body"))
      );
    case "if":
      return (
        "if(" +
        printExpression(node.test) +
        ")" +
        printStatement(node.consequent) +
        (node.alternate === undefined
          ? ""
          : "\nelse " + printStatement(node.alternate))
      );
    case "while":
      return (
        "while(" + printExpression(node.test) + ")" + printStatement(node.body)
      );
    case "do-while":
      return (
        "do " +
        printStatement(node.body) +
        " while(" +
        printExpression(node.test) +
        ");"
      );
    case "for":
      return (
        "for(" +
        (node.initializer === undefined
          ? ";"
          : printStatement(node.initializer)) +
        (node.test === undefined ? "" : printExpression(node.test)) +
        ";" +
        (node.update === undefined ? "" : printExpression(node.update)) +
        ")" +
        printStatement(node.body)
      );
    case "try": {
      let text = "try" + printBlock(node.body.statements);
      if (node.handler !== undefined)
        text +=
          "catch" +
          (node.handler.binding === undefined
            ? ""
            : "(" + bindingName(node.handler.binding) + ")") +
          printBlock(node.handler.body.statements);
      if (node.finalizer !== undefined)
        text += "finally" + printBlock(node.finalizer.statements);
      return text;
    }
    case "switch":
      return (
        "switch(" +
        printExpression(node.expression) +
        "){" +
        node.clauses
          .map(
            (clause) =>
              (clause.test === undefined
                ? "default:"
                : "case " + printExpression(clause.test) + ":") +
              clause.statements.map(printStatement).join("\n"),
          )
          .join("\n") +
        "}"
      );
    case "return":
      return (
        "return" +
        (node.expression === undefined
          ? ""
          : " " + printExpression(node.expression)) +
        ";"
      );
    case "throw":
      return "throw " + printExpression(node.expression) + ";";
    case "break":
    case "continue":
      return (
        node.kind + (node.label === undefined ? "" : " " + node.label) + ";"
      );
    case "label":
      return node.name + ":" + printStatement(node.body);
    case "empty":
      return ";";
    case "interface":
    case "type-alias":
    case "import":
      return "";
    default:
      return fail(node.kind);
  }
}

export interface PrintedModule {
  readonly specifiers: ReadonlyMap<string, readonly string[]>;
  readonly body: string;
  readonly exports: readonly string[];
}

/** Print a lowered Script/module as a function body over runtime imports. */
export function printLoweredModule(module: Module): PrintedModule {
  const specifiers = new Map<string, string[]>();
  const declarations = [...module.imports];
  for (const statement of module.statements)
    if (statement?.kind === "import") declarations.push(statement.declaration);
  for (const declaration of declarations) {
    if (declaration === undefined) throw "IMPORT_INVARIANT";
    const names = specifiers.get(declaration.specifier) ?? [];
    for (const binding of declaration.bindings) {
      if (binding === undefined) throw "IMPORT_INVARIANT";
      if (binding.typeOnly || declaration.typeOnly) continue;
      if (binding.imported !== binding.local) fail("renamed import");
      names.push(binding.local);
    }
    specifiers.set(declaration.specifier, names);
  }
  const exports: string[] = [];
  for (const statement of module.statements) {
    if (statement === undefined) throw "STATEMENT_INVARIANT";
    if (statement.kind === "function" && statement.exported)
      exports.push(statement.name);
  }
  return {
    specifiers,
    body: module.statements.map(printStatement).join("\n"),
    exports,
  };
}

import { createSourceText } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import { lowerScript } from "../src/lowering/index.ts";
import { bindHostRecordViews } from "../../js-runtime/test/ordinary-object-host-record-views.ts";
bindHostRecordViews();
const runtime = await import("@tint/js-runtime/objects");
const globals = await import("@tint/js-runtime/environments/global");
const evaluation = await import("../src/script-evaluation.ts");
const specifierModules = new Map<string, Record<string, unknown>>([
  ["@tint/js-runtime/objects", runtime],
  ["@tint/js-runtime/environments/global", globals],
  [
    "@tint/js-runtime/environments/records",
    await import("@tint/js-runtime/environments/records"),
  ],
  ["@tint/js-runtime/modules", await import("@tint/js-runtime/modules")],
  ["@tint/js-runtime/disposal", await import("@tint/js-runtime/disposal")],
]);

type Entry = (
  global: unknown,
  script: unknown,
) => {
  readonly error: string;
  readonly value: unknown;
};

// Node stands in for the compiler-bound direct-eval site record check.
function viewDirectEvalSite(value: unknown): unknown {
  return typeof value === "object" &&
    value !== null &&
    "variables" in value &&
    "catches" in value
    ? value
    : undefined;
}

/** Instantiate a lowered module's printed entry over this checkout's runtime. */
export function instantiateLoweredModule(module: Module): Entry {
  const printed = printLoweredModule(module);
  const names: string[] = [],
    values: unknown[] = [];
  for (const [specifier, imported] of printed.specifiers) {
    const source = specifierModules.get(specifier);
    if (source === undefined) throw new Error("unknown import " + specifier);
    for (const name of imported) {
      // Type-only vocabulary (records, keys) has no runtime value.
      if (!(name in source)) continue;
      names.push(name);
      values.push(
        name === "viewDirectEvalSite" ? viewDirectEvalSite : source[name],
      );
    }
  }
  const factory = new Function(
    ...names,
    printed.body + "\nreturn execute;",
  ) as (...values: unknown[]) => Entry;
  return factory(...values);
}

type ScriptLowering = typeof lowerScript;

/** Lower Script source and return its executable entry. Callers may pass
 * their own lowering entry; the default is this checkout's source. */
export function compileLoweredScript(
  text: string,
  lower: ScriptLowering = lowerScript,
): Entry {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  if (!source.ok) throw new Error("source text failed");
  const parsed = parseScript(source.value);
  if (!parsed.ok) throw new Error("parse: " + JSON.stringify(parsed.error));
  const lowered = lower(parsed.value);
  if (!lowered.ok) throw new Error("lower: " + JSON.stringify(lowered.error));
  return instantiateLoweredModule(lowered.value);
}

export interface LoweredRealm {
  /** Run Script text; returns "none" or the thrown error's constructor name. */
  run(text: string): string;
  /** Messages passed to the global print function. */
  readonly printed: string[];
  /** Entries compiled through the evaluator host (eval, not top-level runs). */
  compiledEntries(): number;
  drain(): void;
}

/** A realm resembling the native Test262 host's intrinsic installation.
 * Indirect and direct eval compile through the evaluator host contract with
 * this checkout's lowering. Function constructors, Date, Intl, Temporal and
 * weak collections are not installed; tests needing them are not meaningful. */
export function createLoweredRealm(
  lower: ScriptLowering = lowerScript,
): LoweredRealm {
  const r = runtime as unknown as Record<string, (...args: unknown[]) => any>;
  const prototype = r.createObject!(undefined);
  const object = r.createObject!(prototype);
  const hooks = {
    undefinedValue: undefined,
    sameValue: (a: unknown, b: unknown) => r.sameValue!(a, b),
    call: (callee: unknown, receiver: unknown, args: unknown[]) => {
      const result = r.callObjectValue!(callee, receiver, args, object);
      if (result.error !== "none") throw "INVALID_HOOK_CALL";
      return result.value;
    },
  };
  const global = (globals.createGlobalEnvironment as any)(
    object,
    object,
    object,
    (name: string) => name,
    hooks,
  );
  r.installGlobalProperties!(object, object, hooks);
  const realm = r.createErrorRealm!(
    prototype,
    hooks,
    r.createSymbolRegistry!(),
    r.createScriptAgent!(true),
  );
  for (const install of [
    "installErrorIntrinsics",
    "installArrayIntrinsics",
    "installArrayBufferIntrinsics",
    "installDataViewIntrinsics",
    "installObjectIntrinsics",
    "installFunctionIntrinsics",
    "installPrimitiveIntrinsics",
    "installIteratorConstructor",
    "installMapIntrinsics",
    "installSetIntrinsics",
    "installSymbolIntrinsics",
    "installProxyIntrinsics",
    "installReflectIntrinsics",
  ])
    r[install]!(object, realm, hooks);
  r.installTypedArrayIntrinsics!(object, realm, hooks, "little");
  r.installRegExpIntrinsics!(object, realm, hooks);
  r.installMathIntrinsics!(object, realm, hooks, () => 0.5);
  r.installPromiseIntrinsics!(object, realm, hooks, () => {});
  const entries: Entry[] = [];
  const host = {
    domain: () => 1,
    storage: {
      domain: 1,
      publish: () => {
        throw new Error("lowered-node-host does not publish native code");
      },
    },
    table: () => undefined,
    compile: (module: Module) => {
      entries.push(instantiateLoweredModule(module));
      // Module-level statements (template site recipes) are instantiated once
      // per compile here, so only entries without them may be reused.
      return module.statements.every(
        (statement) => statement.kind !== "variable",
      )
        ? {
            ok: true as const,
            address: entries.length,
            reusable: true as const,
          }
        : { ok: true as const, address: entries.length };
    },
    invoke: (
      address: number,
      frame: { $argument0: unknown; $argument1: unknown },
    ) => entries[address - 1]!(frame.$argument0, frame.$argument1),
    completion: (value: unknown) => value as never,
    fault: (reason: string) => {
      throw new Error("lowered-node-host evaluator fault: " + reason);
    },
  };
  const context = { realm, global };
  r.installEvalIntrinsic!(object, realm, hooks);
  r.installEvalCompiler!(
    realm,
    evaluation.createIndirectEvaluator(context, host as never),
  );
  r.installDirectEvalCompiler!(
    realm,
    evaluation.createDirectEvaluator(context, host as never),
  );
  const printed: string[] = [];
  const print = r.createCallableObject!(
    realm.functionPrototype,
    (_receiver: unknown, args: unknown[]) => {
      const converted = r.stringValue!(args[0], hooks, realm);
      printed.push(converted.error === "none" ? converted.value : "<print>");
      return undefined;
    },
  );
  r.createDataProperty!(object, "print", print, hooks);
  function errorName(value: unknown): string {
    const thrown = r.viewObjectValue!(value, object);
    if (thrown === undefined) return "non-object";
    const constructor = r.getObjectValueProperty!(
      value,
      "constructor",
      hooks,
      realm,
    );
    const fn = r.viewObjectValue!(constructor.value, object);
    const name =
      fn === undefined ? undefined : r.getOwnProperty!(fn, "name")?.value;
    const message = r.getOwnProperty!(thrown, "message")?.value;
    return String(name) + (message === undefined ? "" : ": " + message);
  }
  return {
    printed,
    compiledEntries: () => entries.length,
    run(text: string): string {
      const entry = compileLoweredScript(text, lower);
      const result = entry(global, r.createScriptRecord!(realm, undefined));
      if (result.error === "none") return "none";
      if (result.error === "unsupported") return "unsupported";
      return errorName(result.value);
    },
    drain(): void {
      r.drainScriptJobs!(realm.agent, (error: unknown) => {
        printed.push("job error: " + errorName(error));
      });
    },
  };
}
