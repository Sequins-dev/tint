import { createHash } from "node:crypto";
import {
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import type { ExecutionOutcome } from "./test262-execution.ts";
import {
  NativeImageRunner,
  nativeDebuggerLaunch,
  nativeDebuggerStdio,
  nativeDebuggerTracing,
} from "./test262-native-process.ts";
import type { workspaceSourceIdentity } from "./workspace-sources.ts";

interface FixtureRunner {
  run(selectedCase?: number): ExecutionOutcome;
  close(): void;
}
/** The caller owns a cooperative native-execution checkpoint. Preflight every
 * input and reserve a new report before running; persist the outcome before
 * cleanup, which can itself fail. Bespoke observations never count as Test262. */
export function recordNativeFixture(
  options: {
    readonly binary: string;
    readonly fixture: string;
    readonly report: string;
    readonly sourceSnapshot?: ReturnType<typeof workspaceSourceIdentity>;
    readonly timeoutMs?: number;
    readonly selectedCase?: number;
    readonly relatedReports?: readonly string[];
  },
  createRunner: (bytes: Uint8Array) => FixtureRunner = (bytes) =>
    new NativeImageRunner(bytes, options.timeoutMs ?? 60000),
): ExecutionOutcome {
  const bytes = new Uint8Array(readFileSync(options.binary));
  const imageSha256 = createHash("sha256").update(bytes).digest("hex");
  const manifestPath = options.binary + ".manifest.json";
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : undefined;
  if (
    manifest !== undefined &&
    (manifest.kind !== "tint-hosted-native-build" ||
      manifest.version !== 1 ||
      manifest.imageSha256 !== imageSha256)
  )
    throw Error("Native image build provenance differs");
  const sourceSnapshot = manifest?.sourceSnapshot ?? options.sourceSnapshot;
  if (
    sourceSnapshot === undefined ||
    !Number.isSafeInteger(sourceSnapshot.files) ||
    sourceSnapshot.files < 0 ||
    typeof sourceSnapshot.sha256 !== "string"
  )
    throw Error("Native source provenance is missing");
  if (
    manifest !== undefined &&
    options.sourceSnapshot !== undefined &&
    (options.sourceSnapshot.files !== sourceSnapshot.files ||
      options.sourceSnapshot.sha256 !== sourceSnapshot.sha256)
  )
    throw Error("Native source provenance differs from captured build");
  const started = performance.now();
  const metadata = {
    startedAt: new Date().toISOString(),
    containmentTimeoutMs: options.timeoutMs ?? 60000,
    kind: "bespoke-native-regression",
    conformance: false,
    binary: options.binary,
    fixture: options.fixture,
    fixtureSha256: createHash("sha256")
      .update(readFileSync(options.fixture))
      .digest("hex"),
    imageSha256,
    sourceSnapshot,
    ...(manifest === undefined ? {} : { buildManifest: manifestPath }),
    debuggerLaunch: nativeDebuggerLaunch,
    debuggerStdio: nativeDebuggerStdio,
    debuggerTracing: nativeDebuggerTracing,
    ...(options.selectedCase === undefined
      ? {}
      : { selectedCase: options.selectedCase }),
    ...(options.relatedReports === undefined
      ? {}
      : { relatedReports: options.relatedReports }),
  };
  const descriptor = openSync(options.report, "wx");
  let runner: FixtureRunner | undefined;
  try {
    let outcome: ExecutionOutcome;
    try {
      runner = createRunner(bytes);
      outcome = runner.run(options.selectedCase);
    } catch (error) {
      writeFileSync(
        descriptor,
        JSON.stringify(
          {
            ...metadata,
            kind: "bespoke-native-recording-failure",
            recordingError: String(error),
            elapsedMs: performance.now() - started,
          },
          null,
          2,
        ) + "\n",
      );
      throw error;
    }
    writeFileSync(
      descriptor,
      JSON.stringify(
        { ...metadata, elapsedMs: performance.now() - started, outcome },
        null,
        2,
      ) + "\n",
    );
    return outcome;
  } finally {
    try {
      runner?.close();
    } finally {
      closeSync(descriptor);
    }
  }
}
