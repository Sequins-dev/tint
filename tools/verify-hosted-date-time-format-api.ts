import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createObject,createErrorRealm,installIntlIntrinsics,viewObjectValue,getProperty,createDataProperty,type OrdinaryObject,type ObjectHooks,type ScriptPropertyKey} from "objects";
type Obj=OrdinaryObject<ScriptPropertyKey,unknown>;
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(target,receiver,args):unknown=>{const fn=viewObjectValue(target,root);if(fn===undefined||fn.internalCall===undefined)throw "CALL";return fn.internalCall(receiver,args);}};
 const realm=createErrorRealm(root,hooks);realm.systemTimeZoneIdentifier=():string=>"UTC";realm.wallClockMilliseconds=():number=>0;installIntlIntrinsics(root,realm,hooks);
 const intl=viewObjectValue(getProperty(root,"Intl",root,hooks),root);if(intl===undefined)return 1;
 const ctor=viewObjectValue(getProperty(intl,"DateTimeFormat",intl,hooks),root);if(ctor===undefined||ctor.internalConstruct===undefined)return 2;
 const options=createObject<ScriptPropertyKey,unknown>(undefined);createDataProperty(options,"year","numeric",hooks);createDataProperty(options,"month","short",hooks);createDataProperty(options,"day","numeric",hooks);
 const formatter=viewObjectValue(ctor.internalConstruct(["en",options],ctor),root);if(formatter===undefined)return 3;
 const bound=viewObjectValue(getProperty(formatter,"format",formatter,hooks),root);if(bound===undefined||bound.internalCall===undefined)return 4;
 if(bound.internalCall(undefined,[1546473600000])!=="Jan 3, 2019"||getProperty(formatter,"format",formatter,hooks)!==bound)return 5;
 const range=viewObjectValue(getProperty(formatter,"formatRange",formatter,hooks),root);if(range===undefined||range.internalCall===undefined)return 6;
 if(range.internalCall(formatter,[1546646400000,1546473600000])!=="Jan 5 – 3, 2019")return 7;
 const resolved=viewObjectValue(getProperty(formatter,"resolvedOptions",formatter,hooks),root);if(resolved===undefined||resolved.internalCall===undefined)return 8;
 const record=viewObjectValue(resolved.internalCall(formatter,[]),root);if(record===undefined||getProperty(record,"calendar",record,hooks)!=="gregory"||getProperty(record,"hourCycle",record,hooks)!==undefined)return 9;
 const timeOptions=createObject<ScriptPropertyKey,unknown>(undefined);createDataProperty(timeOptions,"hour","numeric",hooks);createDataProperty(timeOptions,"hour12",true,hooks);
 const time=viewObjectValue(ctor.internalConstruct(["ja-u-hc-h24",timeOptions],ctor),root);if(time===undefined)return 10;
 const timeRecord=viewObjectValue(resolved.internalCall(time,[]),root);if(timeRecord===undefined||getProperty(timeRecord,"hourCycle",timeRecord,hooks)!=="h11"||getProperty(timeRecord,"locale",timeRecord,hooks)!=="ja")return 11;
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
