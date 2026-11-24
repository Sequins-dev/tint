import { verifyHostedFixture } from "./hosted-fixture.ts";

// Run with TINT_HOSTED_NATIVE_SERVICES=aot to exercise exact root sharing in a
// composed image, including allocation, aliased records and copying collection.
verifyHostedFixture(
  `import {createObject} from "objects";
interface Left{value:number;next:Left|undefined;}
interface Right{value:number;next:Right|undefined;}
export function run():number{
 const marker=createObject<string,number>(undefined);if(marker.prototype!==undefined)return 8;
 const left:Left[]=[{value:7,next:undefined},{value:3,next:{value:5,next:undefined}}];
 const right:Right[]=[{value:11,next:undefined},{value:2,next:{value:13,next:undefined}}];
 left.sort((a,b):number=>a.value-b.value);right.reverse();
 const moved=right[1];if(moved===undefined)return 1;left.push(moved);
 const removed=left.splice(1,1);if(removed[0]?.value!==7)return 2;
 const first=left[0];if(first===undefined)return 3;
 const next=first.next;if(next===undefined)return 3;next.value=6;
 if(moved===undefined)return 9;moved.value=17;
 for(let i=0;i<1024;i++){const bytes=new Uint32Array(8192);bytes[0]=i;if(bytes[0]!==i)return 4;}
 const a=left[0],b=left[1],c=right[0],d=right[1];
 if(a===undefined||b===undefined||c===undefined||d===undefined)return 5;
 if(a.value!==3||a.next?.value!==6||c.value!==2||c.next?.value!==13)return 6;
 if(b!==d||b.value!==17||removed[0]?.value!==7)return 7;
 return 42;
}`,
  "runtime-shared-collections",
  [["objects", "packages/js-runtime/src/objects/index.ts"]],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 8388608,
    allocationCapacity: 1048576,
    stackBytes: 4194304,
    rootCapacity: 4096,
  },
);
