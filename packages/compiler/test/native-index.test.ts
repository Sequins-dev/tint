import { test } from "node:test";
import {
  collectionFixtureLocations,
  numericFixtureLocations,
  testWorkspaceModules,
} from "../../../tools/test-workspace-modules.ts";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { compileArm64Program } from "../src/native/index.ts";
function source(
  id: string,
  text: string,
  dependencies: ReadonlyMap<string, string> = new Map(),
) {
  const bytes = new TextEncoder().encode(text),
    decoded = createSourceText(bytes, bytes.length);
  assert.ok(decoded.ok);
  const parsed = parseModule(decoded.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return {
    id,
    module: parsed.value,
    dependencies,
    sourcePosition: (offset: number) => {
      const position = decoded.value.positionAt(offset);
      return position.ok ? position.value : undefined;
    },
  };
}
test("native service imports omit facade bodies and retain checked calls through pruning", () => {
  const request = {
    modules: [
      source(
        "service",
        'export function read(value:number):number{throw "UNBOUND_NATIVE_SERVICE";}',
      ),
      source(
        "main",
        'import {read} from "service";export function run():number{return read(41);}',
        new Map([["service", "service"]]),
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [{ module: "service", namespace: "native-service" }],
    closedProgram: true,
    serviceImports: [
      { module: "service", name: "read", contract: "service.read.v1" },
    ],
  };
  const compiled = compileArm64Program(request);
  assert.ok(compiled.ok, JSON.stringify(compiled));
  assert.equal(compiled.value.native.linkage, "unresolved-managed");
  assert.equal(compiled.value.native.managedImports.length, 1);
  assert.deepEqual(compiled.value.native.managedImports[0]?.parameters, [
    "number",
  ]);
  assert.ok(
    !compiled.value.native.strings.some(
      (s) => s.value === "UNBOUND_NATIVE_SERVICE",
    ),
  );
  assert.equal(compileArm64Program({ ...request, runtimes: [] }).ok, false);
  assert.equal(
    compileArm64Program({
      ...request,
      serviceImports: [...request.serviceImports, ...request.serviceImports],
    }).ok,
    false,
  );
});
test("record-test capabilities require explicit runtime exports and reject duplicate registration", () => {
  const request = {
    modules: [
      source(
        "record-runtime",
        "export interface Box{value:number} export function matches(value:unknown,witness:Box):boolean{return false;}",
      ),
      source(
        "main",
        'import {matches} from "record-runtime"; export function run():boolean{const box={value:42};return matches(box,box);}',
        new Map([["record-runtime", "record-runtime"]]),
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [{ module: "record-runtime", namespace: "record-test-runtime" }],
    recordBindings: [
      { module: "record-runtime", name: "matches", operation: "test" as const },
    ],
  };
  const allowed = compileArm64Program(request);
  assert.ok(allowed.ok, JSON.stringify(allowed));
  const untrusted = compileArm64Program({ ...request, runtimes: [] });
  assert.equal(untrusted.ok, false);
  if (!untrusted.ok) assert.equal(untrusted.error.stage, "record-binding");
  const missing = compileArm64Program({
    ...request,
    recordBindings: [
      { module: "record-runtime", name: "missing", operation: "test" },
    ],
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.stage, "record-binding");
  assert.equal(
    compileArm64Program({
      ...request,
      recordBindings: [...request.recordBindings, ...request.recordBindings],
    }).ok,
    false,
  );
});
test("specialization budgets are explicit for application and runtime templates", async () => {
  const request = {
    modules: [
      source(
        "main",
        "function id<T>(value:T):T{return value;}export function run():number{return id<number>(42);}",
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [],
  };
  const denied = compileArm64Program({ ...request, maxSpecializations: 0 });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.stage, "specialize");
  const allowed = compileArm64Program({ ...request, maxSpecializations: 1 });
  assert.ok(allowed.ok, JSON.stringify(allowed));
  const { readFileSync } = await import("node:fs");
  const runtimeRequest = {
    modules: [
      source(
        "lists",
        readFileSync(
          new URL(
            "../../foundation/src/collections/sparse-list.ts",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
      source(
        "main",
        'export function run():boolean{const values=["a"];return values[0]==="a";}',
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [{ module: "lists", namespace: "sparse-list" }],
  };
  const runtimeDenied = compileArm64Program({
    ...runtimeRequest,
    maxSpecializations: 0,
  });
  assert.equal(runtimeDenied.ok, false);
  if (!runtimeDenied.ok) assert.equal(runtimeDenied.error.stage, "runtime");
  const runtimeAllowed = compileArm64Program({
    ...runtimeRequest,
    maxSpecializations: 64,
  });
  assert.ok(runtimeAllowed.ok, JSON.stringify(runtimeAllowed));
});
test("composes imported functions and module state into a native initializer", () => {
  const result = compileArm64Program({
    modules: [
      source(
        "dep",
        "export function add(a:number,b:number):number{return a+b;}",
      ),
      source(
        "main",
        'import {add} from "dep";const base=20;export function answer():number{return add(base,22);}',
        new Map([["dep", "dep"]]),
      ),
    ],
    entry: "main",
    exports: ["answer"],
    start: "answer",
    runtimes: [],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(result.value.native.code.length > 0);
  assert.equal(
    result.value.native.functions[result.value.initializer]?.signature
      .parameters.length,
    0,
  );
  assert.deepEqual(result.value.exports, ["answer"]);
  assert.notEqual(result.value.entry, undefined);
});
test("rejects missing selected exports before native packaging", () => {
  const result = compileArm64Program({
    modules: [source("main", "export function answer():number{return 42;}")],
    entry: "main",
    exports: ["absent"],
    runtimes: [],
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected rejection");
  assert.match(result.error.message, /selected export/);
});
test("host capabilities require declared runtime exports and matching signatures", () => {
  const modules = [
    source(
      "host",
      'export function close(fd:number):number{throw "HOST_UNAVAILABLE";}',
    ),
    source(
      "main",
      'import {close} from "host";export function run():number{return close(-1);}',
      new Map([["host", "host"]]),
    ),
  ];
  const request = {
    modules,
    entry: "main",
    exports: ["run"],
    hostBindings: [
      { module: "host", name: "close", operation: "close" as const },
    ],
  };
  const denied = compileArm64Program({ ...request, runtimes: [] });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.stage, "host");
  const allowed = compileArm64Program({
    ...request,
    runtimes: [{ module: "host", namespace: "host" }],
  });
  assert.ok(allowed.ok, JSON.stringify(allowed));
  assert.deepEqual(
    allowed.value.native.imports.map((i) => i.target.name),
    ["_close", "___error"],
  );
  const mismatch = compileArm64Program({
    ...request,
    runtimes: [{ module: "host", namespace: "host" }],
    hostBindings: [{ module: "host", name: "close", operation: "read" }],
  });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.error.stage, "host");
});

test("runtime re-export implementations stay outside application module instances", () => {
  const names = [
    "key-index",
    "number-list",
    "linked-map",
    "sparse-list",
    "linked-set",
    "primitive-value",
    "number-text",
    "indexed-sort",
    "list-sort",
    "text-encoding",
  ];
  const modules = testWorkspaceModules(
    names,
    undefined,
    new Map([...collectionFixtureLocations, ...numericFixtureLocations]),
  );
  modules.push(
    source(
      "main",
      "export function run():number{const values=[3,1,2];values.sort((a,b)=>a-b);return values[0]??0;}",
    ),
  );
  const result = compileArm64Program({
    modules,
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: names.map((name) => ({ module: name, namespace: name })),
  });
  assert.ok(result.ok, JSON.stringify(result));
});

test("Number predicates lower primitive unions and general values through guarded extraction", async () => {
  const { readFileSync } = await import("node:fs");
  const result = compileArm64Program({
    modules: [
      source(
        "primitive",
        readFileSync(
          new URL("../../native-runtime/src/values/index.ts", import.meta.url),
          "utf8",
        ),
      ),
      source(
        "main",
        `
        export function primitive(value:number|string|boolean):boolean {
          return Number.isFinite(value)&&Number.isInteger(value)&&Number.isSafeInteger(value);
        }
        export function general(value:unknown):boolean {
          return Number.isFinite(value)&&Number.isInteger(value)&&Number.isSafeInteger(value);
        }
      `,
      ),
    ],
    entry: "main",
    exports: ["primitive", "general"],
    runtimes: [{ module: "primitive", namespace: "primitive-value" }],
  });
  assert.ok(result.ok, JSON.stringify(result));
});

test("optional profiling symbols preserve source function identity through specialization", () => {
  const request = {
    modules: [
      source(
        "example.ts",
        "function identity<T>(value:T):T{return value;}export function run():number{return identity<number>(42);}",
      ),
    ],
    entry: "example.ts",
    exports: ["run"],
    start: "run",
    runtimes: [],
  };
  const plain = compileArm64Program(request);
  const debug = compileArm64Program({ ...request, debugSymbols: true });
  assert.ok(plain.ok);
  assert.ok(debug.ok);
  assert.deepEqual(debug.value.native.code, plain.value.native.code);
  assert.equal(plain.value.symbols.length, 0);
  assert.ok(
    debug.value.symbols.some((s) => s.name.includes("example.ts:identity")),
    JSON.stringify(debug.value.symbols),
  );
  assert.ok(debug.value.symbols.some((s) => s.name.includes("example.ts:run")));
  for (const symbol of debug.value.symbols)
    assert.ok(
      debug.value.native.functions.some((f) => f.offset === symbol.offset),
    );
});

test("native line ranges retain original imported and specialized source positions", () => {
  const request = {
    modules: [
      source(
        "dep.ts",
        "// 😀\r\nexport function identity<T>(value:T):T{\r\n  return value;\r\n}\r\n",
      ),
      source(
        "main.ts",
        'import {identity} from "dep";\nexport function run():number{\n  return identity<number>(42);\n}\n',
        new Map([["dep", "dep.ts"]]),
      ),
    ],
    entry: "main.ts",
    exports: ["run"],
    start: "run",
    runtimes: [],
  };
  const plain = compileArm64Program(request);
  const debug = compileArm64Program({ ...request, debugSymbols: true });
  assert.ok(plain.ok, JSON.stringify(plain));
  assert.ok(debug.ok, JSON.stringify(debug));
  assert.deepEqual(debug.value.native.code, plain.value.native.code);
  assert.deepEqual(plain.value.lines, []);
  assert.ok(
    debug.value.lines.some((row) => row.file === "dep.ts" && row.line === 3),
    JSON.stringify(debug.value.lines),
  );
  assert.ok(
    debug.value.lines.some((row) => row.file === "main.ts" && row.line === 3),
    JSON.stringify(debug.value.lines),
  );
  let end = 0;
  for (const row of debug.value.lines) {
    assert.ok(row.offset >= end);
    assert.ok(row.byteLength > 0 && row.column > 0);
    end = row.offset + row.byteLength;
    assert.ok(end <= debug.value.native.code.length);
  }
});

test("basic optimization reports passes and shrinks constant arithmetic with source mappings", () => {
  const request = {
    modules: [
      source(
        "main",
        "export function run():number{return (6*7)+(3*5)-(10/2);}",
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [],
    debugSymbols: true,
  };
  const baseline = compileArm64Program({ ...request, optimization: "none" });
  const optimized = compileArm64Program({ ...request, optimization: "basic" });
  assert.ok(baseline.ok, JSON.stringify(baseline));
  assert.ok(optimized.ok, JSON.stringify(optimized));
  assert.deepEqual(baseline.value.optimization, []);
  assert.deepEqual(
    optimized.value.optimization.map((p) => p.pass),
    [
      "fold-constants",
      "ssa-constants",
      "forward-local-loads",
      "remove-unread-stores",
      "remove-dead-scalars",
      "coalesce-defaults",
      "scalar-replace-records",
      "inline-small-functions",
      "lower-proven-record-reads",
      "select-array-access",
      "simplify-control-flow",
      "compact-slots",
    ],
  );
  assert.ok(
    optimized.value.optimization
      .filter((p) =>
        [
          "fold-constants",
          "forward-local-loads",
          "remove-unread-stores",
          "remove-dead-scalars",
        ].includes(p.pass),
      )
      .every((p) => p.rewritten > 0),
  );
  assert.equal(
    optimized.value.optimization.find(
      (p) => p.pass === "scalar-replace-records",
    )?.rewritten,
    0,
  );
  assert.ok(
    optimized.value.native.code.length < baseline.value.native.code.length,
    JSON.stringify({
      baseline: baseline.value.native.code.length,
      optimized: optimized.value.native.code.length,
    }),
  );
  assert.ok(optimized.value.lines.some((row) => row.file === "main"));
});

test("closed builds prune unreachable bodies before spending scalar optimization work", () => {
  function compile(closedProgram: boolean) {
    const result = compileArm64Program({
      modules: [
        source(
          "main",
          "export function unused(x:number):number{return ((x+3)*7)-(x/2);}export function run():number{return 42;}",
        ),
      ],
      entry: "main",
      exports: ["run"],
      start: "run",
      runtimes: [],
      closedProgram,
    });
    assert.ok(result.ok, JSON.stringify(result));
    return result.value;
  }
  const closed = compile(true),
    open = compile(false);
  assert.equal(closed.optimization[0]?.pass, "remove-unreachable");
  assert.ok((closed.optimization[0]?.rewritten ?? 0) > 0);
  const closedFold = closed.optimization.find(
      (p) => p.pass === "fold-constants",
    )!,
    openFold = open.optimization.find((p) => p.pass === "fold-constants")!;
  assert.ok(closedFold.visited < openFold.visited);
  assert.ok(closed.native.code.length < open.native.code.length);
});

test("dense list representation requires a closed executable and private runtime headers", async () => {
  const { readFileSync } = await import("node:fs");
  const runtime = source(
    "lists",
    readFileSync(
      new URL(
        "../../foundation/src/collections/sparse-list.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  function compile(body: string, closedProgram = true) {
    const result = compileArm64Program({
      modules: [runtime, source("main", body, new Map([["lists", "lists"]]))],
      entry: "main",
      exports: ["run"],
      start: "run",
      runtimes: [{ module: "lists", namespace: "sparse-list" }],
      closedProgram,
      denseReferenceLists: true,
    });
    assert.ok(result.ok, JSON.stringify(result));
    return result.value;
  }
  const body =
    "interface Value {value:number}export function run():number{const values:Value[]=[{value:42}];const v=values[0];if(v===undefined)return 0;return v.value;}";
  assert.ok(
    compile(body).optimization.some(
      (p) => p.pass === "dense-reference-lists" && p.rewritten > 0,
    ),
  );
  assert.ok(
    !compile(body, false).optimization.some(
      (p) => p.pass === "dense-reference-lists",
    ),
  );
  assert.ok(
    compile(
      body + 'function unused():string[]{return ["text"];}',
    ).optimization.some(
      (p) => p.pass === "dense-reference-lists" && p.rewritten > 0,
    ),
  );
  assert.ok(
    compile(
      'import {createList,hasList} from "lists";interface Value {value:number}export function run():number{const values:Value[]=[{value:42}];const extra=createList<Value|undefined>(0);if(hasList<Value|undefined>(extra,0))return 0;const v=values[0];return v===undefined?0:v.value;}',
    ).optimization.some((p) => p.pass === "dense-reference-lists"),
    "explicit generic runtime specializations must be inventoried",
  );
  assert.ok(
    !compile(
      'import {createList,popList} from "lists";interface Value {value:number}export function run():number{const values:Value[]=[{value:42}];const extra=createList<Value|undefined>(0);popList<Value|undefined>(extra);return values.length;}',
    ).optimization.some((p) => p.pass === "dense-reference-lists"),
    "unbound direct header mutations must decline",
  );
  const escaped =
    'import {createList} from "lists";interface Value {value:number}export function run():number{const values:Value[]=[{value:42}];const privateList=createList<Value|undefined>(0);if(privateList.root!==undefined)return 0;const v=values[0];if(v===undefined)return 0;return v.value;}';
  assert.ok(
    !compile(escaped).optimization.some(
      (p) => p.pass === "dense-reference-lists",
    ),
  );
  assert.ok(
    compile(
      'export function run():number{const values=["text"];return values.length;}',
    ).optimization.some((p) => p.pass === "dense-reference-lists"),
  );
  for (const [type, values] of [
    ["number|string", '42,"value"'],
    ["boolean|string|undefined", 'true,"value",undefined'],
    ["boolean", "true,false"],
  ])
    assert.ok(
      compile(
        `export function run():number{const items:(${type})[]=[${values}];const value=items[0];return value===undefined?0:42;}`,
      ).optimization.some(
        (p) => p.pass === "dense-reference-lists" && p.rewritten > 0,
      ),
      `${type} cells must retain the private dense representation`,
    );
});

test("explicit runtime retention keeps binding stubs while initializing dependency state", () => {
  const request = {
    modules: [
      source(
        "data",
        "function initial():number{return 42;}const value=initial();export function read():number{return value;}",
      ),
      source(
        "runtime",
        'export {read} from "data";export interface Box{value:number}export function matches(value:unknown,witness:Box):boolean{return false;}',
        new Map([["data", "data"]]),
      ),
      source(
        "main",
        'import {read,matches} from "runtime";export function run():number{const box={value:read()};return matches(box,box)?box.value:0;}',
        new Map([["runtime", "runtime"]]),
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [
      {
        module: "runtime",
        namespace: "record-test-runtime",
        retainedExports: ["matches"],
      },
    ],
    recordBindings: [
      { module: "runtime", name: "matches", operation: "test" as const },
    ],
  };
  const result = compileArm64Program(request);
  assert.ok(result.ok, JSON.stringify(result));
  const missing = compileArm64Program({
    ...request,
    runtimes: [
      {
        module: "runtime",
        namespace: "record-test-runtime",
        retainedExports: ["missing"],
      },
    ],
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error.message, /retained.*missing/);
});
test("weak capabilities require runtime identity, exact signatures and unique authorization", () => {
  const modules = [
    source(
      "weak",
      'export function create(key:unknown,value:unknown,ephemeron:boolean):unknown{throw "HOST_UNAVAILABLE";}',
    ),
    source(
      "main",
      'import {create} from "weak";export function run():unknown{return create(1,2,true);}',
      new Map([["weak", "weak"]]),
    ),
  ];
  const request = {
    modules,
    entry: "main",
    exports: ["run"],
    weakBindings: [
      { module: "weak", name: "create", operation: "new" as const },
    ],
  };
  const denied = compileArm64Program({ ...request, runtimes: [] });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.stage, "weak");
  const authorized = {
    ...request,
    runtimes: [{ module: "weak", namespace: "weak-storage" }],
  };
  const allowed = compileArm64Program(authorized);
  assert.ok(allowed.ok, JSON.stringify(allowed));
  const mismatch = compileArm64Program({
    ...authorized,
    weakBindings: [{ module: "weak", name: "create", operation: "key" }],
  });
  assert.equal(mismatch.ok, false);
  const duplicate = compileArm64Program({
    ...authorized,
    weakBindings: [...request.weakBindings, ...request.weakBindings],
  });
  assert.equal(duplicate.ok, false);
});
