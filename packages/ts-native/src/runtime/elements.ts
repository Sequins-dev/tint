import { createTypeSystem, type Type } from "@tint/typescript/types";
export interface ElementMatcher {
  readonly matches: (a: number, b: number, optional: boolean) => boolean;
}
export function createElementMatcher(types: readonly Type[]): ElementMatcher {
  const system = createTypeSystem(types);
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
