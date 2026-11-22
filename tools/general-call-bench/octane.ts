import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeNodeExecutable } from "../node-file-host.ts";
import { nativeFixtureTarget } from "../native-host-target.ts";
import { nativeArtifact } from "../native-target-runner.ts";
import { executionPlan } from "../test262-execution.ts";
import {
  createNativeBatchBuilder,
  deferNativeCase,
  benchmarkScriptHost,
  prepareNativeScripts,
} from "../test262-native.ts";
import {
  workspaceSourceIdentity,
  workspaceSources,
} from "../workspace-sources.ts";

const revision = "570ad1ccfe86e3eecba0636c8f932ac08edec517";
const upstream =
  "https://raw.githubusercontent.com/chromium/octane/" + revision;
const hashes = {
  LICENSE: "cf853177951c6de1b17c029b66edf71f8b194cca1722339a7b5def4e8165aaaa",
  "base.js": "216612c2e7096a02b3e52b57e9cf9351bbaf180d60938d5c60b85fd756232733",
  "richards.js":
    "1246a64a24b931158bf01c24640343259fa74b0226e73bad630bd1f686aa0fa7",
  "deltablue.js":
    "6c4784e82f3e8f5c18306d289653d08b17b38838f1bac16b38611d7318fa5a36",
  "navier-stokes.js":
    "27926de809451c60b0c49a4185c08f97081310d0db166a30c1d202fb656556a2",
  "raytrace.js":
    "64b8ff90969966dd69659100e28754976dfc3e9a4f8ee55b9232f974c66ed08c",
};

const cases = {
  Richards: { file: "richards.js", warm: 48, iterations: 48 },
  DeltaBlue: { file: "deltablue.js", warm: 32, iterations: 32 },
  NavierStokes: { file: "navier-stokes.js", warm: 15, iterations: 4 },
  RayTrace: { file: "raytrace.js", warm: 12, iterations: 12 },
} as const;

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function fetchOctane(directory: string): void {
  for (const [name, expected] of Object.entries(hashes)) {
    const bytes = execFileSync("curl", ["-fsSL", upstream + "/" + name]);
    assert.equal(sha256(bytes), expected, name);
    writeFileSync(join(directory, name), bytes, { flag: "wx" });
  }
}

export function prepareOctane(
  directory: string,
  selected: string | undefined,
  node: string,
) {
  directory = resolve(directory);
  const files = new Map<string, string>();
  for (const [name, expected] of Object.entries(hashes)) {
    const bytes = readFileSync(join(directory, name));
    assert.equal(sha256(bytes), expected, name);
    files.set(
      name,
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    );
  }
  const checksums: Record<
    string,
    { sum: number; warm: number; iterations: number }
  > = {};
  const sources = [{ filename: "base.js", source: files.get("base.js")! }];
  for (const [name, { file, warm, iterations }] of Object.entries(cases)) {
    if (selected !== undefined && name !== selected) continue;
    checksums[name] = { sum: iterations, iterations, warm };
    sources.push({ filename: file, source: files.get(file)! });
    sources.push({
      filename: name + "-driver.js",
      source: `(function () {
  BenchmarkSuite.ResetRNG();
  var suite = BenchmarkSuite.suites[BenchmarkSuite.suites.length - 1];
  if (suite.name !== "${name}" || suite.benchmarks.length !== 1) throw new Error("unexpected suite");
  var benchmark = suite.benchmarks[0];
  benchmark.Setup();
  var i;
  for (i = 0; i < ${warm}; i++) benchmark.run();
  var started = tintBenchmarkNow();
  for (i = 0; i < ${iterations}; i++) benchmark.run();
  var elapsed = tintBenchmarkNow() - started;
  benchmark.TearDown();
  tintBenchmarkReport("TINT_GENERAL_BENCH ${name} " + elapsed + " " + i);
})();`,
    });
  }
  assert.ok(Object.keys(checksums).length > 0, "unknown Octane case");
  const work = mkdtempSync(join(tmpdir(), "tint-octane-bench-"));
  const script = join(work, "benchmark.mjs");
  writeFileSync(
    script,
    'import { Script } from "node:vm";\n' +
      "globalThis.tintBenchmarkNow = () => Number(process.hrtime.bigint()) / 1e6;\n" +
      "globalThis.tintBenchmarkReport = (line) => console.log(line);\n" +
      `for (const {filename, source} of ${JSON.stringify(sources)}) new Script(source, {filename}).runInThisContext();\n`,
  );
  // Verify upstream internal checks before investing in the native build.
  const reference = execFileSync(node, [script], { encoding: "utf8" });
  for (const name of Object.keys(checksums)) {
    assert.match(
      reference,
      new RegExp("^TINT_GENERAL_BENCH " + name + " ", "m"),
    );
  }
  const scripts = sources.flatMap(({ filename, source }, index) => {
    const plan = executionPlan(source, "raw", {
      flags: ["raw"],
      features: [],
      includes: [],
    });
    const result = prepareNativeScripts(plan, "raw", [], benchmarkScriptHost);
    if (!result.ok)
      assert.fail(filename + ": " + JSON.stringify(result.outcome));
    return result.modules.map((module) => ({
      ...module,
      id: "octane-script-" + index,
    }));
  });
  const snapshot = workspaceSources();
  const build = createNativeBatchBuilder(
    snapshot,
    false,
    undefined,
    true,
  )([deferNativeCase({ scripts, asynchronous: false })]);
  if (!build.ok) assert.fail(JSON.stringify(build.outcome));
  const path = join(work, "octane");
  writeNodeExecutable(path, build.bytes, true);
  const manifest = path + ".manifest.json";
  const octane = { revision, upstream, hashes };
  const target = nativeFixtureTarget().name;
  writeFileSync(
    manifest,
    JSON.stringify(
      {
        kind: "tint-octane-classic-script-build",
        target,
        debugSymbols: process.env.TINT_DEBUG_SYMBOLS === "1",
        sourceSnapshot: workspaceSourceIdentity(snapshot),
        imageSha256: sha256(build.bytes),
        scripts: sources.map(({ filename, source }) => ({
          filename,
          sha256: sha256(source),
        })),
        octane,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  return {
    script,
    native: {
      untyped: nativeArtifact(target, path, manifest),
    },
    checksums,
    nativeLaunch: { args: ["0"], exit: 42 },
    octane,
  };
}
