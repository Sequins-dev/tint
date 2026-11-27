import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseEvalScript } from "@tint/typescript/syntax";
import { lowerDirectEvalScript } from "@tint/js-engine/lowering";
import { scriptRuntimeDependencies } from "./script-runtime-request.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const programs = [
  ["body", "var v=40;let local=2;function f(){return v+local}f();", 2],
  ["strict", "'use strict';var v=99;v;", 2],
  ["receiver", "this===new.target;", 2],
  ["method", "super.x;", 7],
  ["literal", "1;", 15],
  ["derivedThis", "this;", 15],
  ["superCall", "super();", 15],
  ["privateRead", "this.#x;", 71],
  ["privateMissing", "this.marker=1;this.#missing;", 71],
] as const;
const modules = programs.map(([id, source, flags]) => {
  const parsed = parseEvalScript(createSourceTextView(source), {
    strict: (flags & 1) !== 0,
    newTarget: true,
    superProperty: (flags & 4) !== 0,
    superCall: (flags & 8) !== 0,
  });
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const lowered = lowerDirectEvalScript(parsed.value, source, flags, {
    privateEnvironment: (flags & 64) !== 0,
    fieldInitializer: false,
  });
  assert.ok(lowered.ok, JSON.stringify(lowered));
  return {
    id,
    module: lowered.value,
    dependencies: new Map(scriptRuntimeDependencies),
  };
});
const objectModule = "packages/js-runtime/src/objects/index.ts";
const objectViews = ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"];
const globalModule = "packages/js-runtime/src/environments/global/index.ts";
verifyHostedFixture(
  `
import {execute as body} from "body";
import {execute as strict} from "strict";
import {execute as receiver} from "receiver";
import {execute as method} from "method";
import {execute as literal} from "literal";
import {execute as derivedThis} from "derivedThis";
import {execute as superCall} from "superCall";
import {execute as privateRead} from "privateRead";
import {execute as privateMissing} from "privateMissing";
import {createObject,createPrivateName,addPrivateField,createConstructorObject,createDerivedConstruction,createDataProperty,viewObjectValue,createErrorRealm,createScriptRecord,installErrorIntrinsics,installFunctionIntrinsics,callObjectValue,type ScriptPropertyKey,type ObjectHooks} from "objects";
import {createGlobalEnvironment,createGlobalScope,createDeclarativeScope,type DirectEvalSite,type DirectEvalPrivateName} from "global";
import {createDeclarativeEnvironment,createMutableBinding,initializeBinding,getBindingValue,hasBinding} from "records";
export function run():number{
 const object=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>a===b,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>{const result=callObjectValue(callee,receiver,args,object);if(result.error!=="none")throw "CALL";return result.value;}};
 const realm=createErrorRealm(object,hooks);installErrorIntrinsics(object,realm,hooks);installFunctionIntrinsics(object,realm,hooks);
 const global=createGlobalEnvironment<ScriptPropertyKey,unknown>(object,object,object,(name:string):ScriptPropertyKey=>name,hooks);
 const vars=createDeclarativeEnvironment<unknown>(undefined),block=createDeclarativeEnvironment<unknown>(undefined);
 createMutableBinding<unknown>(vars,"v",false);initializeBinding<unknown>(vars,"v",1);
 const variables=createDeclarativeScope<ScriptPropertyKey,unknown>(createGlobalScope<ScriptPropertyKey,unknown>(global),vars);
 const lexical=createDeclarativeScope<ScriptPropertyKey,unknown>(variables,block);
 const identity=createScriptRecord(realm,undefined);
 const site:DirectEvalSite={scriptOrModule:identity,lexical,variables,catches:undefined,thisValue:object,newTarget:object,home:undefined,derived:undefined,activeFunction:undefined,privateEnvironment:undefined};
 const carrier=createScriptRecord(realm,site);
 const completed=body(global,carrier);
 if(completed.error!=="none"||completed.value!==42)return 60;
 if(getBindingValue<unknown>(vars,"v").value!==40||!hasBinding<unknown>(vars,"f")||hasBinding<unknown>(vars,"local")||hasBinding<unknown>(block,"local"))return 61;
 const isolated=strict(global,carrier);
 if(isolated.error!=="none"||isolated.value!==99||getBindingValue<unknown>(vars,"v").value!==40)return 62;
 const received=receiver(global,carrier);
 if(received.error!=="none"||received.value!==true)return 63;
 const invalid=body(global,createScriptRecord(realm,object));if(invalid.error!=="unsupported")return 64;
 for(let i=0;i<1024;i++){const bytes=new Uint32Array(8192);bytes[0]=i;if(bytes[0]!==i)return 65;}
 const fn=getBindingValue<unknown>(vars,"f");const called=callObjectValue(fn.value,undefined,[],object);
 if(called.error!=="none"||called.value!==42)return 66;
 const base=createObject<ScriptPropertyKey,unknown>(undefined);
 createDataProperty<ScriptPropertyKey,unknown>(base,"x",42,hooks);
 const home=createObject<ScriptPropertyKey,unknown>(base);
 const methodSite:DirectEvalSite={scriptOrModule:identity,lexical,variables,catches:undefined,thisValue:object,newTarget:undefined,home,derived:undefined,activeFunction:undefined,privateEnvironment:undefined};
 const methodCarrier=createScriptRecord(realm,methodSite);
 if(method(global,methodCarrier).value!==42)return 68;
 const replacement=createObject<ScriptPropertyKey,unknown>(undefined);createDataProperty<ScriptPropertyKey,unknown>(replacement,"x",43,hooks);home.prototype=replacement;
 if(method(global,methodCarrier).value!==43)return 68;
 let calls=0,initialized=0;
 const parent=createConstructorObject<ScriptPropertyKey,unknown>(undefined,undefined,(args:readonly unknown[],target:unknown):unknown=>{calls++;return object;});
 const ctor=createConstructorObject<ScriptPropertyKey,unknown>(parent,undefined,(args:readonly unknown[],target:unknown):unknown=>object);
 const derived=createDerivedConstruction<ScriptPropertyKey,unknown>({value:ctor,object:ctor},undefined,(value:unknown):void=>{initialized++;});
 const derivedSite:DirectEvalSite={scriptOrModule:identity,lexical,variables,catches:undefined,thisValue:undefined,newTarget:ctor,home,derived,activeFunction:ctor,privateEnvironment:undefined};
 const derivedCarrier=createScriptRecord(realm,derivedSite);
 if(literal(global,derivedCarrier).value!==1)return 71;if(calls!==0)return 72;
 const missing=derivedThis(global,derivedCarrier);
 if(missing.error!=="throw")return 73;if(viewObjectValue(missing.value,object)?.prototype!==realm.prototypes.get("reference"))return 74;
 if(superCall(global,derivedCarrier).value!==object)return 75;if(derivedThis(global,derivedCarrier).value!==object)return 76;if(calls!==1)return 77;if(initialized!==1)return 78;
 const repeated=superCall(global,derivedCarrier);
 if(repeated.error!=="throw")return 79;if(calls!==2)return 80;if(initialized!==1)return 81;
 if(method(global,carrier).error!=="unsupported")return 70;
 const outerName=createPrivateName("#x"),innerName=createPrivateName("#x");
 if(addPrivateField<ScriptPropertyKey,unknown>(object,outerName,42)!=="none"||addPrivateField<ScriptPropertyKey,unknown>(object,innerName,43)!=="none")return 82;
 const privateEnvironment:DirectEvalPrivateName={name:innerName,outer:{name:outerName,outer:undefined}};
 const privateSite:DirectEvalSite={scriptOrModule:identity,lexical,variables,catches:undefined,thisValue:object,newTarget:undefined,home,derived:undefined,activeFunction:undefined,privateEnvironment};
 const privateCarrier=createScriptRecord(realm,privateSite);
 const privateValue=privateRead(global,privateCarrier);if(privateValue.error!=="none"||privateValue.value!==43)return 83;
 const absent=privateMissing(global,privateCarrier);if(absent.error!=="throw"||viewObjectValue(absent.value,object)?.prototype!==realm.prototypes.get("syntax")||(object.internalRareSlots?.properties!==undefined&&object.internalRareSlots?.properties.has("marker")))return 84;
 const foreignSite:DirectEvalSite={scriptOrModule:identity,lexical,variables,catches:undefined,thisValue:home,newTarget:undefined,home,derived:undefined,activeFunction:undefined,privateEnvironment};
 const wrongBrand=privateRead(global,createScriptRecord(realm,foreignSite));if(wrongBrand.error!=="throw"||viewObjectValue(wrongBrand.value,object)?.prototype!==realm.prototypes.get("type"))return 85;
 for(let i=0;i<1024;i++){const bytes=new Uint32Array(8192);bytes[0]=i;if(bytes[0]!==i)return 86;}
 if(privateRead(global,privateCarrier).value!==43)return 86;
 if(realm.agent.activeContext!==undefined)return 67;
 return 42;
}`,
  "direct-eval-entry",
  [
    ["body", "body"],
    ["strict", "strict"],
    ["receiver", "receiver"],
    ["method", "method"],
    ["literal", "literal"],
    ["derivedThis", "derivedThis"],
    ["superCall", "superCall"],
    ["privateRead", "privateRead"],
    ["privateMissing", "privateMissing"],
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["records", "packages/js-runtime/src/environments/records/index.ts"],
    ["global", globalModule],
  ],
  modules,
  [
    { module: globalModule, name: "viewDirectEvalSite", operation: "view" },
    ...objectViews.map((name) => ({
      module: objectModule,
      name,
      operation: "view" as const,
    })),
  ],
  [
    {
      module: objectModule,
      namespace: "ordinary-object",
      retainedExports: objectViews,
    },
    {
      module: globalModule,
      namespace: "global-environment",
      retainedExports: ["viewDirectEvalSite"],
    },
  ],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
