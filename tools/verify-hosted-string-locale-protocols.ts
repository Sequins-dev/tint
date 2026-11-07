import { verifyHostedFixture } from "./hosted-fixture.ts";
const objects = "packages/js-runtime/src/objects/index.ts";
verifyHostedFixture(
  `
import {unicodeLocaleLowercase,unicodeLocaleUppercase} from "casing";
import {emptyUpdate} from "descriptors";
import {createObject,createErrorRealm,installPrimitiveIntrinsics,installArrayIntrinsics,installRegExpIntrinsics,getOwnProperty,getObjectValueProperty,callObjectValue,createCallableObject,defineOwnProperty,toObjectValue,wellKnownSymbol,type ObjectHooks,type ScriptPropertyKey} from "objects";
export function run():number {
 if(unicodeLocaleLowercase("Iİiı","tr")!=="ıiiı")return 1;
 if(unicodeLocaleUppercase("Iİiı","az")!=="IİİI")return 2;
 if(unicodeLocaleLowercase("I\\u0323\\u0307","tr")!=="i\\u0323")return 3;
 if(unicodeLocaleLowercase("I\\u0301\\u0307","tr")!=="ı\\u0301\\u0307")return 4;
 if(unicodeLocaleLowercase("I\\u0301J\\u0300Į\\u0303","lt")!=="i\\u0307\\u0301j\\u0307\\u0300į\\u0307\\u0303")return 5;
 if(unicodeLocaleLowercase("ÌÍĨ","lt")!=="i\\u0307\\u0300i\\u0307\\u0301i\\u0307\\u0303")return 6;
 if(unicodeLocaleUppercase("i\\u0307j\\u0323\\u0307","lt")!=="IJ\\u0323")return 7;
 if(unicodeLocaleUppercase("i\\u0301\\u0307","lt")!=="I\\u0301\\u0307")return 8;
 if(unicodeLocaleLowercase("ΟΣ","tr")!=="ος")return 9;
 if(unicodeLocaleLowercase("\\ud800I\\udc00","tr")!=="\\ud800ı\\udc00")return 10;
 if(unicodeLocaleUppercase("𝑖\\u0307","lt")!=="𝑖")return 11;
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):unknown=>{const result=callObjectValue(callee,receiver,args,root);if(result.error!=="none")throw "INVALID_FIXTURE_CALL";return result.value;}};
 const realm=createErrorRealm(root,hooks);
 installArrayIntrinsics(root,realm,hooks);installPrimitiveIntrinsics(root,realm,hooks);installRegExpIntrinsics(root,realm,hooks);
 const lower=getOwnProperty<ScriptPropertyKey,unknown>(realm.stringPrototype,"toLocaleLowerCase");
 const upper=getOwnProperty<ScriptPropertyKey,unknown>(realm.stringPrototype,"toLocaleUpperCase");
 if(lower===undefined||upper===undefined)return 20;
 if(lower.writable!==true||lower.enumerable!==false||lower.configurable!==true)return 21;
 if(upper.writable!==true||upper.enumerable!==false||upper.configurable!==true)return 22;
 const lc=callObjectValue(lower.value,"I",["tr"],root),uc=callObjectValue(upper.value,"i",["az"],root);
 if(lc.error!=="none"||uc.error!=="none"||lc.value!=="ı"||uc.value!=="İ")return 23;
 const names:string[]=["match","matchAll","search","replace","replaceAll","split"];
 function read(value:unknown,key:ScriptPropertyKey):unknown {const result=getObjectValueProperty(value,key,hooks,realm);if(result.error!=="none")throw "INVALID_FIXTURE_READ";return result.value;}
 for(let i=0;i<names.length;i++) {
  const name=names[i];if(name===undefined)return 30;
  const key=wellKnownSymbol(realm.symbolRegistry,name==="replaceAll"?"replace":name);
  const getter=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{throw "POISON";});
  const update={...emptyUpdate<unknown>(undefined),fields:36,get:getter,configurable:true};
  if(defineOwnProperty<ScriptPropertyKey,unknown>(realm.numberPrototype,key,update,hooks)!=="accepted")return 31;
  const method=getOwnProperty<ScriptPropertyKey,unknown>(realm.stringPrototype,name);if(method===undefined)return 32;
  const args:unknown[]=[1];if(name==="replace"||name==="replaceAll")args.push("X");
  const called=callObjectValue(method.value,"a1b1c",args,root);if(called.error!=="none")return 33;
  const result=called.value;
  if(name==="search") {if(result!==1)return 34;}
  else if(name==="replace") {if(result!=="aXb1c")return 35;}
  else if(name==="replaceAll") {if(result!=="aXbXc")return 36;}
  else if(name==="split") {if(read(result,"length")!==3||read(result,"0")!=="a"||read(result,"1")!=="b"||read(result,"2")!=="c")return 37;}
  else {let match:unknown=result;if(name==="matchAll")match=read(hooks.call(read(result,"next"),result,[]),"value");if(read(match,"0")!=="1"||read(match,"index")!==1)return 38;}
  const boxed=toObjectValue(1,realm,hooks);let threw=false;
  try{hooks.call(method.value,"a1b1c",[boxed]);}catch(error){if(error!=="POISON")throw error;threw=true;}
  if(!threw)return 39;
 }
 return 42;
}`,
  "string-locale-protocols",
  [
    ["objects", objects],
    ["casing", "packages/foundation/src/unicode/casing/index.ts"],
    ["descriptors", "packages/js-runtime/src/descriptors/index.ts"],
  ],
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
