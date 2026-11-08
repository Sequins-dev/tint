// Usage: node build-eval-cases.mjs <toolchain-dir> <output-image>
// One native image, four raw cases: 0, 1, 100 unique evals, and J's exact
// bounded 1000-unique-eval source (SHA 79a1792e...). Diagnostic, not Test262.
import { writeFileSync, copyFileSync, chmodSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const [toolchainArg, output] = process.argv.slice(2), dir = resolve(toolchainArg);
const { readWorkspaceSourceSnapshot, workspaceSourceIdentity } = await import(dir + "/tools/workspace-sources.ts");
const { prepareNativeScripts, createNativeBatchBuilder, nativeTestResources } = await import(dir + "/tools/test262-native.ts");
const { executionPlan } = await import(dir + "/tools/test262-execution.ts");
const { startNativeHeartbeat } = await import(dir + "/tools/test262-native-heartbeat.ts");
const loop = (end) => 'for(var cu=1024;cu<' + end + ';++cu){var xx=String.fromCharCode(cu);var pattern=eval("/"+xx+"/");if(pattern.source!==xx)throw 1;}';
const sources = ["var cu=1024;var xx=String.fromCharCode(cu);if(xx.length!==1)throw 1;", loop(1025), loop(1124), loop(2024)];
const sha = (text) => createHash("sha256").update(text).digest("hex");
if (sha(sources[3]) !== "79a1792e31612125d20c1eedb3dc926c7289b526c7f25b3ea234b1312fcd0fca") throw Error("J source mismatch");
const heartbeat = startNativeHeartbeat("P eval-count benchmark image build");
try {
  const cases = sources.map((source) => { const p = prepareNativeScripts(executionPlan(source, "raw", { flags: ["raw"], features: [], includes: [] }), "raw", []); if (!p.ok) throw Error(JSON.stringify(p)); return { scripts: p.modules, asynchronous: false, canSuspend: false }; });
  const snapshot = readWorkspaceSourceSnapshot(dir + "/source-snapshot.json");
  heartbeat.phase("compiling four-case eval benchmark image");
  const built = createNativeBatchBuilder(snapshot)(cases);
  if (!built.ok) throw Error(JSON.stringify(built));
  writeFileSync(output, built.bytes, { mode: 0o755, flag: "wx" });
  const manifest = { kind: "eval-count-benchmark-image", conformance: false, toolchain: dir, toolchainSha256: createHash("sha256").update(readFileSync(dir + "/toolchain.json")).digest("hex"), sourceSnapshot: workspaceSourceIdentity(snapshot), cases: sources.map((source, index) => ({ index, evals: [0, 1, 100, 1000][index], source, sha256: sha(source) })), fixtureSha256: sha(JSON.stringify(sources)), imageSha256: sha(built.bytes), resources: nativeTestResources };
  writeFileSync(output + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ image: output, imageSha256: manifest.imageSha256 }));
} finally { await heartbeat.close(); }
