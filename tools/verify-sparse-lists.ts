/** Native sparse-list fixture: a closed program built without dense list
 * lowering, so the foundation SparseList implementation itself executes. */
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { workspaceModules } from "./workspace-sources.ts";
import { projectRoots, projectBuildRequest } from "@tint/compiler/cli";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { buildMacOSProgram } from "@tint/compiler/build";
const fixture = `import {createList,readList,writeList,pushList,popList,lengthList,hasList,deleteList,resizeList} from "@tint/foundation/collections/sparse-list";
interface Box {readonly id:number;}
export function run():number {
 const list=createList<Box|undefined>(0);
 const size=600;
 // Reference: state 0 hole, 1 stored undefined, 2 value with ids[i].
 const states=new Uint8Array(size),ids=new Float64Array(size);
 let length=0,seed=12345;
 function check(code:number):number{
  if(lengthList<Box|undefined>(list)!==length)return code;
  for(let i=0;i<size;i++){
   const v=readList<Box|undefined>(list,i),present=hasList<Box|undefined>(list,i),state=i<length?states[i]:0;
   if(present!==(state!==0))return code+1;
   if(state===2){if(v===undefined||v.id!==ids[i])return code+2;}
   else if(v!==undefined)return code+3;
  }
  return 0;
 }
 for(let step=0;step<20000;step++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const op=(seed>>>24)%7,index=(seed>>>8)%size;
  if(op<=2){
   const stored=op===0?undefined:{id:step};
   writeList<Box|undefined>(list,index,stored);
   states[index]=stored===undefined?1:2;ids[index]=step;
   if(index>=length)length=index+1;
  }else if(op===3){
   if(length<size){const box={id:step};const n=pushList<Box|undefined>(list,box);states[length]=2;ids[length]=step;length++;if(n!==length)return 3;}
  }else if(op===4){
   const v=popList<Box|undefined>(list);
   if(length>0){length--;const state=states[length];states[length]=0;if(state===2){if(v===undefined||v.id!==ids[length])return 4;}else if(v!==undefined)return 5;}
   else if(v!==undefined)return 6;
  }else if(op===5){
   const had=index<length&&states[index]!==0;
   if(deleteList<Box|undefined>(list,index)!==had)return 7;
   if(index<length)states[index]=0;
  }else{
   const next=index%3===0?0:index;
   if(next<length){for(let i=next;i<length;i++)states[i]=0;length=next;resizeList<Box|undefined>(list,next);}
  }
  for(let j=0;j<3;j++){const garbage=new Uint32Array(64);garbage[0]=j;if(garbage[0]!==j)return 8;}
  if(step%997===0){const failed=check(100);if(failed!==0)return failed;}
 }
 const failed=check(200);if(failed!==0)return failed;
 const far=createList<string>(0);
 const indices=[7,8,63,64,511,512,4095,4096,2147483647,2147483648,4294967294];
 for(let k=0;k<indices.length;k++){const i=indices[k];if(i===undefined)return 19;writeList<string>(far,i,"v"+String(i));}
 for(let k=0;k<indices.length;k++){const i=indices[k];if(i===undefined)return 19;if(readList<string>(far,i)!=="v"+String(i)||!hasList<string>(far,i))return 20;if(hasList<string>(far,i+1)&&indices.indexOf(i+1)<0)return 21;}
 if(lengthList<string>(far)!==4294967295||readList<string>(far,4294967293)!==undefined||readList<string>(far,1000)!==undefined)return 22;
 resizeList<string>(far,4096);if(readList<string>(far,4095)!=="v4095"||hasList<string>(far,4096)||hasList<string>(far,2147483648))return 23;
 resizeList<string>(far,4294967295);if(hasList<string>(far,4294967294)||readList<string>(far,4294967294)!==undefined)return 24;
 const removed=[7,8,63,64,511,512,4095];for(let k=0;k<removed.length;k++){const i=removed[k];if(i===undefined||!deleteList<string>(far,i))return 25;}
 if(lengthList<string>(far)!==4294967295||hasList<string>(far,7))return 26;
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
        "@tint/foundation/collections/sparse-list",
        "packages/foundation/src/collections/sparse-list.ts",
      ],
    ]),
  },
];
const request = {
  ...projectBuildRequest(modules, () => {}),
  entry: "fixture",
  start: "run",
  denseReferenceLists: false,
  managedBytes: 32768,
  controlBytes: 2097152,
  allocationCapacity: 4096,
  rootCapacity: 4096,
  stackBytes: 1048576,
  identifier: "tint-sparse-lists",
  debugSymbols: process.env.TINT_DEBUG === "1",
};
const built = buildMacOSProgram(request);
assert.ok(built.ok, JSON.stringify(built));
const directory = mkdtempSync(join(tmpdir(), "tint-sparse-lists-")),
  path = join(directory, "runtime");
try {
  const nodePath = join(directory, "reference.ts");
  writeFileSync(
    nodePath,
    fixture.replace(
      "@tint/foundation/collections/sparse-list",
      new URL(
        "../packages/foundation/src/collections/sparse-list.ts",
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
      "Verified the sparse list runtime natively against a typed-array reference and Node: 20000 random reads/writes/pushes/pops/deletes/truncations with presence, stored undefined, distant indices to 2**32-2 and repeated moving GC, twice under LLDB.",
    );
} finally {
  if (process.env.TINT_BUILD_ONLY !== "1")
    rmSync(directory, { recursive: true, force: true });
}
