import type { CheckedClosures } from "@tint/typescript/checker";
export type ManagedFunctionClass =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: number | undefined };
export type ManagedFunctionFlowCheck =
  { readonly ok: true } | { readonly ok: false; readonly error: string };
/** Flows are deduplicated by type pair, not source site. Check the whole graph,
 * including pairs first observed in an opaque runtime body. Structural views
 * must not hide a callback whose caller expects another descriptor contract. */
export function checkManagedFunctionFlows(
  checked: CheckedClosures,
  classOf: (type: number) => ManagedFunctionClass,
  assignable: (source: number, target: number) => boolean,
  maxWork: number = 100000,
): ManagedFunctionFlowCheck {
  const reject = (error: string): ManagedFunctionFlowCheck => ({
    ok: false,
    error,
  });
  if (!Number.isSafeInteger(maxWork) || maxWork <= 0)
    return reject("invalid function flow analysis budget");
  const pending: number[] = [];
  for (const flow of checked.typeFlows) {
    if (flow === undefined) return reject("missing function flow");
    pending.push(flow.source, flow.target);
  }
  const visited = new Set<string>();
  let work = 0;
  for (let index = 0; index < pending.length; index += 2) {
    if (++work > maxWork)
      return reject("function flow analysis budget exceeded");
    const source = pending[index],
      target = pending[index + 1];
    if (source === undefined || target === undefined)
      return reject("missing function flow type");
    if (source === target) continue;
    const key = String(source) + ":" + String(target);
    if (visited.has(key)) continue;
    visited.add(key);
    const from = checked.types[source],
      to = checked.types[target];
    if (from === undefined || to === undefined)
      return reject("invalid function flow type");
    if (from.kind === "union") {
      for (const member of from.members) {
        if (member === undefined)
          return reject("missing function flow union member");
        pending.push(member, target);
      }
      continue;
    }
    if (to.kind === "union") {
      for (const member of to.members) {
        if (member === undefined)
          return reject("missing function flow union member");
        if (assignable(source, member)) pending.push(source, member);
      }
      continue;
    }
    if (from.kind === "function" && to.kind === "function") {
      const left = classOf(source);
      if (!left.ok) return left;
      const right = classOf(target);
      if (!right.ok) return right;
      if (
        left.value !== right.value &&
        (left.value !== undefined || right.value !== undefined)
      )
        return reject("function flow crosses surface classes");
      pending.push(from.result, to.result);
      const sourceReceiver = from.receiver,
        targetReceiver = to.receiver;
      if (sourceReceiver !== undefined && targetReceiver !== undefined)
        pending.push(targetReceiver, sourceReceiver);
      for (let parameter = 0; parameter < from.parameters.length; parameter++) {
        const a = from.parameters[parameter],
          b = to.parameters[parameter];
        if (a !== undefined && b !== undefined) pending.push(b, a);
      }
    } else if (from.kind === "object" && to.kind === "object") {
      for (const property of to.properties) {
        if (property === undefined)
          return reject("missing function flow property");
        const original = from.properties.find(
          (candidate) =>
            candidate !== undefined && candidate.name === property.name,
        );
        if (original !== undefined) pending.push(original.type, property.type);
      }
    } else if (
      (from.kind === "array" && to.kind === "array") ||
      (from.kind === "set" && to.kind === "set")
    )
      pending.push(from.element, to.element);
    else if (from.kind === "map" && to.kind === "map")
      pending.push(from.key, to.key, from.value, to.value);
  }
  return { ok: true };
}
