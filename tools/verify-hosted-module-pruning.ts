// Module pruning preserves evaluation order: a barrel re-exports a wrapper
// (pure body, imports an effectful module), a pure module and an effectful
// module, and the program uses only a log the barrel re-exports. The
// wrapper and the pure module are not instantiated, yet `a` and `b` still
// run in source order before `c`, as ECMAScript module evaluation requires.
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";
import { verifyHostedFixture } from "./hosted-fixture.ts";

function module(
  id: string,
  text: string,
  dependencies: Record<string, string> = {},
): SourceModule {
  const bytes = new TextEncoder().encode(text),
    decoded = createSourceText(bytes, bytes.length);
  assert.ok(decoded.ok);
  const parsed = parseModule(decoded.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return {
    id,
    module: parsed.value,
    dependencies: new Map(Object.entries(dependencies)),
  };
}

const log = { "./log.ts": "pruning:log" };
verifyHostedFixture(
  `import { log } from "./barrel.ts";
import "./c.ts";
export function run(): number { return log.join("") === "abc" ? 42 : 1; }`,
  "module-pruning",
  [
    ["./barrel.ts", "pruning:barrel"],
    ["./c.ts", "pruning:c"],
  ],
  [
    module(
      "pruning:log",
      "export const log: string[] = [];\nexport function record(name: string): number { log.push(name); return log.length; }",
    ),
    module(
      "pruning:a",
      'import { record } from "./log.ts";\nconst order: number = record("a");\nexport function a(): number { return order; }',
      log,
    ),
    module(
      "pruning:wrapper",
      'import { a } from "./a.ts";\nexport function wrapped(): number { return a(); }',
      { "./a.ts": "pruning:a" },
    ),
    module("pruning:pure", "export function pure(): number { return 2; }"),
    module(
      "pruning:b",
      'import { record } from "./log.ts";\nconst order: number = record("b");\nexport function b(): number { return order; }',
      log,
    ),
    module(
      "pruning:barrel",
      'export { wrapped } from "./wrapper.ts";\nexport { pure } from "./pure.ts";\nexport { b } from "./b.ts";\nexport { log } from "./log.ts";',
      {
        "./wrapper.ts": "pruning:wrapper",
        "./pure.ts": "pruning:pure",
        "./b.ts": "pruning:b",
        ...log,
      },
    ),
    module(
      "pruning:c",
      'import { record } from "./log.ts";\nexport const order: number = record("c");',
      log,
    ),
  ],
  [],
  [],
  { managedBytes: 4194304, allocationCapacity: 65536, requireTyped: true },
);
