import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createObject,createErrorRealm,installTemporalIntrinsics,getOwnProperty,viewObjectValue,type OrdinaryObject,type ObjectHooks,type ScriptPropertyKey} from "object";
import {formatInteger} from "integer";
export function run():number {
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):unknown=>{throw 1;}};
 const root=createObject<ScriptPropertyKey,unknown>(undefined),realm=createErrorRealm(root,hooks);
 installTemporalIntrinsics(root,realm,hooks);
 const temporal=viewObjectValue(getOwnProperty<ScriptPropertyKey,unknown>(root,"Temporal")?.value,root);
 if(temporal===undefined)return 2;
 const now=viewObjectValue(getOwnProperty<ScriptPropertyKey,unknown>(temporal,"Now")?.value,root);
 if(now===undefined)return 3;
 const instant=viewObjectValue(getOwnProperty<ScriptPropertyKey,unknown>(now,"instant")?.value,root);
 const call=instant?.internalCall;
 if(call===undefined)return 4;
 for(const item of [{clock:-1e20,expected:"-8640000000000000000000"},{clock:-0.25,expected:"-1000000"},{clock:0.75,expected:"0"},{clock:123456789.5,expected:"123456789000000"},{clock:1e20,expected:"8640000000000000000000"}]){
  if(item===undefined)return 5;
  let reads=0;const clock=item.clock;
  realm.wallClockMilliseconds=():number=>{reads++;return clock;};
  const first=viewObjectValue(call(null,[]),root);
  const epoch=first?.internalTemporalInstant;
  if(first===undefined||epoch===undefined||first.prototype!==realm.temporalInstantPrototype||formatInteger(epoch.integer,10)!==item.expected||reads!==1)return 6;
  if(call(undefined,[])===first)return 7;
 }
 let clocks=0,zones=0;
 realm.wallClockMilliseconds=():number=>{clocks++;return -0.25;};
 realm.systemTimeZoneIdentifier=():string=>{zones++;return "+05:30";};
 function invoke(target:OrdinaryObject<ScriptPropertyKey,unknown>,name:string,args:unknown[]):unknown {
   const method=viewObjectValue(getOwnProperty<ScriptPropertyKey,unknown>(target,name)?.value,root);
   const run=method?.internalCall;if(run===undefined)throw "NOW_METHOD_INVARIANT";
   return run(null,args);
 }
 if(invoke(now,"timeZoneId",[])!=="+05:30"||clocks!==0||zones!==1)return 9;
 for(const name of ["plainDateTimeISO","zonedDateTimeISO","plainDateISO","plainTimeISO"]){
  if(name===undefined)return 10;clocks=0;zones=0;
  const object=viewObjectValue(invoke(now,name,[]),root);if(object===undefined||clocks!==1||zones!==1)return 11;
  if(name==="zonedDateTimeISO"){
   const data=object.internalTemporalZonedDateTime;
   if(data===undefined||data.dateTime.hour!==5||data.dateTime.minute!==29||data.dateTime.nanosecond!==999000000||object.prototype!==realm.temporalZonedDateTimePrototype)return 12;
  }else if(name==="plainDateISO"){
   const data=object.internalTemporalPlainDate;if(data===undefined||data.year!==1970||data.day!==1||object.prototype!==realm.temporalPlainDatePrototype)return 13;
  }else if(name==="plainTimeISO"){
   const data=object.internalTemporalPlainTime;if(data===undefined||data.hour!==5||data.minute!==29||data.nanosecond!==999000000||object.prototype!==realm.temporalPlainTimePrototype)return 14;
  }else{
   const data=object.internalTemporalPlainDateTime;if(data===undefined||data.hour!==5||data.nanosecond!==999000000||object.prototype!==realm.temporalPlainDateTimePrototype)return 15;
  }
 }
 clocks=0;zones=0;const utc=viewObjectValue(invoke(now,"zonedDateTimeISO",["UTC"]),root);
 if(utc?.internalTemporalZonedDateTime?.dateTime.date.year!==1969||clocks!==1||zones!==0)return 16;
 clocks=0;let invalid=false;try{invoke(now,"plainDateTimeISO",[null]);}catch(error){const object=viewObjectValue(error,root);invalid=object!==undefined&&object.prototype===realm.prototypes.get("type");}
 if(!invalid||clocks!==0)return 17;
 realm.wallClockMilliseconds=undefined;
 let caught=false;try{call(null,[]);}catch(error){caught=true;}
 if(!caught||!realm.unsupported)return 8;
 return 42;
}`,
  "temporal-now",
  [
    ["object", "packages/js-runtime/src/objects/index.ts"],
    ["integer", "packages/foundation/src/numeric/big-integer.ts"],
  ],
  [],
  ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"].map((name) => ({
    module: "packages/js-runtime/src/objects/index.ts",
    name,
    operation: "view",
  })),
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
);
