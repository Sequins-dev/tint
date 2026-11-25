import {
  createTypeSystem,
  isNativeTypedArrayKind,
  type Result,
  type Type,
  type TypeSystem,
} from "@tint/typescript/types";
import type { CollectionElement } from "../scalar.ts";
export interface ElementMatcher {
  readonly matches: (a: number, b: number, optional: boolean) => boolean;
}
/** Whether `value` is a supported list element type, so compact key-specialized
 * maps (`number-key-map`, `string-key-map`) can store parallel `V[]` values. */
export function supportsCompactMapValue(
  types: readonly Type[],
  value: CollectionElement,
): boolean {
  if (typeof value !== "number") return true;
  function check(id: number, seen: Set<number>): boolean {
    if (seen.has(id)) return false;
    const t = types[id];
    if (t === undefined) return false;
    if (
      t.kind === "unknown" ||
      t.kind === "void-value" ||
      t.kind === "never" ||
      t.kind === "number" ||
      t.kind === "string" ||
      t.kind === "boolean" ||
      t.kind === "bigint" ||
      t.kind === "undefined" ||
      t.kind === "literal" ||
      t.kind === "object" ||
      t.kind === "function" ||
      isNativeTypedArrayKind(t.kind)
    )
      return true;
    const path = new Set<number>(seen);
    path.add(id);
    if (t.kind === "array")
      return t.realmArray !== true && check(t.element, path);
    if (t.kind === "set") {
      const element = types[t.element];
      return element?.kind === "number" || element?.kind === "string";
    }
    if (t.kind === "union") {
      if (t.members.length === 0) return false;
      for (const m of t.members)
        if (m === undefined || !check(m, path)) return false;
      return true;
    }
    return false;
  }
  return check(value, new Set<number>());
}
/** A supplied system must describe exactly `types` (the checker's own,
 * published in lockstep with its graph); otherwise one is built. */
export function createElementMatcher(
  types: readonly Type[],
  typeSystem?: TypeSystem,
): ElementMatcher {
  const system: Result<TypeSystem> =
    typeSystem === undefined
      ? createTypeSystem(types)
      : { ok: true, value: typeSystem };
  if (!system.ok) throw "checked runtime type graph invariant";
  const checkedSystem = system.value;
  function presentAssignable(
    from: number,
    to: number,
    seen: Set<number>,
  ): boolean {
    if (seen.has(from)) return true;
    seen.add(from);
    const type = types[from];
    if (type?.kind === "undefined") return true;
    if (type?.kind === "union") {
      for (const member of type.members) {
        if (member === undefined) throw "runtime union invariant";
        if (!presentAssignable(member, to, seen)) return false;
      }
      return true;
    }
    return checkedSystem.assignable(from, to);
  }
  function matches(a: number, b: number, optional: boolean): boolean {
    return optional
      ? presentAssignable(a, b, new Set<number>()) &&
          presentAssignable(b, a, new Set<number>())
      : checkedSystem.assignable(a, b) && checkedSystem.assignable(b, a);
  }
  return { matches };
}
