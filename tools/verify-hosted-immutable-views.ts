import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createErrorRealm,createTypedArrayView,createDataProperty,createCallableObject,installArrayIntrinsics,installTypedArrayIntrinsics,installDataViewIntrinsics,getProperty,viewObjectValue,callObject,scriptSameValue,ensureExoticSlots,type ScriptPropertyKey,type ObjectHooks} from "objects";
import {createByteStorage,copyImmutableByteStorage} from "storage";
export function run():number{
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:scriptSameValue,call:(fn,receiver,args):unknown=>{const result=callObject<ScriptPropertyKey,unknown>(viewObjectValue(fn,root),receiver,args,undefined);if(result.error!=="none")throw "CALL_FAILED";return result.value;}};
 const realm=createErrorRealm(root,hooks),global=createObject<ScriptPropertyKey,unknown>(root);
 installArrayIntrinsics(global,realm,hooks);installTypedArrayIntrinsics(global,realm,hooks,"little");installDataViewIntrinsics(global,realm,hooks);
 const allocated=createByteStorage(8,8,false,16);if(!allocated.ok)return 1;
 const immutable=copyImmutableByteStorage(allocated.value,0,8,8);if(!immutable.ok)return 2;
 const storage=immutable.value,buffer=createObject<ScriptPropertyKey,unknown>(realm.arrayBufferPrototype);ensureExoticSlots(buffer).internalArrayBufferData=storage;
 const view=createTypedArrayView(realm.typedArrayPrototype,{buffer,storage,byteOffset:0,length:8,kind:"Uint8",endian:"little"},realm,hooks);
 const empty=createTypedArrayView(realm.typedArrayPrototype,{buffer,storage,byteOffset:8,length:0,kind:"Uint8",endian:"little"},realm,hooks);
 function rejects(receiver:unknown,name:string,args:unknown[]):boolean{
  const object=viewObjectValue(receiver,root);if(object===undefined)return false;
  try{hooks.call(getProperty<ScriptPropertyKey,unknown>(object,name,receiver,hooks),receiver,args);}
  catch(error){const thrown=viewObjectValue(error,root);return thrown!==undefined&&getProperty<ScriptPropertyKey,unknown>(thrown,"name",thrown,hooks)==="TypeError";}
  return false;
 }
 const names=["reverse","sort","fill","copyWithin","set"];
 for(let i=0;i<names.length;i++){const name=names[i];if(name===undefined)return 3;if(!rejects(empty,name,name==="set"?[empty]:[]))return 10+i;}
 let conversions=0;const value=createObject<ScriptPropertyKey,unknown>(root);
 createDataProperty<ScriptPropertyKey,unknown>(value,"valueOf",createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{conversions++;return 0;}),hooks);
 if(!rejects(view,"fill",[value])||!rejects(view,"copyWithin",[value])||!rejects(view,"set",[empty,value])||conversions!==0)return 20;
 const dataView=createObject<ScriptPropertyKey,unknown>(realm.dataViewPrototype);ensureExoticSlots(dataView).internalDataViewData={buffer,storage,byteOffset:0,byteLength:8};ensureExoticSlots(dataView).internalArrayBufferView=true;
 if(!rejects(dataView,"setUint8",[value,value])||!rejects(dataView,"setBigInt64",[value,value])||conversions!==0)return 21;
 return 42;
}`,
  "immutable-views",
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
