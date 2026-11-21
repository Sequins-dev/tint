// Builds one form of a corpus construct through the hosted pipeline (with the
// general fallback available) and runs it natively under LLDB, expecting 42:
//   node tools/unified-pipeline/verify-construct.ts <construct> typed|untyped
// A general fallback is reported on stderr ("general fallback for ...").
import { createSourceModuleLoader } from "@tint/typescript/modules";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { verifyHostedFixture } from "../hosted-fixture.ts";
import {
  workerFixtureOptions,
  workerFixtureRuntimes,
} from "../worker-fixture-options.ts";
import {
  createHostedSourceValidator,
  type HostedValidationSource,
} from "../source-validation.ts";
import { constructs } from "./corpus.ts";

const [name, form] = process.argv.slice(2);
const construct = constructs.find((item) => item.name === name);
if (construct === undefined) throw Error("unknown construct " + name);
if (form !== "typed" && form !== "untyped")
  throw Error("form must be typed or untyped");
// Tint has no per-program compiler options yet; it always checks as the
// workspace tsconfig does (noUncheckedIndexedAccess on).
if (construct.options?.noUncheckedIndexedAccess === false) {
  console.log("UNSUPPORTED_OPTION noUncheckedIndexedAccess=false");
  process.exit(3);
}
const replay = process.env.TINT_SOURCE_REPLAY === "1";
const functionFallback =
  process.env.TINT_FUNCTION_FALLBACK === "1" && form === "typed";
const dependencies: [string, string][] = [];
const workerDependency = [
  "node:worker_threads",
  "node:worker_threads",
] as const;
const workerModules = construct.workers?.map(
  (file) => "./" + construct.name + "/" + file,
);
if (workerModules !== undefined) dependencies.push([...workerDependency]);
const sources = [];
for (const [file, text] of Object.entries(construct.helpers ?? {})) {
  const worker = construct.workers?.includes(file) === true;
  const id = worker
    ? "./" + construct.name + "/" + file
    : "construct-helper:" + file;
  dependencies.push(["./" + file, id]);
  sources.push({
    id,
    text,
    dependencies: new Map([
      ...(construct.helperImports?.[file] ?? []).map(
        (target) => ["./" + target, "construct-helper:" + target] as const,
      ),
      ...(worker ? [workerDependency] : []),
    ]),
    unchecked: file === "untyped.ts" || form === "untyped",
  } satisfies HostedValidationSource);
}
const helpers = replay ? [] : createSourceModuleLoader(sources).load();
const validateSource =
  process.env.TINT_SOURCE_VALIDATION === "1" ||
  functionFallback ||
  construct.typedError !== undefined
    ? createHostedSourceValidator(
        [
          {
            id: "fixture",
            text: construct[form],
            dependencies: new Map(dependencies),
            unchecked: form === "untyped",
          },
          ...sources,
          ...(workerModules === undefined
            ? []
            : [
                {
                  id: "node:worker_threads",
                  text: readFileSync(
                    createRequire(import.meta.url).resolve(
                      "@types/node/worker_threads.d.ts",
                    ),
                    "utf8",
                  ),
                  declaration: true,
                  unchecked: true,
                },
              ]),
        ],
        construct.options,
        (advisory) =>
          console.error("SOURCE_ADVISORY " + JSON.stringify(advisory)),
      )
    : undefined;
verifyHostedFixture(
  construct[form],
  "construct-" + construct.name + "-" + form,
  dependencies,
  helpers,
  [],
  workerModules === undefined ? [] : workerFixtureRuntimes,
  {
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    ...(workerModules === undefined ? {} : workerFixtureOptions(workerModules)),
    ...(validateSource === undefined
      ? {}
      : {
          validateSource: (entry: string) => {
            const diagnostics = validateSource(entry);
            for (const diagnostic of diagnostics)
              console.error("SOURCE_DIAGNOSTIC " + JSON.stringify(diagnostic));
            return diagnostics;
          },
        }),
    onFallbackTrigger: (trigger) =>
      console.error("FALLBACK_TRIGGER " + JSON.stringify(trigger)),
    ...(replay ? { replaySources: sources } : {}),
    ...(functionFallback ? { functionFallback } : {}),
  },
);
