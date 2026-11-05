import { test } from "node:test";
import assert from "node:assert/strict";
import { numericHelper } from "../src/aarch64/scalar/numeric.ts";
/** Small test-only executor for the leaf's instruction subset. Native corpus
 * validation remains the semantic authority; this gives deterministic work counts. */
function remainder(left: number, right: number) {
  const code = numericHelper("remainder"),
    d: number[] = [left, right],
    x: bigint[] = [];
  const bytes = new DataView(new ArrayBuffer(8));
  let pc = 0,
    steps = 0,
    comparison = 0,
    unordered = false;
  function bits(value: number) {
    bytes.setFloat64(0, value, true);
    return bytes.getBigUint64(0, true);
  }
  function number(value: bigint) {
    bytes.setBigUint64(0, value, true);
    return bytes.getFloat64(0, true);
  }
  while (steps++ < 20000) {
    const op = code[pc];
    assert.ok(op);
    let next = pc + 1;
    switch (op.op) {
      case "fabs":
        d[op.rd] = Math.abs(d[op.rn]!);
        break;
      case "fneg":
        d[op.rd] = -d[op.rn]!;
        break;
      case "frintz":
        d[op.rd] = Math.trunc(d[op.rn]!);
        break;
      case "fmov-d-d":
        d[op.rd] = d[op.rn]!;
        break;
      case "fmov-d-x":
        d[op.rd] = number(op.rn === "zr" ? 0n : x[op.rn]!);
        break;
      case "fmov-x-d":
        if (op.rd !== "zr") x[op.rd] = bits(d[op.rn]!);
        break;
      case "movz":
        if (op.rd !== "zr") x[op.rd] = BigInt(op.immediate) << BigInt(op.shift);
        break;
      case "ubfm":
        assert.ok(op.imms >= op.immr);
        assert.notEqual(op.rn, "zr");
        if (op.rd !== "zr")
          x[op.rd] =
            (x[op.rn as number]! >> BigInt(op.immr)) &
            ((1n << BigInt(op.imms - op.immr + 1)) - 1n);
        break;
      case "sub-imm":
        assert.equal(op.rd, "zr");
        assert.equal(op.setFlags, true);
        comparison = Number(x[op.rn as number]!) - op.immediate;
        unordered = false;
        break;
      case "fcmp":
        comparison = d[op.rn]! - d[op.rm]!;
        unordered = Number.isNaN(d[op.rn]!) || Number.isNaN(d[op.rm]!);
        if (d[op.rn] === d[op.rm]) comparison = 0;
        break;
      case "fadd":
        d[op.rd] = d[op.rn]! + d[op.rm]!;
        break;
      case "fsub":
        d[op.rd] = d[op.rn]! - d[op.rm]!;
        break;
      case "fmul":
        d[op.rd] = d[op.rn]! * d[op.rm]!;
        break;
      case "fdiv":
        d[op.rd] = d[op.rn]! / d[op.rm]!;
        break;
      case "b":
        next = pc + op.displacement / 4;
        break;
      case "b.cond": {
        const taken =
          op.condition === "eq"
            ? comparison === 0
            : op.condition === "ne"
              ? comparison !== 0
              : op.condition === "mi"
                ? comparison < 0
                : op.condition === "pl"
                  ? !(comparison < 0)
                  : op.condition === "gt"
                    ? comparison > 0
                    : op.condition === "vs"
                      ? unordered
                      : undefined;
        assert.notEqual(taken, undefined, op.condition);
        if (taken) next = pc + op.displacement / 4;
        break;
      }
      case "ret":
        return { value: d[0]!, steps };
      default:
        throw Error("unsupported test instruction " + op.op);
    }
    pc = next;
  }
  throw Error("leaf failed to return");
}
test("power-of-two remainder has bounded work for address-sized and extreme inputs", () => {
  for (const [left, right] of [
    [0x300000018, 8],
    [-0x300000018, 16],
    [Number.MAX_VALUE, 2 ** -1022],
    [Number.MAX_VALUE, 2 ** 1023],
    [0.875, 0.25],
    [-16, 8],
    [2 ** 52 - 0.5, 2],
  ]) {
    const result = remainder(left!, right!);
    assert.ok(Object.is(result.value, left! % right!));
    assert.ok(
      result.steps <= 40,
      `remainder took ${result.steps} instructions`,
    );
  }
});
