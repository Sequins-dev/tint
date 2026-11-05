import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadSourceGraph } from "@tint/typescript/modules";
import { buildMacOSProgram } from "@tint/compiler/build";
import {
  projectFiles,
  projectMappings,
  projectRoots,
  projectBuildRequest,
} from "@tint/compiler/cli";
const output = resolve(process.argv[2] ?? ".tint-bootstrap/stage1");
const snapshotFlag = process.argv.indexOf("--snapshot");
const snapshotArgument =
  snapshotFlag < 0 ? undefined : process.argv[snapshotFlag + 1];
if (
  snapshotFlag >= 0 &&
  (snapshotArgument === undefined || snapshotArgument.startsWith("--"))
)
  throw Error("--snapshot requires a new source directory");
const snapshot =
  snapshotArgument === undefined ? undefined : resolve(snapshotArgument);
const heapFlag = process.argv.indexOf("--managed-bytes");
const heapArgument = heapFlag < 0 ? undefined : process.argv[heapFlag + 1];
const managedBytes =
  heapArgument === undefined ? undefined : Number(heapArgument);
if (
  heapFlag >= 0 &&
  (managedBytes === undefined ||
    !Number.isSafeInteger(managedBytes) ||
    managedBytes <= 0 ||
    managedBytes > 0xffffffff ||
    managedBytes % 16 !== 0)
)
  throw Error(
    "--managed-bytes requires a positive, 16-byte-aligned uint32 extent",
  );
const capacityFlag = process.argv.indexOf("--allocation-capacity");
const capacityArgument =
  capacityFlag < 0 ? undefined : process.argv[capacityFlag + 1];
const allocationCapacity =
  capacityArgument === undefined ? undefined : Number(capacityArgument);
if (
  capacityFlag >= 0 &&
  (allocationCapacity === undefined ||
    !Number.isSafeInteger(allocationCapacity) ||
    allocationCapacity <= 0 ||
    allocationCapacity > 0xffffffff)
)
  throw Error("--allocation-capacity requires a positive uint32 count");
const rootFlag = process.argv.indexOf("--source-root");
const rootArgument = rootFlag < 0 ? undefined : process.argv[rootFlag + 1];
if (
  rootFlag >= 0 &&
  (rootArgument === undefined || rootArgument.startsWith("--"))
)
  throw Error("--source-root requires an input directory");
const sourceRoot = resolve(rootArgument ?? ".");
const started = performance.now();
function report(stage: string) {
  console.log(
    `[${((performance.now() - started) / 1000).toFixed(1)}s] ${stage}`,
  );
}
report("sources");
const inputs = projectFiles().map((file) => ({
  ...file,
  bytes: new Uint8Array(readFileSync(resolve(sourceRoot, file.id))),
}));
if (snapshot !== undefined) {
  // A unique directory prevents accidentally changing the source of an older profile.
  mkdirSync(snapshot);
  for (const input of inputs) {
    const path = resolve(snapshot, input.id);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, input.bytes);
  }
}
report("parse");
const graph = loadSourceGraph(inputs, projectMappings(), projectRoots());
if (!graph.ok) throw Error(JSON.stringify(graph.error));
const request = projectBuildRequest(graph.value, report);
const built = buildMacOSProgram({
  ...request,
  managedBytes: managedBytes ?? request.managedBytes,
  allocationCapacity: allocationCapacity ?? request.allocationCapacity,
  debugSymbols: process.argv.includes("--debug-symbols"),
  debugDirectory: snapshot ?? sourceRoot,
});
if (!built.ok) throw Error(JSON.stringify(built.error));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, built.value);
chmodSync(output, 0o755);
report(`wrote ${output} (${built.value.length} bytes)`);
