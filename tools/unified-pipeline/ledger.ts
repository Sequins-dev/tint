// Typed/untyped gap ledger (docs/unified-pipeline.md, slice 0). Builds both
// forms of every corpus construct through the hosted pipeline with the
// general fallback available, runs each natively under LLDB (expecting 42),
// and records which forms stayed on the typed path:
//
//   node tools/unified-pipeline/ledger.ts <label> [--jobs N] [--only a,b]
//       [--baseline docs/results/unified-pipeline-ledger-<old>.json]
//
// Writes docs/results/unified-pipeline-ledger-<label>.json (never
// overwritten). With --baseline, exits 1 when a form that passed in the
// baseline no longer passes, or a typed form that stayed typed now falls
// back. Run `pnpm build` first; do not edit the tree during a run.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { constructs } from "./corpus.ts";

type Form = "typed" | "untyped";
interface Entry {
  readonly construct: string;
  readonly form: Form;
  /** "general" when the build used the general fallback; "type-error" when
   * an ill-typed form was rejected at compile time as expected. */
  readonly path: "typed" | "general" | "type-error" | "none";
  /** "missed-type-error": an ill-typed form compiled; "unsupported": the
   * construct needs compiler options Tint does not offer yet. */
  readonly outcome:
    | "pass"
    | "build-failed"
    | "run-failed"
    | "missed-type-error"
    | "unsupported";
  readonly generalModules?: readonly string[];
  readonly reason?: string;
  readonly error?: string;
  readonly sourceSnapshot?: string;
  readonly seconds: number;
}
interface Ledger {
  readonly kind: "tint-unified-pipeline-ledger";
  readonly version: 1;
  readonly label: string;
  readonly recorded: string;
  readonly node: string;
  readonly sourceSnapshot: string | undefined;
  readonly summary: Record<Form, Record<string, number>>;
  readonly entries: readonly Entry[];
}

const args = process.argv.slice(2);
const label = args[0];
if (label === undefined || label.startsWith("--"))
  throw Error(
    "usage: ledger.ts <label> [--jobs N] [--only a,b] [--baseline file]",
  );
function option(name: string): string | undefined {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
}
const jobs = Number(option("--jobs") ?? "3");
const only = option("--only")?.split(",");
const baselinePath = option("--baseline");
const output = resolve(
  "docs/results/unified-pipeline-ledger-" + label + ".json",
);
if (existsSync(output)) throw Error(output + " already exists");
const baseline =
  baselinePath === undefined
    ? undefined
    : (JSON.parse(readFileSync(baselinePath, "utf8")) as Ledger);

const work: { construct: string; form: Form }[] = [];
for (const construct of constructs)
  if (only === undefined || only.includes(construct.name))
    for (const form of ["typed", "untyped"] as const)
      work.push({ construct: construct.name, form });

function verify(construct: string, form: Form): Promise<Entry> {
  const started = Date.now();
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    TZ: "UTC",
    TINT_KEEP_NATIVE: "1",
  };
  delete environment.TINT_GENERAL_FALLBACK;
  delete environment.TINT_BUILD_ONLY;
  return new Promise((done) => {
    const child = spawn(
      process.execPath,
      ["tools/unified-pipeline/verify-construct.ts", construct, form],
      { env: environment },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (status: number | null) => {
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      const fallback = /general fallback for (.*?) \((.*)\)\n/.exec(stderr);
      // The hosted builder prints the image path once the build succeeded.
      const image = stdout
        .split("\n")
        .find(
          (line) => line.startsWith("/") && existsSync(line + ".manifest.json"),
        );
      let sourceSnapshot: string | undefined;
      if (image !== undefined) {
        const manifest = JSON.parse(
          readFileSync(image + ".manifest.json", "utf8"),
        ) as { sourceSnapshot: { sha256: string } };
        sourceSnapshot = manifest.sourceSnapshot.sha256;
        rmSync(dirname(image), { recursive: true, force: true });
      }
      // A build that fails before compiling (the hosted builder asserts its
      // parse) or in the compiler reports the error object.
      const assertion = /AssertionError \[ERR_ASSERTION\]: (\{.*\})\n/.exec(
        stderr,
      )?.[1];
      const expectedTypeError =
        form === "typed"
          ? constructs.find((item) => item.name === construct)?.typedError
          : undefined;
      const sourceDiagnostic =
        image === undefined && assertion !== undefined
          ? /^.*"stage":"source".*?: (TS\d+): /.exec(assertion)?.[1]
          : undefined;
      const rejected =
        expectedTypeError !== undefined &&
        sourceDiagnostic === expectedTypeError;
      const outcome: Entry["outcome"] = stdout.includes("UNSUPPORTED_OPTION")
        ? "unsupported"
        : expectedTypeError !== undefined
          ? rejected
            ? "pass"
            : image === undefined
              ? "build-failed"
              : "missed-type-error"
          : status === 0 && stdout.includes("Verified native")
            ? "pass"
            : image === undefined
              ? "build-failed"
              : "run-failed";
      done({
        construct,
        form,
        path:
          sourceDiagnostic !== undefined
            ? "type-error"
            : image === undefined
              ? "none"
              : fallback === null
                ? "typed"
                : "general",
        outcome,
        ...(fallback === null
          ? assertion === undefined || image !== undefined
            ? {}
            : { reason: assertion }
          : {
              generalModules: (fallback[1] ?? "").split(", "),
              reason: fallback[2] ?? "",
            }),
        ...(outcome === "pass" ? {} : { error: stderr.slice(-1200) }),
        ...(sourceSnapshot === undefined ? {} : { sourceSnapshot }),
        seconds,
      });
    });
  });
}

const entries: Entry[] = [];
let next = 0;
async function worker(): Promise<void> {
  for (;;) {
    const item = work[next++];
    if (item === undefined) return;
    const entry = await verify(item.construct, item.form);
    entries.push(entry);
    console.log(
      `${entry.construct.padEnd(26)} ${entry.form.padEnd(8)} ${entry.path.padEnd(8)} ${entry.outcome.padEnd(13)} ${entry.seconds}s${entry.reason === undefined ? "" : "  " + entry.reason.slice(0, 120)}`,
    );
  }
}
await Promise.all(Array.from({ length: Math.max(1, jobs) }, () => worker()));
const order = (entry: Entry): number =>
  work.findIndex(
    (item) => item.construct === entry.construct && item.form === entry.form,
  );
entries.sort((a, b) => order(a) - order(b));

const snapshots = new Set(
  entries.flatMap((entry) =>
    entry.sourceSnapshot === undefined ? [] : [entry.sourceSnapshot],
  ),
);
if (snapshots.size > 1)
  throw Error(
    "the workspace changed during the run: " + [...snapshots].join(", "),
  );
const summary: Record<Form, Record<string, number>> = {
  typed: {},
  untyped: {},
};
for (const entry of entries) {
  const key = entry.outcome === "pass" ? entry.path : entry.outcome;
  summary[entry.form][key] = (summary[entry.form][key] ?? 0) + 1;
}
const ledger: Ledger = {
  kind: "tint-unified-pipeline-ledger",
  version: 1,
  label,
  recorded: new Date().toISOString(),
  node: process.version,
  sourceSnapshot: [...snapshots][0],
  summary,
  entries,
};
writeFileSync(output, JSON.stringify(ledger, null, 2) + "\n", { flag: "wx" });
console.log("typed forms:", JSON.stringify(summary.typed));
console.log("untyped forms:", JSON.stringify(summary.untyped));
console.log(
  "wrote " + join("docs/results", "unified-pipeline-ledger-" + label + ".json"),
);

if (baseline !== undefined) {
  const regressions: string[] = [];
  for (const before of baseline.entries) {
    const after = entries.find(
      (entry) =>
        entry.construct === before.construct && entry.form === before.form,
    );
    if (after === undefined) continue;
    const name = before.construct + " (" + before.form + ")";
    if (before.outcome === "pass" && after.outcome !== "pass")
      regressions.push(name + ": " + before.outcome + " -> " + after.outcome);
    else if (
      before.form === "typed" &&
      before.outcome === "pass" &&
      before.path === "typed" &&
      after.path !== "typed"
    )
      regressions.push(name + ": typed -> " + after.path);
  }
  if (regressions.length > 0) {
    console.error("regressions against " + baselinePath + ":");
    for (const regression of regressions) console.error("  " + regression);
    process.exitCode = 1;
  } else console.log("no regressions against " + baselinePath);
}
