import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModuleIR, FunctionIR } from "@tint/ir/scalar";
import {
  darwinAArch64Target,
  linuxAArch64Target,
  linuxX86_64Target,
} from "@tint/platform/target";
import { projectMappings } from "../src/catalog.ts";
import { compilerMappingsForTarget } from "../src/project.ts";
import type { ForeignLibrary } from "../src/native/index.ts";
import {
  admitEmissionWorkers,
  decodeErrorMessage,
  decodeInitMessage,
  decodeJobMessage,
  decodeReplyHeader,
  defaultResultCreditBytes,
  defaultWorkerStackBytes,
  encodeErrorMessage,
  encodeInitMessage,
  encodeJobMessage,
  encodeReplyHeader,
  estimateRangeCreditBytes,
  planEmissionRanges,
} from "../src/parallel-policy.ts";

const MiB = 1048576;

function syntheticModule(instructionCounts: readonly number[]): ModuleIR {
  const functions: FunctionIR[] = instructionCounts.map((count, id) => ({
    id,
    name: "fn_" + String(id),
    exported: false,
    parameters: [],
    slots: [],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: Array.from({ length: count }, (_v, idx) => ({
          id: idx,
          kind: "constant" as const,
          value: idx,
          start: 0,
          end: 0,
        })),
        terminator: {
          kind: "return" as const,
          value: undefined,
          start: 0,
          end: 0,
        },
      },
    ],
  }));
  return {
    functions,
    records: [],
  };
}

test("planEmissionRanges covers every function contiguously and balances IR weight", () => {
  const mod = syntheticModule([100, 10, 10, 10, 10, 80, 5, 5, 90, 20]);
  const ranges = planEmissionRanges(mod, 4);
  assert.equal(ranges.length, 4);
  assert.equal(ranges[0]?.first, 0);
  for (let i = 1; i < ranges.length; i++) {
    assert.equal(ranges[i]?.first, ranges[i - 1]?.end);
    assert.ok((ranges[i]?.end ?? 0) > (ranges[i]?.first ?? 0));
  }
  assert.equal(ranges[ranges.length - 1]?.end, mod.functions.length);
  assert.deepEqual(planEmissionRanges(syntheticModule([]), 4), []);
  assert.deepEqual(planEmissionRanges(syntheticModule([10, 20]), 8), [
    { first: 0, end: 1 },
    { first: 1, end: 2 },
  ]);
});

test("admitEmissionWorkers caps or falls back to serial based on coordinator RSS and worker reserves", () => {
  const base = {
    requestedWorkers: 4,
    rangeCount: 16,
    coordinatorRssBytes: 1200 * MiB,
    wireBytes: 48 * MiB,
    workerHeapBytes: 704 * MiB,
    workerStackBytes: defaultWorkerStackBytes,
    resultCreditBytes: defaultResultCreditBytes,
  };
  // Explicit (no budget): admits all 4 requested lanes.
  const explicit = admitEmissionWorkers({
    ...base,
    memoryBudgetBytes: undefined,
  });
  assert.equal(explicit.workers, 4);
  assert.equal(explicit.reason, "explicit");

  // Budget of 2200 MiB: coordinator (1200) + wire (48) + credits (64) = 1312,
  // leaving 888 MiB, which fits exactly 1 lane (704 + 16 + 32 = 752 MiB).
  const oneLane = admitEmissionWorkers({
    ...base,
    memoryBudgetBytes: 2200 * MiB,
  });
  assert.equal(oneLane.workers, 1);
  assert.equal(oneLane.reason, "budget-capped");

  // Budget of 2900 MiB: leaves 1588 MiB -> fits 2 lanes (1504 MiB).
  const twoLanes = admitEmissionWorkers({
    ...base,
    memoryBudgetBytes: 2900 * MiB,
  });
  assert.equal(twoLanes.workers, 2);
  assert.equal(twoLanes.reason, "budget-capped");

  // Budget of 1900 MiB: leaves 588 MiB < 752 MiB -> falls back to serial.
  const serial = admitEmissionWorkers({
    ...base,
    memoryBudgetBytes: 1900 * MiB,
  });
  assert.equal(serial.workers, 0);
  assert.equal(serial.reason, "budget-exceeded");

  // Result credit estimates stay bounded below half the total credit pool.
  assert.ok(
    estimateRangeCreditBytes(10_000_000, defaultResultCreditBytes) <=
      defaultResultCreditBytes / 2,
  );
  assert.ok(estimateRangeCreditBytes(1, defaultResultCreditBytes) >= 65536);
});

test("parallel emission wire messages round-trip init, job, reply, and error payloads", () => {
  const initBytes = encodeInitMessage({
    wireBase: 0x0000_1234_5678_9000,
    preparationBytes: 123456,
    bodyBytes: 7890123,
    targetOs: "darwin",
    options: {
      maxByteLength: Number.MAX_SAFE_INTEGER,
      hostABI: darwinAArch64Target.hostABI,
      unboundedAnalysis: true,
      jsConvert: true,
      linearAllocation: true,
      generationalBarriers: true,
      pageAlignedCode: true,
      closedRoots: [42],
      workerFunctions: new Set(["worker_a", "worker_b"]),
    },
    ranges: [
      { first: 0, end: 10 },
      { first: 10, end: 25 },
    ],
  });
  const decodedInit = decodeInitMessage(initBytes);
  assert.equal(decodedInit.wireBase, 0x0000_1234_5678_9000);
  assert.equal(decodedInit.preparationBytes, 123456);
  assert.equal(decodedInit.bodyBytes, 7890123);
  assert.equal(decodedInit.targetOs, "darwin");
  assert.equal(decodedInit.options.unboundedAnalysis, true);
  assert.equal(decodedInit.options.jsConvert, true);
  assert.equal(decodedInit.options.linearAllocation, true);
  assert.equal(decodedInit.options.generationalBarriers, true);
  assert.equal(decodedInit.options.pageAlignedCode, true);
  assert.deepEqual(decodedInit.options.closedRoots, [42]);
  assert.deepEqual(
    [...(decodedInit.options.workerFunctions ?? [])],
    ["worker_a", "worker_b"],
  );
  assert.deepEqual(decodedInit.ranges, [
    { first: 0, end: 10 },
    { first: 10, end: 25 },
  ]);

  const forms = {
    calls: true,
    addresses: false,
    far: true,
    longBranches: [1, 5],
    longAddresses: [9],
    islands: [2],
    farBranches: [11, 14],
  };
  const job = decodeJobMessage(encodeJobMessage({ rangeIndex: 7, forms }));
  assert.deepEqual(job, { rangeIndex: 7, forms });

  const reply = decodeReplyHeader(encodeReplyHeader(7, forms, 4096));
  assert.equal(reply.rangeIndex, 7);
  assert.deepEqual(reply.forms, forms);
  assert.equal(reply.packetByteLength, 4096);
  assert.ok(reply.packetOffset > 0);

  const err = decodeErrorMessage(encodeErrorMessage(3, "boom"));
  assert.deepEqual(err, { rangeIndex: 3, message: "boom" });
  const globalErr = decodeErrorMessage(encodeErrorMessage(-1, "fatal"));
  assert.deepEqual(globalErr, { rangeIndex: -1, message: "fatal" });
});

test("compilerMappingsForTarget binds target-specific parallel hosts for AArch64 and keeps stub for x86-64", () => {
  const fakeLibrary = (module: string, fnName: string): ForeignLibrary =>
    ({
      id: module,
      declaration: {
        module,
        functions: [{ name: fnName }],
      },
      stubs: [],
      views: [],
    }) as unknown as ForeignLibrary;
  const darwinLibs = [
    fakeLibrary("tint:c/worker-thread-host", "pipe"),
    fakeLibrary("tint:c/darwin-reactor", "kqueue"),
  ];
  const linuxLibs = [
    fakeLibrary("tint:c/worker-thread-host", "pipe"),
    fakeLibrary("tint:c/linux-reactor", "epoll_create1"),
  ];
  const findParallelHost = (
    mapped: ReturnType<typeof compilerMappingsForTarget>,
  ): string | undefined =>
    mapped.find((m) => m.specifier === "@tint/platform/parallel-host")?.target;

  assert.equal(
    findParallelHost(
      compilerMappingsForTarget(
        projectMappings(),
        darwinAArch64Target,
        darwinLibs,
      ),
    ),
    "packages/platform/src/darwin/parallel-host.ts",
  );
  assert.equal(
    findParallelHost(
      compilerMappingsForTarget(
        projectMappings(),
        linuxAArch64Target,
        linuxLibs,
      ),
    ),
    "packages/platform/src/linux/parallel-host.ts",
  );
  assert.equal(
    findParallelHost(
      compilerMappingsForTarget(projectMappings(), linuxX86_64Target, []),
    ),
    "packages/platform/src/parallel-host.ts",
  );
});
