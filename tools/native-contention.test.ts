import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
async function fixture() {
  assert.ok(
    existsSync("tools/native-contention-fixture.ts"),
    "direct-native contention fixture must exist",
  );
  return import("./native-contention-fixture.ts");
}
test("contention fixture has explicit Darwin calls and separate platform entries without managed ABI", async () => {
  const { contentionCode } = await fixture();
  const result = contentionCode(4, 1000);
  assert.deepEqual(result.imports, [
    "_mmap",
    "_munmap",
    "_pthread_create",
    "_pthread_join",
  ]);
  assert.ok(result.workerOffset > result.entryOffset);
  assert.equal(result.frameBytes, 96);
  for (const offset of [result.entryOffset, result.workerOffset])
    assert.deepEqual(result.instructions[offset / 4], {
      op: "stp",
      width: 64,
      rt: 29,
      rt2: 30,
      rn: "sp",
      offset: -96,
      mode: "pre",
    });
  assert.ok(
    !result.instructions.some(
      (i) => ("rd" in i && i.rd === 18) || ("rt" in i && i.rt === 18),
    ),
  );
  assert.ok(
    !result.instructions.some(
      (i) => i.op.includes("cvt") || i.op.startsWith("f"),
    ),
  );
  assert.equal(
    result.calls.filter((c) => c.name === "_pthread_create").length,
    2,
  );
  assert.equal(
    result.calls.filter((c) => c.name === "_pthread_join").length,
    2,
  );
  assert.ok(result.casLeafByteLength > 0);
  assert.equal(result.addressFixups.length, result.calls.length);
});
test("two interleaved platform-entry workers really contend, preserve ABI and exact subword neighbors", async () => {
  const { contentionCode } = await fixture();
  const { modelContention } = await import("./native-contention-machine.ts");
  for (const width of [1, 2, 4] as const) {
    const result = contentionCode(width, 1000);
    const observed = modelContention(result);
    assert.equal(
      observed.counter,
      2000 % (width === 1 ? 256 : width === 2 ? 65536 : 4294967296),
    );
    assert.equal(observed.completed, 2);
    assert.ok(
      observed.mismatches >= 1,
      "both workers must capture zero before either attempts CAS",
    );
    assert.equal(observed.canariesIntact, true);
  }
});
test("contention fixture rejects unbounded policy before emission", async () => {
  const { contentionCode } = await fixture();
  for (const [width, iterations] of [
    [3, 1],
    [8, 1],
    [4, 0],
    [4, -1],
    [4, 1.5],
    [4, 100001],
  ])
    assert.throws(() => contentionCode(width as 1 | 2 | 4, iterations));
});

test("extracted CAS leaf is relocation-closed raw ABI and rejects escaped branches/context memory", async () => {
  const { contentionCode } = await fixture();
  const { auditContentionLeaf } =
    await import("./native-contention-leaf-audit.ts");
  const { writeInstruction } = await import("@tint/codegen/aarch64/isa");
  const built = contentionCode(4, 1000),
    audit = auditContentionLeaf(built.casLeafBytes);
  assert.deepEqual(audit.widths, [1, 2, 4]);
  assert.equal(audit.contextAccesses, 0);
  assert.equal(audit.externalRelocations, 0);
  assert.equal(
    audit.rawArguments,
    "x0=base,x1=extent,x2=offset,x3=width,x4=expected,x5=replacement; x0=observed or -1",
  );
  for (const instruction of [
    { op: "b", displacement: 1048576 },
    { op: "bl", displacement: 0 },
    { op: "ldr", width: 64, rt: 0, rn: 0, offset: 72 },
  ] as const) {
    const bytes = built.casLeafBytes.slice();
    assert.ok(writeInstruction(bytes, 0, instruction).ok);
    assert.throws(() => auditContentionLeaf(bytes));
  }
});

test("created workers honor controller abort before start without touching payload", async () => {
  const { contentionCode } = await fixture();
  const { modelContention } = await import("./native-contention-machine.ts");
  const observed = modelContention(contentionCode(4, 1000), true);
  assert.equal(observed.counter, 0);
  assert.equal(observed.completed, 2);
  assert.equal(observed.mismatches, 0);
  assert.equal(observed.canariesIntact, true);
});

test("controller guards do not overwrite the register being compared", async () => {
  const { contentionCode } = await fixture();
  const built = contentionCode(4, 1000);
  assert.ok(
    built.instructions
      .filter((i) => i.op === "sub-reg" && i.setFlags)
      .every((i) => i.op === "sub-reg" && i.rn !== i.rm),
  );
  for (const [index, i] of built.instructions.entries())
    if (i.op === "b" || i.op === "bl" || i.op === "b.cond") {
      const target = index * 4 + i.displacement;
      assert.ok(target >= 0 && target < built.code.length && target % 4 === 0);
    }
});

test("u8 first attempts cannot lose the forced mismatch to a256-increment ABA schedule", async () => {
  const { contentionCode } = await fixture();
  const { modelContention } = await import("./native-contention-machine.ts");
  const observed = modelContention(contentionCode(1, 1000), false, "aba");
  assert.equal(observed.counter, 208);
  assert.ok(
    observed.mismatches >= 1,
    "first-attempt completion gate must prevent256 wraps before peer's first CAS",
  );
});

test("adversarial model reproduces the original ungated u8 ABA counterexample", async () => {
  const { contentionCode } = await fixture();
  const { modelContention } = await import("./native-contention-machine.ts");
  const ungated = modelContention(contentionCode(1, 1000, false), false, "aba");
  assert.equal(ungated.counter, 208);
  assert.equal(ungated.mismatches, 0);
});
