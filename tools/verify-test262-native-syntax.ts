import assert from "node:assert/strict";
import { createNativeSyntaxBuilder } from "./test262-native-syntax.ts";
import { executeNativeImage } from "./test262-native-process.ts";
import { judgeExecution } from "./test262-execution.ts";

const build = createNativeSyntaxBuilder();
const cases = [
  ["const = ;", "script", "error"],
  ["let x;let x;", "script", "error"],
  ["function f(){}function f(){}", "module", "error"],
  ["const x=1;x=2;unknownGlobal();", "module", "completed"],
  ["class C{x=arguments;}", "script", "error"],
  ["throw 42;", "script", "completed"],
  ['"unterminated', "script", "error"],
  ["export const = ;", "module", "error"],
  ["let x=1n;", "script", "completed"],
  ["let x=/x/;", "script", "completed"],
  ["let x=/x/v;", "script", "completed"],
  ["let x=/a{9007199254740992}/;", "script", "unsupported"],
] as const;
for (const [source, goal, kind] of cases) {
  const built = build({
    source,
    goal,
    harness: [],
    asynchronous: false,
    canSuspend: false,
  });
  assert.ok(built.ok, JSON.stringify(built));
  const outcome = executeNativeImage(built.bytes, 60000);
  console.log(JSON.stringify({ source, goal, outcome }));
  assert.equal(outcome.kind, kind);
  if (outcome.kind === "error") {
    assert.equal(outcome.phase, "parse");
    assert.equal(outcome.type, "SyntaxError");
  }
  const status = judgeExecution(
    {
      flags: [],
      features: [],
      includes: [],
      negative: { phase: "parse", type: "SyntaxError" },
    },
    outcome,
  );
  assert.equal(
    status,
    kind === "error" ? "pass" : kind === "completed" ? "fail" : "unsupported",
  );
}
console.log(
  "Verified native parsing, error phases, non-evaluation and unsupported syntax.",
);
