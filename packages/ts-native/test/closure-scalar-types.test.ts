import test from "node:test";
import assert from "node:assert/strict";
import type { CheckedClosures } from "@tint/typescript/checker";
import { scalarType } from "../src/closure/lowering/planning.ts";

/** A narrowed discriminated union is a chain of two-member unions, one per
 * excluded case; its encoding is computed in linear time (each member's
 * once), where recomputing members per test tripled the work per level. */
function chain(depth: number, last: { readonly kind: string }) {
  const types: unknown[] = [{ kind: "boolean" }, { kind: "undefined" }, last];
  let previous = types.length;
  types.push({ kind: "union", members: [0, 1] });
  for (let level = 0; level < depth; level++) {
    types.push({ kind: "union", members: [previous, level % 2 === 0 ? 0 : 2] });
    previous = types.length - 1;
  }
  return {
    checked: { types } as unknown as CheckedClosures,
    root: previous,
  };
}

test("deeply nested unions encode in linear time", () => {
  const optional = chain(80, { kind: "undefined" });
  assert.equal(scalarType(optional.checked, optional.root), "optional-boolean");
  const mixed = chain(80, { kind: "string" });
  assert.equal(scalarType(mixed.checked, mixed.root), undefined);
  const flat = chain(0, { kind: "undefined" });
  assert.equal(scalarType(flat.checked, flat.root), "optional-boolean");
});
