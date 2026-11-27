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
    location: { module: "main", start: 0, end: generatorText.indexOf("\n") },
    owner: {
      module: "main",
      kind: "function",
      start: 0,
      end: generatorText.indexOf("\n"),
    },
  });
});

test("validated sources preserve capability and owner through typed rejection", () => {
  const cases = [
    [
      'export function run(): number { return "text".localeCompare("a"); }',
      "check",
      "realm-library-member",
      "function",
    ],
    [
      "export function run(): number { type Result = number; const value: Result = 42; return value; }",
      "link",
      "nested-type-declaration",
      "function",
    ],
    [
      "while (false) {} export function run(): number { return 42; }",
      "link",
      "module-evaluation",
      "module",
    ],
    [
      "function scaled(n: number): number { return n * factor; } const factor = 6; export function run(): number { return scaled(7); }",
      "runtime",
      "binding-initialization",
      "function",
    ],
  ] as const;
  for (const [text, phase, capability, ownerKind] of cases) {
    const { lowering, requests } = recordingLowering();
    const compiled = compileArm64Program({
      ...generatorProgram({ ...lowering, validateSource: () => [] }),
      modules: [source("main", text)],
    });
    assert.equal(requests.length, 1, JSON.stringify(compiled));
    const trigger = requests[0]?.trigger;
    assert.equal(trigger?.phase, phase);
    assert.equal(trigger?.capability, capability);
    assert.equal(trigger?.location.module, "main");
    assert.equal(trigger?.owner.kind, ownerKind);
    assert.equal(trigger?.owner.module, "main");
    assert.ok(trigger.owner.start <= trigger.location.start);
    assert.ok(trigger.owner.end >= trigger.location.end);
  }
});

test("source replay preserves dependency bindings and emitted bytes", () => {
  const text = '// 😀\nimport { offset } from "./offset.ts";\n' + generatorText;
  const dependencies = new Map([["./offset.ts", "offset"]]);
  const dependencyText = "export const offset: number = 42;";
  const loader = createSourceModuleLoader([
    { id: "main", text, dependencies },
    { id: "offset", text: dependencyText, dependencies: new Map() },
    {
      id: "unused",
      text: "export const unrelated: number = 1;",
      dependencies: new Map(),
    },
  ]);
  const owned = loader.load();
  dependencies.set("./offset.ts", "edited");
  const observed: (number | undefined)[] = [];
  const available: string[][] = [];
  const lowering: GeneralLowering = {
    ...recordingLowering().lowering,
    lower: (request) => {
      assert.equal(
        request.modules[0]?.dependencies.get("./offset.ts"),
        "offset",
      );
      observed.push(request.trigger?.owner.start);
      available.push(request.available.map(({ id }) => id));
      const host = source(
        "general-host",
        'import { offset } from "offset"; export function run(): number { return offset; }',
      );
      host.dependencies.set("offset", "offset");
      return { ok: true, value: { modules: [host], entry: host.id } };
    },
  };
  const fromOwned = compileArm64Program({
    ...generatorProgram(lowering),
    modules: owned,
  });
  const fromLoader = compileArm64Program({
    ...generatorProgram(lowering),
    modules: [],
    moduleLoader: loader,
  });
  assert.ok(fromOwned.ok, JSON.stringify(fromOwned));
  assert.ok(fromLoader.ok, JSON.stringify(fromLoader));
  assert.deepEqual(fromLoader.value.native.code, fromOwned.value.native.code);
  const start = text.indexOf("function*");
  assert.deepEqual(observed, [start, start]);
  assert.deepEqual(available, [
    ["main", "offset", "unused"],
    ["main", "offset"],
  ]);
});

test("linking attributes implicit arguments to its receiver-owning function", () => {
  const { lowering, requests } = recordingLowering();
  const text = `function size(): number {
  const read = (): number => arguments.length;
  return read();
}
export function run(): number { return size(); }`;
  compileArm64Program({
    ...generatorProgram(lowering),
    modules: [source("main", text)],
  });
  assert.deepEqual(requests[0]?.trigger, {
    phase: "link",
    code: "UNKNOWN_NAME",
    capability: "arguments-object",
    location: {
      module: "main",
      start: text.indexOf("arguments"),
      end: text.indexOf("arguments") + "arguments".length,
    },
    owner: {
      module: "main",
      kind: "function",
      start: 0,
      end: text.indexOf("\nexport function"),
    },
  });
});

test("replay closes known arguments capabilities before generating a retry", () => {
  const { lowering, requests } = recordingLowering();
  const loader = createSourceModuleLoader([
    {
      id: "main",
      text: 'import { first } from "first"; import { second } from "second"; export function run(): number { return first() + second(); }',
      dependencies: new Map([
        ["first", "first"],
        ["second", "second"],
      ]),
    },
    {
      id: "first",
      text: "export function first(): number { return arguments.length; }",
      dependencies: new Map(),
    },
    {
      id: "second",
      text: "export function second(): number { return arguments.length; }",
      dependencies: new Map(),
    },
  ]);
  compileArm64Program({
    ...generatorProgram(lowering),
    modules: [],
    moduleLoader: loader,
  });
  assert.deepEqual(
    requests[0]?.modules.map(({ id }) => id),
    ["main", "first", "second"],
  );
  assert.deepEqual(requests[0]?.boundaries, []);
});

test("validated source cannot turn an unclassified compiler rejection into fallback", () => {
  const { lowering, requests } = recordingLowering();
  const result = compileArm64Program({
    ...generatorProgram({ ...lowering, validateSource: () => [] }),
    modules: [
      source(
        "main",
        "export function run(): number { return unknownGlobal(); }",
      ),
    ],
  });
  assert.equal(requests.length, 0);
  assert.ok(!result.ok);
  assert.equal(result.error.stage, "link");
  assert.match(result.error.message, /unknown value name: unknownGlobal/);
});

test("validated source can retry an explicitly classified capability", () => {
  const { lowering, requests } = recordingLowering();
  compileArm64Program(
    generatorProgram({ ...lowering, validateSource: () => [] }),
  );
  assert.equal(requests[0]?.trigger?.capability, "generator-suspension");
});

test("RegExp binding identifies the function that needs realm literals", () => {
  const { lowering, requests } = recordingLowering();
  const text =
    'export function run(): number { return /tint/.test("tint") ? 42 : 1; }';
  compileArm64Program({
    ...generatorProgram({ ...lowering, validateSource: () => [] }),
    modules: [source("main", text)],
  });
  assert.deepEqual(requests[0]?.trigger, {
    phase: "link",
    code: "UNSUPPORTED",
    capability: "regexp-literal",
    location: {
      module: "main",
      start: text.indexOf("/tint/"),
      end: text.indexOf("/tint/") + "/tint/".length,
    },
    owner: { kind: "function", module: "main", start: 0, end: text.length },
  });
});

test("inferred generic calls report a specialization capability with a source owner", () => {
  const { lowering, requests } = recordingLowering();
  const text =
    "function same<T>(value: T): T { return value; }\nexport function run(): number { return same(42); }";
  compileArm64Program({
    ...generatorProgram({ ...lowering, validateSource: () => [] }),
    modules: [source("main", text)],
  });
  assert.deepEqual(requests[0]?.trigger, {
    phase: "specialize",
    code: "UNSUPPORTED",
    capability: "generic-inference",
    location: {
      module: "main",
      start: text.indexOf("same(42)"),
      end: text.indexOf("same(42)") + "same(42)".length,
    },
    owner: {
      kind: "function",
      module: "main",
      start: text.indexOf("export"),
      end: text.length,
    },
  });
});

test("class heritage fallback is owned by the whole class", () => {
  const { lowering, requests } = recordingLowering();
  const text =
    "class Base {}\nfunction pick(): unknown { return Base; }\nclass Derived extends pick() {}\nexport function run(): number { return 42; }";
  compileArm64Program({
    ...generatorProgram({ ...lowering, validateSource: () => [] }),
    modules: [source("main", text)],
  });
  assert.equal(requests[0]?.trigger?.capability, "class-heritage");
  assert.equal(requests[0]?.trigger?.owner.kind, "class");
  const owner = requests[0]?.trigger?.owner;
  assert.equal(
    text.slice(owner?.start, owner?.end),
    "class Derived extends pick() {}",
  );
});

test("module classes and derived classes compile on the typed path", () => {
  const { lowering, requests } = recordingLowering();
  const text =
    "class Clazz { value: number = 42; }\nclass Derived extends Clazz { extra: number = 1; }\nexport function run(): number { return new Derived().value; }";
  const compiled = compileArm64Program({
    ...generatorProgram({ ...lowering, validateSource: () => [] }),
    modules: [source("main", text)],
  });
  assert.equal(requests.length, 0);
  assert.equal(compiled.ok, true, compiled.ok ? "" : compiled.error.message);
});

test("a typed binder restriction inside a method is owned by the class", () => {
  const { lowering, requests } = recordingLowering();
  const text =
    "class Clazz { count(): number { return arguments.length; } }\nexport function run(): number { return new Clazz().count(); }";
  compileArm64Program({
    ...generatorProgram({ ...lowering, validateSource: () => [] }),
    modules: [source("main", text)],
  });
  const trigger = requests[0]?.trigger;
  assert.equal(trigger?.phase, "link");
  assert.equal(trigger?.capability, "arguments-object");
  assert.equal(trigger?.owner.kind, "class");
  assert.equal(
    text.slice(trigger?.owner.start, trigger?.owner.end),
    text.split("\n")[0],
  );
});

test("requireTyped fails fast with the typed Worker preparation reason instead of lowering general guests", () => {
  const calls: boolean[] = [];
  const { lowering } = recordingLowering();
  const compiled = compileArm64Program({
    modules: [
      source("main", "export function run(): number { return 42; }"),
      source("peer", "export const x: number = 1;"),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [],
    workerModules: ["peer"],
    requireTyped: true,
    generalLowering: {
      ...lowering,
      prepareTypedWorkers: (_request, typed) => {
        calls.push(typed);
        return {
          ok: false,
          error:
            "module ./shared.ts uses the Worker bindings in the graphs of main and peer",
        };
      },
    },
  });
  assert.deepEqual(calls, [true]);
  assert.equal(compiled.ok, false);
  if (!compiled.ok) {
    assert.equal(compiled.error.stage, "worker-entry");
    assert.match(
      compiled.error.message,
      /module \.\/shared\.ts uses the Worker bindings in the graphs of main and peer/,
    );
  }
});
