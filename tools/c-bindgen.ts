// The C binding generator (docs/native-ffi.md, "Binding generator"): reads
// C headers with clang and emits `tint:c/<library>` declaration modules in
// the documented syntax. A dev-time tool; clang never takes part in a Tint
// build or link.
//
//   pnpm bindgen                 extract this host's facts, then emit
//   pnpm bindgen extract [libs]  write this host target's facts
//   pnpm bindgen emit [libs]     emit modules from the checked-in facts
//   pnpm bindgen check [libs]    fail if facts (this host) or modules drift
//
// Facts are per target (tools/c-bindgen/facts/<library>.<target>.json), so
// a module for Darwin and Linux needs facts extracted on both (linux-arm64
// on the `dev` container machine); emission merges them on either host.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { format } from "prettier";
import { parseForeignDeclarations } from "@tint/compiler/native";
import { emitBinding } from "./c-bindgen/emit.ts";
import { extractFacts, hostTarget } from "./c-bindgen/extract.ts";
import type { TargetFacts } from "./c-bindgen/facts.ts";
import { bindingDifferences } from "./c-bindgen/parity.ts";
import {
  cTargetOf,
  functionSpec,
  type BindingSpec,
  type TargetName,
} from "./c-bindgen/spec.ts";

const root = new URL("./c-bindgen/", import.meta.url);
export const specDirectory = new URL("specs/", root);
export const factsDirectory = new URL("facts/", root);
/** The checked-in `tint:c` bindings, which the generator writes: the
 * compiler expands them from here (src/c/*.d.ts of @tint/native-runtime). */
export const generatedDirectory = new URL(
  "../packages/native-runtime/src/c/",
  import.meta.url,
);

export interface LoadedSpec {
  /** The spec's file name without `.ts` (its library name). */
  readonly name: string;
  /** Repository-relative path, as generated headers name it. */
  readonly path: string;
  readonly spec: BindingSpec;
}
export async function loadSpecs(
  names: readonly string[] = [],
): Promise<LoadedSpec[]> {
  const files = readdirSync(specDirectory)
    .filter((file) => file.endsWith(".ts"))
    .sort();
  const loaded: LoadedSpec[] = [];
  for (const file of files) {
    const name = basename(file, ".ts");
    if (names.length > 0 && !names.includes(name)) continue;
    const module = (await import(new URL(file, specDirectory).href)) as {
      default: BindingSpec;
    };
    if (module.default.library !== name)
      throw new Error(`spec ${file} must bind library ${name}`);
    loaded.push({
      name,
      path: `tools/c-bindgen/specs/${file}`,
      spec: module.default,
    });
  }
  for (const name of names)
    if (!loaded.some((item) => item.name === name))
      throw new Error(`no spec named ${name}`);
  return loaded;
}
export function factsFile(name: string, target: TargetName): URL {
  return new URL(`${name}.${target}.json`, factsDirectory);
}
export function generatedFile(name: string): URL {
  return new URL(`${name}.d.ts`, generatedDirectory);
}
export async function formatFacts(facts: TargetFacts): Promise<string> {
  return format(JSON.stringify(facts), { parser: "json" });
}
export function readFacts(loaded: LoadedSpec): Map<TargetName, TargetFacts> {
  const facts = new Map<TargetName, TargetFacts>();
  for (const target of loaded.spec.targets) {
    const file = factsFile(loaded.name, target);
    if (existsSync(file))
      facts.set(target, JSON.parse(readFileSync(file, "utf8")) as TargetFacts);
  }
  return facts;
}
/** Compare header facts across SDKs. Parameter spelling is ABI-neutral,
 * except that a name-keyed binding override must still select its parameter. */
export function factsMeaning(facts: TargetFacts, spec: BindingSpec): string {
  const namedOverrides = new Set<string>();
  for (const entry of spec.functions ?? []) {
    const fn = functionSpec(entry);
    if (Object.keys(fn.parameters ?? {}).some((key) => !/^\d+$/.test(key)))
      namedOverrides.add(fn.name);
  }
  return JSON.stringify({
    ...facts,
    clang: "",
    functions: facts.functions.map((fn) =>
      namedOverrides.has(fn.name)
        ? fn
        : { ...fn, parameters: fn.parameters.map(({ type }) => ({ type })) },
    ),
  });
}

/** What a regenerated binding declares differently from the checked-in
 * one on `target` (parity of declarations, not text). */
export function semanticDifferences(
  current: string,
  regenerated: string,
  target: TargetName,
): string[] {
  const cTarget = cTargetOf(target);
  const before = parseForeignDeclarations(current, cTarget),
    after = parseForeignDeclarations(regenerated, cTarget);
  if (!before.ok)
    return [`the checked-in binding does not parse: ${before.error.message}`];
  if (!after.ok)
    return [`the regenerated binding does not parse: ${after.error.message}`];
  return bindingDifferences(before.value, after.value, cTarget);
}

async function main(argv: readonly string[]): Promise<number> {
  const command =
    argv[0] === "extract" || argv[0] === "emit" || argv[0] === "check"
      ? argv[0]
      : "all";
  const names = command === "all" ? argv : argv.slice(1);
  const specs = await loadSpecs(names);
  const host = hostTarget();
  let failed = false;
  for (const loaded of specs) {
    if (
      command !== "emit" &&
      host !== undefined &&
      loaded.spec.targets.includes(host)
    ) {
      const facts = extractFacts(loaded.spec, host);
      const text = await formatFacts(facts);
      const file = factsFile(loaded.name, host);
      if (command === "check") {
        const current = existsSync(file)
          ? (JSON.parse(readFileSync(file, "utf8")) as TargetFacts)
          : undefined;
        if (
          current === undefined ||
          factsMeaning(current, loaded.spec) !==
            factsMeaning(facts, loaded.spec)
        ) {
          console.error(
            `${loaded.name}: ${host} facts drifted from the headers (run pnpm bindgen extract)`,
          );
          failed = true;
        }
      } else writeFileSync(file, text);
      for (const entry of facts.skipped)
        console.log(`${loaded.name} (${host}): ${entry.name}: ${entry.reason}`);
    }
    if (command === "extract") continue;
    const facts = readFacts(loaded);
    const missing = loaded.spec.targets.filter((target) => !facts.has(target));
    if (missing.length > 0) {
      console.error(
        `${loaded.name}: no facts for ${missing.join(", ")} (run pnpm bindgen extract on such a host)`,
      );
      failed = true;
      continue;
    }
    const emission = await emitBinding(loaded.spec, facts, {
      specPath: loaded.path,
    });
    const file = generatedFile(loaded.name);
    if (command === "check") {
      const current = existsSync(file) ? readFileSync(file, "utf8") : "";
      if (current !== emission.text) {
        console.error(
          `${loaded.name}: the checked-in binding is stale (run pnpm bindgen emit)`,
        );
        for (const target of loaded.spec.targets)
          for (const line of semanticDifferences(
            current,
            emission.text,
            target,
          ))
            console.error(`  ${target}: ${line}`);
        failed = true;
      }
    } else writeFileSync(file, emission.text);
    for (const line of emission.report)
      console.log(`${loaded.name}: not bound: ${line}`);
    for (const line of emission.opaque)
      console.log(`${loaded.name}: function pointer as an address: ${line}`);
  }
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  process.exitCode = await main(process.argv.slice(2));
