// Compiler observability: pass statistics, per-pass IR dumps and diffs,
// optimization remarks, annotated disassembly and code size reports
// (docs/compiler-observability.md). Observation must never change output.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildMacOSProgram, type BuildRequest } from "@tint/compiler/build";
import { projectBuildRequest, projectRoots } from "@tint/compiler/cli";
import {
  formatPassJSON,
  formatPassTable,
  optimizeModule,
  type OptimizationRemark,
  type PassEvent,
} from "@tint/ir/optimization";
import { verify, type ModuleIR } from "@tint/ir/scalar";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { workspaceModules } from "./workspace-sources.ts";
import { functionEnvironmentFixture } from "./function-environment-fixture.ts";
import {
  createBuildObservation,
  observabilityOptions,
  parseRemarkFilter,
  remarkSelected,
  sourceNameResolver,
  type ObservabilityOptions,
} from "./observability/build-observer.ts";
import {
  diffLines,
  loadPassDumps,
  renderPassDiffs,
  unifiedDiff,
} from "./ir-dump/pass-diff.ts";
import {
  compareCodeSize,
  formatCodeSizeComparison,
  type CodeSizeReport,
} from "./code-size/report.ts";
import { annotate, imageText, machOSections } from "./disasm/annotate.ts";
import { linuxAArch64Target } from "@tint/platform/target";
import { formatModule } from "./ir-dump/format.ts";
import { decodeProfile } from "./op-cost/profile.ts";
import { findLlvmTool } from "./host-tools.ts";
import { createNodeFileHost } from "./node-file-host.ts";

// Exercises the main remark producers: an inlined helper, a recursive
// call that stays, a loop-invariant product, in-bounds typed-array
// accesses, proven record reads, a local closure call and a dense list.
const fixture = `
interface Point {readonly x:number; readonly y:number}
function sum(p:Point):number {return p.x+p.y;}
function fact(n:number):number {return n<2?1:n*fact(n-1);}
function scale(values:Uint8Array,a:number,b:number):number {
 let total=0;
 for(let i=0;i<16;i++){total+=(values[i]??0)*(a*b);}
 return total;
}
export function run():number {
 const values=new Uint8Array(16);
 for(let i=0;i<16;i++)values[i]=i;
 const twice=(n:number):number=>n*2;
 const p:Point={x:twice(3),y:4};
 const t=scale(values,1,2);
 const points:Point[]=[];
 points.push(p);
 return sum(p)+fact(4)+(t===240?0:100)-20+points.length-1;
}
`;

function fixtureRequest(): BuildRequest {
  const bytes = new TextEncoder().encode(fixture);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const modules = [
    ...workspaceModules(projectRoots()),
    {
      id: "fixture",
      module: parsed.value,
      dependencies: new Map<string, string>(),
      sourcePosition: (offset: number) => {
        const position = source.value.positionAt(offset);
        return position.ok ? position.value : undefined;
      },
    },
  ];
  const request = projectBuildRequest(modules, () => {});
  return {
    ...request,
    allowDebugger: true,
    entry: "fixture",
    start: "run",
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 16777216,
    allocationCapacity: 1048576,
    rootCapacity: 1024,
    stackBytes: 1048576,
    identifier: "tint-observability-test",
  };
}
function build(request: BuildRequest): Uint8Array {
  const built = buildMacOSProgram(request);
  assert.ok(built.ok, JSON.stringify(!built.ok && built.error));
  return built.value;
}
const everything: ObservabilityOptions = {
  passStats: true,
  codeSize: true,
  passDumps: "",
  remarks: parseRemarkFilter(""),
};

test("forced disk spilling preserves the hosted image", () => {
  const request = { ...fixtureRequest(), debugSymbols: true };
  const memory = build(request);
  const directory = mkdtempSync(join(tmpdir(), "tint-streaming-image-"));
  try {
    const host = createNodeFileHost();
    let writes = 0;
    let reads = 0;
    let releases = 0;
    const spilled = build({
      ...request,
      storage: {
        policy: "all",
        directory,
        files: {
          ...host,
          createTemporary: (prefix: string) => {
            const result = host.createTemporary(prefix);
            if (result.ok) writes++;
            return result;
          },
          openRead: (path: string) => {
            const result = host.openRead(path);
            if (result.ok) reads++;
            return result;
          },
          remove: (path: string) => {
            const result = host.remove(path);
            if (result.ok) releases++;
            return result;
          },
        },
      },
    });
    assert.ok(writes > 0);
    assert.ok(reads > 0);
    assert.equal(releases, writes);
    assert.deepEqual(spilled, memory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("in-memory packing without a file host preserves the hosted image", () => {
  // Automatic packing for large programs uses this store: a budget with no
  // spill backend keeps packed chunks in memory and evicts decoded bodies.
  const request = { ...fixtureRequest(), debugSymbols: true };
  const memory = build(request);
  const packed = build({
    ...request,
    storage: { policy: "budget", byteBudget: 4096 },
  });
  assert.deepEqual(packed, memory);
});

test("observing a build leaves the image byte-identical and writes every report", () => {
  const request = fixtureRequest();
  const plain = build(request);
  const observation = createBuildObservation(everything);
  const observed = build({ ...request, ...observation.request });
  assert.deepEqual(observed, plain);
  const directory = mkdtempSync(join(tmpdir(), "tint-observability-"));
  try {
    const output = join(directory, "fixture");
    const logged: string[] = [];
    observation.finish(output, (text) => logged.push(text));
    const log = logged.join("");

    // Pass statistics: table and JSON in pipeline order, with wall times.
    const statistics = JSON.parse(
      readFileSync(output + ".pass-stats.json", "utf8"),
    );
    assert.equal(statistics.budgetExhausted, false);
    const names = statistics.passes.map((pass: { pass: string }) => pass.pass);
    for (const pass of [
      "dense-reference-lists",
      "remove-unreachable",
      "fold-constants",
      "inline-small-functions",
      "hoist-loop-invariants",
      "select-array-access",
      "compact-slots",
    ])
      assert.ok(names.includes(pass), pass);
    for (const pass of statistics.passes) {
      assert.equal(typeof pass.milliseconds, "number");
      assert.ok(pass.visited >= 0 && pass.rewritten >= 0);
    }
    assert.match(log, /hoist-loop-invariants/);
    assert.match(log, /total/);

    // Remarks: located in the fixture, with source function names.
    const remarks = readFileSync(output + ".remarks.jsonl", "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const find = (pass: string, outcome: string, text: string) =>
      remarks.find(
        (remark) =>
          remark.pass === pass &&
          remark.outcome === outcome &&
          remark.file === "fixture" &&
          remark.message.includes(text),
      );
    const inlined = find("inline-small-functions", "applied", "inlined");
    assert.ok(inlined, JSON.stringify(remarks.slice(0, 5)));
    assert.equal(typeof inlined.line, "number");
    assert.ok(find("inline-small-functions", "missed", "not inlined"));
    const hoisted = find("hoist-loop-invariants", "applied", "hoisted");
    assert.ok(hoisted);
    assert.equal(hoisted.sourceFunction, "fixture:scale");
    assert.equal(hoisted.line, 7);
    assert.ok(find("select-array-access", "applied", "length 16"));
    assert.ok(find("lower-proven-record-reads", "applied", "proven"));
    assert.ok(find("devirtualize-closures", "applied", "devirtualized"));
    assert.ok(
      remarks.some(
        (remark) =>
          remark.pass === "dense-reference-lists" &&
          remark.outcome === "applied",
      ),
    );

    // Per-pass dumps: replaying the diffs reproduces each final function.
    const dumps = loadPassDumps(output + ".passes");
    const scale = [...dumps.functions].find(([, history]) =>
      (history.input ?? "").includes("; fixture:scale"),
    );
    assert.ok(scale);
    const [key, history] = scale;
    assert.ok(history.versions.length > 1);
    const passesChangingScale = history.versions.map((v) => v.pass);
    assert.ok(passesChangingScale.includes("hoist-loop-invariants"));
    const summary = renderPassDiffs(dumps, {
      function: "fixture:scale",
      summary: true,
    });
    assert.match(summary, new RegExp("hoist-loop-invariants: \\+\\d+ -\\d+"));
    const diff = renderPassDiffs(dumps, {
      function: key,
      pass: "hoist-loop-invariants",
    });
    assert.match(diff, /^=== \d{3} hoist-loop-invariants: /);
    assert.match(diff, /^@@ /m);

    // Code size: per-function bytes and per-pass IR sizes.
    const size = JSON.parse(
      readFileSync(output + ".code-size.json", "utf8"),
    ) as CodeSizeReport;
    assert.equal(
      size.total,
      size.functions.reduce((sum, fn) => sum + fn.bytes, 0),
    );
    assert.deepEqual(Object.keys(size.modules).sort(), [
      "allocator",
      "program",
      "runtime",
    ]);
    assert.ok(
      size.functions.some(
        (fn) => fn.module === "program" && fn.source === "fixture:run",
      ),
    );
    assert.equal(size.ir?.passes.length, statistics.passes.length);
    assert.match(log, /IR size by pass/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pass limits truncate the program's optimization at a pass boundary", () => {
  const request = fixtureRequest();
  const full = createBuildObservation({ passStats: true, codeSize: false });
  const plain = build({ ...request, ...full.request });
  const directory = mkdtempSync(join(tmpdir(), "tint-observability-"));
  try {
    full.finish(join(directory, "full"), () => {});
    const total = JSON.parse(
      readFileSync(join(directory, "full.pass-stats.json"), "utf8"),
    ).passes.length;
    // No limit reached: the image is unchanged.
    assert.deepEqual(
      build({ ...request, optimizationPassLimit: total }),
      plain,
    );
    for (const limit of [0, 1, 2, 10]) {
      const limited = createBuildObservation({
        passStats: true,
        codeSize: false,
        passLimit: limit,
      });
      build({ ...request, ...limited.request });
      const logged: string[] = [];
      limited.finish(join(directory, "limit-" + limit), (text) =>
        logged.push(text),
      );
      // Native code generation reports after the optimizer's passes.
      const passes = JSON.parse(
        readFileSync(join(directory, `limit-${limit}.pass-stats.json`), "utf8"),
      ).passes.filter((pass: { phase: string }) => pass.phase !== "codegen");
      assert.equal(passes.length, limit);
      assert.match(logged.join(""), new RegExp(`after ${limit} of at most`));
    }
    // A limit alone still reports where optimization stopped.
    const limitOnly = createBuildObservation({
      passStats: false,
      codeSize: false,
      passLimit: 3,
    });
    build({ ...request, ...limitOnly.request });
    const logged: string[] = [];
    assert.deepEqual(
      limitOnly.finish(join(directory, "limit-only"), (text) =>
        logged.push(text),
      ),
      [],
    );
    assert.match(logged.join(""), /after 3 of at most 3 passes/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("optimizer observation reports every pass and never changes the result", () => {
  for (const present of [false, true]) {
    const module = functionEnvironmentFixture(present);
    const plain = optimizeModule(module);
    const events: PassEvent[] = [],
      remarks: OptimizationRemark[] = [];
    let begun: ModuleIR | undefined;
    const observed = optimizeModule(module, undefined, {
      observer: {
        begin: (input) => {
          begun = input;
        },
        pass: (event) => events.push(event),
        remark: (remark) => remarks.push(remark),
      },
    });
    assert.equal(begun, module);
    assert.deepEqual(observed, plain);
    assert.deepEqual(
      events.map((event) => event.statistics),
      plain.passes,
    );
    assert.equal(events.at(-1)?.module, observed.module);
    // Each pass limit stops at the module the full run reported there.
    for (let limit = 0; limit <= plain.passes.length; limit++) {
      const limited = optimizeModule(module, undefined, { passLimit: limit });
      assert.equal(limited.passes.length, limit);
      assert.deepEqual(
        limited.module,
        limit === 0 ? module : events[limit - 1]?.module,
      );
      assert.ok(verify(limited.module).ok);
    }
  }
});

test("an exhausted pass reports its checkpoint and drops its remarks", () => {
  const module = functionEnvironmentFixture(true);
  const events: PassEvent[] = [],
    remarks: OptimizationRemark[] = [];
  const result = optimizeModule(module, 3, {
    observer: {
      pass: (event) => events.push(event),
      remark: (remark) => remarks.push(remark),
    },
  });
  assert.equal(result.budgetExhausted, true);
  const last = events.at(-1);
  assert.ok(last);
  assert.equal(last.budgetExhausted, true);
  assert.equal(last.module, result.module);
  assert.deepEqual(remarks, []);
});

test("pass tables and JSON carry statistics, exhaustion and times", () => {
  const reports = [
    {
      statistics: {
        phase: "scalar" as const,
        pass: "fold-constants" as const,
        visited: 12,
        rewritten: 3,
      },
      budgetExhausted: false,
      milliseconds: 1.25,
    },
    {
      statistics: {
        phase: "scalar" as const,
        pass: "ssa-constants" as const,
        visited: 7,
        rewritten: 0,
        skipped: 2,
      },
      budgetExhausted: true,
      milliseconds: 0.0004,
    },
  ];
  const table = formatPassTable(reports);
  assert.match(table, /fold-constants\s+12\s+3\s+0\s+1\.3/);
  assert.match(table, /ssa-constants\s+7\s+0\s+2\s+0\.0  exhausted/);
  assert.match(table, /total\s+19\s+3\s+2\s+1\.3  exhausted/);
  const json = JSON.parse(formatPassJSON(reports));
  assert.equal(json.budgetExhausted, true);
  assert.deepEqual(json.passes[1], {
    index: 1,
    phase: "scalar",
    pass: "ssa-constants",
    visited: 7,
    rewritten: 0,
    skipped: 2,
    budgetExhausted: true,
    milliseconds: 0,
  });
  assert.equal(json.passes[0].milliseconds, 1.25);
  // Fallbacks (conservative redos) show in both forms.
  const fallback = {
    statistics: {
      phase: "scalar" as const,
      pass: "hoist-loop-invariants" as const,
      visited: 5,
      rewritten: 1,
      fallbacks: 2,
    },
    budgetExhausted: false,
  };
  assert.match(
    formatPassTable([fallback]),
    /hoist-loop-invariants\s+5\s+1\s+0  fallbacks 2\n[^]*total.*fallbacks 2/,
  );
  assert.equal(JSON.parse(formatPassJSON([fallback])).passes[0].fallbacks, 2);
  // Untimed reports (native builds without a clock binding) omit times.
  const untimed = formatPassTable([
    { statistics: reports[0]!.statistics, budgetExhausted: false },
  ]);
  assert.doesNotMatch(untimed, / ms/);
  assert.equal(
    JSON.parse(
      formatPassJSON([
        { statistics: reports[0]!.statistics, budgetExhausted: false },
      ]),
    ).passes[0].milliseconds,
    undefined,
  );
});

test("remark filters, options and source names", () => {
  const remark = {
    pass: "hoist-loop-invariants",
    outcome: "missed" as const,
    function: "@1:value:3$9",
    start: 1,
    end: 2,
    message: "m",
    file: "fixture",
    sourceFunction: "fixture:scale",
  };
  assert.ok(remarkSelected(parseRemarkFilter(""), remark));
  assert.ok(remarkSelected(parseRemarkFilter("scale"), remark));
  assert.ok(remarkSelected(parseRemarkFilter("function=value:3"), remark));
  assert.ok(
    remarkSelected(parseRemarkFilter("pass=inline,pass=hoist"), remark),
  );
  assert.ok(!remarkSelected(parseRemarkFilter("outcome=applied"), remark));
  assert.ok(!remarkSelected(parseRemarkFilter("scale,file=packages/"), remark));
  assert.throws(() => parseRemarkFilter("colour=red"));
  assert.throws(() => parseRemarkFilter("outcome=maybe"));
  const options = observabilityOptions(
    {
      TINT_PASS_STATS: "1",
      TINT_DUMP_PASSES: "",
      TINT_REMARKS: "pass=inline",
      TINT_OPT_PASS_LIMIT: "5",
    },
    ["--code-size"],
  );
  assert.equal(options.passStats, true);
  assert.equal(options.codeSize, true);
  assert.equal(options.passDumps, "");
  assert.equal(options.passLimit, 5);
  assert.deepEqual(options.remarks?.pass, ["inline"]);
  assert.throws(() => observabilityOptions({ TINT_OPT_PASS_LIMIT: "-1" }));
  assert.deepEqual(observabilityOptions({}), {
    passStats: false,
    codeSize: false,
  });
  const resolve = sourceNameResolver(new Map([["@1:value:3$214", "m:f"]]));
  assert.equal(resolve("@1:value:3$214"), "m:f");
  assert.equal(resolve("@1:value:3$214$direct"), "m:f");
  assert.equal(resolve("@1:value:3$214:sparse"), "m:f");
  assert.equal(resolve("@2:value:0$1"), undefined);
});

test("line diffs are minimal and unified hunks are well formed", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const lcs = (a: string[], b: string[]) => {
    const table = a.map(() => new Array<number>(b.length + 1).fill(0));
    table.push(new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        table[i]![j] =
          a[i] === b[j]
            ? table[i + 1]![j + 1]! + 1
            : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    return table[0]![0]!;
  };
  for (let iteration = 0; iteration < 500; iteration++) {
    const line = () => "abc"[Math.floor(random() * 3)]!;
    const a = Array.from({ length: Math.floor(random() * 10) }, line),
      b = Array.from({ length: Math.floor(random() * 10) }, line);
    const edits = diffLines(a, b);
    assert.deepEqual(
      edits.filter((edit) => edit.kind !== "+").map((edit) => edit.line),
      a,
    );
    assert.deepEqual(
      edits.filter((edit) => edit.kind !== "-").map((edit) => edit.line),
      b,
    );
    assert.equal(edits.filter((edit) => edit.kind === " ").length, lcs(a, b));
  }
  assert.equal(unifiedDiff("a\nb", "a\nb"), "");
  assert.equal(
    unifiedDiff("1\n2\n3\n4\n5\n6\n7\n8\n9", "1\n2\nX\n4\n5\n6\n7\n8\nY", 1),
    "@@ -2,3 +2,3 @@\n 2\n-3\n+X\n 4\n@@ -8,2 +8,2 @@\n 8\n-9\n+Y\n",
  );
});

test("code size comparison groups instances and gates growth", () => {
  const report = (
    functions: { module: string; name: string; bytes: number }[],
  ): CodeSizeReport => {
    const modules: Record<string, number> = {};
    for (const fn of functions)
      modules[fn.module] = (modules[fn.module] ?? 0) + fn.bytes;
    return {
      kind: "tint-code-size",
      version: 1,
      modules,
      total: functions.reduce((sum, fn) => sum + fn.bytes, 0),
      functions: functions.map((fn) => ({ ...fn, offset: 0 })),
    };
  };
  const base = report([
      { module: "program", name: "f$1", bytes: 100 },
      { module: "program", name: "g$2", bytes: 40 },
      { module: "runtime", name: "r$3", bytes: 10 },
    ]),
    head = report([
      { module: "program", name: "f$7", bytes: 160 },
      { module: "program", name: "g$8", bytes: 20 },
      { module: "runtime", name: "r$9", bytes: 10 },
    ]);
  const comparison = compareCodeSize(base, head);
  assert.equal(comparison.head - comparison.base, 40);
  assert.deepEqual(
    comparison.functions.map((fn) => [fn.name, fn.base, fn.head]),
    [
      ["f", 100, 160],
      ["g", 40, 20],
    ],
  );
  // Exact names: every instance appears and disappears.
  assert.equal(compareCodeSize(base, head, true).functions.length, 6);
  const text = formatCodeSizeComparison(comparison);
  assert.match(text, /total 150 -> 190 bytes: \+40 \(\+26\.67%\)/);
  assert.match(text, /1 functions grown:\n\s+\+60/);
  const directory = mkdtempSync(join(tmpdir(), "tint-code-size-"));
  try {
    writeFileSync(join(directory, "base.json"), JSON.stringify(base));
    writeFileSync(join(directory, "head.json"), JSON.stringify(head));
    const run = (...limits: string[]) =>
      spawnSync(
        process.execPath,
        [
          "tools/code-size/compare.ts",
          join(directory, "base.json"),
          join(directory, "head.json"),
          ...limits,
        ],
        { encoding: "utf8" },
      );
    assert.equal(run().status, 0);
    assert.equal(run("--max-growth", "40").status, 0);
    assert.equal(run("--max-growth", "39").status, 1);
    assert.equal(run("--max-growth-percent", "20").status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pprof captures attribute leaf samples to unslid addresses, per thread", () => {
  // A minimal pprof Profile message, encoded field by field.
  const varint = (value: number): number[] => {
    const bytes: number[] = [];
    let rest = value;
    while (rest >= 128) {
      bytes.push((rest % 128) + 128);
      rest = Math.floor(rest / 128);
    }
    bytes.push(rest);
    return bytes;
  };
  const scalar = (field: number, value: number): number[] => [
    ...varint(field * 8),
    ...varint(value),
  ];
  const message = (field: number, body: number[]): number[] => [
    ...varint(field * 8 + 2),
    ...varint(body.length),
    ...body,
  ];
  const text = (field: number, value: string): number[] =>
    message(field, [...new TextEncoder().encode(value)]);
  // Strings: 0 "", 1 thread_id, 2 the binary, 3 dyld.
  const sample = (locations: number[], count: number, thread: number) =>
    message(2, [
      ...message(1, locations.flatMap(varint)),
      ...message(2, [...varint(count), ...varint(count * 1000000)]),
      ...message(3, [...scalar(1, 1), ...scalar(3, thread)]),
    ]);
  const profile = new Uint8Array([
    ...sample([1, 2], 3, 7),
    ...sample([2], 2, 7),
    ...sample([3], 1, 7),
    ...sample([1], 4, 9),
    ...message(3, [
      ...scalar(1, 1),
      ...scalar(2, 0x104000000),
      ...scalar(5, 2),
    ]),
    ...message(3, [
      ...scalar(1, 2),
      ...scalar(2, 0x7ff000000),
      ...scalar(5, 3),
    ]),
    ...message(4, [
      ...scalar(1, 1),
      ...scalar(2, 1),
      ...scalar(3, 0x104000010),
    ]),
    ...message(4, [
      ...scalar(1, 2),
      ...scalar(2, 1),
      ...scalar(3, 0x104000020),
    ]),
    ...message(4, [
      ...scalar(1, 3),
      ...scalar(2, 2),
      ...scalar(3, 0x7ff000000),
    ]),
    ...text(6, ""),
    ...text(6, "thread_id"),
    ...text(6, "/tmp/dir/fixture"),
    ...text(6, "/usr/lib/dyld"),
  ]);
  const samples = decodeProfile(profile, "/elsewhere/fixture");
  assert.equal(samples.total, 10);
  assert.equal(samples.byAddress.get(0x100000010), 7);
  assert.equal(samples.byAddress.get(0x100000020), 2);
  // Thread 7 has the most samples inside the image (5 against 4).
  const busiest = decodeProfile(profile, "/elsewhere/fixture", {
    thread: "busiest",
  });
  assert.equal(busiest.thread, 7);
  assert.equal(busiest.total, 6);
  assert.equal(busiest.byAddress.get(0x100000010), 3);
  assert.equal(
    decodeProfile(profile, "fixture", { thread: 9 }).byAddress.get(0x100000010),
    4,
  );
});

test(
  "annotated disassembly interleaves IR operations, source lines and samples",
  { skip: findLlvmTool("llvm-objdump") === undefined },
  () => {
    const request = fixtureRequest();
    let ranges: unknown;
    const dumps: string[] = [];
    const observation = createBuildObservation({
      passStats: false,
      codeSize: true,
    });
    const image = build({
      ...request,
      ...observation.request,
      debugSymbols: true,
      onOperationRanges: (value) => {
        ranges = value;
      },
      onScalarIR: (stage, module) => {
        if (stage === "optimized") dumps.push(formatModule(module));
      },
    });
    const directory = mkdtempSync(join(tmpdir(), "tint-annotate-"));
    try {
      const binary = join(directory, "fixture");
      writeFileSync(binary, image, { mode: 0o755 });
      writeFileSync(binary + ".operations.json", JSON.stringify(ranges));
      writeFileSync(binary + ".optimized.ir", dumps.join(""));
      observation.finish(binary, () => {});
      const text = machOSections(image).find(
        (section) => section.section === "__text",
      );
      assert.ok(text);
      assert.equal(text.address, 0x100001000);
      const size = JSON.parse(
        readFileSync(binary + ".code-size.json", "utf8"),
      ) as CodeSizeReport;
      const run = size.functions.find((fn) => fn.source === "fixture:run");
      assert.ok(run);
      const hot = text.address + run.offset + 64;
      const listing = annotate(binary, {
        functions: ["fixture:run"],
        samples: { total: 10, byAddress: new Map([[hot, 7]]) },
      });
      assert.match(
        listing,
        /^== program:fixture:run \[.+\]  0x[0-9a-f]+  \d+ bytes  7 samples \(70\.00%\)/,
      );
      assert.match(listing, /^ {14}; IR b\d+#-?\d+ \S+/m);
      assert.match(listing, /^ {14}; \.\/fixture:\d+$/m);
      assert.match(
        listing,
        new RegExp(`^\\s+7   ${hot.toString(16)}:  \\S+`, "m"),
      );
      // Hottest functions are selected by samples without a name filter.
      const hottest = annotate(binary, {
        functions: [],
        hot: 1,
        samples: { total: 10, byAddress: new Map([[hot, 7]]) },
      });
      assert.equal(hottest.match(/^== /gm)?.length, 1);
      assert.match(hottest, /fixture:run/);
      assert.throws(() => annotate(binary, { functions: [] }));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  "annotated disassembly reads ELF images",
  { skip: findLlvmTool("llvm-objdump") === undefined },
  () => {
    const observation = createBuildObservation({
      passStats: false,
      codeSize: true,
    });
    const image = build({
      ...fixtureRequest(),
      ...observation.request,
      target: linuxAArch64Target,
      debugSymbols: true,
    });
    const directory = mkdtempSync(join(tmpdir(), "tint-annotate-elf-"));
    try {
      const binary = join(directory, "fixture");
      writeFileSync(binary, image, { mode: 0o755 });
      observation.finish(binary, () => {});
      const { text, dwarf } = imageText(image);
      assert.equal(text.section, ".text");
      assert.equal(text.address % 4096, 0);
      assert.ok(dwarf);
      const size = JSON.parse(
        readFileSync(binary + ".code-size.json", "utf8"),
      ) as CodeSizeReport;
      const run = size.functions.find((fn) => fn.source === "fixture:run");
      assert.ok(run);
      const hot = text.address + run.offset + 64;
      const listing = annotate(binary, {
        functions: ["fixture:run"],
        samples: { total: 4, byAddress: new Map([[hot, 3]]) },
      });
      assert.match(
        listing,
        /^== program:fixture:run \[.+\]  0x[0-9a-f]+  \d+ bytes  3 samples \(75\.00%\)/,
      );
      assert.match(listing, /^ {14}; \.\/fixture:\d+$/m);
      assert.match(
        listing,
        new RegExp(`^\\s+3   ${hot.toString(16)}:  \\S+`, "m"),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
