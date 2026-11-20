// Compile-only probe. No image is written or launched. Use Node 24.12 and TZ=UTC
// after pnpm build. An optional comma-separated selection enables general retry.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { projectBuildRequest, projectRoots } from "@tint/compiler/cli";
import {
  compileNativeProgram,
  foreignRuntimeBindings,
} from "@tint/compiler/native";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";
import {
  expandForeignSnapshot,
  workspaceGeneralLowering,
} from "../hosted-fixture.ts";
import { nativeFixtureTarget } from "../native-host-target.ts";
import {
  workspaceModules,
  workspaceSources,
  workspaceSourceIdentity,
} from "../workspace-sources.ts";
import { constructs, type Construct } from "./corpus.ts";

const [output, retryList = "", onlyList = ""] = process.argv.slice(2);
if (output === undefined)
  throw Error(
    "usage: probe-slice-3.ts <new-report.json> [retry-names] [only-names]",
  );
if (process.env.TZ !== "UTC" || process.env.TINT_GENERAL_FALLBACK === "0")
  throw Error("set TZ=UTC and unset TINT_GENERAL_FALLBACK");
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const captured = workspaceSources();
const foreign = expandForeignSnapshot(captured);
const suppliedLowering = workspaceGeneralLowering();
if (suppliedLowering === undefined)
  throw Error("general provider is unavailable");
const lowering = suppliedLowering;
const target = nativeFixtureTarget();
const baseModules = workspaceModules(
  [...projectRoots(), ...lowering.runtimeModules],
  foreign.snapshot,
);
const targetRequest = projectBuildRequest(
  baseModules,
  () => {},
  foreign.libraries,
);
const ffi = foreignRuntimeBindings(new Set(baseModules.map(({ id }) => id)));
const extra: readonly Construct[] = [
  {
    name: "probe-decorated-class",
    typed: `function mark(value: typeof Example, context: ClassDecoratorContext): void {}
@mark class Example { value: number = 42; }
export function run(): number { return new Example().value; }`,
    untyped: "",
  },
  {
    name: "probe-direct-eval",
    typed: `export function run(): number { const x: number = 42; return eval("x"); }`,
    untyped: "",
  },
  {
    name: "probe-error-after-generator",
    typed: `function* make(): Generator<number, void, unknown> { yield 42; }
export function run(): number { const x: number = "wrong"; return x; }`,
    untyped: "",
  },
];
const retry = new Set(retryList.split(",").filter(Boolean));
const only = new Set(onlyList.split(",").filter(Boolean));
const focused: readonly Construct[] = [
  {
    name: "probe-index-unproven",
    typed: `export function run(): number {
  const bytes = new Uint8Array(2);
  const value: number = bytes[1];
  return value;
}`,
    untyped: "",
  },
  {
    name: "probe-decorator-primitive-signature",
    typed: `function mark(value: unknown, context: unknown): void {}
@mark class Example { value: number = 42; }
export function run(): number { return new Example().value; }`,
    untyped: "",
  },
  ...constructs
    .filter(({ name }) => name === "class-inheritance")
    .map((construct) => ({
      ...construct,
      name: "probe-inheritance-override",
      typed: construct.typed.replace(
        "area(): number { return this.side",
        "override area(): number { return this.side",
      ),
    })),
];
const cases = [
  ...constructs,
  ...extra,
  ...focused.filter(({ name }) => only.has(name)),
].filter(({ name }) => only.size === 0 || only.has(name));
for (const name of [...retry, ...only]) {
  if (!cases.some((construct) => construct.name === name))
    throw Error("unknown selected case: " + name);
}

const config = ts.readConfigFile("tsconfig.base.json", ts.sys.readFile);
const converted = ts.convertCompilerOptionsFromJson(
  config.config.compilerOptions,
  process.cwd(),
);
if (config.error || converted.errors.length !== 0)
  throw Error("invalid tsconfig.base.json");
function oracle(construct: Construct) {
  const root = "/tint-slice-3-fixture";
  const entry = join(root, "entry.ts");
  const sources = new Map([[entry, construct.typed]]);
  for (const [file, source] of Object.entries(construct.helpers ?? {}))
    sources.set(join(root, file), source);
  const options: ts.CompilerOptions = {
    ...converted.options,
    ...construct.options,
    noEmit: true,
  };
  const host = ts.createCompilerHost(options);
  const packageFile = join(root, "package.json");
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  const readFile = host.readFile.bind(host);
  host.getSourceFile = (file, language, onError, create) => {
    const source = sources.get(file);
    return source === undefined
      ? getSourceFile(file, language, onError, create)
      : ts.createSourceFile(file, source, language, true);
  };
  host.fileExists = (file) =>
    file === packageFile || sources.has(file) || fileExists(file);
  host.directoryExists = (directory) =>
    directory === root || (directoryExists?.(directory) ?? false);
  host.readFile = (file) =>
    file === packageFile
      ? '{"type":"module"}'
      : (sources.get(file) ?? readFile(file));
  const program = ts.createProgram([...sources.keys()], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map(({ code, file, start, messageText }) => ({
      code,
      file: file?.fileName.replace(root + "/", ""),
      start,
      message: ts.flattenDiagnosticMessageText(messageText, "\n"),
    }));
}
function parse(
  id: string,
  text: string,
  dependencies: ReadonlyMap<string, string>,
) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  if (!source.ok) throw Error(JSON.stringify(source.error));
  const started = performance.now();
  const result = parseModule(source.value);
  const milliseconds = performance.now() - started;
  if (!result.ok)
    return { ok: false as const, error: result.error, milliseconds };
  const module: SourceModule = { id, module: result.value, dependencies };
  return { ok: true as const, module, milliseconds };
}
function compile(modules: readonly SourceModule[], general: boolean) {
  const result = compileNativeProgram(
    {
      modules: [...baseModules, ...modules],
      entry: "fixture",
      start: "run",
      exports: ["run"],
      runtimes: [...targetRequest.runtimes, ...ffi.runtimes],
      hostBindings: [...targetRequest.hostBindings, ...ffi.hostBindings],
      foreignLibraries: foreign.libraries,
      foreignBindings: targetRequest.foreignBindings ?? [],
      foreignMemoryBindings: ffi.memoryBindings,
      weakBindings: ffi.weakBindings,
      pageAlignedCode: true,
      closedProgram: true,
      denseReferenceLists: true,
      linearAllocation: true,
      generationalBarriers: true,
      optimization: "basic",
      maxSpecializations: targetRequest.maxSpecializations ?? 4096,
      ...(general ? { generalLowering: lowering } : {}),
    },
    target,
  );
  if (!result.ok) return { ok: false as const, diagnostic: result.error };
  return {
    ok: true as const,
    programCodeBytes: result.value.native.code.length,
    general: result.value.general,
  };
}
const entries = cases.map((construct) => {
  const typescript = oracle(construct);
  const helpers: SourceModule[] = [];
  const dependencies = new Map<string, string>();
  for (const [file, text] of Object.entries(construct.helpers ?? {})) {
    const id = "construct-helper:" + file;
    const edges = new Map(
      (construct.helperImports?.[file] ?? []).map((target) => [
        "./" + target,
        "construct-helper:" + target,
      ]),
    );
    const parsed = parse(id, text, edges);
    if (!parsed.ok) throw Error(JSON.stringify(parsed));
    helpers.push(parsed.module);
    dependencies.set("./" + file, id);
  }
  const sourceBytes = Buffer.byteLength(construct.typed);
  const parsed = parse("fixture", construct.typed, dependencies);
  let observation;
  if (!parsed.ok) observation = { parseError: parsed.error };
  else if (construct.options?.noUncheckedIndexedAccess === false)
    observation = { unsupportedOption: "noUncheckedIndexedAccess=false" };
  else {
    const modules = [...helpers, parsed.module];
    const typed = compile(modules, false);
    observation = {
      typed,
      ...(retry.has(construct.name) ? { retry: compile(modules, true) } : {}),
    };
  }
  console.error(construct.name);
  return {
    construct: construct.name,
    sourceBytes,
    parseMilliseconds: parsed.milliseconds,
    typescript,
    ...observation,
  };
});
writeFileSync(
  output,
  JSON.stringify(
    {
      revision,
      snapshot: workspaceSourceIdentity(captured).sha256,
      node: process.version,
      typescript: ts.version,
      target: target.name,
      retry: [...retry],
      ...(only.size === 0 ? {} : { only: [...only] }),
      entries,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
