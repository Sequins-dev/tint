import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const parsed = parseModule(
  createSourceTextView(`export interface Box{readonly value:number;}
export interface Unallocated{readonly label:string;readonly next:Unallocated|undefined;}
export function identity(witness:Box|undefined):number{throw "UNBOUND";}
export function unallocated(witness:Unallocated|undefined):number{throw "UNBOUND";}
export function descriptor(value:unknown,witness:Box):number{throw "UNBOUND";}
export function unbound(witness:Box|undefined):number{throw "UNBOUND";}`),
);
assert.ok(parsed.ok, JSON.stringify(parsed));
verifyHostedFixture(
  `import {identity,unallocated,descriptor,unbound,type Box} from "identities";
export function run():number{
 const first=identity(undefined),unused=unallocated(undefined);
 if(first<=0||unused<=0||first===unused)return 1;
 const box:Box={value:42};if(descriptor(box,box)!==first)return 2;if(identity(box)!==first)return 6;
 let rejected=false;try{unbound(undefined);}catch(error){rejected=error==="UNBOUND";}if(!rejected)return 3;
 for(let i=0;i<640;i++){const garbage=new Uint32Array(8192);garbage[0]=i;if(garbage[0]!==i)return 4;}
 if(identity(undefined)!==first||unallocated(undefined)!==unused||descriptor(box,box)!==first)return 5;
 return 42;
}`,
  "record-identity",
  [["identities", "identities"]],
  [{ id: "identities", module: parsed.value, dependencies: new Map() }],
  [
    { module: "identities", name: "identity", operation: "identity" },
    { module: "identities", name: "unallocated", operation: "identity" },
    { module: "identities", name: "descriptor", operation: "descriptor" },
  ],
  [{ module: "identities", namespace: "record-identities" }],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 8388608,
    allocationCapacity: 262144,
    rootCapacity: 4096,
    stackBytes: 8388608,
  },
);
