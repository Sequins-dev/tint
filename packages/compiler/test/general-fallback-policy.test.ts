import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { createSourceModuleLoader } from "@tint/typescript/modules";
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
const generatorText =
  "function* count(): Generator<number> { yield 1; }\n" +
  "export function run(): number { let total = 0; for (const n of count()) total += n; return total; }";

function generatorProgram(lowering: GeneralLowering): CompileRequest {
  return {
    modules: [source("main", generatorText)],
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

test("general fallback reparses loader input after the typed attempt", () => {
  const { lowering, requests } = recordingLowering();
  const loader = createSourceModuleLoader([
    { id: "main", text: generatorText, dependencies: new Map() },
  ]);
  const parses: ReturnType<typeof loader.load>[] = [];
  const compiled = compileArm64Program({
    ...generatorProgram(lowering),
    modules: [],
    moduleLoader: {
      ids: loader.ids,
      load: (ids) => {
        const modules = loader.load(ids);
        parses.push(modules);
        return modules;
      },
    },
  });
  assert.equal(compiled.ok, false);
  assert.equal(parses.length, 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.available, parses[1]);
  assert.notEqual(parses[0]?.[0]?.module, parses[1]?.[0]?.module);
});

test("an original source diagnostic prevents fallback and preserves its location", () => {
  const { lowering, requests } = recordingLowering();
  const diagnostic = {
    code: "TS2322",
    message: "Type 'string' is not assignable to type 'number'.",
    module: "main",
    start: 118,
    end: 123,
  };
  const compiled = compileArm64Program(
    generatorProgram({ ...lowering, validateSource: () => [diagnostic] }),
  );
  assert.equal(requests.length, 0);
  assert.ok(!compiled.ok);
  assert.equal(compiled.error.stage, "source");
  assert.deepEqual(compiled.error.sourceDiagnostics, [diagnostic]);
});

test("source validation precedes a successful typed attempt", () => {
  const { lowering } = recordingLowering();
  const entries: string[] = [];
  const compiled = compileArm64Program({
    ...generatorProgram({
      ...lowering,
      validateSource: (entry: string) => {
        entries.push(entry);
        return [];
      },
    }),
    modules: [source("main", "export function run(): number { return 42; }")],
  });
  assert.deepEqual(entries, ["main"]);
  assert.ok(compiled.ok);
});

test("requireTyped bypasses the hosted source validator", () => {
  const { lowering } = recordingLowering();
  const compiled = compileArm64Program({
    ...generatorProgram({
      ...lowering,
      validateSource: () => assert.fail("unexpected hosted validation"),
    }),
    requireTyped: true,
  });
  assert.ok(!compiled.ok);
  assert.equal(compiled.error.stage, "check");
});

test("a generator fallback carries its original function owner and capability", () => {
  const { lowering, requests } = recordingLowering();
  compileArm64Program(generatorProgram(lowering));
  assert.deepEqual(requests[0]?.trigger, {
    phase: "check",
    code: "UNSUPPORTED",
    capability: "generator-suspension",
    owner: {
      module: "main",
      kind: "function",
      start: 0,
      end: generatorText.indexOf("\n"),
    },
  });
});
