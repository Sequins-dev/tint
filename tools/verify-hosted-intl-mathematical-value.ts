import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `import {intlMathematicalValue,intlStringMathematicalValue,createObject,createCallableObject,createErrorRealm,defineOwnProperty,wellKnownSymbol,createBigIntLiteral,type ObjectHooks,type ScriptPropertyKey} from "objects";
import {decimalToString} from "numeric";
export function run():number {
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(target,receiver,args):unknown=>undefined};
 const root=createObject<ScriptPropertyKey,unknown>(undefined),realm=createErrorRealm(root,hooks);
 const exact=intlStringMathematicalValue("0x20000000000001");if(decimalToString(exact)!=="9007199254740993")return 1;
 if(decimalToString(intlMathematicalValue(-0,realm,hooks))!=="-0")return 2;
 if(intlStringMathematicalValue("1e90000").kind!=="infinity"||decimalToString(intlStringMathematicalValue("-1e-90000"))!=="-0")return 3;
 let calls=0;
 const object=createObject<ScriptPropertyKey,unknown>(realm.objectPrototype);
 const method=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{calls++;if(args[0]!=="number")throw "hint";return "9007199254740993";});
 defineOwnProperty<ScriptPropertyKey,unknown>(object,wellKnownSymbol(realm.symbolRegistry,"toPrimitive"),{fields:51,value:method,writable:true,get:undefined,set:undefined,enumerable:false,configurable:true},hooks);
 if(decimalToString(intlMathematicalValue(object,realm,hooks))!=="9007199254740993"||calls!==1)return 4;
 let digits="1";for(let i=0;i<400;i++)digits+="0";
 const bigint=createBigIntLiteral(digits),value=intlMathematicalValue(bigint,realm,hooks);
 if(value.kind!=="finite"||value.digits!=="1"||value.exponent!==400||intlStringMathematicalValue(digits).kind!=="infinity")return 5;
 return 42;
}`,
  "intl-mathematical-value",
  [
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["numeric", "packages/foundation/src/numeric/number-text/index.ts"],
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
