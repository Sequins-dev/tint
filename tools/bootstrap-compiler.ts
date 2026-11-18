import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadSourceGraph } from "@tint/typescript/modules";
import { expandForeignInputs } from "@tint/compiler/native";
import { nativeTargetNamed } from "@tint/platform/target";
import { nodeHostTarget } from "./native-host-target.ts";
import { functionStorageFromEnvironment } from "./emission-storage.ts";
import {
  buildMacOSProgram,
  type ImageOperationRange,
} from "@tint/compiler/build";
import { pathToFileURL } from "node:url";
import { formatModule } from "./ir-dump/format.ts";
import type { ModuleIR } from "@tint/ir/scalar";
import * as currentProject from "@tint/compiler/cli";
import {
  createBuildObservation,
  observabilityOptions,
} from "./observability/build-observer.ts";
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
// The compiler image runs on the target it is built for: default to Node's.
const targetFlag = process.argv.indexOf("--target");
const target =
  targetFlag < 0
    ? nodeHostTarget()
    : nativeTargetNamed(process.argv[targetFlag + 1] ?? "");
if (target === undefined)
  throw Error("--target requires darwin-aarch64 or linux-aarch64");
const rootFlag = process.argv.indexOf("--source-root");
const rootArgument = rootFlag < 0 ? undefined : process.argv[rootFlag + 1];
if (
  rootFlag >= 0 &&
  (rootArgument === undefined || rootArgument.startsWith("--"))
)
  throw Error("--source-root requires an input directory");
const sourceRoot = resolve(rootArgument ?? ".");
// A frozen source root brings its own project description (catalog, roots
// and build request): its file set predates or postdates the current one.
const project: Pick<
  typeof currentProject,
  "projectFiles" | "projectMappings" | "projectRoots" | "projectBuildRequest"
> &
  Partial<Pick<typeof currentProject, "compilerBuildRequest">> =
  rootArgument === undefined
    ? currentProject
    : {
        ...((await import(
          pathToFileURL(resolve(sourceRoot, "packages/compiler/src/catalog.ts"))
            .href
        )) as Pick<typeof currentProject, "projectFiles" | "projectMappings">),
        ...((await import(
          pathToFileURL(resolve(sourceRoot, "packages/compiler/src/project.ts"))
            .href
        )) as Pick<
          typeof currentProject,
          "projectRoots" | "projectBuildRequest"
        > &
          Partial<Pick<typeof currentProject, "compilerBuildRequest">>),
      };
const started = performance.now();
function report(stage: string) {
  console.log(
    `[${((performance.now() - started) / 1000).toFixed(1)}s] ${stage}`,
  );
}
report("sources");
const inputs = project.projectFiles().map((file) => ({
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
// C binding declarations become generated modules, as the native CLI loads
// them (docs/native-ffi.md); frozen roots that predate them have none.
const foreign = expandForeignInputs(inputs, target.c);
if (!foreign.ok) throw Error(foreign.error);
const graph = loadSourceGraph(
  foreign.value.inputs,
  [...project.projectMappings(), ...foreign.value.mappings],
  project.projectRoots(),
);
if (!graph.ok) throw Error(JSON.stringify(graph.error));
// The compiler's own request (with the clock its --pass-stats reads); older
// frozen source roots predate it.
const request = (project.compilerBuildRequest ?? project.projectBuildRequest)(
  graph.value,
  report,
  foreign.value.libraries,
);
// Compiler observability (docs/compiler-observability.md): --pass-stats,
// --code-size, TINT_PASS_STATS, TINT_CODE_SIZE, TINT_DUMP_PASSES,
// TINT_REMARKS and TINT_OPT_PASS_LIMIT write <output>.* reports.
const observation = createBuildObservation(
  observabilityOptions(process.env, process.argv),
);
// --operation-ranges writes <output>.operations.json (tools/op-cost).
let operationRanges: readonly ImageOperationRange[] | undefined;
// TINT_DUMP_IR=<substring> writes <output>.lowered.ir and <output>.optimized.ir
// for program functions whose names contain it ("" = all).
const dumps: [string, string][] = [];
const dumpFilter = process.env.TINT_DUMP_IR;
const storage = functionStorageFromEnvironment();
const built = buildMacOSProgram({
  ...request,
  target,
  ...(storage === undefined ? {} : { storage }),
  // The self-build (and the frozen workloads built from older project
  // sources) must stay typed: its speed is the compiler benchmark.
  requireTyped: true,
  managedBytes: managedBytes ?? request.managedBytes,
  allocationCapacity: allocationCapacity ?? request.allocationCapacity,
  debugSymbols: process.argv.includes("--debug-symbols"),
  // --signposts: os_signpost GC and allocation intervals
  // (docs/runtime-diagnostics.md).
  ...(process.argv.includes("--signposts") ? { signposts: true } : {}),
  // Debug builds include heap introspection (docs/native-heap-profiling.md);
  // --no-heap-introspection keeps their code identical to default builds.
  ...(process.argv.includes("--no-heap-introspection")
    ? { heapIntrospection: false }
    : {}),
  debugDirectory: snapshot ?? sourceRoot,
  ...observation.request,
  ...(process.argv.includes("--operation-ranges")
    ? {
        onOperationRanges: (ranges: readonly ImageOperationRange[]) => {
          operationRanges = ranges;
        },
      }
    : {}),
  ...(dumpFilter === undefined
    ? {}
    : {
        onScalarIR: (stage: "lowered" | "optimized", module: ModuleIR) => {
          dumps.push([stage, formatModule(module, dumpFilter || undefined)]);
        },
      }),
});
for (const [stage, text] of dumps)
  writeFileSync(output + "." + stage + ".ir", text);
if (!built.ok) throw Error(JSON.stringify(built.error));
mkdirSync(dirname(output), { recursive: true });
observation.finish(output);
writeFileSync(output, built.value);
chmodSync(output, 0o755);
if (operationRanges !== undefined)
  writeFileSync(output + ".operations.json", JSON.stringify(operationRanges));
report(`wrote ${output} (${built.value.length} bytes)`);
