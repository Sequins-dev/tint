import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `type Value=number|string|boolean|null|undefined;
interface Slot{value:Value;}
interface Trace{count:number;}
function pass(value:Value):Value{if(typeof value==="number"&&value===123)return 123;return value;}
function next(trace:Trace):Value{trace.count++;return 42;}
function fallback(value:Value,trace:Trace):Value{return value??next(trace);}
function fieldValue(slot:{readonly value:Value}):Value{return slot.value;}
function abrupt(trace:Trace):Value{trace.count++;throw 7;}
export function run():number{
 const slot:Slot={value:NaN};
 if(slot.value===slot.value)return 1;
 const narrow:{value:number}={value:41};if(fieldValue(narrow)!==41)return 20;
 slot.value=pass(-0);const zero=slot.value;if(typeof zero!=="number")return 2;if(1/zero!==-Infinity)return 2;
 slot.value=pass("a\\u0000\\ud800");const text=slot.value;if(typeof text!=="string")return 3;if(text.length!==3||text.charCodeAt(2)!==55296)return 3;
 slot.value=pass(true);if(slot.value!==true)return 4;
 slot.value=pass(undefined);if(slot.value!==undefined)return 5;
 slot.value=pass(null);if(slot.value!==null)return 6;
 const map=new Map<Value,number>();
 map.set(-0,1);map.set(0,2);map.set(NaN,3);map.set(NaN,4);map.set("x",5);map.set(true,6);map.set(undefined,7);map.set(null,8);
 if(map.size!==6||map.get(-0)!==2||map.get(NaN)!==4||map.get("x")!==5||map.get(true)!==6||map.get(undefined)!==7||map.get(null)!==8)return 8;
 const trace:Trace={count:0};
 if(fallback(pass(false),trace)!==false||fallback(pass(0),trace)!==0||fallback(pass(""),trace)!==""||trace.count!==0)return 9;
 if(fallback(pass(null),trace)!==42||fallback(pass(undefined),trace)!==42||trace.count!==2)return 10;
 try{const present=pass(0)??abrupt(trace);if(present!==0||trace.count!==2)return 11;}catch(error){return 12;}
 try{const absent=pass(null)??abrupt(trace);return 13;}catch(error){if(error!==7||trace.count!==3)return 14;}
 const optional:{value?:number|string|undefined}={};
 if(optional.value!==undefined)return 15;
 optional.value="text";if(optional.value!=="text")return 16;
 optional.value=undefined;if(optional.value!==undefined)return 17;
 const retained="moving"+text;slot.value=pass(retained);
 for(let n=0;n<100000;n++){const garbage="g"+n;if(garbage.length<1)return 18;}
 if(slot.value!==retained||map.get("x")!==5)return 19;
 return 42;
}`,
  "primitive-unions",
);
