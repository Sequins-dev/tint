import {
  boundaryNumber,
  boundaryUnknown,
  type GeneralProgramRequest,
} from "@tint/compiler/native";
import { createSourceTextView } from "@tint/source/text";
import { bindJavaScriptModule } from "@tint/typescript/binding";
import {
  eraseTypeSyntax,
  parseModule,
  rewriteModule,
  type Expression,
  type Statement,
  type TypeNode,
} from "@tint/typescript/syntax";
import type { TypedCompanions } from "./function-fallback.ts";

type FunctionDeclaration = Extract<Statement, { kind: "function" }>;

function numeric(type: TypeNode | undefined): boolean {
  return (
    type?.kind === "named" &&
    type.name === "number" &&
    (type.arguments?.length ?? 0) === 0
  );
}

function arithmetic(operator: string): boolean {
  return ["+", "-", "*", "/", "%"].includes(operator);
}

/** Keep an annotated arithmetic sibling native. Its lexical wrapper passes
 * reads and writes of the original cell, so aliases and escaped closures
 * still share one binding per activation. */
export function planNestedCompanions(
  request: GeneralProgramRequest,
  typedId: string,
  runtimeObjects: string,
): TypedCompanions | undefined {
  const owner = request.trigger?.owner;
  if (request.sourceValidated !== true || owner?.kind !== "function")
    return undefined;
  const source = request.modules.find((module) => module.id === owner.module);
  if (source === undefined) return undefined;
  if (
    source.module.statements.some(
      (statement) =>
        statement.start === owner.start && statement.end === owner.end,
    )
  )
    return undefined;
  const bound = bindJavaScriptModule(eraseTypeSyntax(source.module));
  if (!bound.ok || (bound.value.directEvalOwners?.length ?? 0) !== 0)
    return undefined;
  const graph = bound.value;
  const selected = graph.functions.find(
    (frame) => frame.node.start === owner.start && frame.node.end === owner.end,
  );
  if (selected?.parent === undefined) return undefined;
  const annotated = new Set<number>();
  const functions = new Map<number, FunctionDeclaration>();
  rewriteModule(source.module, {
    statement: (statement, original) => {
      if (original.kind === "variable") {
        for (const declaration of original.declarations)
          if (
            declaration.kind !== "object-binding" &&
            declaration.kind !== "array-binding" &&
            numeric(declaration.type)
          )
            annotated.add(declaration.start);
      }
      if (original.kind === "function") {
        functions.set(original.start, original);
        for (const parameter of original.parameters)
          if (parameter.kind !== "pattern-parameter" && numeric(parameter.type))
            annotated.add(parameter.start);
      }
      return statement;
    },
  });
  const fallback = functions.get(owner.start);
  if (fallback === undefined) return undefined;
  const used = new Set(graph.bindings.map((binding) => binding.name));
  function name(base: string): string {
    let candidate = "$" + base;
    while (used.has(candidate)) candidate += "$";
    used.add(candidate);
    return candidate;
  }
  const read = name("readCapture");
  const write = name("writeCapture");
  const call = name("callCapture");
  const adapter = name("nestedNative");
  function parse(text: string) {
    const result = parseModule(createSourceTextView(text));
    if (!result.ok)
      throw Error("nested closure bridge: " + result.error.message);
    return result.value;
  }

  for (const frame of graph.functions) {
    if (
      frame.parent !== selected.parent ||
      frame.id === selected.id ||
      frame.captures.length === 0 ||
      frame.captures.length > 4
    )
      continue;
    const fn = functions.get(frame.node.start);
    if (
      fn === undefined ||
      fn.body.kind !== "block" ||
      fn.end !== frame.node.end ||
      fn.async ||
      fn.generator ||
      fn.receiver !== undefined ||
      (fn.typeParameters?.length ?? 0) !== 0 ||
      !numeric(fn.returnType) ||
      !fn.parameters.every(
        (parameter) =>
          parameter.kind !== "pattern-parameter" &&
          !parameter.rest &&
          !parameter.optional &&
          parameter.initializer === undefined &&
          numeric(parameter.type),
      )
    )
      continue;
    const parameters: string[] = [];
    for (const parameter of fn.parameters)
      if (parameter.kind !== "pattern-parameter")
        parameters.push(parameter.name);
    const bridges = new Map<number, { read?: string; write?: string }>();
    const forwarded: string[] = [],
      callArguments: string[] = [];
    for (const capture of frame.captures) {
      const binding = graph.bindings[capture.binding];
      if (
        binding === undefined ||
        capture.forwarded ||
        !annotated.has(binding.node.start) ||
        (capture.write && !binding.mutable)
      )
        break;
      const getters: { read?: string; write?: string } = {};
      if (capture.read) {
        const getter = name("get");
        getters.read = getter;
        forwarded.push(getter + ": unknown");
        callArguments.push("() => " + binding.name);
      }
      if (capture.write) {
        const setter = name("set");
        const incoming = name("next");
        getters.write = setter;
        forwarded.push(setter + ": unknown");
        callArguments.push(
          "(" +
            incoming +
            ": number) => { " +
            binding.name +
            " = " +
            incoming +
            "; }",
        );
      }
      bridges.set(capture.binding, getters);
    }
    if (bridges.size !== frame.captures.length) continue;
    const references = new Map<number, number>();
    for (const reference of graph.references)
      if (
        reference.binding !== undefined &&
        reference.node.start >= fn.body.start &&
        reference.node.end <= fn.body.end
      )
        references.set(reference.node.start, reference.binding);
    function access(node: Expression) {
      if (node.kind !== "identifier") return undefined;
      return bridges.get(references.get(node.start) ?? -1);
    }
    function value(node: Expression): string | undefined {
      if (node.kind === "number") return node.raw;
      if (node.kind === "group") return value(node.expression);
      if (node.kind === "identifier") {
        const bridge = access(node)?.read;
        return bridge !== undefined
          ? read + "(" + bridge + ")"
          : parameters.includes(node.name)
            ? node.name
            : undefined;
      }
      if (
        node.kind === "unary" &&
        (node.operator === "-" || node.operator === "+")
      ) {
        const operand = value(node.operand);
        return operand === undefined
          ? undefined
          : "(" + node.operator + operand + ")";
      }
      if (node.kind === "binary" && arithmetic(node.operator)) {
        const left = value(node.left),
          right = value(node.right);
        return left === undefined || right === undefined
          ? undefined
          : "(" + left + " " + node.operator + " " + right + ")";
      }
      if (node.kind === "assignment" || node.kind === "compound") {
        const bridge = access(node.target)?.write,
          right = value(node.value);
        if (bridge === undefined || right === undefined) return undefined;
        if (node.kind === "assignment")
          return write + "(" + bridge + "," + right + ")";
        const left = value(node.target);
        return left === undefined || !arithmetic(node.operator)
          ? undefined
          : write +
              "(" +
              bridge +
              "," +
              left +
              " " +
              node.operator +
              " " +
              right +
              ")";
      }
      return undefined;
    }
    const body: string[] = [];
    for (const statement of fn.body.statements) {
      if (
        statement.kind !== "return" &&
        statement.kind !== "throw" &&
        statement.kind !== "expression"
      )
        break;
      const expression = statement.expression;
      const printed = expression === undefined ? undefined : value(expression);
      if (printed === undefined) break;
      body.push(
        (statement.kind === "expression" ? "" : statement.kind + " ") +
          printed +
          ";",
      );
    }
    const last = fn.body.statements.at(-1);
    if (
      body.length !== fn.body.statements.length ||
      (last?.kind !== "return" && last?.kind !== "throw")
    )
      continue;

    const imports = parse(
      "import {" + adapter + "} from " + JSON.stringify(typedId) + ";",
    );
    const wrapper = parse(
      " ".repeat(source.module.end + 1) +
        "function $wrapper() { return " +
        adapter +
        "(" +
        [...callArguments, ...parameters].join(",") +
        "); }",
    ).statements[0];
    if (wrapper?.kind !== "function")
      throw Error("nested bridge wrapper invariant");
    const general = rewriteModule(source.module, {
      statement: (mapped, original) =>
        original === fn && mapped.kind === "function"
          ? { ...mapped, body: wrapper.body }
          : mapped,
    });
    const numericParameters = parameters.map(
      (parameter) => parameter + ": number",
    );
    const typed = parse(`
import {callGeneralValue as ${call}} from ${JSON.stringify(runtimeObjects)};
function ${read}(reader: unknown): number {
  const result = ${call}(reader, undefined, []);
  if (typeof result !== "number") throw new TypeError("Invalid numeric capture");
  return result;
}
function ${write}(writer: unknown, value: number): number {
  ${call}(writer, undefined, [value]);
  return value;
}
export function ${adapter}(${[...forwarded, ...numericParameters].join(",")}): number {
  ${body.join("\n")}
}`);
    const dependencies = new Map(source.dependencies);
    dependencies.set(typedId, typedId);
    return {
      name: fallback.name,
      kind: "function",
      general: {
        ...source,
        dependencies,
        module: {
          ...general,
          imports: [...imports.imports, ...general.imports],
          statements: [...imports.statements, ...general.statements],
        },
      },
      typed: {
        id: typedId,
        dependencies: new Map([[runtimeObjects, runtimeObjects]]),
        module: typed,
      },
      boundary: {
        id: typedId,
        exports: [
          {
            kind: "function",
            name: adapter,
            local: adapter,
            parameters: [
              ...forwarded.map(() => boundaryUnknown),
              ...parameters.map(() => boundaryNumber),
            ],
          },
        ],
      },
    };
  }
  return undefined;
}
