import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import {
  compileArm64Program,
  type CompileRequest,
  type GeneralLowering,
  type GeneralProgramRequest,
} from "../src/native/index.ts";
import { compilerBuildRequest } from "../src/project.ts";

function source(id: string, text: string) {
  const bytes = new TextEncoder().encode(text),
    decoded = createSourceText(bytes, bytes.length);
  assert.ok(decoded.ok);
  const parsed = parseModule(decoded.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return { id, module: parsed.value, dependencies: new Map<string, string>() };
}

/** A lowering that records its requests and declines them. */
function recordingLowering(): {
  readonly lowering: GeneralLowering;
  readonly requests: GeneralProgramRequest[];
} {
  const requests: GeneralProgramRequest[] = [];
  return {
    requests,
    lowering: {
      runtimeModules: [],
      recordBindings: [],
      runtimes: [],
      lower: (request) => {
        requests.push(request);
        return { ok: false, error: "declined by the test lowering" };
      },
    },
  };
}

// A generator is rejected by the typed pipeline, so compiling it needs the
// general fallback.
function generatorProgram(lowering: GeneralLowering): CompileRequest {
  return {
    modules: [
      source(
        "main",
        "function* count(): Generator<number> { yield 1; }\n" +
          "export function run(): number { let total = 0; for (const n of count()) total += n; return total; }",
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [],
    generalLowering: lowering,
  };
}

test("a typed rejection reaches the general lowering by default", () => {
  const { lowering, requests } = recordingLowering();
  const compiled = compileArm64Program(generatorProgram(lowering));
  assert.equal(compiled.ok, false);
  assert.equal(requests.length, 1);
  assert.deepEqual(
    requests[0]?.modules.map((module) => module.id),
    ["main"],
  );
  if (!compiled.ok) {
    assert.equal(compiled.error.stage, "general");
    assert.match(compiled.error.message, /declined by the test lowering/);
  }
});

test("requireTyped refuses the general fallback and keeps the typed error", () => {
  const { lowering, requests } = recordingLowering();
  const compiled = compileArm64Program({
    ...generatorProgram(lowering),
    requireTyped: true,
  });
  assert.equal(requests.length, 0);
  assert.equal(compiled.ok, false);
  if (!compiled.ok) {
    assert.equal(compiled.error.stage, "check");
    assert.equal(compiled.error.module, "main");
    assert.match(
      compiled.error.message,
      /generator suspension .*\(typed compilation required\)$/,
    );
  }
});

test("the compiler's own build request requires typed compilation", () => {
  assert.equal(compilerBuildRequest([], () => {}).requireTyped, true);
});
