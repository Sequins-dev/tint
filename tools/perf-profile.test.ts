// Linux perf samples (tools/profiling/perf-script.ts) and per-OS process
// measurement (tools/host-tools.ts): parsers on recorded text everywhere;
// on Linux also a native `perf record` of a Tint image converted to pprof.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  attributePerfSamples,
  parsePerfScript,
  perfProfile,
} from "./profiling/perf-script.ts";
import { decodeProfile } from "./profiling/pprof.ts";
import { toCpuProfile } from "./profiling/devtools-profiles.ts";
import {
  measureProcess,
  parseBsdTime,
  parseGnuTime,
  parsePerfStat,
} from "./host-tools.ts";

const image = "/work/tint-image";
const script = `  100/100   12601.145452:     250000 cpu-clock:u:
\t    aaaacf093634 allocator:createRegionAllocator$0+0x634 (${image}+0x3634)
\t    aaaacf091953 tint:process-entry+0x953 (${image}+0x1953)
\t    aaaacf091954 tint:process-entry+0x954 (${image}+0x1954)
\t               0 [unknown] ([unknown])

  100/100   12601.150065:     250000 cpu-clock:u:
\t    aaaacf141ff0 program:fixture:churn [@1:value:1$253]+0x220 (${image}+0xb1ff0)
\t    aaaacf142e37 program:fixture:run [@1:value:3$255]+0x9fb (${image}+0xb2e37)
\t    aaaacf142e38 program:fixture:run [@1:value:3$255]+0x9fc (${image}+0xb2e38)
\t    ffff93f87347 __libc_start_main+0x9c (/usr/lib/aarch64-linux-gnu/libc.so.6+0x2733c)

  100/101   12601.250065:     500000 cpu-clock:u:
\t    aaaacf141ff0 program:fixture:churn [@1:value:1$253]+0x220 (${image}+0xb1ff0)
\t    ffff93f80000 [unknown] (/usr/lib/aarch64-linux-gnu/libc.so.6+0x10000)
`;

// perf before 6.8 (no dsoff field): mapping events, and map-relative
// call-chain entries without an offset in the object column.
const mappedScript = ` 200/200   1048.890870: PERF_RECORD_MMAP2 200/200: [0xaaaacdd70000(0xbb000) @ 0 fe:10 23683102 3221807528]: r-xp ${image}
 200/200   1048.890952: PERF_RECORD_MMAP2 200/200: [0xffff96370000(0x1af000) @ 0 fe:10 760 0]: r-xp /usr/lib/aarch64-linux-gnu/libc.so.6
 200/200   1048.891366:     500000 cpu-clock:u:
\t           a5470 [unknown] (${image})
\t           a536b [unknown] (${image})
\t           a536c [unknown] (${image})
\t    ffff963f2618 pthread_create+0x18 (/usr/lib/aarch64-linux-gnu/libc.so.6)
\t               0 [unknown] ([unknown])

 201/201   1048.891400:     500000 cpu-clock:u:
\t           a5470 [unknown] (${image})
`;

test("perf without dsoff: mapping events give offsets and process addresses", () => {
  const [first, other] = parsePerfScript(mappedScript);
  assert.deepEqual(
    first?.frames.map((frame) => [
      frame.address,
      frame.dsoOffset,
      frame.symbol,
    ]),
    [
      [0xaaaacdd70000 + 0xa5470, 0xa5470, undefined],
      [0xaaaacdd70000 + 0xa536b, 0xa536b, undefined],
      [0xffff963f2618, 0x82618, "pthread_create"],
    ],
  );
  // Mappings belong to their process: another pid's frame stays unresolved.
  assert.deepEqual(
    other?.frames.map((frame) => [frame.address, frame.dsoOffset]),
    [[0xa5470, undefined]],
  );
  const profile = perfProfile(parsePerfScript(mappedScript), { image });
  assert.equal(profile.samples[0]?.stack[0]?.address, 0xa5470);
});

test("perf script samples parse with arm64 frame-pointer duplicates removed", () => {
  const samples = parsePerfScript(script);
  assert.equal(samples.length, 3);
  const [first, second, third] = samples;
  assert.deepEqual(
    { pid: first?.pid, tid: first?.tid, period: first?.period },
    { pid: 100, tid: 100, period: 250000 },
  );
  assert.equal(first?.event, "cpu-clock:u");
  assert.equal(first?.time, 12601.145452);
  // The chain's terminating zero frame and the link-register duplicate of
  // the caller are dropped; symbols with spaces keep their full name.
  assert.deepEqual(
    second?.frames.map((frame) => [frame.symbol, frame.dsoOffset]),
    [
      ["program:fixture:churn [@1:value:1$253]", 0xb1ff0],
      ["program:fixture:run [@1:value:3$255]", 0xb2e37],
      ["__libc_start_main", 0x2733c],
    ],
  );
  assert.equal(first?.frames.length, 2);
  assert.equal(third?.tid, 101);
  assert.equal(third?.frames[1]?.symbol, undefined);
  // Exclusive samples of the main thread (tid = pid).
  assert.deepEqual(attributePerfSamples(samples), {
    samples: 2,
    leafGroups: [
      {
        function: "allocator:createRegionAllocator$0",
        samples: 1,
        percent: 50,
      },
      {
        function: "program:fixture:churn [@1:value:1$253]",
        samples: 1,
        percent: 50,
      },
    ],
  });
  assert.equal(attributePerfSamples(samples, 101).samples, 1);
  assert.throws(() => attributePerfSamples(samples, 7));
});

test("perf samples become a CPU profile with DWARF lines at linked addresses", () => {
  const asked: number[] = [];
  const profile = perfProfile(parsePerfScript(script), {
    image,
    symbolise: (addresses) => {
      asked.push(...addresses);
      return new Map([
        [
          0xb1ff0,
          [
            { function: "fixture:makeChain", file: "fixture", line: 13 },
            { function: "fixture:churn", file: "fixture", line: 19 },
          ],
        ],
      ]);
    },
  });
  // Only image frames are symbolised, by their file offset (= linked address).
  assert.deepEqual(
    [...new Set(asked)].sort((a, b) => a - b),
    [0x1953, 0x3634, 0xb1ff0, 0xb2e37],
  );
  assert.deepEqual(profile.sampleTypes, [
    { type: "samples", unit: "count" },
    { type: "cpu", unit: "nanoseconds" },
  ]);
  assert.equal(profile.period, 250000);
  assert.equal(profile.mapping?.file, image);
  const second = profile.samples[1];
  assert.deepEqual(second?.values, [1, 250000]);
  assert.deepEqual(second?.numLabels, {
    thread_id: 100,
    timestamp: 12601150065000,
  });
  assert.deepEqual(
    second?.stack.map((location) => [
      location.address,
      location.lines.map((line) => line.function),
    ]),
    [
      [0xb1ff0, ["fixture:makeChain", "fixture:churn"]],
      [0xb2e37, ["program:fixture:run [@1:value:3$255]"]],
      [0xffff93f87347, ["__libc_start_main"]],
    ],
  );
  assert.equal(profile.samples[2]?.stack[1]?.lines[0]?.function, "[libc.so.6]");
  // Thread selection, and the shared writers accept the result.
  const main = perfProfile(parsePerfScript(script), { image, thread: "main" });
  assert.equal(main.samples.length, 2);
  const cpu = toCpuProfile(profile);
  assert.ok(
    cpu.nodes.some(
      (node) => node.callFrame.functionName === "fixture:makeChain",
    ),
  );
});

test("process measurement reports parse per OS", () => {
  assert.deepEqual(
    parsePerfStat(
      "# started on Tue\n\n123456,,cycles:u,1000,100.00,,\n<not supported>,,instructions:u,0,100.00,,\n",
    ),
    { cycles: 123456, instructions: undefined },
  );
  assert.deepEqual(parsePerfStat("<not supported>,,cycles,0,100.00,,\n"), {
    cycles: undefined,
    instructions: undefined,
  });
  assert.deepEqual(
    parseGnuTime("Command exited with non-zero status 3\n1.25 20480\n"),
    {
      wallSeconds: 1.25,
      maxResidentBytes: 20480 * 1024,
    },
  );
  assert.deepEqual(
    parseBsdTime(
      "        1.50 real         1.20 user         0.10 sys\n   2097152  maximum resident set size\n         4000000000  instructions retired\n         5000000000  cycles elapsed\n",
    ),
    {
      wallSeconds: 1.5,
      maxResidentBytes: 2097152,
      instructions: 4000000000,
      cycles: 5000000000,
    },
  );
  const run = measureProcess(process.execPath, ["-e", "process.exit(3)"]);
  assert.equal(run.status, 3);
  assert.ok(run.wallSeconds >= 0 && run.maxResidentBytes > 1000000);
  if (process.platform === "darwin") assert.ok((run.cycles ?? 0) > 0);
});

const perfAvailable =
  process.platform === "linux" &&
  spawnSync("perf", [
    "record",
    "-q",
    "-e",
    "cpu-clock",
    "-o",
    "/dev/null",
    "--",
    "true",
  ]).status === 0;

test(
  "perf record of a Tint image converts to a symbolised pprof profile",
  { skip: !perfAvailable && "needs Linux perf", timeout: 600000 },
  async () => {
    const { buildHeapToolsFixture } = await import("./heap-tools-fixture.ts");
    process.env.TINT_BUILD_ONLY = "1";
    process.env.TINT_DEBUG_SYMBOLS = "1";
    const binary = buildHeapToolsFixture("perf-profile-test");
    const work = mkdtempSync(join(tmpdir(), "tint-perf-"));
    try {
      for (const mode of ["fp", "dwarf"]) {
        const data = join(work, mode + ".data"),
          pprof = join(work, mode + ".pb.gz");
        const recorded = spawnSync(
          "perf",
          [
            "record",
            "-q",
            "-e",
            "cpu-clock",
            "-F",
            "2000",
            "--call-graph",
            mode,
            "-o",
            data,
            "--",
            binary,
          ],
          { encoding: "utf8" },
        );
        assert.equal(recorded.status, 42, recorded.stderr);
        const converted = spawnSync(
          process.execPath,
          [
            "tools/heap-snapshot/cli.ts",
            "perf",
            data,
            "--image",
            binary,
            "--pprof",
            pprof,
          ],
          { encoding: "utf8", timeout: 300000 },
        );
        assert.equal(converted.status, 0, converted.stdout + converted.stderr);
        const profile = decodeProfile(readFileSync(pprof));
        assert.ok(profile.samples.length > 5, mode);
        // The fixture's allocation loop dominates, attributed through DWARF
        // (source files and lines), with its callers up to the entry.
        let churn = 0;
        for (const sample of profile.samples) {
          const names = sample.stack.flatMap((location) =>
            location.lines.map((line) => line.function),
          );
          if (names.some((name) => name.includes("fixture:churn"))) {
            churn++;
            assert.ok(
              names.some((name) => name.includes("fixture:run")),
              mode + ": " + names.join(" < "),
            );
            assert.ok(
              sample.stack.some((location) =>
                location.lines.some(
                  (line) => line.file === "fixture" && (line.line ?? 0) > 0,
                ),
              ),
            );
          }
        }
        assert.ok(churn > profile.samples.length / 2, mode + " churn " + churn);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(dirname(binary), { recursive: true, force: true });
    }
  },
);
