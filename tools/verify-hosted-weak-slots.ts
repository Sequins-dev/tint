import { verifyHostedFixture } from "./hosted-fixture.ts";
const module = "packages/native-runtime/src/intrinsics/weak.ts";
verifyHostedFixture(
  `import {createWeakSlot,weakSlotKey,weakSlotValue,setWeakSlotValue,clearWeakSlot} from "weak";
function makeDead():unknown{return createWeakSlot({value:1},23,true);}
function makeCycle():unknown{const key={value:2};return createWeakSlot(key,key,true);}
function pressure():void{
 for(let i=0;i<50000;i++){
  const cell=createWeakSlot(i,0,false);
  if(weakSlotKey(cell)!==i||weakSlotValue(cell)!==undefined)throw "weak scalar";
 }
}
export function run():number{
 const key={value:3},live=createWeakSlot(key,19,true),dead=makeDead(),cycle=makeCycle();
 if(weakSlotKey(live)!==key||weakSlotValue(live)!==19)return 1;
 setWeakSlotValue(live,42);if(weakSlotValue(live)!==42)return 2;
 pressure();
 if(weakSlotKey(live)!==key||weakSlotValue(live)!==42)return 3;
 if(weakSlotKey(dead)!==undefined||weakSlotValue(dead)!==undefined)return 4;
 if(weakSlotKey(cycle)!==undefined||weakSlotValue(cycle)!==undefined)return 5;
 clearWeakSlot(live);if(weakSlotKey(live)!==undefined||weakSlotValue(live)!==undefined)return 6;
 return 42;
}`,
  "weak-slots",
  [["weak", module]],
  [],
  [],
  [{ module, namespace: "weak-storage" }],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 1048576,
    allocationCapacity: 65536,
    weakBindings: [
      { module, name: "createWeakSlot", operation: "new" },
      { module, name: "weakSlotKey", operation: "key" },
      { module, name: "weakSlotValue", operation: "value" },
      { module, name: "setWeakSlotValue", operation: "set-value" },
      { module, name: "clearWeakSlot", operation: "clear" },
    ],
  },
);
