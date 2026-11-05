import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createNativeBatchBuilder,
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
  "Build only; use the serial LLDB recorder for execution",
);
const directory = mkdtempSync(join(tmpdir(), "tint-await-chains-")),
  snapshot = workspaceSources();
const programs: readonly { name: string; sources: Record<string, string> }[] = [
  ...["for-await", "for-in", "for-of"].map((kind) => ({
    name: "unchanged nested await loop: " + kind,
    sources: {
      "root.js": readFileSync(
        ".tint-bootstrap/test262/test/language/module-code/top-level-await/syntax/" +
          kind +
          "-await-expr-nested.js",
        "utf8",
      ),
    },
  })),
  {
    name: "nested awaits preserve each Promise-job suspension",
    sources: {
      "root.js": `async function sample(chain){const trace=[];let tick=0;function next(){trace.push('t'+(++tick));if(tick<6)Promise.resolve().then(next);}Promise.resolve().then(next);const thenable={then(resolve){trace.push('then');resolve(42);}};let result;if(chain)result=await await await thenable;else{result=await thenable;result=await result;result=await result;}trace.push('done');if(result!==42)throw 1;return trace.join(',');}const chain=await sample(true),explicit=await sample(false);if(chain!==explicit||chain!=='t1,then,t2,t3,t4,done')throw new Error(chain+' / '+explicit);`,
    },
  },
  {
    name: "rejection exits the await chain and retains finally completion",
    sources: {
      "root.js": `const marker={};let entered=0,cleanup=0;try{await await await {then(resolve,reject){entered++;reject(marker);}};throw 1;}catch(error){if(error!==marker)throw error;}finally{const value=await await await 9;if(value!==9)throw 2;cleanup++;}if(entered!==1||cleanup!==1)throw 3;`,
    },
  },
  {
    name: "grouped long await chains evaluate the input once",
    sources: {
      "root.js":
        "let calls=0;const value=" +
        "await (".repeat(20) +
        "(++calls,42)" +
        ")".repeat(20) +
        ";if(value!==42||calls!==1)throw 1;",
    },
  },
  {
    name: "async-generator chains preserve yield and finally",
    sources: {
      "root.js": `let cleaned=0;async function* g(){try{yield await await await 42;}finally{const value=await await await 9;if(value!==9)throw 1;cleaned++;}}const iterator=g(),first=await iterator.next();if(first.value!==42||first.done)throw 2;const last=await iterator.return(7);if(last.value!==7||!last.done||cleaned!==1)throw 3;`,
    },
  },
  {
    name: "runtime-compiled async await chains call back through the AOT surface",
    sources: {
      "root.js": `$262.evalScript('async function runtimeAwaitChain(){return await await await 42;}');const value=await runtimeAwaitChain();if(value!==42)throw 1;`,
    },
  },
];
const cases: NativeTestCase[] = [],
  descriptions = [];
for (const [index, program] of programs.entries()) {
  const folder = join(directory, "case-" + index);
  mkdirSync(folder);
  for (const [name, source] of Object.entries(program.sources))
    writeFileSync(join(folder, name), source);
  const source = program.sources["root.js"];
  assert.ok(source !== undefined);
  const prepared = prepareNativeModuleProgram(
    {
      source,
      goal: "module",
      harness: [],
      asynchronous: false,
      canSuspend: true,
    },
    [],
    join(folder, "root.js"),
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  cases.push({
    scripts: prepared.harness,
    modules: prepared.entries,
    asynchronous: false,
  });
  descriptions.push({ ...program, expected: { kind: "completed" } });
}
const built = createNativeBatchBuilder(snapshot, true)(cases);
if (!built.ok) throw Error(JSON.stringify(built.outcome));
const binary = join(directory, "await-chains"),
  fixture = join(directory, "cases.json");
writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
writeFileSync(
  fixture,
  JSON.stringify(
    {
      kind: "native-await-chains-fixture",
      conformance: false,
      cases: descriptions,
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
