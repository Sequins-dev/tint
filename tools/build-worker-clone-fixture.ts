import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The worker clone fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const object = "packages/js-runtime/src/objects/index.ts";
const views = ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"];
verifyHostedFixture(
  `
import {createObject,createErrorRealm,createDataProperty,getOwnProperty,viewObjectValue,callObjectValue,bigIntFromString,bigIntToString,viewBigIntValue,serializeWorkerValue,deserializeWorkerValue,type ScriptPropertyKey,type ObjectHooks} from 'object';
export function run():number {
  const first=createObject<ScriptPropertyKey,unknown>(undefined);
  const second=createObject<ScriptPropertyKey,unknown>(undefined);
  const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const result=callObjectValue(fn,receiver,args,first);if(result.error!=="none")throw "CALL";return result.value;}};
  const from=createErrorRealm(first,hooks),to=createErrorRealm(second,hooks);
  const root=createObject<ScriptPropertyKey,unknown>(first);
  const child=createObject<ScriptPropertyKey,unknown>(first);
  createDataProperty<ScriptPropertyKey,unknown>(root,"left",child,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(root,"right",child,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(child,"parent",root,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(child,"zero",-0,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(child,"large",bigIntFromString("9007199254740993"),hooks);
  const packet=serializeWorkerValue(root,from);
  const result=viewObjectValue(deserializeWorkerValue(packet,to),second);
  if(result===undefined||result===root||result.prototype!==second)return 1;
  const copy=viewObjectValue(getOwnProperty<ScriptPropertyKey,unknown>(result,"left")?.value,second);
  if(copy===undefined||copy===child||copy!==getOwnProperty<ScriptPropertyKey,unknown>(result,"right")?.value)return 2;
  if(getOwnProperty<ScriptPropertyKey,unknown>(copy,"parent")?.value!==result)return 3;
  const zero=getOwnProperty<ScriptPropertyKey,unknown>(copy,"zero")?.value;
  if(typeof zero!=="number"||1/zero!==-Infinity)return 4;
  const big=viewBigIntValue(getOwnProperty<ScriptPropertyKey,unknown>(copy,"large")?.value);
  if(big===undefined||bigIntToString(big,10)!=="9007199254740993")return 5;
  return 42;
}
`,
  "worker-clone",
  [["object", object]],
  [],
  views.map((name) => ({ module: object, name, operation: "view" })),
  [{ module: object, namespace: "ordinary-object", retainedExports: views }],
  {
    managedBytes: 16777216,
    allocationCapacity: 262144,
    stackBytes: 16777216,
    requireTyped: true,
  },
);
