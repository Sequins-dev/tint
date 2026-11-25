import { test } from "node:test";
import assert from "node:assert/strict";
import { verify, type FunctionIR, type ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import {
  fusedPropertyAccesses,
  knownObjectTagAccesses,
} from "../src/scalar/property-fusion.ts";
const span = { start: 0, end: 1 };
export function recordPredicate(record: number = 0): ModuleIR {
  return {
    records: [{ byteLength: 16, fields: [] }],
    functions: [
      {
        id: 0,
        name: "matches",
        exported: true,
        parameters: [0],
        slots: ["general"],
        returnType: "boolean",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "general-record-is", id: 1, value: 0, record, ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  };
}
test("general record predicates validate descriptors and emit without allocation helpers", () => {
  assert.ok(verify(recordPredicate()).ok);
  assert.equal(verify(recordPredicate(1)).ok, false);
  const result = emitModule(recordPredicate());
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.helpers.length, 0);
  assert.equal(result.value.records.length, 1);
});

test("knownObjectTagAccesses propagates object tag across fused own loads and record tests only on sound paths", () => {
  const propLoad = (
    id: number,
    object: number,
    site: number,
    inherited: boolean,
  ) => ({
    kind: "property-load" as const,
    id,
    object,
    site,
    record: 0,
    field: 0,
    count: 4,
    siteRecord: 1,
    siteField: 0,
    entries: 4,
    inherited,
    epochRecord: 0,
    epochField: 0,
    ...span,
  });
  // Block 0: own property-load on slot 0 -> fused hit -> block 1, miss -> block 2.
  // Block 1: second property-load on slot 0 (tag proven!), then reassigns slot 0 -> block 3.
  // Block 2 (miss): third property-load on slot 0 (tag NOT proven).
  // Block 3 (after reassign): fourth property-load on slot 0 (tag NOT proven).
  const fn: FunctionIR = {
    id: 0,
    name: "tagFlow",
    exported: true,
    parameters: [0, 1],
    slots: ["general", "reference", "general"],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "load", id: 1, slot: 1, ...span },
          propLoad(2, 0, 1, false),
          { kind: "general-is", id: 3, value: 2, type: "absent", ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 3,
          consequent: 2,
          alternate: 1,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 4, slot: 0, ...span },
          { kind: "load", id: 5, slot: 1, ...span },
          propLoad(6, 4, 5, false),
          { kind: "load", id: 7, slot: 2, ...span },
          { kind: "store", slot: 0, value: 7, ...span },
        ],
        terminator: { kind: "jump", target: 3, ...span },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 8, slot: 0, ...span },
          { kind: "load", id: 9, slot: 1, ...span },
          propLoad(10, 8, 9, false),
        ],
        terminator: { kind: "return", value: 10, ...span },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 11, slot: 0, ...span },
          { kind: "load", id: 12, slot: 1, ...span },
          propLoad(13, 11, 12, false),
        ],
        terminator: { kind: "return", value: 13, ...span },
      },
    ],
  };
  const fused = fusedPropertyAccesses(fn);
  const known = knownObjectTagAccesses(fn, fused);
  assert.ok(known !== undefined);
  assert.equal(known.has(2), false);
  assert.equal(known.has(6), true);
  assert.equal(known.has(10), false);
  assert.equal(known.has(13), false);

  // Inherited property-load can match string primitives (tag 3), so it must NOT
  // prove tag === 5 on the hit edge.
  const inheritedFn: FunctionIR = {
    ...fn,
    blocks: [
      {
        ...fn.blocks[0]!,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "load", id: 1, slot: 1, ...span },
          propLoad(2, 0, 1, true),
          { kind: "general-is", id: 3, value: 2, type: "absent", ...span },
        ],
      },
      ...fn.blocks.slice(1),
    ],
  };
  const inheritedKnown = knownObjectTagAccesses(
    inheritedFn,
    fusedPropertyAccesses(inheritedFn),
  );
  assert.equal(inheritedKnown?.has(6) ?? false, false);

  // A general-record-is branch proves tag === 5 on its true edge (and not false).
  const recordBranchFn: FunctionIR = {
    id: 1,
    name: "recordBranch",
    exported: true,
    parameters: [0, 1],
    slots: ["general", "reference"],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "general-record-is", id: 1, value: 0, record: 0, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 1,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 0, ...span },
          { kind: "load", id: 3, slot: 1, ...span },
          propLoad(4, 2, 3, false),
        ],
        terminator: { kind: "return", value: 4, ...span },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 5, slot: 0, ...span },
          { kind: "load", id: 6, slot: 1, ...span },
          propLoad(7, 5, 6, false),
        ],
        terminator: { kind: "return", value: 7, ...span },
      },
    ],
  };
  const branchKnown = knownObjectTagAccesses(
    recordBranchFn,
    fusedPropertyAccesses(recordBranchFn),
  );
  assert.equal(branchKnown?.has(4), true);
  assert.equal(branchKnown?.has(7) ?? false, false);
});
