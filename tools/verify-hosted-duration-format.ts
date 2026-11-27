import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  intlFormatRecordBindings,
  intlFormatViewNames,
} from "./intl-format-views.ts";
verifyHostedFixture(
  `import {createObject,createErrorRealm,installIntlIntrinsics,installTemporalIntrinsics,viewObjectValue,getProperty,createDataProperty,type OrdinaryObject,type ObjectHooks,type ScriptPropertyKey} from "objects";
type Obj=OrdinaryObject<ScriptPropertyKey,unknown>;
function object(value:unknown,root:Obj):Obj{const result=viewObjectValue(value,root);if(result===undefined)throw "OBJECT";return result;}
function invoke(fn:Obj,receiver:unknown,args:readonly unknown[]):unknown{const call=fn.internalRareSlots?.internalCall;if(call===undefined)throw "CALL";return call(receiver,args);}
function get(value:Obj,key:string,hooks:ObjectHooks<unknown>):unknown{return getProperty<ScriptPropertyKey,unknown>(value,key,value,hooks);}
function set(value:Obj,key:string,item:unknown,hooks:ObjectHooks<unknown>):void{if(!createDataProperty<ScriptPropertyKey,unknown>(value,key,item,hooks))throw "PROPERTY";}
export function run():number{
 const root=createObject<ScriptPropertyKey,unknown>(undefined),hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(target,receiver,args):unknown=>invoke(object(target,root),receiver,args)},realm=createErrorRealm(root,hooks);installIntlIntrinsics(root,realm,hooks);installTemporalIntrinsics(root,realm,hooks);
 const intl=object(get(root,"Intl",hooks),root),ctor=object(get(intl,"DurationFormat",hooks),root),construct=ctor.internalRareSlots?.internalConstruct;if(construct===undefined)return 1;
 const options=createObject<ScriptPropertyKey,unknown>(undefined);set(options,"style","digital",hooks);set(options,"fractionalDigits",4,hooks);
 const formatter=object(construct(["en",options],ctor),root),format=object(get(formatter,"format",hooks),root);
 if(invoke(format,formatter,["PT1H22M33.111222333S"])!=="1:22:33.1112")return 2;
 if(invoke(format,formatter,["-PT3S"])!=="-0:00:03.0000")return 3;
 const exactOptions=createObject<ScriptPropertyKey,unknown>(undefined);set(exactOptions,"seconds","numeric",hooks);
 const exact=object(construct(["en",exactOptions],ctor),root),exactFormat=object(get(exact,"format",hooks),root),bag=createObject<ScriptPropertyKey,unknown>(undefined);set(bag,"milliseconds",4503599627370497000,hooks);set(bag,"microseconds",4503599627370495000000,hooks);
 if(invoke(exactFormat,exact,[bag])!=="9007199254740991.975424")return 4;
 const partsMethod=object(get(formatter,"formatToParts",hooks),root),parts=object(invoke(partsMethod,formatter,["PT1H2M3S"]),root),first=object(get(parts,"0",hooks),root),separator=object(get(parts,"1",hooks),root);if(get(first,"unit",hooks)!=="hour"||get(separator,"unit",hooks)!==undefined)return 5;
 const fi=object(construct(["fi",options],ctor),root),fiFormat=object(get(fi,"format",hooks),root);if(invoke(fiFormat,fi,["PT1H2M3S"])!=="1.02.03,0000")return 6;
 const longOptions=createObject<ScriptPropertyKey,unknown>(undefined);set(longOptions,"style","long",hooks);const long=object(construct(["en",longOptions],ctor),root),longFormat=object(get(long,"format",hooks),root);if(invoke(longFormat,long,["P1Y2M"])!=="1 year, 2 months")return 7;
 const temporal=object(get(root,"Temporal",hooks),root),durationCtor=object(get(temporal,"Duration",hooks),root),durationConstruct=durationCtor.internalRareSlots?.internalConstruct;if(durationConstruct===undefined)return 8;
 const duration=object(durationConstruct([1,2],durationCtor),root),localeMethod=object(get(duration,"toLocaleString",hooks),root);if(invoke(localeMethod,duration,["en",longOptions])!=="1 year, 2 months")return 9;
 return 42;
}`,
  "duration-format",
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
    ...intlFormatRecordBindings("packages/js-runtime/src/objects/index.ts"),
  ],
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
        ...intlFormatViewNames,
      ],
    },
  ],
  {
    managedBytes: 268435456,
    allocationCapacity: 8388608,
    stackBytes: 16777216,
    rootCapacity: 16384,
  },
);
