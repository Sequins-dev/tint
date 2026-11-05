import { verifyHostedFixture } from "./hosted-fixture.ts";

const objectModule = "packages/js-runtime/src/objects/index.ts";
const views = [
  "viewObjectValue",
  "viewSymbolValue",
  "viewBigIntValue",
] as const;

verifyHostedFixture(
  `import {createObject,createErrorRealm,installPrimitiveIntrinsics,getOwnProperty,viewObjectValue,callObjectValue,bigIntFromString,type ObjectHooks,type ScriptPropertyKey} from "object";
export function run():number {
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):unknown=>undefined};
 const root=createObject<ScriptPropertyKey,unknown>(undefined),realm=createErrorRealm(root,hooks);
 installPrimitiveIntrinsics(root,realm,hooks);
 const property=getOwnProperty<ScriptPropertyKey,unknown>(realm.bigIntPrototype,"toString");
 if(property===undefined||!property.writable||property.enumerable||!property.configurable)return 1;
 const method=viewObjectValue(property.value,root);if(method===undefined)return 2;
 const length=getOwnProperty<ScriptPropertyKey,unknown>(method,"length");
 if(length===undefined||length.value!==0||length.writable||length.enumerable||!length.configurable)return 3;
 if(getOwnProperty<ScriptPropertyKey,unknown>(method,"name")?.value!=="toString"||method.internalConstruct!==undefined)return 4;
 const value=bigIntFromString("42");if(value===undefined)return 5;
 const decimal=callObjectValue(method,value,[],root),binary=callObjectValue(method,value,[2],root);
 if(decimal.error!=="none"||decimal.value!=="42"||binary.error!=="none"||binary.value!=="101010")return 6;
 return 42;
}`,
  "bigint-metadata",
  [["object", objectModule]],
  [],
  views.map((name) => ({
    module: objectModule,
    name,
    operation: "view" as const,
  })),
  [
    {
      module: objectModule,
      namespace: "ordinary-object",
      retainedExports: views,
    },
  ],
  { managedBytes: 67108864, allocationCapacity: 4194304 },
);
