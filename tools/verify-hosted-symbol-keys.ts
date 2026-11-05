import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
import {viewSymbolValue,createErrorRealm,installObjectIntrinsics,callObjectValue,viewObjectValue,deleteObjectValueProperty,createSymbolValue,createSymbolRegistry,registeredSymbol,registeredSymbolKey,wellKnownSymbol,symbolDescriptiveString,scriptPropertyKeyOrder,createObject,createDataProperty,getProperty,hasProperty,ownKeys,copyDataProperties,createPropertyEnumeration,nextEnumerableProperty,type ScriptPropertyKey,type ObjectHooks} from "object";
export function run():number {
  const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):unknown=>{throw "UNEXPECTED_CALL";}};
  const registry=createSymbolRegistry();
  const a=createSymbolValue("same"),b=createSymbolValue("same");
  if(viewSymbolValue(a)!==a||viewSymbolValue("same")!==undefined||viewSymbolValue(undefined)!==undefined||viewSymbolValue({other:42})!==undefined)return 15;
  if(a===b||registeredSymbol(registry,"same")===a)return 1;
  const registered=registeredSymbol(registry,"same");
  if(registeredSymbol(registry,"same")!==registered||registeredSymbolKey(registry,registered)!=="same"||registeredSymbolKey(registry,a)!==undefined)return 2;
  const iterator=wellKnownSymbol(registry,"iterator");
  if(wellKnownSymbol(registry,"iterator")!==iterator||symbolDescriptiveString(iterator)!=="Symbol(Symbol.iterator)")return 3;
  const source=createObject<ScriptPropertyKey,unknown>(undefined);
  createDataProperty<ScriptPropertyKey,unknown>(source,a,42,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(source,"z",2,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(source,"2",3,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(source,b,4,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(source,"1",5,hooks);
  const keys=ownKeys<ScriptPropertyKey,unknown>(source,(key):number=>scriptPropertyKeyOrder(key));
  if(keys.length!==5||keys[0]!=="1"||keys[1]!=="2"||keys[2]!=="z"||keys[3]!==a||keys[4]!==b)return 4;
  const enumeration=createPropertyEnumeration<ScriptPropertyKey,unknown>(source,(key):number=>scriptPropertyKeyOrder(key));
  if(nextEnumerableProperty<ScriptPropertyKey,unknown>(enumeration)!=="1"||nextEnumerableProperty<ScriptPropertyKey,unknown>(enumeration)!=="2"||nextEnumerableProperty<ScriptPropertyKey,unknown>(enumeration)!=="z"||nextEnumerableProperty<ScriptPropertyKey,unknown>(enumeration)!==undefined)return 5;
  const copy=createObject<ScriptPropertyKey,unknown>(undefined);
  if(!copyDataProperties<ScriptPropertyKey,unknown>(copy,source,source,[a],(key):number=>scriptPropertyKeyOrder(key),hooks))return 6;
  if(hasProperty<ScriptPropertyKey,unknown>(copy,a)||getProperty<ScriptPropertyKey,unknown>(copy,b,copy,hooks)!==4)return 7;
  for(let i=0;i<30000;i++){const garbage:ScriptPropertyKey[]=[createSymbolValue("discard"),"discard"];if(garbage.length!==2)return 8;}
  if(viewSymbolValue(a)!==a||viewSymbolValue(source)!==undefined)return 16;
  if(getProperty<ScriptPropertyKey,unknown>(source,a,source,hooks)!==42||keys[3]!==a||registeredSymbolKey(registry,registered)!=="same")return 9;
  const root=createObject<ScriptPropertyKey,unknown>(undefined);
  const realm=createErrorRealm(root,hooks);
  const global=createObject<ScriptPropertyKey,unknown>(root);
  installObjectIntrinsics(global,realm,hooks);
  const object=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(global,"Object",global,hooks),root);
  if(object===undefined)return 10;
  const symbolsMethod=getProperty<ScriptPropertyKey,unknown>(object,"getOwnPropertySymbols",object,hooks);
  const reflected=callObjectValue(symbolsMethod,object,[source],root);
  const symbols=viewObjectValue(reflected.value,root);
  if(reflected.error!=="none"||symbols===undefined)return 11;
  if(getProperty<ScriptPropertyKey,unknown>(symbols,"length",symbols,hooks)!==2||getProperty<ScriptPropertyKey,unknown>(symbols,"0",symbols,hooks)!==a||getProperty<ScriptPropertyKey,unknown>(symbols,"1",symbols,hooks)!==b)return 12;
  const namesMethod=getProperty<ScriptPropertyKey,unknown>(object,"getOwnPropertyNames",object,hooks);
  const namesResult=callObjectValue(namesMethod,object,[source],root);
  const names=viewObjectValue(namesResult.value,root);
  if(namesResult.error!=="none"||names===undefined||getProperty<ScriptPropertyKey,unknown>(names,"length",names,hooks)!==3)return 13;
  if(!deleteObjectValueProperty("text",a,true,root).value)return 14;
  return 42;
}
`,
  "symbol-keys",
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
