import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createObject,createErrorRealm,installIntlIntrinsics,installTemporalIntrinsics,installPrimitiveIntrinsics,viewObjectValue,getProperty,createDataProperty,createBigIntLiteral,type OrdinaryObject,type ObjectHooks,type ScriptPropertyKey} from "objects";
type Obj=OrdinaryObject<ScriptPropertyKey,unknown>;
function object(value:unknown,root:Obj):Obj {const result=viewObjectValue(value,root);if(result===undefined)throw "OBJECT";return result;}
function invoke(fn:Obj,receiver:unknown,args:readonly unknown[]):unknown {const call=fn.internalCall;if(call===undefined)throw "CALL";return call(receiver,args);}
function construct(ctor:Obj,args:readonly unknown[],root:Obj):Obj {const call=ctor.internalConstruct;if(call===undefined)throw "CONSTRUCT";return object(call(args,ctor),root);}
function get(value:Obj,key:string,hooks:ObjectHooks<unknown>):unknown {return getProperty<ScriptPropertyKey,unknown>(value,key,value,hooks);}
function set(value:Obj,key:string,item:unknown,hooks:ObjectHooks<unknown>):void {if(!createDataProperty<ScriptPropertyKey,unknown>(value,key,item,hooks))throw "PROPERTY";}
function format(formatter:Obj,value:unknown,root:Obj,hooks:ObjectHooks<unknown>):unknown {return invoke(object(get(formatter,"format",hooks),root),undefined,[value]);}
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(target,receiver,args):unknown=>invoke(object(target,root),receiver,args)};
 const realm=createErrorRealm(root,hooks);realm.systemTimeZoneIdentifier=():string=>"UTC";realm.wallClockMilliseconds=():number=>0;installPrimitiveIntrinsics(root,realm,hooks);installIntlIntrinsics(root,realm,hooks);installTemporalIntrinsics(root,realm,hooks);
 const intl=object(get(root,"Intl",hooks),root),temporal=object(get(root,"Temporal",hooks),root),ctor=object(get(intl,"DateTimeFormat",hooks),root);
 const options=createObject<ScriptPropertyKey,unknown>(undefined);set(options,"calendar","iso8601",hooks);
 const formatter=construct(ctor,["en",options],root),date=construct(object(get(temporal,"PlainDate",hooks),root),[2024,9,19],root),time=construct(object(get(temporal,"PlainTime",hooks),root),[12,23,37,847],root);
 if(format(formatter,date,root,hooks)!=="9/19/2024"||format(formatter,time,root,hooks)!=="12:23:37 PM")return 1;
 const yearMonth=construct(object(get(temporal,"PlainYearMonth",hooks),root),[2024,9,"iso8601"],root);if(format(formatter,yearMonth,root,hooks)!=="9/2024")return 2;
 const boundary=construct(object(get(temporal,"PlainDate",hooks),root),[-271821,4,19],root),minimum=format(formatter,boundary,root,hooks);if(typeof minimum!=="string"||!minimum.includes("271822"))return 3;
 const precise=createObject<ScriptPropertyKey,unknown>(undefined);set(precise,"hour","2-digit",hooks);set(precise,"minute","2-digit",hooks);set(precise,"second","2-digit",hooks);set(precise,"fractionalSecondDigits",3,hooks);set(precise,"hourCycle","h23",hooks);
 const clock=construct(ctor,["en",precise],root),instant=construct(object(get(temporal,"Instant",hooks),root),[createBigIntLiteral("-1")],root);
 if(format(clock,instant,root,hooks)!=="23:59:59.999")return 4;
 const shifted=createObject<ScriptPropertyKey,unknown>(undefined);set(shifted,"hour","numeric",hooks);set(shifted,"minute","numeric",hooks);set(shifted,"timeZone","+14:00",hooks);set(shifted,"timeZoneName","longOffset",hooks);set(shifted,"hourCycle","h23",hooks);
 const zone=construct(ctor,["en",shifted],root);if(format(zone,time,root,hooks)!=="12:23")return 5;
 const later=construct(object(get(temporal,"PlainDate",hooks),root),[2024,9,21],root),range=object(get(formatter,"formatRange",hooks),root),text=invoke(range,formatter,[date,later]);if(typeof text!=="string"||!text.includes("19")||!text.includes("21"))return 6;
 const timeLocale=object(get(time,"toLocaleString",hooks),root);if(invoke(timeLocale,time,["en"])!=="12:23:37 PM")return 7;
 const dateLocale=object(get(date,"toLocaleString",hooks),root);if(invoke(dateLocale,date,["en"])!=="9/19/2024")return 8;
 const zoned=construct(object(get(temporal,"ZonedDateTime",hooks),root),[createBigIntLiteral("0"),"+00:00"],root),zonedLocale=object(get(zoned,"toLocaleString",hooks),root),zonedText=invoke(zonedLocale,zoned,["en"]);if(typeof zonedText!=="string"||!zonedText.includes("GMT")||zonedText.includes("+"))return 9;
 const legacy=construct(object(get(root,"Date",hooks),root),[0],root),legacyLocale=object(get(legacy,"toLocaleTimeString",hooks),root);if(invoke(legacyLocale,legacy,["en",precise])!=="00:00:00.000")return 10;
 return 42;
}`,
  "temporal-date-time-format",
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
  {
    managedBytes: 268435456,
    allocationCapacity: 8388608,
    stackBytes: 16777216,
    rootCapacity: 16384,
  },
);
