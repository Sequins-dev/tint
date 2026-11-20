import {
  createKeyIndex,
  type ReadonlyKeyIndex,
} from "@tint/foundation/collections/key-index";
import type { Binding, BoundModule } from "../binding/index.ts";
import {
  rewriteModule,
  syntaxHash,
  type Expression,
  type Module,
  type Span,
} from "../syntax/index.ts";
import type { Type } from "../types/index.ts";

export interface LocalRealmPlan {
  readonly literals: ReadonlyKeyIndex<Expression, boolean>;
  readonly bindings: ReadonlySet<number>;
  readonly results: ReadonlySet<number>;
}

interface DirectFunction {
  readonly parameters: readonly (number | undefined)[];
  result: Flow | undefined;
  escapes: boolean;
}

interface Flow {
  readonly id: number;
  readonly neighbors: number[];
  rejected: boolean;
  demanded: boolean;
}

export function aggregatePayload(types: readonly Type[], id: number): boolean {
  const type = types[id];
  if (type?.kind === "array") return type.realmArray !== true;
  if (type?.kind === "object")
    return type.stringIndex === undefined && type.realmRecord !== true;
  return (
    type?.kind === "union" &&
    type.members.some(
      (member) => member !== undefined && aggregatePayload(types, member),
    )
  );
}

/** A component contains the storage site, local aliases and aggregates stored
 * inside it. Every reference in the component must have a modeled use before
 * any of its allocations can change representation. */
export function planLocalRealm(
  module: Module,
  bound: BoundModule,
  types: readonly Type[],
  bindingTypes: readonly number[],
  expressions: ReadonlyKeyIndex<Expression, number>,
  references: ReadonlyKeyIndex<Expression, Binding>,
  declarations: ReadonlyKeyIndex<Span, Binding>,
  functions: ReadonlyKeyIndex<Span, number>,
  returnOwners: ReadonlyKeyIndex<Span, number>,
  sinks: ReadonlyKeyIndex<Expression, boolean>,
  reads: ReadonlyKeyIndex<Expression, boolean>,
): LocalRealmPlan {
  const flows: Flow[] = [];
  const nodes = createKeyIndex<Expression, Flow>(syntaxHash);
  const consumed = createKeyIndex<Expression, boolean>(syntaxHash);
  const locals = new Map<number, Flow>();
  const initializers = new Set<number>();
  const direct = new Map<number, DirectFunction>();
  const functionNodes = new Map<number, DirectFunction>();
  const called = createKeyIndex<Expression, boolean>(syntaxHash);
  const writes = createKeyIndex<Expression, boolean>(syntaxHash);
  rewriteModule(module, {
    statement: (mapped, node) => {
      if (node.kind !== "function") return mapped;
      const params = node.parameters,
        exported = node.exported;
      const binding = declarations.get(node);
      if (binding === undefined) throw "realm function binding invariant";
      const id = functions.get(node);
      const type = types[bindingTypes[binding.id] ?? -1];
      if (id === undefined || type?.kind !== "function") return mapped;
      const parameters = params.map((parameter) =>
        parameter === undefined ? undefined : declarations.get(parameter)?.id,
      );
      const plan: DirectFunction = {
        parameters,
        result: aggregatePayload(types, type.result) ? newFlow() : undefined,
        escapes:
          exported ||
          params.some(
            (p) =>
              p === undefined ||
              p.kind === "pattern-parameter" ||
              p.rest === true ||
              p.initializer !== undefined ||
              p.optional === true,
          ),
      };
      direct.set(binding.id, plan);
      functionNodes.set(id, plan);
      return mapped;
    },
  });

  function newFlow(): Flow {
    const flow: Flow = {
      id: flows.length,
      neighbors: [],
      rejected: false,
      demanded: false,
    };
    flows.push(flow);
    return flow;
  }
  function local(id: number): Flow {
    const known = locals.get(id);
    if (known !== undefined) return known;
    const flow = newFlow();
    locals.set(id, flow);
    return flow;
  }
  function connect(left: Flow | undefined, right: Flow | undefined): void {
    if (left === undefined || right === undefined || left === right) return;
    left.neighbors.push(right.id);
    right.neighbors.push(left.id);
  }
  function use(node: Expression, parent?: Flow): Flow | undefined {
    consumed.set(node, true);
    const child = nodes.get(node);
    connect(parent, child);
    return child;
  }
  function kind(node: Expression): Type | undefined {
    return types[expressions.get(node) ?? -1];
  }
  function localAllocation(node: Expression): boolean {
    return bound.functions.some(
      (fn) =>
        fn !== undefined &&
        fn.node.start <= node.start &&
        fn.node.end >= node.end,
    );
  }
  rewriteModule(module, {
    statement: (mapped, node) => {
      if (node.kind === "expression" && node.expression.kind === "assignment")
        use(node.expression);
      if (node.kind === "variable") {
        for (const declaration of node.declarations) {
          if (
            declaration === undefined ||
            declaration.kind === "object-binding" ||
            declaration.kind === "array-binding"
          )
            continue;
          const initializer = declaration.initializer;
          const binding = declarations.get(declaration);
          if (
            initializer === undefined ||
            binding === undefined ||
            binding.owner === undefined ||
            node.mode === "var" ||
            !nodes.has(initializer)
          )
            continue;
          initializers.add(binding.id);
          use(initializer, local(binding.id));
        }
      } else if (node.kind === "return" && node.expression !== undefined) {
        const value = node.expression;
        const result = functionNodes.get(returnOwners.get(node) ?? -1)?.result;
        if (result !== undefined) use(value, result);
      }
      return mapped;
    },
    expression: (mapped, node) => {
      const type = expressions.get(node);
      const flow =
        type !== undefined && aggregatePayload(types, type)
          ? newFlow()
          : undefined;
      if (flow !== undefined) {
        nodes.set(node, flow);
        if (sinks.has(node)) {
          flow.demanded = true;
          consumed.set(node, true);
        }
      }
      switch (node.kind) {
        case "group":
        case "satisfies":
          if (flow !== undefined) use(node.expression, flow);
          break;
        case "conditional":
          if (flow !== undefined) {
            use(node.consequent, flow);
            use(node.alternate, flow);
          }
          break;
        case "identifier": {
          const binding = references.get(node);
          if (flow !== undefined && binding !== undefined)
            connect(flow, local(binding.id));
          break;
        }
        case "array":
          if (flow === undefined) break;
          if (!localAllocation(node)) flow.rejected = true;
          for (const element of node.elements) {
            if (element === undefined) throw "array flow invariant";
            if (element.kind === "spread") flow.rejected = true;
            else use(element, flow);
          }
          break;
        case "object":
          if (flow === undefined) break;
          if (!localAllocation(node)) flow.rejected = true;
          for (const property of node.properties) {
            if (property === undefined) throw "record flow invariant";
            if (property.kind === "spread") flow.rejected = true;
            else use(property.value, flow);
          }
          break;
        case "member":
        case "index": {
          if (reads.has(node)) {
            if (flow !== undefined) flow.demanded = true;
          } else if (nodes.has(node.object)) {
            use(node.object, flow);
          } else if (flow !== undefined) flow.rejected = true;
          break;
        }
        case "call": {
          let target = node.callee;
          while (target.kind === "group" || target.kind === "satisfies")
            target = target.expression;
          const binding =
            target.kind === "identifier" ? references.get(target) : undefined;
          const fn = binding === undefined ? undefined : direct.get(binding.id);
          if (fn !== undefined) {
            called.set(target, true);
            if (
              node.arguments.length !== fn.parameters.length ||
              node.arguments.some((arg) => arg?.kind === "spread")
            )
              fn.escapes = true;
            for (let i = 0; i < fn.parameters.length; i++) {
              const arg = node.arguments[i],
                param = fn.parameters[i];
              if (arg === undefined || param === undefined) continue;
              if (aggregatePayload(types, bindingTypes[param] ?? -1))
                use(arg, local(param));
            }
            connect(flow, fn.result);
            if (flow !== undefined && fn.result === undefined)
              flow.rejected = true;
            break;
          }
          if (
            target.kind === "member" &&
            kind(target.object)?.kind === "array"
          ) {
            const name = target.property;
            const methods = [
              "push",
              "unshift",
              "pop",
              "shift",
              "splice",
              "fill",
              "at",
              "join",
              "includes",
              "indexOf",
              "lastIndexOf",
              "slice",
              "copyWithin",
              "reverse",
              "sort",
              "toReversed",
              "toSorted",
              "toSpliced",
              "with",
            ];
            if (methods.includes(name)) {
              const receiver = use(target.object, flow);
              const first =
                name === "splice" || name === "toSpliced"
                  ? 2
                  : name === "with"
                    ? 1
                    : 0;
              const count =
                name === "fill" || name === "with"
                  ? 1
                  : name === "splice" ||
                      name === "toSpliced" ||
                      name === "push" ||
                      name === "unshift"
                    ? node.arguments.length - first
                    : 0;
              for (let i: number = first; i < first + count; i++) {
                const arg = node.arguments[i];
                if (arg !== undefined) use(arg, receiver);
              }
              break;
            }
          }
          const receiver = target.kind === "member" ? target.object : undefined;
          if (
            target.kind === "member" &&
            receiver?.kind === "identifier" &&
            receiver.name === "Object" &&
            !references.has(receiver) &&
            (target.property === "keys" || target.property === "hasOwn")
          ) {
            const object = node.arguments[0];
            if (object !== undefined) use(object);
          }
          if (flow !== undefined) flow.rejected = true;
          break;
        }
        case "compound":
        case "update":
        case "assignment": {
          let target = node.target;
          while (target.kind === "group") target = target.expression;
          if (target.kind === "member" || target.kind === "index") {
            const receiver = use(target.object, flow);
            use(target);
            if (node.kind !== "update") {
              if (receiver !== undefined) use(node.value, receiver);
              else if (sinks.has(node.value))
                connect(flow, nodes.get(node.value));
              else if (flow !== undefined) flow.rejected = true;
            }
          } else if (
            node.kind === "assignment" &&
            target.kind === "identifier"
          ) {
            const binding = references.get(target);
            if (binding !== undefined && nodes.has(node.value)) {
              const storage = local(binding.id);
              writes.set(target, true);
              use(target, storage);
              use(node.value, storage);
              connect(flow, storage);
            }
          } else if (flow !== undefined) flow.rejected = true;
          break;
        }
        case "binary":
          if (
            flow !== undefined &&
            (node.operator === "&&" ||
              node.operator === "||" ||
              node.operator === "??")
          ) {
            use(node.left, flow);
            use(node.right, flow);
            break;
          }
          if (
            node.operator === "===" ||
            node.operator === "!==" ||
            node.operator === "==" ||
            node.operator === "!="
          ) {
            const left = use(node.left);
            const right = use(node.right);
            connect(left, right);
          }
          if (flow !== undefined) flow.rejected = true;
          break;
        default:
          if (flow !== undefined) flow.rejected = true;
          break;
      }
      return mapped;
    },
  });
  nodes.forEach((flow, node) => {
    if (!consumed.has(node)) flow.rejected = true;
  });
  for (const reference of bound.references) {
    if (reference === undefined) throw "realm flow reference invariant";
    const id = reference.binding;
    if (id === undefined) continue;
    const fn = direct.get(id);
    if (fn !== undefined && !called.has(reference.node)) fn.escapes = true;
    const flow = locals.get(id);
    if (flow === undefined) continue;
    if (reference.access !== "read" && !writes.has(reference.node))
      flow.rejected = true;
  }
  for (const [_id, fn] of functionNodes) {
    const result = fn.result;
    if (fn.escapes && result !== undefined) result.rejected = true;
    for (const param of fn.parameters) {
      if (param === undefined) continue;
      const flow = locals.get(param);
      if (flow === undefined) continue;
      if (fn.escapes) flow.rejected = true;
      else initializers.add(param);
    }
  }
  for (const [id, flow] of locals)
    if (!initializers.has(id)) flow.rejected = true;

  const selected = new Set<number>();
  const visited = new Set<number>();
  for (const origin of flows) {
    if (origin === undefined) throw "realm flow invariant";
    if (!origin.demanded || visited.has(origin.id)) continue;
    const component: number[] = [origin.id];
    visited.add(origin.id);
    let valid = true;
    for (let index = 0; index < component.length; index++) {
      const current = flows[component[index] ?? -1];
      if (current === undefined) throw "realm component invariant";
      if (current.rejected) valid = false;
      for (const next of current.neighbors) {
        if (next === undefined) throw "realm neighbor invariant";
        if (visited.has(next)) continue;
        visited.add(next);
        component.push(next);
      }
    }
    if (valid)
      for (const id of component) {
        if (id === undefined) throw "realm component invariant";
        selected.add(id);
      }
  }
  const literals = createKeyIndex<Expression, boolean>(syntaxHash);
  const bindings = new Set<number>();
  nodes.forEach((flow, node) => {
    if (
      selected.has(flow.id) &&
      (node.kind === "array" || node.kind === "object")
    )
      literals.set(node, true);
  });
  for (const [id, flow] of locals) if (selected.has(flow.id)) bindings.add(id);
  const results = new Set<number>();
  for (const [id, fn] of functionNodes) {
    const result = fn.result;
    if (result !== undefined && selected.has(result.id)) results.add(id);
  }
  return { literals, bindings, results };
}
