import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createTypedArrayView,createObject,createErrorRealm,createCallableObject,createDataProperty,getProperty,setProperty,ownKeys,viewObjectValue,callObject,bigIntToString,viewBigIntValue,scriptSameValue,type ScriptPropertyKey,type ObjectHooks,type TypedArrayData} from "objects";
import {createByteStorage,resizeByteStorage,detachByteStorage} from "storage";
export function run():number{
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:scriptSameValue,call:(fn,receiver,args):unknown=>{const result=callObject<ScriptPropertyKey,unknown>(viewObjectValue(fn,root),receiver,args,undefined);if(result.error!=="none")throw "CALL_FAILED";return result.value;}};
 const realm=createErrorRealm(root,hooks),allocated=createByteStorage(16,32,true,32);if(!allocated.ok)return 1;
 const storage=allocated.value,buffer=createObject<ScriptPropertyKey,unknown>(undefined);buffer.internalArrayBufferData=storage;
 const data:TypedArrayData={buffer,storage,byteOffset:2,length:2,kind:"Uint16",endian:"little"};
 const fixed=createTypedArrayView(root,data,realm,hooks),tracking=createTypedArrayView(root,{...data,length:undefined},realm,hooks);
 if(!setProperty<ScriptPropertyKey,unknown>(fixed,"0",65537,{object:fixed,value:fixed},hooks)||getProperty<ScriptPropertyKey,unknown>(tracking,"0",tracking,hooks)!==1)return 2;
 if(resizeByteStorage(storage,4)!=="none"||getProperty<ScriptPropertyKey,unknown>(fixed,"0",fixed,hooks)!==undefined||getProperty<ScriptPropertyKey,unknown>(tracking,"0",tracking,hooks)!==1)return 3;
 if(resizeByteStorage(storage,16)!=="none"||getProperty<ScriptPropertyKey,unknown>(fixed,"0",fixed,hooks)!==1)return 4;
 const big=createTypedArrayView(root,{buffer,storage,byteOffset:8,length:1,kind:"BigInt64",endian:"little"},realm,hooks);
 if(!setProperty<ScriptPropertyKey,unknown>(big,"0","18446744073709551615",{object:big,value:big},hooks))return 5;
 const value=viewBigIntValue(getProperty<ScriptPropertyKey,unknown>(big,"0",big,hooks));if(value===undefined||bigIntToString(value,10)!=="-1")return 6;
 let conversions=0;const coercible=createObject<ScriptPropertyKey,unknown>(root);
 const valueOf=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{conversions++;detachByteStorage(storage);return 42;});
 if(!createDataProperty<ScriptPropertyKey,unknown>(coercible,"valueOf",valueOf,hooks))return 7;
 if(!setProperty<ScriptPropertyKey,unknown>(fixed,"0",coercible,{object:fixed,value:fixed},hooks)||conversions!==1)return 8;
 if(ownKeys<ScriptPropertyKey,unknown>(fixed,(key):number=>-1).length!==0)return 9;
 if(!setProperty<ScriptPropertyKey,unknown>(fixed,"99",coercible,{object:fixed,value:fixed},hooks)||conversions!==2)return 10;
 return 42;
}`,
  "typed-array-data",
  [
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["storage", "packages/js-runtime/src/bytes/index.ts"],
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
