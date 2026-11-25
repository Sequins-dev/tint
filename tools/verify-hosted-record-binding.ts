import { verifyHostedFixture } from "./hosted-fixture.ts";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
const bytes = new TextEncoder().encode(
  'export interface Box {value:number} export function descriptor(value:unknown,witness:Box):number{throw "UNBOUND_RECORD_DESCRIPTOR";} export function matches(value:unknown,witness:Box):boolean{throw "UNBOUND_RECORD_TEST";} export function view(value:unknown,witness:Box):Box|undefined{throw "UNBOUND_RECORD_VIEW";}',
);
const source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const runtime = parseModule(source.value);
assert.ok(runtime.ok);
verifyHostedFixture(
  `
import {matches,view,descriptor,type Box} from "record-runtime";
export function run():number{
 const box:Box={value:42};
 const other={text:"different"};
 const address=descriptor(box,box);
 if(!Number.isSafeInteger(address)||address<=0||descriptor({value:1},box)!==address)return 7;
 if(descriptor(other,box)!==-1||descriptor(null,box)!==-1||descriptor(undefined,box)!==-1||descriptor(42,box)!==-1||descriptor("text",box)!==-1||descriptor(false,box)!==-1)return 8;
 if(!matches(box,box)||!matches({value:1},box))return 1;
 if(matches(other,box)||matches(null,box)||matches(undefined,box)||matches(42,box)||matches("text",box)||matches(false,box))return 2;
 const stored:unknown=box;
 if(!matches(stored,box))return 3;
 const checked=view(stored,box);
 if(checked===undefined||checked!==box||checked.value!==42)return 4;
 checked.value=19;
 if(box.value!==19)return 5;
 if(view(other,box)!==undefined||view(null,box)!==undefined||view(undefined,box)!==undefined||view(42,box)!==undefined||view("text",box)!==undefined||view(false,box)!==undefined)return 6;
 for(let i=0;i<200;i++){const garbage=new Uint32Array(8192);garbage[0]=i;if(garbage[0]!==i)return 9;}
 if(descriptor(box,box)!==address||box.value!==19)return 10;
 return 42;
}`,
  "record-binding",
  [["record-runtime", "record-runtime"]],
  [{ id: "record-runtime", module: runtime.value, dependencies: new Map() }],
  [
    { module: "record-runtime", name: "descriptor", operation: "descriptor" },
    { module: "record-runtime", name: "matches", operation: "test" },
    { module: "record-runtime", name: "view", operation: "view" },
  ],
  [{ module: "record-runtime", namespace: "record-test-runtime" }],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 4194304,
    allocationCapacity: 65536,
  },
);
