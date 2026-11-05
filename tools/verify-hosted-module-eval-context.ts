import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { lowerSourceTextModule } from "@tint/js-engine/lowering";
import type { SourceModule } from "@tint/typescript/modules/model";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const objects = "packages/js-runtime/src/objects/index.ts",
  global = "packages/js-runtime/src/environments/global/index.ts",
  modules = "packages/js-runtime/src/modules/index.ts";
const dependencies: readonly [string, string][] = [
  ["@tint/js-runtime/objects", objects],
  ["@tint/js-runtime/environments/global", global],
  [
    "@tint/js-runtime/environments/records",
    "packages/js-runtime/src/environments/records/index.ts",
  ],
  ["@tint/js-runtime/modules", modules],
];
const generated: SourceModule[] = [];
for (const [id, text] of [
  [
    "module-a",
    'let value=40;export const top=eval("value+2");export function read(){return eval("value+2");}export function echo(value){return eval(value);}',
  ],
  ["module-b", 'import {read} from "./a.js";export const result=read();'],
]) {
  assert.ok(id !== undefined && text !== undefined);
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok);
  const lowered = lowerSourceTextModule(parsed.value, text);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  generated.push({
    id,
    module: lowered.value,
    dependencies: new Map(dependencies),
  });
}
verifyHostedFixture(
  `
import {create as createA} from "module-a";import {create as createB} from "module-b";
import {createObject,createErrorRealm,installEvalIntrinsic,installEvalCompiler,installDirectEvalCompiler,callObjectValue,getProperty,runScriptContext,type ObjectHooks,type ScriptPropertyKey} from "objects";
import {createGlobalEnvironment,viewDirectEvalSite,type DirectEvalSite} from "global";
import {loadRequestedModules,finishLoadingImportedModule,linkModule,evaluateModule,settledModulePromise,getModuleNamespace,type ModuleRecord,type ModuleReferrer,type ModuleRequest,type ModuleLoadPayload} from "modules";
export function run():number{
 const object=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>a===b,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>{const result=callObjectValue(callee,receiver,args,object);if(result.error!=="none")throw "MODULE_EVAL_CALL_INVARIANT";return result.value;}};
 const realm=createErrorRealm(object,hooks),global=createGlobalEnvironment<ScriptPropertyKey,unknown>(object,object,undefined,(name:string):ScriptPropertyKey=>name,hooks);
 const state:{owner:ModuleRecord|undefined;site:DirectEvalSite|undefined;calls:number;failure:number}={owner:undefined,site:undefined,calls:0,failure:0};
 installEvalIntrinsic(object,realm,hooks);installEvalCompiler(realm,(source:string):unknown=>{throw "UNEXPECTED_INDIRECT_EVAL";});
 installDirectEvalCompiler(realm,(source:string,flags:number,opaque:unknown):unknown=>{const site=viewDirectEvalSite(opaque),active=realm.agent.activeContext;if(site===undefined){state.failure=60;return undefined;}state.site=site;state.calls++;if(site.scriptOrModule!==state.owner||active===undefined||active.scriptOrModule!==state.owner)state.failure=61;if(source!=="value+2"||(flags!==1&&flags!==3))state.failure=62;if(site.thisValue!==undefined)state.failure=63;return 42;});
 const a=createA(global,realm,undefined),b=createB(global,realm,undefined);state.owner=a;
 realm.moduleLoader=(referrer:ModuleReferrer,request:ModuleRequest,hostDefined:unknown,payload:ModuleLoadPayload):void=>{if(request.specifier!=="./a.js")throw "MODULE_EVAL_LOAD_INVARIANT";finishLoadingImportedModule(referrer,request,payload,{ok:true,module:a});};
 if(settledModulePromise(loadRequestedModules(b,hooks,undefined),realm).kind!=="fulfilled"||!linkModule(b).ok)return 64;
 if(settledModulePromise(evaluateModule(b,hooks),realm).kind!=="fulfilled"||state.calls!==2||state.failure!==0)return 65;
 const namespaceA=getModuleNamespace(a),namespaceB=getModuleNamespace(b);if(getProperty<ScriptPropertyKey,unknown>(namespaceA,"top",namespaceA,hooks)!==42||getProperty<ScriptPropertyKey,unknown>(namespaceB,"result",namespaceB,hooks)!==42)return 66;
 const read=getProperty<ScriptPropertyKey,unknown>(namespaceA,"read",namespaceA,hooks),echo=getProperty<ScriptPropertyKey,unknown>(namespaceA,"echo",namespaceA,hooks);
 runScriptContext<void>(realm.agent,{realm,scriptOrModule:"foreign"},():void=>{const result=callObjectValue(read,undefined,[],object);if(result.error!=="none"||result.value!==42)state.failure=67;const active=realm.agent.activeContext;if(active===undefined||active.scriptOrModule!=="foreign")state.failure=68;});
 if(state.failure!==0||state.calls!==3||realm.agent.activeContext!==undefined)return 69;
 const roundtrip=callObjectValue(echo,undefined,[7],object);if(roundtrip.error!=="none"||roundtrip.value!==7||state.calls!==3)return 70;
 for(let i=0;i<200000;i++){const churn:{value:number}={value:i};if(churn.value!==i)return 71;}
 const site=state.site;if(site===undefined||site.scriptOrModule!==a||state.failure!==0)return 72;
 return 42;
}`,
  "module-eval-context",
  [
    ["objects", objects],
    ["global", global],
    ["modules", modules],
    ["module-a", "module-a"],
    ["module-b", "module-b"],
  ],
  generated,
  [
    { module: global, name: "viewDirectEvalSite", operation: "view" },
    ...["viewObjectValue", "viewSymbolValue", "viewBigIntValue"].map(
      (name) => ({ module: objects, name, operation: "view" as const }),
    ),
  ],
  [
    {
      module: global,
      namespace: "module-eval-global-view",
      retainedExports: ["viewDirectEvalSite"],
    },
    {
      module: objects,
      namespace: "module-eval-object-views",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
  { managedBytes: 4194304, allocationCapacity: 65536 },
);
