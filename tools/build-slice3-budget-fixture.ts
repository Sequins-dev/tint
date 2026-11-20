import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("budget fixture requires TINT_BUILD_ONLY=1");
const [mode, direction, arityText, countText] = process.argv.slice(2);
const arity = Number(arityText);
const count = Number(countText);
if (
  (mode !== "mixed" && mode !== "whole") ||
  (direction !== "call" && direction !== "round-trip") ||
  ![0, 1, 2].includes(arity) ||
  !Number.isSafeInteger(count) ||
  count < 0
)
  throw Error(
    "usage: build-slice3-budget-fixture.ts mixed|whole call|round-trip 0|1|2 calls",
  );

const parameters = ["first", "second"].slice(0, arity);
const typed = parameters.map((name) => name + ": number").join(", ");
const arguments_ = ["i & 63", "i & 31"].slice(0, arity).join(", ");
const terms = ["7", "first * 2", "second"].slice(0, arity + 1).join(" + ");
const paired = direction === "round-trip";
let sum = 0;
for (let i = 0; i < count; i++)
  sum +=
    7 + arity + (arity >= 1 ? (i & 63) * 2 : 0) + (arity === 2 ? i & 31 : 0);
const source = `
${paired ? `function kernel(${typed}): number { return ${terms}; }` : ""}
function bridge(${typed}): number {
  return ${paired ? "kernel(" + parameters.join(", ") + ")" : terms} + arguments.length;
}
export function run(): number {
  let total = 0;
  for (let i = 0; i < ${count}; i++) total += bridge(${arguments_});
  return total === ${sum} ? 42 : 1;
}`;

// Resolve against the invocation directory to build the identical source
// with the candidate and the archived baseline toolchain.
const { verifyHostedFixture } = (await import(
  pathToFileURL(resolve("tools/hosted-fixture.ts")).href
)) as typeof import("./hosted-fixture.ts");
const contract =
  mode === "whole"
    ? {}
    : {
        validateSource: (
          await import("./source-validation.ts")
        ).createHostedSourceValidator([{ id: "fixture", text: source }]),
        functionFallback: true,
      };
const image = verifyHostedFixture(
  source,
  ["slice3-budget", mode, direction, arity, count].join("-"),
  [],
  [],
  [],
  [],
  {
    managedBytes: 134217728,
    allocationCapacity: 2097152,
    ...contract,
  },
);
const manifest = JSON.parse(readFileSync(image + ".manifest.json", "utf8"));
if (mode === "mixed") {
  assert.equal(manifest.fallbackFunctions?.length, 1);
  assert.equal(manifest.fallbackFunctions?.[0]?.name, "bridge");
}
