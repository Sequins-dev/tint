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
const directory = mkdtempSync(join(tmpdir(), "tint-managed-templates-")),
  snapshot = workspaceSources();
const programs: readonly {
  name: string;
  source: string;
  files: Record<string, string>;
  asynchronous: boolean;
  expected: unknown;
  module?: true;
}[] = [
  {
    name: "repeated function calls retain one frozen template object",
    source:
      'const f=eval("(function(){function tag(s){return s;}return ()=>tag`x`;})()");const a=f();if(f()!==a||!Object.isFrozen(a)||!Object.isFrozen(a.raw))throw 1;',
    files: {},
    asynchronous: false,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "fresh eval parses sharing a referrer keep distinct sites",
    source:
      'const source="(function(){function tag(s){return s;}return tag`same`;})()";const a=eval(source),b=eval(source);if(a===b||a.raw===b.raw)throw 1;',
    files: {},
    asynchronous: false,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "equal text at distinct sites never merges identity",
    source:
      'const r=eval("(function(){function tag(s){return s;}return [tag`same`,tag`same`];})()");if(r[0]===r[1])throw 1;',
    files: {},
    asynchronous: false,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "Function caches its own sites and separates function objects",
    source:
      'const body="function tag(s){return s;}return tag`x`;";const F=Function(body),G=Function(body);if(F()!==F()||F()===G())throw 1;',
    files: {},
    asynchronous: false,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "undefined cooked segments and exact raw text survive compilation",
    source:
      'const r=eval("(function(){function tag(s){return s;}return tag`\\\\unicode`;})()");if(r[0]!==undefined||r.raw[0]!=="\\\\unicode")throw 1;',
    files: {},
    asynchronous: false,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "tag getter and substitutions preserve source order",
    source:
      'globalThis.__tagLog="";const value=eval("(function(){const o={get tag(){__tagLog+=\\"g\\";return (s,x)=>{__tagLog+=\\"t\\";return x;}}};return o.tag`x${(__tagLog+=\\"s\\",42)}`;})()");if(value!==42||__tagLog!=="gst")throw 1;',
    files: {},
    asynchronous: false,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "constructed bodies create template arrays in their own realm",
    source:
      'const other=$262.createRealm().global;const F=other.Function("function tag(s){return s;}return tag`x`;");if(Object.getPrototypeOf(F())!==other.Array.prototype||F()!==F())throw 1;',
    files: {},
    asynchronous: false,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "returned JIT callbacks retain sites across allocation churn",
    source:
      'const f=eval("(function(){function tag(s){return s;}return ()=>tag`root`;})()");const a=f();for(let i=0;i<100000;i++){const garbage=[i,i,i,i,i,i,i,i];if(garbage[0]!==i)throw 1;}if(f()!==a)throw 2;',
    files: {},
    asynchronous: false,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "template identity survives suspension and continuation loops",
    source:
      'eval("(async function(){function tag(s){return s;}let first;for(let i=0;i<2;i++){await 0;const value=tag`same`;if(i===0)first=value;else if(value!==first)return false;}return true;})()").then(value=>{if(!value)throw 1;print("Test262:AsyncTestComplete");});',
    files: {},
    asynchronous: true,
    expected: {
      kind: "completed",
    },
  },
  {
    name: "a genuine missing-tag error is catchable without poisoning evaluation",
    source:
      'let caught=false;try{$262.evalScript("missing`x`")}catch(error){caught=error instanceof ReferenceError;}if(!caught||$262.evalScript("42")!==42)throw 1;',
    files: {},
    asynchronous: false,
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
    cases.push({
      scripts: prepared.scripts,
      ...(prepared.root === undefined
        ? {}
        : {
            modules: prepared.root.entries,
            scriptRoot: { absent: prepared.root.absent },
          }),
      asynchronous: item.asynchronous,
    });
  }
}
const built = createNativeBatchBuilder(snapshot, true)(cases);
if (!built.ok) throw Error(JSON.stringify(built.outcome));
const binary = join(directory, "managed-templates"),
  fixture = join(directory, "cases.json");
writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
writeFileSync(
  fixture,
  JSON.stringify(
    {
      kind: "native-managed-templates-fixture",
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
