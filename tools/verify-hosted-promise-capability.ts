import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createCallableObject,createConstructorObject,createDataProperty,callObjectValue,viewObjectValue,newPromiseCapability,speciesConstructor,createErrorRealm,wellKnownSymbol,type ObjectHooks,type ScriptPropertyKey} from "object";
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const r=callObjectValue(fn,receiver,args,root);if(r.error!=="none")throw 99;return r.value;}};
 const realm=createErrorRealm(root,hooks);
 const seen:unknown[]=[];
 const resolve=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{if(receiver!==undefined)throw 90;seen.push(args[0]);return 19;});
 const reject=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{seen.push(args[0]);return undefined;});
 const result=createObject<ScriptPropertyKey,unknown>(root);
 const ctor=createConstructorObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>undefined,(args,target):unknown=>{callObjectValue(args[0],undefined,[resolve,reject],root);return result;});
 const capability=newPromiseCapability(ctor,realm,hooks);
 if(capability.promise!==result)return 1;
 capability.resolve(42);capability.reject(23);
 if(seen[0]!==42||seen[1]!==23)return 2;
 const repeated=createConstructorObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>undefined,(args,target):unknown=>{callObjectValue(args[0],undefined,[resolve,reject],root);callObjectValue(args[0],undefined,[resolve,reject],root);return result;});
 try{newPromiseCapability(repeated,realm,hooks);return 3;}catch(error){const e=viewObjectValue(error,root);if(e===undefined||e.prototype!==realm.prototypes.get("type"))return 90;}
 const missing=createConstructorObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>undefined,(args,target):unknown=>result);
 try{newPromiseCapability(missing,realm,hooks);return 4;}catch(error){const e=viewObjectValue(error,root);if(e===undefined||e.prototype!==realm.prototypes.get("type"))return 90;}
 try{newPromiseCapability(resolve,realm,hooks);return 5;}catch(error){const e=viewObjectValue(error,root);if(e===undefined||e.prototype!==realm.prototypes.get("type"))return 90;}
 if(speciesConstructor(result,ctor,realm,hooks)!==ctor)return 6;
 const holder=createObject<ScriptPropertyKey,unknown>(root);
 createDataProperty<ScriptPropertyKey,unknown>(result,"constructor",holder,hooks);
 createDataProperty<ScriptPropertyKey,unknown>(holder,wellKnownSymbol(realm.symbolRegistry,"species"),repeated,hooks);
 if(speciesConstructor(result,ctor,realm,hooks)!==repeated)return 7;
 const undefinedFirst=createConstructorObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>undefined,(args,target):unknown=>{callObjectValue(args[0],undefined,[],root);callObjectValue(args[0],undefined,[resolve,reject],root);return result;});
 newPromiseCapability(undefinedFirst,realm,hooks).resolve(84);
 if(seen[2]!==84)return 8;
 const throwingResolve=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{throw 123;});
 const throwing=createConstructorObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>undefined,(args,target):unknown=>{callObjectValue(args[0],undefined,[throwingResolve,reject],root);return result;});
 const abrupt=newPromiseCapability(throwing,realm,hooks);
 try{abrupt.resolve(42);return 9;}catch(error){if(error!==123)return 10;}
 createDataProperty<ScriptPropertyKey,unknown>(holder,wellKnownSymbol(realm.symbolRegistry,"species"),null,hooks);
 if(speciesConstructor(result,ctor,realm,hooks)!==ctor)return 11;
 createDataProperty<ScriptPropertyKey,unknown>(holder,wellKnownSymbol(realm.symbolRegistry,"species"),resolve,hooks);
 try{speciesConstructor(result,ctor,realm,hooks);return 12;}catch(error){const e=viewObjectValue(error,root);if(e===undefined||e.prototype!==realm.prototypes.get("type"))return 91;}
 return 42;
}`,
  "promise-capability",
  [["object", "packages/js-runtime/src/objects/index.ts"]],
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
