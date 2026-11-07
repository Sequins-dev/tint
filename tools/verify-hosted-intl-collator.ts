import { verifyHostedFixture } from "./hosted-fixture.ts";
import { startNativeHeartbeat } from "./test262-native-heartbeat.ts";
const heartbeat = startNativeHeartbeat("Intl.Collator API native fixture");
try {
  heartbeat.phase("building Collator API fixture");
  const objects = "packages/js-runtime/src/objects/index.ts";
  verifyHostedFixture(
    String.raw`
import {createObject,createErrorRealm,installArrayIntrinsics,installPrimitiveIntrinsics,installIntlIntrinsics,getOwnProperty,getObjectValueProperty,callObjectValue,createDataProperty,viewObjectValue,type ScriptPropertyKey,type ObjectHooks} from "objects";
export function run():number{
 const global=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):unknown=>{const result=callObjectValue(callee,receiver,args,global);if(result.error!=="none")throw "FIXTURE_CALL";return result.value;}};
 const realm=createErrorRealm(global,hooks);installArrayIntrinsics(global,realm,hooks);installPrimitiveIntrinsics(global,realm,hooks);installIntlIntrinsics(global,realm,hooks);
 function get(value:unknown,key:ScriptPropertyKey):unknown{const result=getObjectValueProperty(value,key,hooks,realm);if(result.error!=="none")throw "FIXTURE_GET";return result.value;}
 const ctor=get(get(global,"Intl"),"Collator");if(ctor===undefined)return 1;
 const prototype=get(ctor,"prototype"),compareDescriptor=getOwnProperty<ScriptPropertyKey,unknown>(viewObjectValue(prototype,global)??global,"compare");
 if(compareDescriptor===undefined||compareDescriptor.get===undefined||compareDescriptor.set!==undefined||compareDescriptor.enumerable||!compareDescriptor.configurable)return 2;
 if(get(ctor,"length")!==0||get(ctor,"name")!=="Collator")return 3;
 function create(locale:string,options:unknown):unknown{return hooks.call(ctor,undefined,[locale,options]);}
 function option(key:string,value:unknown):unknown{const object=createObject<ScriptPropertyKey,unknown>(realm.objectPrototype);if(!createDataProperty<ScriptPropertyKey,unknown>(object,key,value,hooks))throw "FIXTURE_OPTION";return object;}
 function compare(collator:unknown,left:string,right:string):unknown{return hooks.call(get(collator,"compare"),undefined,[left,right]);}
 const en=create("en",undefined),bound=get(en,"compare");if(bound!==get(en,"compare")||get(bound,"length")!==2||get(bound,"name")!=="")return 4;
 if(compare(en,"a","b")!==-1||compare(en,"ä\u0323","a\u0323\u0308")!==0)return 5;
 if(compare(create("en",option("numeric",true)),"000٢","２")!==0)return 6;
 if(compare(create("en",option("caseFirst","upper")),"A","a")!==-1)return 7;
 if(compare(create("en",option("ignorePunctuation",true)),"a- b","ab")!==0)return 8;
 if(compare(create("en",option("sensitivity","case")),"Aã","Aa")!==0)return 9;
 if(compare(create("de",undefined),"Ä","AE")!==-1)return 10;
 if(compare(create("de",option("usage","search")),"Ä","AE")!==1)return 11;
 if(compare(create("de-u-co-phonebk",undefined),"Ä","Af")!==-1)return 12;
 const extended=create("de-u-co-phonebk",option("collation","eor")),resolved=hooks.call(get(extended,"resolvedOptions"),extended,[]);if(get(resolved,"locale")!=="de"||get(resolved,"collation")!=="eor")return 13;
 const methods:string[]=["toLocaleLowerCase","toLocaleUpperCase","localeCompare"];
 for(const name of methods){if(name===undefined)return 14;const descriptor=getOwnProperty<ScriptPropertyKey,unknown>(realm.stringPrototype,name);if(descriptor===undefined||!descriptor.writable||descriptor.enumerable||!descriptor.configurable)return 15;}
 if(hooks.call(get(realm.stringPrototype,"localeCompare"),"ä",["Af","de-u-co-phonebk"])!==-1)return 16;
 if(hooks.call(get(realm.stringPrototype,"toLocaleLowerCase"),"I",["tr"])!=="ı")return 17;
 if(hooks.call(get(realm.stringPrototype,"toLocaleUpperCase"),"i",["az"])!=="İ")return 18;
 let branded=false;try{hooks.call(compareDescriptor.get,prototype,[]);}catch(error){branded=true;}if(!branded)return 19;
 return 42;
}`,
    "intl-collator",
    [["objects", objects]],
    [],
    ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"].map((name) => ({
      module: objects,
      name,
      operation: "view" as const,
    })),
    [
      {
        module: objects,
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
      rootCapacity: 16384,
      stackBytes: 16777216,
    },
  );
} finally {
  await heartbeat.close();
}
