import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
const directory = mkdtempSync(join(tmpdir(), "tint-module-direct-eval-")),
  snapshot = workspaceSources();
const programs: readonly { name: string; sources: Record<string, string> }[] = [
  {
    name: "eval retains Script grammar inside modules",
    sources: {
      "root.js": `for(const source of ['import.meta','export default 1;','import x from "./dep.js";']){let caught=false;try{eval(source);}catch(error){if(!(error instanceof SyntaxError))throw error;caught=true;}if(!caught)throw new Error('grammar');}`,
    },
  },
  {
    name: "eval reads module locals and live imports without leaking strict vars",
    sources: {
      "root.js": `import {value,bump} from './dep.js';let local=2;if(eval('value+local')!==42)throw new Error('read');eval('local=3');if(local!==3)throw new Error('write');bump();if(eval('value')!==41)throw new Error('live');let caught=false;try{eval('value=99');}catch(error){if(!(error instanceof TypeError))throw error;caught=true;}if(!caught||value!==41)throw new Error('import');eval('var hidden=1');if(typeof hidden!=='undefined')throw new Error('leak');`,
      "dep.js": `export let value=40;export function bump(){value++;}`,
    },
  },
  {
    name: "hoisted source functions evaluate in their defining module",
    sources: {
      "root.js": `import {read} from './dep.js';let value=99;if(read()!==42)throw new Error('scope');`,
      "dep.js": `let value=40;export function read(){return eval('value+2');}`,
    },
  },
  {
    name: "module eval survives top-level suspension",
    sources: {
      "root.js": `let value=40;await 0;if(eval('value+2')!==42)throw new Error('await');`,
    },
  },
  {
    name: "private method eval keeps its module site",
    sources: {
      "root.js": `class C{#value=40;read(){return eval('this.#value+2');}}if(new C().read()!==42)throw new Error('private');`,
    },
  },
  {
    name: "generator eval keeps the module environment after resume",
    sources: {
      "root.js": `let value=40;function* g(){yield 0;return eval('value+2');}const it=g();if(it.next().value!==0||it.next().value!==42)throw new Error('generator');`,
    },
  },
  {
    name: "indirect eval stays global in module code",
    sources: {
      "root.js": `let local=40;if((0,eval)('typeof local')!=='undefined'||eval('typeof local')!=='number')throw new Error('indirect');`,
    },
  },
  {
    name: "module eval preserves TDZ errors and completion after initialization",
    sources: {
      "root.js": `let caught=false;try{eval('later');}catch(error){if(!(error instanceof ReferenceError))throw error;caught=true;}if(!caught)throw new Error('tdz');let later=42;if(eval('later')!==42)throw new Error('initialized');`,
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
const binary = join(directory, "module-eval"),
  fixture = join(directory, "cases.json");
writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
writeFileSync(
  fixture,
  JSON.stringify(
    {
      kind: "native-module-direct-eval-fixture",
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
