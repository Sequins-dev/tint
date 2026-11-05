import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createNativeBatchBuilder,
  prepareNativeScriptProgram,
  prepareNativeModuleProgram,
  type NativeTestCase,
} from "./test262-native.ts";
import {
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
assert.equal(
  process.env.TINT_BUILD_ONLY,
  "1",
  "Build only; use the serial native recorder",
);
const directory = mkdtempSync(join(tmpdir(), "tint-managed-import-")),
  snapshot = workspaceSources();
const programs: readonly {
  name: string;
  module?: true;
  source: string;
  files: Record<string, string>;
  asynchronous: boolean;
  expected: unknown;
}[] = [
  {
    name: "direct eval uses the caller Script record",
    source:
      'const p=eval("import(\'./dep.js\')");p.then(ns=>{if(ns.value!==42)throw 1;print("Test262:AsyncTestComplete");});',
    files: {
      "dep.js": "export const value=42;",
    },
    asynchronous: true,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "indirect eval uses the effective Script identity",
    source:
      'const p=(0,eval)("import(\'./dep.js\')");p.then(ns=>{if(ns.value!==42)throw 1;print("Test262:AsyncTestComplete");});',
    files: {
      "dep.js": "export const value=42;",
    },
    asynchronous: true,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "Function retains its construction Script identity",
    source:
      'const f=Function("return import(\'./dep.js\')");f().then(ns=>{if(ns.value!==42)throw 1;print("Test262:AsyncTestComplete");});',
    files: {
      "dep.js": "export const value=42;",
    },
    asynchronous: true,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "evalScript creates an importer and uses the realm loader",
    source:
      "$262.evalScript(\"import('./dep.js').then(ns=>{if(ns.value!==42)throw 1;print('Test262:AsyncTestComplete');});\");",
    files: {
      "dep.js": "export const value=42;",
    },
    asynchronous: true,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "module direct eval imports its own module",
    module: true,
    source:
      'export const value=42;eval("import(\'./root.js\')").then(ns=>{if(ns.value!==42)throw 1;print("Test262:AsyncTestComplete");});',
    files: {
      "dep.js": "export const value=42;",
    },
    asynchronous: true,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "module constructed Function captures its defining module",
    module: true,
    source:
      'export const value=42;Function("return import(\'./root.js\')")().then(ns=>{if(ns.value!==42)throw 1;print("Test262:AsyncTestComplete");});',
    files: {
      "dep.js": "export const value=42;",
    },
    asynchronous: true,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "eval import preserves rejection identity",
    source:
      'const marker={};eval("import({toString(){throw marker;}})").then(()=>{throw 1;},error=>{if(error!==marker)throw 2;print("Test262:AsyncTestComplete");});',
    files: {
      "dep.js": "export const value=42;",
    },
    asynchronous: true,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "eval import evaluates operands before asynchronous conversion",
    source:
      "let log=\"\";const p=eval(\"import((log+='s', {toString(){log+='t';return './dep.js'}}),(log+='o',{}))\");if(log!==\"sot\")throw log;p.then(ns=>{if(ns.value!==42)throw 1;print(\"Test262:AsyncTestComplete\");});",
    files: {
      "dep.js": "export const value=42;",
    },
    asynchronous: true,
    expected: {
      kind: "completed",
    },
  },
];
const cases: NativeTestCase[] = [];
for (const [index, item] of programs.entries()) {
  const folder = join(directory, "case-" + index);
  mkdirSync(folder);
  writeFileSync(join(folder, "root.js"), item.source);
  for (const [name, text] of Object.entries(item.files))
    writeFileSync(join(folder, name), text);
  if (item.module === true) {
    const prepared = prepareNativeModuleProgram(
      {
        source: item.source,
        goal: "module",
        harness: [],
        asynchronous: item.asynchronous,
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
      asynchronous: item.asynchronous,
    });
  } else {
    const prepared = prepareNativeScriptProgram(
      {
        source: item.source,
        goal: "script",
        harness: [],
        asynchronous: item.asynchronous,
        canSuspend: true,
      },
      "sloppy",
      [],
      join(folder, "root.js"),
      undefined,
      true,
      true,
    );
    assert.ok(prepared.ok, JSON.stringify(prepared));
    assert.ok(prepared.root);
    cases.push({
      scripts: prepared.scripts,
      modules: prepared.root.entries,
      scriptRoot: { absent: prepared.root.absent },
      asynchronous: item.asynchronous,
    });
  }
}
const built = createNativeBatchBuilder(snapshot, true)(cases);
if (!built.ok) throw Error(JSON.stringify(built.outcome));
const binary = join(directory, "managed-import"),
  fixture = join(directory, "cases.json");
writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
writeFileSync(
  fixture,
  JSON.stringify(
    {
      kind: "native-managed-import-fixture",
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
