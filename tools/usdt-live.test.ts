// The parts of tools/linux/verify-usdt-live.ts that need no kernel
// uprobes: SDT notes read back from an image the ELF writer produced,
// perf and bpftrace output parsing, and tracer counts held against GDB's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildElfExecutable } from "@tint/image/linux/elf";
import {
  bpftraceProbeHits,
  compareWithGdb,
  perfProbeHits,
  stapsdtProbes,
} from "./linux/verify-usdt-live.ts";

test("stapsdt notes read back with their sites, base and arguments", () => {
  // nop; nop; mov w0, #42; ret
  const code = new Uint8Array([
    0x1f, 0x20, 0x03, 0xd5, 0x1f, 0x20, 0x03, 0xd5, 0x40, 5, 0x80, 0x52, 0xc0,
    3, 0x5f, 0xd6,
  ]);
  const result = buildElfExecutable({
    code,
    entryOffset: 8,
    maxByteLength: 1 << 20,
    probes: [
      {
        provider: "tint",
        name: "gc__end",
        offset: 0,
        arguments: "8@x10 8@x11 8@x12 8@x13 8@x9",
      },
      {
        provider: "tint",
        name: "gc_collect__begin",
        offset: 4,
        arguments: "8@x9",
      },
    ],
  });
  assert.ok(result.ok);
  const bytes = Buffer.from(result.value.bytes);
  const probes = stapsdtProbes(bytes);
  assert.deepEqual(
    probes.map((probe) => [probe.provider, probe.name, probe.arguments]),
    [
      ["tint", "gc__end", "8@x10 8@x11 8@x12 8@x13 8@x9"],
      ["tint", "gc_collect__begin", "8@x9"],
    ],
  );
  const [first, second] = probes;
  assert.ok(first !== undefined && second !== undefined);
  assert.equal(second.location - first.location, 4);
  assert.equal(first.semaphore, 0);
  assert.equal(first.base, second.base);
  assert.ok(first.base > 0);
});

test("tracer counts must equal GDB's except balanced gc.worker edges", () => {
  const reference = {
    exitCode: 42,
    listed: [],
    probes: {
      gc_collect__begin: { count: 2, threads: 1 },
      gc_collect__end: { count: 2, threads: 1 },
      gc__end: { count: 2, threads: 1 },
      gc_worker__begin: { count: 12, threads: 6 },
      gc_worker__end: { count: 12, threads: 6 },
    },
    collections: [
      [0, 1024, 16, 16, 7],
      [1, 2048, 32, 32, 9],
    ],
    session: "",
  };
  const traced = {
    counts: {
      gc_collect__begin: 2,
      gc_collect__end: 2,
      gc__end: 2,
      gc_worker__begin: 10,
      gc_worker__end: 10,
    },
    workerThreads: 5,
    collections: [
      [0, 1024, 16, 16],
      [1, 2048, 32, 32],
    ],
  };
  compareWithGdb("perf", traced, reference);
  assert.throws(
    () =>
      compareWithGdb(
        "perf",
        { ...traced, counts: { ...traced.counts, gc_collect__end: 1 } },
        reference,
      ),
    /gc_collect__end hits/,
  );
  assert.throws(
    () =>
      compareWithGdb(
        "perf",
        { ...traced, counts: { ...traced.counts, gc_worker__end: 9 } },
        reference,
      ),
    /gc.worker edges/,
  );
  assert.throws(
    () =>
      compareWithGdb(
        "bpftrace",
        { ...traced, collections: [[0, 1024, 16, 16]] },
        reference,
      ),
    /gc__end metrics/,
  );
});

test("perf script and bpftrace JSON output parse to probe hits", () => {
  const perf = perfProbeHits(
    [
      "   4100 sdt_tint:gc_collect__begin: (aaaaaaaa9d60) arg1=281474976710000",
      "   4101 sdt_tint:gc_worker__begin: (aaaaaaaa9d90) arg1=1",
      "   4102 sdt_tint:gc_worker__begin: (aaaaaaaa9d90) arg1=2",
      "   4100 sdt_tint:gc__end: (aaaaaaaa9d44) arg1=1 arg2=0x100000 arg3=2048 arg4=2048 arg5=7",
      "   4100 sdt_tint:gc_collect__end: (aaaaaaaa9d68) arg1=281474976710000",
      "",
    ].join("\n"),
  );
  assert.deepEqual(perf, {
    counts: {
      gc_collect__begin: 1,
      gc_worker__begin: 2,
      gc__end: 1,
      gc_collect__end: 1,
    },
    workerThreads: 2,
    collections: [[1, 1048576, 2048, 2048]],
  });
  const image = "/tmp/usdt-live";
  const bpftrace = bpftraceProbeHits(
    [
      "Attaching 23 probes...",
      JSON.stringify({ type: "attached_probes", data: { probes: 23 } }),
      JSON.stringify({ type: "printf", data: "GCEND 0 1024 16 16\n" }),
      JSON.stringify({
        type: "map",
        data: {
          "@counts": {
            [`usdt:${image}:tint:gc__end`]: 1,
            [`usdt:${image}:tint:gc_worker__begin`]: 3,
          },
        },
      }),
      JSON.stringify({
        type: "map",
        data: { "@workers": { "4101": 2, "4102": 1 } },
      }),
    ].join("\n"),
  );
  assert.deepEqual(bpftrace, {
    counts: { gc__end: 1, gc_worker__begin: 3 },
    workerThreads: 2,
    collections: [[0, 1024, 16, 16]],
  });
});
