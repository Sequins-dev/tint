import { spawnSync, spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir, loadavg } from "node:os";
import { createHash } from "node:crypto";
import { readWorkspaceSourceSnapshot } from "../../tools/workspace-sources.ts";
import { startNativeHeartbeat } from "../../tools/test262-native-heartbeat.ts";
import { debugserverLaunchCommand } from "../../tools/native-debugger-session.ts";
const directory = resolve(
  ".tint-bootstrap/perf/selfbuild-dense-matched-pair-v1",
);
mkdirSync(directory);
const manifest = JSON.parse(
  readFileSync(".tint-bootstrap/perf/dense-candidate-v8-manifest.json", "utf8"),
);
const prerequisite = JSON.parse(
  readFileSync(
    ".tint-bootstrap/perf/selfbuild-inline-unions-post-C2-v1/result.json",
    "utf8",
  ),
);
if (!prerequisite.identical || prerequisite.final.exitStatus !== 0)
  throw Error("post-C2 baseline has not validated");
const source = manifest.sourceRoot,
  frozen = manifest.baseToolchain.directory;
const snapshot = readWorkspaceSourceSnapshot(manifest.sourceSnapshotFile);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (digest(readFileSync(manifest.adapter.path)) !== manifest.adapter.sha256)
  throw Error("adapter changed");
for (const input of snapshot.inputs)
  if (!Buffer.from(input.bytes).equals(readFileSync(source + "/" + input.id)))
    throw Error("source changed " + input.id);
const toolchain = JSON.parse(readFileSync(frozen + "/toolchain.json", "utf8"));
for (const file of toolchain.files)
  if (digest(readFileSync(frozen + "/" + file.path)) !== file.sha256)
    throw Error("frozen file changed " + file.path);
const heartbeat = startNativeHeartbeat(
  "P matched native compiler dense representation",
);
const before = directory + "/before-stage1",
  after = directory + "/after-stage1";
writeFileSync(
  directory + "/inputs.json",
  JSON.stringify(
    {
      manifest,
      loadStart: loadavg(),
      compilerHosts: [
        "unchanged frozen Node host",
        "same host with recorded dense encoding adapter",
      ],
      scope:
        "Both executable compiler workloads use identical candidate TypeScript sources. Their generated output must match the after stage1 image byte for byte. The after compiler must also reproduce its own stage image. Production source and Node emission equivalence remain required before merge readiness.",
    },
    null,
    2,
  ) + "\n",
);
try {
  for (const [label, image, adapter] of [
    ["before", before, false],
    ["after", after, true],
  ]) {
    heartbeat.phase(
      "building " + label + " native compiler from identical source",
    );
    const args = [
      "-p",
      process.execPath,
      ...(adapter ? ["--import", manifest.adapter.path] : []),
      frozen + "/tools/bootstrap-compiler.ts",
      image,
      "--source-root",
      source,
      "--debug-symbols",
    ];
    const r = spawnSync("/usr/bin/time", args, {
      cwd: frozen,
      stdio: "inherit",
    });
    if (r.status !== 0) throw Error(label + " Node stage1 failed " + r.status);
  }
  const expected = readFileSync(after),
    observations = [];
  for (const [label, image] of [
    ["before", before],
    ["after", after],
  ]) {
    const run = directory + "/" + label;
    mkdirSync(run);
    process.env.TINT_P_REPORT_CAPTURE = run + "/reports.jsonl";
    heartbeat.phase(label + " native compiler under LLDB");
    const session = mkdtempSync(join(tmpdir(), "tint-p-dense-self-"));
    const initial = run + "/initial.json",
      final = run + "/final.json",
      output = run + "/stage2";
    const commands = [
      "settings set target.disable-aslr false",
      "command script import " +
        resolve(".tint-bootstrap/perf/p_capture_report_v1.py"),
      'script bp=lldb.debugger.GetSelectedTarget().BreakpointCreateByRegex("program:packages/compiler/src/cli.ts:report "); assert bp.GetNumLocations()>0; bp.SetScriptCallbackFunction("p_capture_report_v1.capture")',
      debugserverLaunchCommand(
        image,
        session,
        [source, output, "--debug-symbols"],
        300000,
        "direct",
      ),
      `script import json,time; p=lldb.debugger.GetSelectedTarget().GetProcess(); open(${JSON.stringify(initial)},'w').write(json.dumps({'state':'stopped' if p.GetState()==lldb.eStateStopped else str(p.GetState()),'pid':p.GetProcessID(),'monotonicNs':time.monotonic_ns()})); assert p.GetState()==lldb.eStateStopped`,
      "continue",
      `script import json,time; p=lldb.debugger.GetSelectedTarget().GetProcess(); open(${JSON.stringify(final)},'w').write(json.dumps({'state':'exited' if p.GetState()==lldb.eStateExited else str(p.GetState()),'exitStatus':p.GetExitStatus(),'monotonicNs':time.monotonic_ns()})); p.Kill() if p.GetState()!=lldb.eStateExited else None`,
    ];
    const observer = spawn(
      "python3",
      [resolve(".tint-bootstrap/perf/observe-selfbuild-cpu-v1.py"), run],
      { stdio: "inherit" },
    );
    const observed = new Promise((resolve, reject) =>
      observer.once("close", (status) =>
        status === 0
          ? resolve(undefined)
          : reject(Error("CPU observer " + status)),
      ),
    );
    const loadBefore = loadavg();
    const r = spawnSync(
      "/usr/bin/lldb",
      [
        "--no-lldbinit",
        "--batch",
        ...commands.flatMap((c) => ["-o", c]),
        image,
      ],
      { stdio: "inherit" },
    );
    if (!existsSync(initial)) observer.kill("SIGTERM");
    await observed;
    const start = JSON.parse(readFileSync(initial, "utf8")),
      end = JSON.parse(readFileSync(final, "utf8"));
    if (
      r.status !== 0 ||
      start.state !== "stopped" ||
      end.state !== "exited" ||
      end.exitStatus !== 0
    )
      throw Error(label + " native compiler failed " + JSON.stringify(end));
    const bytes = readFileSync(output);
    if (!bytes.equals(expected))
      throw Error(label + " output differs from after stage1");
    const observation = {
      label,
      initial: start,
      final: end,
      loadBefore,
      loadAfter: loadavg(),
      cpu: JSON.parse(readFileSync(run + "/cpu.json", "utf8")),
      inferiorWallMs: (end.monotonicNs - start.monotonicNs) / 1000000,
      outputSha256: digest(bytes),
      outputBytes: bytes.length,
      identicalToAfterStage1: true,
    };
    observations.push(observation);
    writeFileSync(
      run + "/result.json",
      JSON.stringify(observation, null, 2) + "\n",
    );
  }
  heartbeat.phase("verifying final compiler signature and DWARF");
  const signature = spawnSync("codesign", ["--verify", "--strict", after], {
      stdio: "inherit",
    }),
    dwarf = spawnSync("dwarfdump", ["--verify", after], { stdio: "inherit" });
  if (signature.status !== 0 || dwarf.status !== 0)
    throw Error("signature or DWARF validation failed");
  writeFileSync(
    directory + "/result.json",
    JSON.stringify(
      {
        manifest,
        observations,
        signatureExit: signature.status,
        dwarfExit: dwarf.status,
        afterStageImageIdentical: true,
        identicalCompilerOutputs: true,
        cpuSpeedup:
          observations[0].cpu.cpuMsLowerBound /
          observations[1].cpu.cpuMsLowerBound,
        scope:
          "One full native compiler execution per generated representation; same exact TypeScript source and identical emitted compiler bytes. Operation benchmarks provide repeated CPU medians. This is a prototype until production emission equivalence and workspace gates pass.",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  heartbeat.close();
}
