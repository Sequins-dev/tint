import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createNativeBatchBuilder,
  prepareNativeModuleProgram,
  prepareNativeScriptProgram,
  type NativeTestCase,
} from "./test262-native.ts";
import {
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
assert.equal(
  process.env.TINT_BUILD_ONLY,
  "1",
  "Build only; execute through the serial native recorder",
);
const directory = mkdtempSync(join(tmpdir(), "tint-test262-json-modules-")),
  snapshot = workspaceSources();
const programs: readonly {
  name: string;
  source: string;
  json?: string;
  js?: string;
  script?: true;
  expected: unknown;
}[] = [
  {
    name: "static JSON default, identity and proto key",
    source:
      'import value from "./data.json" with {type:"json"};import again from "./data.json" with {type:"json"};if(value!==again||value.answer!==42||value.__proto__!==7||Object.getPrototypeOf(value)!==Object.prototype)throw 1;',
    json: '{"answer":42,"__proto__":7}',
    expected: { kind: "completed" },
  },
  {
    name: "invalid JSON fails while loading",
    source: 'import value from "./data.json" with {type:"json"};throw 1;',
    json: "[1,]",
    expected: { kind: "error", phase: "resolution", type: "SyntaxError" },
  },
  {
    name: "JSON requires the json type",
    source: 'import value from "./data.json";throw 1;',
    json: "{}",
    expected: { kind: "error", phase: "resolution", type: "TypeError" },
  },
  {
    name: "unsupported type cannot select JSON",
    source: 'import value from "./data.json" with {type:"not-json"};throw 1;',
    json: "{}",
    expected: { kind: "error", phase: "resolution", type: "TypeError" },
  },
  {
    name: "JSON has no named exports",
    source: 'import {answer} from "./data.json" with {type:"json"};throw 1;',
    json: '{"answer":42}',
    expected: { kind: "error", phase: "resolution", type: "SyntaxError" },
  },
  {
    name: "unsupported attribute key fails during graph loading",
    source:
      'import value from "./data.json" with {type:"json",unknown:"x"};throw 1;',
    json: "{}",
    expected: { kind: "error", phase: "resolution", type: "SyntaxError" },
  },
  {
    name: "JavaScript refuses json type",
    source: 'import value from "./dep.js" with {type:"json"};throw 1;',
    js: "export default 42;",
    expected: { kind: "error", phase: "resolution", type: "TypeError" },
  },
  {
    name: "JSON cache never bypasses request validation",
    source:
      'import value from "./data.json" with {type:"json"};const good=await import("./data.json",{with:{type:"json"}});if(good.default!==value)throw 1;let caught=false;try{await import("./data.json");}catch(error){if(!(error instanceof TypeError))throw error;caught=true;}if(!caught)throw 2;',
    json: '{"answer":42}',
    expected: { kind: "completed" },
  },
  {
    name: "Script dynamic JSON returns a shared namespace on fresh promises",
    script: true,
    source:
      'const a=import("./data.json",{with:{type:"json"}}),b=import("./data.json",{with:{type:"json"}});if(a===b)throw 1;Promise.all([a,b]).then(values=>{if(values[0]!==values[1]||values[0].default.answer!==42)throw 2;print("Test262:AsyncTestComplete");});',
    json: '{"answer":42}',
    expected: { kind: "completed" },
  },
  {
    name: "text module proposals stay sticky unsupported",
    source: 'try{await import("./data.json",{with:{type:"text"}});}catch{}',
    json: "{}",
    expected: { kind: "unsupported" },
  },
  {
    name: "dynamic invalid JSON rejects with SyntaxError",
    source:
      'let caught=false;try{await import("./data.json",{with:{type:"json"}});}catch(error){if(!(error instanceof SyntaxError))throw error;caught=true;}if(!caught)throw 1;',
    json: "[1,]",
    expected: { kind: "completed" },
  },
];
const cases: NativeTestCase[] = [];
for (const [index, program] of programs.entries()) {
  const folder = join(directory, "case-" + index);
  mkdirSync(folder);
  writeFileSync(join(folder, "root.js"), program.source);
  if (program.json !== undefined)
    writeFileSync(join(folder, "data.json"), program.json);
  if (program.js !== undefined)
    writeFileSync(join(folder, "dep.js"), program.js);
  if (program.script === true) {
    const prepared = prepareNativeScriptProgram(
      {
        source: program.source,
        goal: "script",
        harness: [],
        asynchronous: true,
        canSuspend: true,
      },
      "sloppy",
      [],
      join(folder, "root.js"),
      undefined,
      true,
    );
    assert.ok(prepared.ok, JSON.stringify(prepared));
    assert.ok(prepared.root);
    cases.push({
      scripts: prepared.scripts,
      modules: prepared.root.entries,
      scriptRoot: { absent: prepared.root.absent },
      asynchronous: true,
    });
  } else {
    const prepared = prepareNativeModuleProgram(
      {
        source: program.source,
        goal: "module",
        harness: [],
        asynchronous: false,
        canSuspend: true,
      },
      [],
      join(folder, "root.js"),
      undefined,
      true,
    );
    assert.ok(prepared.ok, JSON.stringify(prepared));
    cases.push({
      scripts: prepared.harness,
      modules: prepared.entries,
      asynchronous: false,
    });
  }
}
const built = createNativeBatchBuilder(snapshot, true)(cases);
if (!built.ok) throw Error(JSON.stringify(built.outcome));
const binary = join(directory, "json-module-host"),
  fixture = join(directory, "cases.json");
writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
writeFileSync(
  fixture,
  JSON.stringify(
    {
      kind: "native-json-module-host-fixture",
      conformance: false,
      cases: programs,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
writeFileSync(
  binary + ".manifest.json",
  JSON.stringify(
    {
      kind: "tint-hosted-native-build",
      version: 1,
      sourceSnapshot: workspaceSourceIdentity(snapshot),
      imageSha256: createHash("sha256").update(built.bytes).digest("hex"),
      fixture,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(binary);
