import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { workspaceModules } from "./workspace-sources.ts";
import { projectRoots, projectBuildRequest } from "@tint/compiler/cli";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { buildMacOSProgram } from "@tint/compiler/build";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
const nativeBench = "packages/bench/src/native.ts",
  clock = "packages/native-runtime/src/intrinsics/clock.ts";
const entrySource = String.raw`
import {registerBenchmarks} from "workloads";
import {runBenchmarks} from "native-bench";
import {monotonicMilliseconds} from "native-clock";
import {createNativeFileHost} from "native-fs";
import {writeAll} from "sync-io";
function quote(text:string):string {
 const hex="0123456789abcdef";let output="\"";
 for(let i=0;i<text.length;i++){
  const code=text.charCodeAt(i),character=text.slice(i,i+1);
  if(code===34 || code===92)output+="\\"+character;
  else if(code<32 || (code>=55296 && code<=57343)) {
   output+="\\u";
   for(let shift=12;shift>=0;shift-=4)output+=hex.slice((code>>>shift)&15,((code>>>shift)&15)+1);
  } else output+=character;
 }
 return output+"\"";
}
export function run():number {
 const host=createNativeFileHost();
 function output(fd:number,text:string):void {
  const bytes=new TextEncoder().encode(text+"\n"),written=writeAll(buffer=>host.write(fd,buffer),bytes);
  if(!written.ok)throw "BENCHMARK_OUTPUT_FAILED";
 }
 try {
  registerBenchmarks();
  const completed=runBenchmarks(()=>monotonicMilliseconds(),result=>{
   for(let i=0;i<result.samples.length;i++){
    const sample=result.samples[i];if(sample===undefined)throw "missing benchmark sample";
    output(1,"{\"name\":"+quote(result.name)+",\"index\":"+i+",\"duration_ns\":"+sample.duration_ns+",\"operations\":"+sample.operations+"}");
   }
  });
  output(1,"{\"completed\":"+completed+"}");return 0;
 }catch(error){output(2,typeof error==="string"?error:"BENCHMARK_FAILED");return 1;}
}
`;
mkdirSync(".tint-bench", { recursive: true });
writeFileSync(".tint-bench/native-entry.ts", entrySource);
const modules = [...workspaceModules([...projectRoots(), nativeBench, clock])];
modules.push({
  id: "benchmarks/runtime.bench.ts",
  module: parse(readFileSync("benchmarks/runtime.bench.ts", "utf8")),
  dependencies: new Map([
    ["node:bench", nativeBench],
    [
      "@tint/native-runtime/allocators/region",
      "packages/native-runtime/src/allocators/region/index.ts",
    ],
    [
      "@tint/foundation/binary/sha256",
      "packages/foundation/src/binary/sha256.ts",
    ],
    ["@tint/typescript/types", "packages/typescript/src/types/index.ts"],
  ]),
});
modules.push({
  id: ".tint-bench/native-entry.ts",
  dependencies: new Map([
    ["workloads", "benchmarks/runtime.bench.ts"],
    ["native-bench", nativeBench],
    ["native-clock", clock],
    ["native-fs", "packages/platform/src/darwin/fs.ts"],
    ["sync-io", "packages/platform/src/io/sync.ts"],
  ]),
  module: parse(entrySource),
});
const request = projectBuildRequest(modules, () => {});
const result = buildMacOSProgram({
  ...request,
  entry: ".tint-bench/native-entry.ts",
  start: "run",
  runtimes: [...request.runtimes, { module: clock, namespace: "native-clock" }],
  hostBindings: [
    ...request.hostBindings,
    {
      module: clock,
      name: "monotonicMilliseconds",
      operation: "monotonic-time",
    },
  ],
  managedBytes: 33554432,
  allocationCapacity: 1048576,
  rootCapacity: 16384,
  stackBytes: 8388608,
  identifier: "tint-benchmarks",
  debugSymbols: true,
  debugDirectory: resolve("."),
});
assert.ok(result.ok, JSON.stringify(result));
const output = resolve(process.argv[2] ?? ".tint-bench/runtime-native");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, result.value, { mode: 0o755 });
console.log(output);
