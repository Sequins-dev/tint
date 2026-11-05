import { readFileSync } from "node:fs";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const map = readFileSync(
  "packages/foundation/src/collections/linked-map.ts",
  "utf8",
).replace(
  "const entry = findMap<K, V>(map, key);",
  "const seen=new Set<K>();seen.add(key);const entry = findMap<K, V>(map, key);",
);
const set = readFileSync(
  "packages/foundation/src/collections/linked-set.ts",
  "utf8",
).replace(
  "export function createSet<T>(): LinkedSet<T> {",
  "export function createSet<T>(): LinkedSet<T> {const scratch:{value:T}[]=[];",
);
const index = readFileSync(
  "packages/foundation/src/collections/key-index.ts",
  "utf8",
);
const list = readFileSync(
  "packages/foundation/src/collections/sparse-list.ts",
  "utf8",
);
verifyHostedFixture(
  `import {createSourceText} from "source";
import {parseModule,type Module} from "syntax";
import {bindModule} from "binding";
import {linkModules,specializeModule} from "linking";
import {checkClosureModule} from "checker";
import {prepareCollectionRuntimes} from "runtime";
function parse(text:string):Module {
 const bytes=new TextEncoder().encode(text);
 const source=createSourceText(bytes,bytes.length);if(!source.ok)throw "source";
 const parsed=parseModule(source.value);if(!parsed.ok)throw "parse";
 return parsed.value;
}
export function run():number {
 const globals:string[]=["undefined","NaN","Infinity","Number","String","Math","Map","Set","Uint32Array","Float64Array"];
 const dependencies=new Map<string,string>();
 dependencies.set("./key-index.ts","key-index");dependencies.set("linked-map","linked-map");dependencies.set("linked-set","linked-set");dependencies.set("sparse-list","sparse-list");
 const linked=linkModules([
  {id:"key-index",module:parse(${JSON.stringify(index)}),dependencies:new Map<string,string>()},
  {id:"linked-map",module:parse(${JSON.stringify(map)}),dependencies},
  {id:"linked-set",module:parse(${JSON.stringify(set)}),dependencies:new Map<string,string>()},
  {id:"sparse-list",module:parse(${JSON.stringify(list)}),dependencies:new Map<string,string>()},
  {id:"main",module:parse('import "linked-map";import "linked-set";import "sparse-list";function run():number{const map=new Map<string,number>();map.set("x",42);return map.get("x")??0;}'),dependencies}
 ],"main",globals,{evaluation:"instance"});
 if(!linked.ok)return 1;
 const bound=bindModule(linked.value.module,globals);if(!bound.ok)return 2;
 const specialized=specializeModule(linked.value.module,bound.value);if(!specialized.ok)return 3;
 const checked=checkClosureModule(specialized.value.module);if(!checked.ok)return 4;
 const helpers=new Map<string,string>();
 for(const item of linked.value.exports){if(item===undefined)return 9;if(item.namespace==="value")helpers.set(item.module+":"+item.name,item.linkedName);}
 const prepared=prepareCollectionRuntimes(linked.value.module,checked.value,helpers,globals);
 if(!prepared.ok)return 5;
 const options=prepared.value.options;
 if(options.maps===undefined||options.maps.length===0)return 6;
 if(options.sets===undefined||options.sets.length===0)return 7;
 if(options.lists===undefined||options.lists.length===0)return 8;
 return 42;
}`,
  "runtime-linking",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
    ["linking", "packages/ts-native/src/modules/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["runtime", "packages/ts-native/src/runtime/index.ts"],
  ],
  [],
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
