import type { CheckedClosures } from "@tint/typescript/checker";
import type { TypeSystem } from "@tint/typescript/types";
import { arrayElement, entryType } from "./records.ts";
/** Semantic covariance does not establish that a native container can be read
 * through another representation. Until adapters exist, reject such flows. */
export function incompatibleRepresentationView(
  checked: CheckedClosures,
  system: TypeSystem,
): string | undefined {
  const visited = new Map<number, Set<number>>();
  let representations = "",
    view = "array view";
  function incompatible(source: number, target: number): boolean {
    if (source === target) return false;
    let targets = visited.get(source);
    if (targets === undefined) {
      targets = new Set<number>();
      visited.set(source, targets);
    }
    if (targets.has(target)) return false;
    targets.add(target);
    const from = checked.types[source],
      to = checked.types[target];
    if (from === undefined || to === undefined) return false;
    if (from.kind === "union")
      return from.members.some((member) => incompatible(member, target));
    if (to.kind === "union")
      return to.members.some(
        (member) =>
          system.assignable(source, member) && incompatible(source, member),
      );
    if (
      (from.kind === "function" && to.kind === "object") ||
      (from.kind === "object" && to.kind === "function")
    ) {
      view = "callable view";
      representations = from.kind + " -> " + to.kind;
      return true;
    }
    if (from.kind === "set" && to.kind === "set")
      return incompatible(from.element, to.element);
    if (from.kind === "map" && to.kind === "map")
      return (
        incompatible(from.key, to.key) || incompatible(from.value, to.value)
      );
    if (from.kind === "array" && to.kind === "array") {
      const a = arrayElement(checked, source),
        b = arrayElement(checked, target);
      const encodingA = typeof a === "number" ? entryType(checked, a) : a;
      const encodingB = typeof b === "number" ? entryType(checked, b) : b;
      // Fresh contextual-literal proofs may carry an inferred type which has no
      // standalone runtime encoding. Normal lowering validates those encodings.
      if (encodingA === undefined || encodingB === undefined) return false;
      if (encodingA !== encodingB) {
        representations = encodingA + " -> " + encodingB;
        return true;
      }
      return incompatible(from.element, to.element);
    }
    if (from.kind === "object" && to.kind === "object") {
      for (const property of to.properties) {
        if (property === undefined) throw "PROPERTY_INVARIANT";
        const original = from.properties.find(
          (candidate) =>
            candidate !== undefined && candidate.name === property.name,
        );
        if (
          original !== undefined &&
          incompatible(original.type, property.type)
        )
          return true;
      }
    }
    if (from.kind === "function" && to.kind === "function") {
      const sourceReceiver = from.receiver,
        targetReceiver = to.receiver;
      if (
        sourceReceiver !== undefined &&
        targetReceiver !== undefined &&
        incompatible(targetReceiver, sourceReceiver)
      )
        return true;
      if (incompatible(from.result, to.result)) return true;
      for (let i = 0; i < from.parameters.length; i++) {
        const a = from.parameters[i],
          b = to.parameters[i];
        if (a !== undefined && b !== undefined && incompatible(b, a))
          return true;
      }
    }
    return false;
  }
  for (const flow of checked.typeFlows) {
    if (flow === undefined) throw "TYPE_FLOW_INVARIANT";
    if (incompatible(flow.source, flow.target))
      return (
        view +
        " requires a representation adapter (" +
        representations +
        ") at " +
        flow.node.start
      );
  }
  return undefined;
}
