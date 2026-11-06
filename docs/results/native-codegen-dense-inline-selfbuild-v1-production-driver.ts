import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { startNativeHeartbeat } from "../../tools/test262-native-heartbeat.ts";
const prefix = resolve(
  ".tint-bootstrap/perf/verify-dense-production-emission-v1",
);
mkdirSync(prefix);
const frozen = JSON.parse(
    readFileSync(
      ".tint-bootstrap/perf/codegen-dense-production-toolchain-v9.json",
      "utf8",
    ),
  ),
  candidate = JSON.parse(
    readFileSync(
      ".tint-bootstrap/perf/dense-candidate-v8-manifest.json",
      "utf8",
    ),
  ),
  matched = JSON.parse(
    readFileSync(
      ".tint-bootstrap/perf/selfbuild-dense-matched-pair-v1/result.json",
      "utf8",
    ),
  );
if (!matched.afterStageImageIdentical || !matched.identicalCompilerOutputs)
  throw Error("native matched compiler proof missing");
for (const file of candidate.changed)
  if (
    !readFileSync(frozen.directory + "/" + file).equals(
      readFileSync(candidate.sourceRoot + "/" + file),
    )
  )
    throw Error("production candidate implementation differs " + file);
const heartbeat = startNativeHeartbeat(
  "P production dense compiler emission equivalence",
);
try {
  heartbeat.phase("production Node compiler emitting sealed candidate sources");
  const image = prefix + "/stage1",
    r = spawnSync(
      "/usr/bin/time",
      [
        "-p",
        process.execPath,
        frozen.directory + "/tools/bootstrap-compiler.ts",
        image,
        "--source-root",
        candidate.sourceRoot,
        "--debug-symbols",
      ],
      { cwd: frozen.directory, stdio: "inherit" },
    );
  if (r.status !== 0)
    throw Error("production Node compilation failed " + r.status);
  const bytes = readFileSync(image),
    expected = readFileSync(
      ".tint-bootstrap/perf/selfbuild-dense-matched-pair-v1/after-stage1",
    );
  if (!bytes.equals(expected))
    throw Error("production image differs from matched native stage images");
  writeFileSync(
    prefix + "/result.json",
    JSON.stringify(
      {
        kind: "production-host-emission-equivalence",
        frozenToolchain: frozen,
        candidateSourceSnapshot: candidate.sourceSnapshot,
        prototypeAdapter: candidate.adapter,
        productionAdapter: null,
        identical: true,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        scope:
          "Unmodified production host emits exactly the matched prototype stage1/native stage2 bytes from the same sealed source input. All three implementation source files match the sealed candidate byte for byte; current workspace adds a comment-only contract clarification.",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  heartbeat.close();
}
