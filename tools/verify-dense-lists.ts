import { nativeFixtureTarget } from "./native-host-target.ts";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { workspaceModules } from "./workspace-sources.ts";
import { projectRoots, projectBuildRequest } from "@tint/compiler/cli";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { compileArm64Program } from "@tint/compiler/native";
import { buildMacOSProgram } from "@tint/compiler/build";
const fixture = `import {createKeyIndex} from "@tint/foundation/collections/key-index";
interface Value {value:number;next:Value|undefined;}
export function run():number {
 const words:string[]=["first","second"];words[33]="last";
 if(words[1]!=="second"||words[20]!==undefined||words[33]!=="last")return 20;
 words.splice(1);if(words[1]!==undefined)return 21;
 const mixed:(number|string)[]=[42,"answer"];mixed[19]=71;
 if(mixed[0]!==42||mixed[1]!=="answer"||mixed[10]!==undefined||mixed[19]!==71)return 22;
 mixed.splice(1);if(mixed[1]!==undefined)return 23;
 const flags:boolean[]=[false,true];flags[33]=false;
 if(flags[0]!==false||flags[1]!==true||flags[20]!==undefined||flags[33]!==false)return 31;
 flags.splice(1);if(flags[1]!==undefined)return 32;
 const states:(boolean|undefined)[]=[false,undefined,true];states[33]=undefined;
 let stateCount=0;states.map((value):boolean|undefined=>{stateCount++;return value;});
 if(stateCount!==4||states[0]!==false||states[10]!==undefined||states[33]!==undefined)return 33;
 const a:Value={value:19,next:undefined},b:Value={value:23,next:a};a.next=b;
 const index=createKeyIndex<string,Value>((key)=>key.length);
 index.set("aa",a);index.set("bb",b);
 const values:(Value|undefined)[]=[];
 values[0]=a;values[2]=undefined;
 if(values[0]!==a||values[1]!==undefined||values[2]!==undefined||values.length!==3)return 1;
 let present=0;values.map((value):Value|undefined=>{present++;return value;});if(present!==2)return 13;
 values.pop();if(values[2]!==undefined)return 2;
 values[7]=undefined;
 values[33]=b;values[0]=b;if(values[0]!==b||values[33]!==b)return 3;
 let grown=0;values.map((value):Value|undefined=>{grown++;return value;});if(grown!==3||values[7]!==undefined)return 26;
 values.splice(2);values[39]=undefined;if(values[33]!==undefined)return 4;
 values.splice(0);
 for(let i=0;i<16;i++)values.push(i%2===0?a:b);
 const markers:(Value|undefined)[]=[undefined];markers[33]=a;
 const arrays:(Value|undefined)[][]=[values];if(arrays[0]!==values)return 27;
 const get=():number=>{const v=values[0];return v===undefined?0:v.value;};
 for(let i=0;i<200;i++){
  values[i%16]={value:i,next:a};
  for(let j=0;j<20;j++){const garbage=new Uint32Array(50);garbage[0]=j;if(garbage[0]!==j)return 5;}
  const v=values[i%16];if(v===undefined||v.value!==i||v.next!==a||a.next!==b||b.next!==a)return 6;
  if(markers[0]!==undefined||markers[33]!==a)return 28;
  const first=values[0];if(first===undefined||get()!==first.value)return 7;
 }
 if(flags[0]!==false||states[0]!==false||states[2]!==true||states[33]!==undefined)return 34;
 stateCount=0;states.map((value):boolean|undefined=>{stateCount++;return value;});if(stateCount!==4)return 35;
 const copy=values.slice();copy.sort((x,y)=>{if(x===undefined||y===undefined)return 0;return x.value-y.value;});
 const low=copy[0],high=copy[15];if(low===undefined||high===undefined||low.value!==184||high.value!==199)return 8;
 let marked=0;markers.map((value):Value|undefined=>{marked++;return value;});if(marked!==2)return 29;
 values[31]=undefined;
 values[1000000]=a;if(values.length!==1000001||values[1000000]!==a)return 9;
 let migrated=0;values.slice(30,32).map((value):Value|undefined=>{migrated++;return value;});if(migrated!==1||values[31]!==undefined)return 30;
 const av=index.get("aa"),bv=index.get("bb");if(av!==a||bv!==b||!index.delete("aa")||index.has("aa")||index.get("bb")!==b)return 24;index.clear();if(index.has("bb"))return 25;
 const popped=values.pop();if(popped!==a||values[1000000]!==undefined||values.length!==1000000)return 10;
 return 42;
}`;
const bytes = new TextEncoder().encode(fixture),
  source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok, JSON.stringify(parsed));
const modules = [
  ...workspaceModules(projectRoots()),
  {
    id: "fixture",
    module: parsed.value,
    dependencies: new Map<string, string>([
      [
        "@tint/foundation/collections/key-index",
        "packages/foundation/src/collections/key-index.ts",
      ],
    ]),
  },
];
const request = {
  ...projectBuildRequest(modules, () => {}),
  entry: "fixture",
  start: "run",
  denseReferenceLists: true,
  managedBytes: 32768,
  controlBytes: 2097152,
  allocationCapacity: 4096,
  rootCapacity: 4096,
  stackBytes: 1048576,
  identifier: "tint-dense-lists",
  debugSymbols: process.env.TINT_DEBUG === "1",
};
const probe = compileArm64Program({
  modules,
  entry: "fixture",
  exports: ["run"],
  start: "run",
  runtimes: request.runtimes,
  hostBindings: request.hostBindings,
  closedProgram: true,
  denseReferenceLists: true,
  linearAllocation: true,
  generationalBarriers: true,
});
assert.ok(probe.ok, JSON.stringify(probe));
assert.ok(
  probe.value.optimization.some(
    (p) => p.pass === "dense-reference-lists" && p.rewritten > 0,
  ),
  "dense representation was not selected",
);
const built = buildMacOSProgram({ ...request, target: nativeFixtureTarget() });
assert.ok(built.ok, JSON.stringify(built));
const directory = mkdtempSync(join(tmpdir(), "tint-dense-lists-")),
  path = join(directory, "runtime");
try {
  const nodePath = join(directory, "reference.ts");
  writeFileSync(
    nodePath,
    fixture.replace(
      "@tint/foundation/collections/key-index",
      new URL(
        "../packages/foundation/src/collections/key-index.ts",
        import.meta.url,
      ).href,
    ) + "\nif(run()!==42)throw Error('Node reference failed');\n",
  );
  const reference = spawnSync(process.execPath, [nodePath], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(reference.error, undefined);
  assert.equal(reference.status, 0, reference.stdout + reference.stderr);
  writeFileSync(path, built.value, { mode: 0o755 });
  console.log(path);
  for (let i = 0; i < (process.env.TINT_BUILD_ONLY === "1" ? 0 : 2); i++) {
    const result = spawnSync(
      "/usr/bin/lldb",
      [
        "--no-lldbinit",
        "--batch",
        "-o",
        "settings set target.disable-aslr false",
        "-o",
        "process launch --stop-at-entry",
        "-o",
        "script assert lldb.process.GetState() == lldb.eStateStopped",
        "-o",
        "continue",
        "-o",
        "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
        path,
      ],
      { encoding: "utf8", timeout: 60000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /exited with status = 42 /, result.stdout);
  }
  if (process.env.TINT_BUILD_ONLY !== "1")
    console.log(
      "Verified source dense arrays against Node with holes, undefined, aliases, closures, sorting, shrink/regrow, sparse migration and repeated moving GC twice under LLDB.",
    );
} finally {
  if (process.env.TINT_BUILD_ONLY !== "1")
    rmSync(directory, { recursive: true, force: true });
}
