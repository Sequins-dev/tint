import { verifyHostedFixture } from "./hosted-fixture.ts";
// collectGarbage (the Test262 host's $262.gc, and tint:ffi's external storage
// under memory pressure) must run a real full collection through the runtime
// collector: an object reachable only from a weak slot is cleared while
// strongly held data survives relocation, under the copying and generational
// runtimes (a forced collection keeps layouts stable, so generational
// mutators may bind it).
const weak = "packages/native-runtime/src/intrinsics/weak.ts",
  memory = "packages/native-runtime/src/intrinsics/memory.ts";
const joined = (prefix: string) =>
  Array.from({ length: 1000 }, (_, i) => prefix + i).join("|").length;
const copying = `import {createWeakSlot,weakSlotKey} from "weak";
import {collectGarbage} from "memory";
function weaklyHeld():unknown{const fresh:string[]=["fresh-"+String(7)];return createWeakSlot(fresh,undefined,false);}
export function run():number{
 const kept:string[]=[];
 for(let i=0;i<1000;i++)kept.push("kept-"+String(i));
 const cell=weaklyHeld();
 const strong:string[]=["strong"];
 const strongCell=createWeakSlot(strong,undefined,false);
 if(weakSlotKey(cell)===undefined)return 1;
 collectGarbage();
 if(weakSlotKey(cell)!==undefined)return 2;
 if(weakSlotKey(strongCell)!==strong||strong[0]!=="strong")return 3;
 for(let i=0;i<1000;i++)if(kept[i]!=="kept-"+String(i))return 4;
 for(let round=0;round<3;round++)collectGarbage();
 const after:string[]=[];
 for(let i=0;i<1000;i++)after.push("after-"+String(i));
 if(after.join("|").length!==${joined("after-")})return 5;
 if(kept[999]!=="kept-999"||weakSlotKey(strongCell)!==strong)return 6;
 return 42;
}`;
const common = {
  managedBytes: 4194304,
  allocationCapacity: 65536,
  rootCapacity: 8192,
  stackBytes: 2097152,
  hostBindings: [
    { module: memory, name: "collectGarbage", operation: "collect-garbage" },
  ],
} as const;
verifyHostedFixture(
  copying,
  "collect-garbage-copying",
  [
    ["weak", weak],
    ["memory", memory],
  ],
  [],
  [],
  [
    { module: weak, namespace: "weak-storage" },
    { module: memory, namespace: "native-memory" },
  ],
  {
    ...common,
    runtimeEntry: "initializeCopyingRuntime",
    weakBindings: [
      { module: weak, name: "createWeakSlot", operation: "new" },
      { module: weak, name: "weakSlotKey", operation: "key" },
    ],
  },
);
verifyHostedFixture(
  copying,
  "collect-garbage-generational",
  [
    ["weak", weak],
    ["memory", memory],
  ],
  [],
  [],
  [
    { module: weak, namespace: "weak-storage" },
    { module: memory, namespace: "native-memory" },
  ],
  {
    ...common,
    runtimeEntry: "initializeGenerationalRuntime",
    weakBindings: [
      { module: weak, name: "createWeakSlot", operation: "new" },
      { module: weak, name: "weakSlotKey", operation: "key" },
    ],
  },
);
