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
  expressions: ReadonlyKeyIndex<Expression, number>,
  references: ReadonlyKeyIndex<Expression, Binding>,
  declarations: ReadonlyKeyIndex<Span, Binding>,
  sinks: ReadonlyKeyIndex<Expression, boolean>,
  reads: ReadonlyKeyIndex<Expression, boolean>,
): LocalRealmPlan {
  const flows: Flow[] = [];
  const nodes = createKeyIndex<Expression, Flow>(syntaxHash);
  const consumed = createKeyIndex<Expression, boolean>(syntaxHash);
  const locals = new Map<number, Flow>();
  const initializers = new Set<number>();

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
            binding.captured ||
            node.mode === "var" ||
            !nodes.has(initializer)
          )
            continue;
          initializers.add(binding.id);
          use(initializer, local(binding.id));
        }
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
          if (flow !== undefined) use(node.expression, flow);
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
            else if (sinks.has(node)) use(property.value, flow);
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
          const target = node.callee;
          if (
            target.kind === "member" &&
            target.property === "push" &&
            kind(target.object)?.kind === "array"
          ) {
            const list = use(target.object);
            if (list !== undefined)
              for (const argument of node.arguments) {
                if (argument === undefined) throw "push flow invariant";
                use(argument, list);
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
        case "assignment": {
          const target = node.target;
          if (target.kind === "member" || target.kind === "index") {
            const receiver = use(target.object);
            if (receiver !== undefined) {
              connect(receiver, flow);
              if (kind(target.object)?.kind === "array")
                use(node.value, receiver);
            } else if (sinks.has(node.value))
              connect(flow, nodes.get(node.value));
            else if (flow !== undefined) flow.rejected = true;
          } else if (flow !== undefined) flow.rejected = true;
          break;
        }
        case "binary":
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
    const flow = locals.get(id);
    if (flow === undefined) continue;
    if (!initializers.has(id) || reference.access !== "read")
      flow.rejected = true;
  }

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
  return { literals, bindings };
}
