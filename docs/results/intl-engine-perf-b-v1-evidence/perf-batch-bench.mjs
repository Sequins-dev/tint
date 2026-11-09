// Matched native batch-compilation benchmark (adapted from H's
// measure-dtf-runtime-footprint-h-v4.mjs). Loads the compiler from a frozen
// toolchain and its own source snapshot, builds one image for a pinned
// non-Intl Test262 manifest and one for P/A1's 24-eval fixture, and records
// compile wall/CPU, image size and peak RSS. Usage:
//   node perf-batch-bench.mjs <frozen-dir> <manifest> <label> <report> [aot|monolithic]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const wholeProcessCpu = process.cpuUsage();
const [frozenArg, manifestArg, label, reportArg, modeArg] = process.argv.slice(2);
if (!reportArg) throw Error("usage: frozen manifest label report [aot|monolithic]");
const mode = modeArg ?? "monolithic";
const frozen = resolve(frozenArg);
const url = (name) => pathToFileURL(frozen + "/tools/" + name + ".ts").href;
const { startNativeHeartbeat } = await import(url("test262-native-heartbeat"));
const heartbeat = startNativeHeartbeat("B intl perf " + label);
const cpuMs = (u) => (u.user + u.system) / 1000;
try {
  const [{ readWorkspaceSourceSnapshot, workspaceSourceIdentity }, native, { testMetadata }, { executionPlan }, { test262Source }, { frozenNativeRunIdentity }] =
    await Promise.all([import(url("workspace-sources")), import(url("test262-native")), import(url("test262")), import(url("test262-execution")), import(url("test262-checkout")), import(url("native-run-journal"))]);
  const snapshot = readWorkspaceSourceSnapshot(frozen + "/source-snapshot.json");
  const frozenToolchainSha256 = frozenNativeRunIdentity(url("test262-native-run"), workspaceSourceIdentity(snapshot));
  if (frozenToolchainSha256 === undefined) throw Error("frozen identity required");
  const evaluation = native.capturedScriptEvaluation(snapshot);
  const root = resolve(".tint-bootstrap/test262");
  function prepare(plan, variant, harness, filename) {
    if (evaluation?.dynamicImport) {
      const x = native.prepareNativeScriptProgram(plan, variant, harness, filename, undefined, false, true);
      if (!x.ok) throw Error(JSON.stringify(x));
      return { scripts: x.scripts, asynchronous: plan.asynchronous, canSuspend: plan.canSuspend, ...(x.root === undefined ? {} : { scriptRoot: { absent: x.root.absent }, modules: x.root.entries }) };
    }
    const x = native.prepareNativeScripts(plan, variant, harness);
    if (!x.ok) throw Error(JSON.stringify(x));
    return { scripts: x.modules, asynchronous: plan.asynchronous, canSuspend: plan.canSuspend };
  }
  const manifest = JSON.parse(readFileSync(manifestArg));
  const cases = [], inputs = [];
  for (const row of manifest) {
    const filename = root + "/test/" + row.path, source = test262Source(filename);
    if (source.sha256 !== row.sha256) throw Error("test input mismatch " + row.path);
    const metadata = testMetadata(source.source), plan = executionPlan(source.source, row.variant, metadata);
    const harness = plan.harness.map((name) => ({ filename: root + "/harness/" + name, ...test262Source(root + "/harness/" + name) }));
    if (metadata.negative || plan.goal !== "script" || metadata.features.some((x) => /Intl|Temporal/.test(x))) throw Error("non-Intl positive Scripts only");
    cases.push(prepare(plan, row.variant, harness, filename));
    inputs.push({ ...row, harness: harness.map((h, i) => ({ name: plan.harness[i], sha256: h.sha256 })) });
  }
  const evalSources = [
    'var s=0;for(var i=0;i<24;i++){s+=eval("var v"+i+"="+i+"; v"+i+"*2+(function(a){return a+1})(v"+i+")");}if(s!==852)throw new Error(String(s));',
    'var t=0;for(var i=0;i<24;i++){t+=Function("a","b","return a*"+i+"+b")(2,1);}if(t!==576)throw new Error(String(t));',
  ];
  const evalCases = evalSources.map((source) => {
    const plan = executionPlan(source, "raw", { flags: ["raw"], features: [], includes: [] });
    const x = native.prepareNativeScripts(plan, "raw", []);
    if (!x.ok) throw Error(JSON.stringify(x));
    return { scripts: x.modules, asynchronous: plan.asynchronous };
  });
  let serviceImage, servicePreparation;
  if (mode === "aot") {
    heartbeat.phase("preparing cached native service");
    const { prepareDateTimeNativeService } = await import(url("date-time-native-service"));
    const c = process.cpuUsage(), t = performance.now();
    serviceImage = prepareDateTimeNativeService(snapshot, frozenToolchainSha256, resolve(process.env.TINT_NATIVE_SERVICE_CACHE ?? ".tint-bootstrap/native-service-cache"));
    servicePreparation = { cacheHit: serviceImage.hit, unitBytes: serviceImage.unitBytes, ...serviceImage.identity, wallMs: performance.now() - t, cpuMs: cpuMs(process.cpuUsage(c)) };
  }
  const build = native.createNativeBatchBuilder(snapshot, false, serviceImage);
  function measure(name, list) {
    heartbeat.phase("compiling " + name + " (" + list.length + " cases)");
    const c = process.cpuUsage(), t = performance.now();
    const built = build(list);
    const wallMs = performance.now() - t, cpu = process.cpuUsage(c);
    if (!built.ok) throw Error(name + ": " + JSON.stringify(built.outcome ?? built).slice(0, 4000));
    const image = resolve(reportArg + "." + name + ".image");
    writeFileSync(image, built.bytes, { flag: "wx" });
    return { cases: list.length, compileWallMs: wallMs, compileCpuUserMs: cpu.user / 1000, compileCpuSystemMs: cpu.system / 1000, compileCpuMs: cpuMs(cpu), imageBytes: built.bytes.length, imageSha256: createHash("sha256").update(built.bytes).digest("hex"), image };
  }
  const array64 = measure("array64", cases);
  const eval24 = measure("eval24", evalCases);
  const result = {
    kind: "b-intl-engine-perf-benchmark", conformance: false, label, mode, time: new Date().toISOString(), node: process.version,
    frozen, frozenToolchainSha256, sourceSnapshot: workspaceSourceIdentity(snapshot), servicePreparation,
    inputs, evalSources, array64, eval24,
    peakRssBytes: process.resourceUsage().maxRSS * 1024, wholeProcessCpuMs: cpuMs(process.cpuUsage(wholeProcessCpu)),
    resources: native.nativeTestResources,
  };
  writeFileSync(reportArg, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ label, mode, array64: { wall: array64.compileWallMs, cpu: array64.compileCpuMs, bytes: array64.imageBytes }, eval24: { wall: eval24.compileWallMs, cpu: eval24.compileCpuMs, bytes: eval24.imageBytes }, peakRss: result.peakRssBytes }));
} finally {
  await heartbeat.close();
}
