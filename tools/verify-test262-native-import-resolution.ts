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
const directory = mkdtempSync(join(tmpdir(), "tint-import-resolution-")),
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
    name: "primitive bare specifiers reject asynchronously",
    source:
      'let synchronous=true;const promise=import(1);promise.then(()=>{throw 1;},error=>{if(synchronous||!(error instanceof TypeError))throw 2;print("Test262:AsyncTestComplete");});synchronous=false;',
    files: {},
    asynchronous: true,
    expected: { kind: "completed" },
  },
  {
    name: "nested import promises reject while the inner module loads",
    source:
      'const inner=import("./dep.js"),outer=import(inner);Promise.all([inner,outer.then(()=>{throw 1;},error=>{if(!(error instanceof TypeError))throw error;})]).then(values=>{if(values[0].value!==42)throw 2;print("Test262:AsyncTestComplete");});',
    files: { "dep.js": "export const value=42;" },
    asynchronous: true,
    expected: { kind: "completed" },
  },
  {
    name: "computed undiscovered relative siblings stay unsupported",
    source: 'const prefix="./";import(prefix+"dep.js");',
    files: { "dep.js": "export const value=42;" },
    asynchronous: false,
    expected: { kind: "unsupported" },
  },
  {
    name: "specifier coercion failures retain their identity",
    source:
      'const marker={};import({toString(){throw marker;}}).then(()=>{throw 1;},error=>{if(error!==marker)throw 2;print("Test262:AsyncTestComplete");});',
    files: {},
    asynchronous: true,
    expected: { kind: "completed" },
  },
  {
    name: "module importers use the same bare-specifier rejection policy",
    module: true,
    source:
      'import(1).then(()=>{throw 1;},error=>{if(!(error instanceof TypeError))throw error;print("Test262:AsyncTestComplete");});',
    files: {},
    asynchronous: true,
    expected: { kind: "completed" },
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
const binary = join(directory, "import-resolution"),
  fixture = join(directory, "cases.json");
writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
writeFileSync(
  fixture,
  JSON.stringify(
    {
      kind: "native-import-resolution-fixture",
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
