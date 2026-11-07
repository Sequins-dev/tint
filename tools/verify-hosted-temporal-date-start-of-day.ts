import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createObject,createErrorRealm,installTemporalIntrinsics,createNamedTimeZoneProvider,viewBigIntValue,bigIntToString,viewObjectValue,getProperty,createDataProperty,type OrdinaryObject,type ObjectHooks,type ScriptPropertyKey} from "objects";
import {readTimeZoneIdentifiers} from "zone-ids";
type Obj=OrdinaryObject<ScriptPropertyKey,unknown>;
function object(value:unknown,root:Obj):Obj{const result=viewObjectValue(value,root);if(result===undefined)throw "OBJECT";return result;}
function invoke(fn:Obj,receiver:unknown,args:readonly unknown[]):unknown{const call=fn.internalCall;if(call===undefined)throw "CALL";return call(receiver,args);}
function get(value:Obj,key:string,hooks:ObjectHooks<unknown>):unknown{return getProperty<ScriptPropertyKey,unknown>(value,key,value,hooks);}
function set(value:Obj,key:string,item:unknown,hooks:ObjectHooks<unknown>):void{if(!createDataProperty<ScriptPropertyKey,unknown>(value,key,item,hooks))throw "PROPERTY";}
export function run():number{
 const bytes=new Uint8Array(74),view=new DataView(bytes.buffer);bytes.set([84,90,105,102]);view.setUint32(32,2);view.setUint32(36,2);view.setUint32(40,8);view.setInt32(44,0);view.setInt32(48,100000);bytes[52]=1;bytes[53]=1;view.setInt32(54,-1800);view.setInt32(60,1800);bytes[64]=1;bytes[65]=4;bytes.set([66,69,70,0,65,70,84,0],66);
 const metadata=readTimeZoneIdentifiers("Z Test/Midnight 0 - X");if(!metadata.ok)return 1;
 const root=createObject<ScriptPropertyKey,unknown>(undefined),hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(target,receiver,args):unknown=>invoke(object(target,root),receiver,args)},realm=createErrorRealm(root,hooks);realm.namedTimeZones=createNamedTimeZoneProvider(metadata.value,(name):Uint8Array|undefined=>bytes);installTemporalIntrinsics(root,realm,hooks);
 const temporal=object(get(root,"Temporal",hooks),root),dateCtor=object(get(temporal,"PlainDate",hooks),root),construct=dateCtor.internalConstruct;if(construct===undefined)return 2;
 const date=object(construct([1970,1,1,"gregory"],dateCtor),root),method=object(get(date,"toZonedDateTime",hooks),root),start=object(invoke(method,date,["Test/Midnight"]),root),epoch=viewBigIntValue(get(start,"epochNanoseconds",hooks));if(epoch===undefined||bigIntToString(epoch,10)!=="0"||get(start,"minute",hooks)!==30||get(start,"calendarId",hooks)!=="gregory")return 3;
 const options=createObject<ScriptPropertyKey,unknown>(undefined);set(options,"timeZone","Test/Midnight",hooks);const implicit=object(invoke(method,date,[options]),root),implicitEpoch=viewBigIntValue(get(implicit,"epochNanoseconds",hooks));if(implicitEpoch===undefined||bigIntToString(implicitEpoch,10)!=="0")return 4;
 const timeCtor=object(get(temporal,"PlainTime",hooks),root),constructTime=timeCtor.internalConstruct;if(constructTime===undefined)return 5;set(options,"plainTime",constructTime([],timeCtor),hooks);const explicit=object(invoke(method,date,[options]),root),explicitEpoch=viewBigIntValue(get(explicit,"epochNanoseconds",hooks));if(explicitEpoch===undefined||bigIntToString(explicitEpoch,10)!=="1800000000000"||get(explicit,"hour",hooks)!==1)return 6;
 return 42;
}`,
  "temporal-date-start-of-day",
  [["objects", "packages/js-runtime/src/objects/index.ts"]],
  [],
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewObjectValue",
      operation: "view",
    },
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewSymbolValue",
      operation: "view",
    },
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewBigIntValue",
      operation: "view",
    },
  ],
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
