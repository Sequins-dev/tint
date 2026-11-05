import { test } from "node:test";
import assert from "node:assert/strict";
import {
  visitInstructionOperands,
  substituteInstructionValues,
  substituteTerminatorValues,
  visitTerminatorOperands,
  type Instruction,
  type Terminator,
} from "../src/scalar/index.ts";
const span = { start: 0, end: 0 };
test("operand traversal excludes literals and identities but includes presence and captured values", () => {
  const cases: [Instruction, number[]][] = [
    [{ kind: "constant", id: 99, value: 42, ...span }, []],
    [{ kind: "load", id: 99, slot: 42, ...span }, []],
    [{ kind: "function-environment", id: 99, callee: 1, ...span }, [1]],
    [
      { kind: "record-has", id: 99, object: 1, record: 42, field: 43, ...span },
      [1],
    ],
    [
      {
        kind: "record-new",
        id: 99,
        record: 42,
        arguments: [1, undefined, 2],
        presence: [undefined, 3],
        ...span,
      },
      [1, 2, 3],
    ],
    [
      { kind: "function-new", id: 99, target: 42, environment: 1, ...span },
      [1],
    ],
    [
      {
        kind: "call",
        id: 99,
        target: 42,
        environment: "inherit",
        arguments: [1, 2],
        ...span,
      },
      [1, 2],
    ],
    [
      {
        kind: "call-indirect",
        id: 99,
        target: 42,
        callee: 3,
        arguments: [1, 2],
        ...span,
      },
      [3, 1, 2],
    ],
    [
      { kind: "string-from-code-units", id: 99, values: [1, 2], ...span },
      [1, 2],
    ],
    [{ kind: "array-write", array: 1, index: 2, value: 3, ...span }, [1, 2, 3]],
  ];
  for (const [op, expected] of cases) {
    const actual: number[] = [];
    visitInstructionOperands(op, (id) => actual.push(id));
    assert.deepEqual(actual, expected, op.kind);
    const aliases = new Uint32Array(100);
    for (const id of expected) aliases[id] = id + 11;
    const rewritten = substituteInstructionValues(op, aliases),
      mapped: number[] = [];
    visitInstructionOperands(rewritten, (id) => mapped.push(id));
    assert.deepEqual(
      mapped,
      expected.map((id) => id + 10),
      op.kind,
    );
    assert.equal(substituteInstructionValues(op, new Uint32Array(100)), op);
  }
});
test("terminator traversal distinguishes values from slots and control-flow labels", () => {
  const cases: [Terminator, number[]][] = [
    [
      {
        kind: "record-cell",
        object: 1,
        record: 42,
        field: 43,
        operation: "write",
        slot: 44,
        consequent: 45,
        alternate: 46,
        ...span,
      },
      [1],
    ],
    [
      {
        kind: "cell",
        cell: 42,
        operation: "write",
        slot: 43,
        consequent: 44,
        alternate: 45,
        ...span,
      },
      [],
    ],
    [
      { kind: "branch", condition: 1, consequent: 42, alternate: 43, ...span },
      [1],
    ],
    [{ kind: "throw", value: 1, ...span }, [1]],
    [{ kind: "return", value: undefined, ...span }, []],
  ];
  for (const [op, expected] of cases) {
    const actual: number[] = [];
    visitTerminatorOperands(op, (id) => actual.push(id));
    assert.deepEqual(actual, expected, op.kind);
    const aliases = new Uint32Array(100);
    for (const id of expected) aliases[id] = id + 11;
    const rewritten = substituteTerminatorValues(op, aliases),
      mapped: number[] = [];
    visitTerminatorOperands(rewritten, (id) => mapped.push(id));
    assert.deepEqual(
      mapped,
      expected.map((id) => id + 10),
      op.kind,
    );
    assert.equal(substituteTerminatorValues(op, new Uint32Array(100)), op);
  }
});
