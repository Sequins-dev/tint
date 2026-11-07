import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createObject,createErrorRealm,installIntlIntrinsics,viewObjectValue,getProperty,createDataProperty,type OrdinaryObject,type ObjectHooks,type ScriptPropertyKey} from "objects";
import {createUnitFormatProfile,unitFormatPattern,unitFormatDigital,createDurationListFormatter} from "units";
import {formatList} from "lists";
type Obj=OrdinaryObject<ScriptPropertyKey,unknown>;
function object(value:unknown,root:Obj):Obj{const result=viewObjectValue(value,root);if(result===undefined)throw "OBJECT";return result;}
function invoke(fn:Obj,receiver:unknown,args:readonly unknown[]):unknown{const call=fn.internalCall;if(call===undefined)throw "CALL";return call(receiver,args);}
function get(value:Obj,key:string,hooks:ObjectHooks<unknown>):unknown{return getProperty<ScriptPropertyKey,unknown>(value,key,value,hooks);}
function set(value:Obj,key:string,item:unknown,hooks:ObjectHooks<unknown>):void{if(!createDataProperty<ScriptPropertyKey,unknown>(value,key,item,hooks))throw "PROPERTY";}
export function run():number{
 const en=createUnitFormatProfile("en"),ar=createUnitFormatProfile("ar"),fi=createUnitFormatProfile("fi");if(en===undefined||ar===undefined||fi===undefined)return 1;
 if(unitFormatPattern(en,"long","year","other")!=="{0} years"||unitFormatPattern(ar,"long","year","two")!=="سنتان")return 2;
 const digital=unitFormatDigital(fi,"latn"),arabic=unitFormatDigital(fi,"arab");if(digital===undefined||arabic===undefined||digital.hourMinuteSeparator!=="."||arabic.hourMinuteSeparator!==":")return 3;
 const list=createDurationListFormatter(en,"long");if(list===undefined||formatList(list,["1 year","2 months"])!=="1 year, 2 months")return 4;
 const root=createObject<ScriptPropertyKey,unknown>(undefined),hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(target,receiver,args):unknown=>invoke(object(target,root),receiver,args)},realm=createErrorRealm(root,hooks);installIntlIntrinsics(root,realm,hooks);
 const intl=object(get(root,"Intl",hooks),root),ctor=object(get(intl,"NumberFormat",hooks),root),construct=ctor.internalConstruct;if(construct===undefined)return 5;
 const options=createObject<ScriptPropertyKey,unknown>(undefined);set(options,"style","unit",hooks);set(options,"unit","year",hooks);set(options,"unitDisplay","long",hooks);
 const formatter=object(construct(["en",options],ctor),root),format=object(get(formatter,"format",hooks),root);if(invoke(format,undefined,[2])!=="2 years")return 6;
 const dual=object(construct(["ar",options],ctor),root),dualFormat=object(get(dual,"format",hooks),root);if(invoke(dualFormat,undefined,[2])!=="سنتان"||invoke(dualFormat,undefined,[-2])!=="‎-سنتان")return 7;
 set(options,"unit","nanosecond",hooks);const nanos=object(construct(["en",options],ctor),root),nanoFormat=object(get(nanos,"format",hooks),root);if(invoke(nanoFormat,undefined,[9])!=="9 nanoseconds")return 8;
 return 42;
}`,
  "unit-format",
  [
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["units", "packages/js-runtime/src/objects/unit-format.ts"],
    ["lists", "packages/js-runtime/src/objects/list-format.ts"],
  ],
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
