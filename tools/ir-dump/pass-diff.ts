// Diffs consecutive per-pass IR dumps (TINT_DUMP_PASSES=<filter> writes
// <output>.passes/) per function, showing which pass changed what:
//   node tools/ir-dump/pass-diff.ts <output>.passes [--function <substring>]
//        [--pass <substring>] [--summary] [--context N]
// --summary lists, per function, the passes that changed it with their
// added/removed line counts. To bisect a miscompile to a pass, rebuild with
// TINT_OPT_PASS_LIMIT=N (docs/compiler-observability.md).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface PassDumpIndex {
  readonly kind: "tint-pass-dumps";
  readonly version: 1;
  readonly filter: string;
  readonly input: readonly string[];
  readonly passes: readonly {
    readonly index: number;
    readonly pass: string;
    readonly budgetExhausted: boolean;
    readonly visited: number;
    readonly rewritten: number;
    readonly skipped?: number;
    readonly file?: string;
    readonly changed: readonly string[];
    readonly removed: readonly string[];
  }[];
}
/** One version of a function: its text after `pass` (undefined: removed). */
export interface FunctionVersion {
  readonly index: number;
  readonly pass: string;
  readonly text: string | undefined;
}
export interface PassDumps {
  readonly index: PassDumpIndex;
  /** Function key to its input text and every later version, in order. */
  readonly functions: ReadonlyMap<
    string,
    { readonly input: string | undefined; readonly versions: FunctionVersion[] }
  >;
}

/** Dumped functions are separated by blank lines and never contain one. */
function functionTexts(path: string): string[] {
  const text = readFileSync(path, "utf8").replace(/\n+$/, "");
  return text === "" ? [] : text.split("\n\n");
}
export function loadPassDumps(directory: string): PassDumps {
  const index = JSON.parse(
    readFileSync(join(directory, "index.json"), "utf8"),
  ) as PassDumpIndex;
  if (index.kind !== "tint-pass-dumps" || index.version !== 1)
    throw Error(directory + " is not a tint pass dump directory");
  const functions = new Map<
    string,
    { input: string | undefined; versions: FunctionVersion[] }
  >();
  const inputPath = join(directory, "input.ir");
  const inputs = existsSync(inputPath) ? functionTexts(inputPath) : [];
  if (inputs.length !== index.input.length)
    throw Error("input.ir does not match index.json");
  index.input.forEach((key, i) =>
    functions.set(key, { input: inputs[i], versions: [] }),
  );
  for (const pass of index.passes) {
    const texts =
      pass.file === undefined ? [] : functionTexts(join(directory, pass.file));
    if (texts.length !== pass.changed.length)
      throw Error(`${pass.file} does not match index.json`);
    pass.changed.forEach((key, i) => {
      const entry = functions.get(key) ?? { input: undefined, versions: [] };
      entry.versions.push({
        index: pass.index,
        pass: pass.pass,
        text: texts[i],
      });
      functions.set(key, entry);
    });
    for (const key of pass.removed)
      functions.get(key)?.versions.push({
        index: pass.index,
        pass: pass.pass,
        text: undefined,
      });
  }
  return { index, functions };
}

type Edit = { readonly kind: " " | "-" | "+"; readonly line: string };
/** Line edit script (Myers' O((N+M)D) algorithm). */
export function diffLines(a: readonly string[], b: readonly string[]): Edit[] {
  const n = a.length,
    m = b.length,
    max = n + m,
    offset = max + 1;
  const trace: Int32Array[] = [];
  const v = new Int32Array(2 * max + 3);
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  // Backtrack from the end through each round's starting frontier.
  const edits: Edit[] = [];
  let x = n,
    y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const frontier = trace[d]!,
      k = x - y;
    const previousK =
      k === -d ||
      (k !== d && frontier[offset + k - 1]! < frontier[offset + k + 1]!)
        ? k + 1
        : k - 1;
    const previousX = d === 0 ? 0 : frontier[offset + previousK]!,
      previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      edits.push({ kind: " ", line: a[--x]! });
      y--;
    }
    if (d === 0) break;
    if (x === previousX) edits.push({ kind: "+", line: b[--y]! });
    else edits.push({ kind: "-", line: a[--x]! });
  }
  while (x > 0 && y > 0) {
    edits.push({ kind: " ", line: a[--x]! });
    y--;
  }
  return edits.reverse();
}
/** Unified diff hunks of two texts ("" when equal). */
export function unifiedDiff(
  before: string,
  after: string,
  context: number = 3,
): string {
  const a = before === "" ? [] : before.split("\n"),
    b = after === "" ? [] : after.split("\n");
  const edits = diffLines(a, b);
  const out: string[] = [];
  let i = 0;
  while (i < edits.length) {
    if (edits[i]!.kind === " ") {
      i++;
      continue;
    }
    // A hunk: changes joined by at most 2 * context unchanged lines.
    let start = Math.max(0, i - context),
      end = i;
    while (end < edits.length) {
      if (edits[end]!.kind !== " ") {
        end++;
        continue;
      }
      let run = end;
      while (run < edits.length && edits[run]!.kind === " ") run++;
      if (run === edits.length || run - end > 2 * context) {
        end = Math.min(end + context, edits.length);
        break;
      }
      end = run;
    }
    let oldLine = 1,
      newLine = 1;
    for (let j = 0; j < start; j++) {
      if (edits[j]!.kind !== "+") oldLine++;
      if (edits[j]!.kind !== "-") newLine++;
    }
    const hunk = edits.slice(start, end);
    const oldCount = hunk.filter((edit) => edit.kind !== "+").length,
      newCount = hunk.filter((edit) => edit.kind !== "-").length;
    out.push(`@@ -${oldLine},${oldCount} +${newLine},${newCount} @@`);
    for (const edit of hunk) out.push(edit.kind + edit.line);
    i = end;
    start = end;
  }
  return out.length === 0 ? "" : out.join("\n") + "\n";
}
export function changeCounts(
  before: string,
  after: string,
): { added: number; removed: number } {
  let added = 0,
    removed = 0;
  for (const edit of diffLines(
    before === "" ? [] : before.split("\n"),
    after === "" ? [] : after.split("\n"),
  ))
    if (edit.kind === "+") added++;
    else if (edit.kind === "-") removed++;
  return { added, removed };
}

/** Diffs (or a summary) of every selected function's versions. */
export function renderPassDiffs(
  dumps: PassDumps,
  options: {
    readonly function?: string;
    readonly pass?: string;
    readonly summary?: boolean;
    readonly context?: number;
  } = {},
): string {
  const out: string[] = [];
  for (const [key, history] of dumps.functions) {
    // Match generated names or the source name in the dumped header.
    const header = (
      history.input ??
      history.versions.find((version) => version.text !== undefined)?.text ??
      ""
    ).split("\n", 1)[0];
    if (
      options.function !== undefined &&
      !key.includes(options.function) &&
      !(header ?? "").includes(options.function)
    )
      continue;
    let previous = history.input ?? "";
    const lines: string[] = [];
    for (const version of history.versions) {
      const after = version.text ?? "";
      const selected =
        options.pass === undefined || version.pass.includes(options.pass);
      if (selected) {
        const label = `${String(version.index).padStart(3, "0")} ${version.pass}`;
        if (options.summary) {
          const { added, removed } = changeCounts(previous, after);
          lines.push(
            `  ${label}: ` +
              (version.text === undefined
                ? "removed"
                : previous === ""
                  ? `added (${added} lines)`
                  : `+${added} -${removed}`),
          );
        } else {
          lines.push(
            `=== ${label}: ${key}` +
              (version.text === undefined
                ? " (removed)"
                : previous === ""
                  ? " (new)"
                  : ""),
          );
          lines.push(
            unifiedDiff(previous, after, options.context).replace(/\n$/, ""),
          );
        }
      }
      previous = after;
    }
    if (lines.length === 0) continue;
    if (options.summary) out.push(key, ...lines);
    else out.push(...lines);
  }
  return out.length === 0 ? "" : out.join("\n") + "\n";
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const argv = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const at = argv.indexOf(name);
    return at < 0 ? undefined : argv[at + 1];
  };
  const directory = argv.find(
    (arg, i) =>
      !arg.startsWith("--") &&
      !["--function", "--pass", "--context"].includes(argv[i - 1] ?? ""),
  );
  if (directory === undefined) {
    process.stderr.write(
      "usage: pass-diff.ts <output>.passes [--function s] [--pass s] [--summary] [--context N]\n",
    );
    process.exit(64);
  }
  const fn = option("--function"),
    pass = option("--pass"),
    context = option("--context");
  process.stdout.write(
    renderPassDiffs(loadPassDumps(directory), {
      ...(fn === undefined ? {} : { function: fn }),
      ...(pass === undefined ? {} : { pass }),
      ...(context === undefined ? {} : { context: Number(context) }),
      summary: argv.includes("--summary"),
    }),
  );
}
