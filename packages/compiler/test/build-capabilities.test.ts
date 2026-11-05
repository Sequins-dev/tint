import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMacOSProgram, type BuildRequest } from "../src/build.ts";

test("executable host grants require explicit JIT image permission", () => {
  for (const operation of [
    "executable-map",
    "executable-write",
    "executable-call-number",
    "executable-call-value",
    "executable-call-managed",
  ] as const) {
    const stages: string[] = [];
    const request: BuildRequest = {
      modules: [],
      entry: "main",
      start: "run",
      runtimes: [],
      hostBindings: [{ module: "memory", name: "capability", operation }],
      allocatorModule: "allocator",
      runtimeModule: "runtime",
      memoryModule: "memory",
      identifier: "capability-test",
      managedBytes: 4096,
      controlBytes: 4096,
      allocationCapacity: 16,
      rootCapacity: 16,
      stackBytes: 4096,
      report: (stage) => stages.push(stage),
    };
    for (const allowJit of [undefined, false]) {
      const result = buildMacOSProgram(
        allowJit === undefined ? request : { ...request, allowJit },
      );
      assert.equal(result.ok, false);
      if (!result.ok)
        assert.deepEqual(result.error, {
          stage: "host-binding",
          message: "executable-memory capabilities require allowJit",
        });
    }
    assert.deepEqual(stages, [], "permission rejection precedes compilation");
    const allowed = buildMacOSProgram({ ...request, allowJit: true });
    assert.equal(allowed.ok, false);
    if (!allowed.ok) assert.equal(allowed.error.stage, "allocator");
  }
});

test("copying runtime forwarding metadata must cover the configured semispace", () => {
  const stages: string[] = [];
  const request: BuildRequest = {
    modules: [],
    entry: "main",
    start: "run",
    runtimes: [],
    hostBindings: [],
    allocatorModule: "allocator",
    runtimeModule: "runtime",
    runtimeEntry: "initializeCopyingRuntime",
    memoryModule: "memory",
    identifier: "copying-policy-test",
    managedBytes: 16777216,
    controlBytes: 65536,
    allocationCapacity: 131072,
    rootCapacity: 4096,
    stackBytes: 1048576,
    report: (stage) => stages.push(stage),
  };
  for (const [managedBytes, allocationCapacity] of [
    [16777216, 131072],
    [16777216, 180191],
    [8192, 55],
    [16, 256],
    [Number.NaN, 256],
    [8192, 0],
    [8192, 1.5],
  ]) {
    const rejected = buildMacOSProgram({
      ...request,
      managedBytes: managedBytes!,
      allocationCapacity: allocationCapacity!,
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.error.stage, "memory-policy");
  }
  assert.deepEqual(
    stages,
    [],
    "invalid workspaces fail before any native compilation",
  );
  for (const [managedBytes, allocationCapacity] of [
    [16777216, 180192],
    [8192, 56],
  ]) {
    const allowed = buildMacOSProgram({
      ...request,
      managedBytes: managedBytes!,
      allocationCapacity: allocationCapacity!,
    });
    assert.equal(allowed.ok, false);
    if (!allowed.ok) assert.equal(allowed.error.stage, "allocator");
  }
});

test("generational runtime rejects undersized forwarding and mark workspaces before compilation", () => {
  const stages: string[] = [];
  const request: BuildRequest = {
    modules: [],
    entry: "main",
    start: "run",
    runtimes: [],
    hostBindings: [],
    allocatorModule: "allocator",
    runtimeModule: "runtime",
    runtimeEntry: "initializeGenerationalRuntime",
    memoryModule: "memory",
    identifier: "generational-policy-test",
    managedBytes: 16777216,
    controlBytes: 65536,
    allocationCapacity: 65536,
    rootCapacity: 4096,
    stackBytes: 1048576,
    report: (stage) => stages.push(stage),
  };
  for (const [managedBytes, allocationCapacity] of [
    [16777216, 65536],
    [16777216, 180191],
    [8192, 55],
    [1024, 256],
    [2048, 3],
    [Number.NaN, 256],
    [8192, 0],
  ]) {
    const result = buildMacOSProgram({
      ...request,
      managedBytes: managedBytes!,
      allocationCapacity: allocationCapacity!,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.stage, "memory-policy");
  }
  assert.deepEqual(stages, []);
  for (const [managedBytes, allocationCapacity] of [
    [16777216, 180192],
    [8192, 56],
    [2048, 4],
  ]) {
    const result = buildMacOSProgram({
      ...request,
      managedBytes: managedBytes!,
      allocationCapacity: allocationCapacity!,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.stage, "allocator");
  }
});
