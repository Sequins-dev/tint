import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  intlFormatRecordBindings,
  intlFormatViewNames,
} from "./intl-format-views.ts";
verifyHostedFixture(
  `import {createObject,createErrorRealm,installIntlIntrinsics,viewObjectValue,getProperty,createDataProperty,type OrdinaryObject,type ObjectHooks,type ScriptPropertyKey} from "objects";
type Obj=OrdinaryObject<ScriptPropertyKey,unknown>;
function invoke(fn:Obj,receiver:unknown,args:readonly unknown[]):unknown {const call=fn.internalRareSlots?.internalCall;if(call===undefined)throw "CALL";return call(receiver,args);}
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(target,receiver,args):unknown=>{const fn=viewObjectValue(target,root);if(fn===undefined||fn.internalRareSlots?.internalCall===undefined)throw "CALL";return invoke(fn,receiver,args);}};
 const realm=createErrorRealm(root,hooks);realm.systemTimeZoneIdentifier=():string=>"UTC";realm.wallClockMilliseconds=():number=>0;installIntlIntrinsics(root,realm,hooks);
 const intl=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(root,"Intl",root,hooks),root);if(intl===undefined)return 1;
 const ctor=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(intl,"DateTimeFormat",intl,hooks),root);if(ctor===undefined||ctor.internalRareSlots?.internalConstruct===undefined)return 2;
 const construct=ctor.internalRareSlots?.internalConstruct;if(construct===undefined)return 2;
 const options=createObject<ScriptPropertyKey,unknown>(undefined);createDataProperty<ScriptPropertyKey,unknown>(options,"year","numeric",hooks);createDataProperty<ScriptPropertyKey,unknown>(options,"month","short",hooks);createDataProperty<ScriptPropertyKey,unknown>(options,"day","numeric",hooks);
 const formatter=viewObjectValue(construct(["en",options],ctor),root);if(formatter===undefined)return 3;
 const bound=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(formatter,"format",formatter,hooks),root);if(bound===undefined||bound.internalRareSlots?.internalCall===undefined)return 4;
 if(invoke(bound,undefined,[1546473600000])!=="Jan 3, 2019"||getProperty<ScriptPropertyKey,unknown>(formatter,"format",formatter,hooks)!==bound)return 5;
 const range=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(formatter,"formatRange",formatter,hooks),root);if(range===undefined||range.internalRareSlots?.internalCall===undefined)return 6;
 if(invoke(range,formatter,[1546646400000,1546473600000])!=="Jan 5 – 3, 2019")return 7;
 const resolved=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(formatter,"resolvedOptions",formatter,hooks),root);if(resolved===undefined||resolved.internalRareSlots?.internalCall===undefined)return 8;
 const record=viewObjectValue(invoke(resolved,formatter,[]),root);if(record===undefined||getProperty<ScriptPropertyKey,unknown>(record,"calendar",record,hooks)!=="gregory"||getProperty<ScriptPropertyKey,unknown>(record,"hourCycle",record,hooks)!==undefined)return 9;
 const timeOptions=createObject<ScriptPropertyKey,unknown>(undefined);createDataProperty<ScriptPropertyKey,unknown>(timeOptions,"hour","numeric",hooks);createDataProperty<ScriptPropertyKey,unknown>(timeOptions,"hour12",true,hooks);
 const time=viewObjectValue(construct(["ja-u-hc-h24",timeOptions],ctor),root);if(time===undefined)return 10;
 const timeRecord=viewObjectValue(invoke(resolved,time,[]),root);if(timeRecord===undefined||getProperty<ScriptPropertyKey,unknown>(timeRecord,"hourCycle",timeRecord,hooks)!=="h11"||getProperty<ScriptPropertyKey,unknown>(timeRecord,"locale",timeRecord,hooks)!=="ja")return 11;
 return 42;
}`,
  "date-time-format-api",
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
