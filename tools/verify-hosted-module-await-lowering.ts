import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { lowerSourceTextModule } from "@tint/js-engine/lowering";
import type { SourceModule } from "@tint/typescript/modules/model";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const programs: readonly [string, string][] = [
  ["leaf", 'log("l");export let x=await 40;log("x");'],
  ["sibling", 'log("s");'],
  [
    "root",
    'import {x} from "./leaf";import "./sibling";export const answer=x+2;log("r");',
  ],
  [
    "loop",
    'export let sum=0;for await (const value of [1,2]){sum+=value;}await using resource=disposable;log("u");export const complete=sum;',
  ],
  ["failure", "await 0;throw marker;"],
];
const generated: SourceModule[] = [],
  dependencies: [string, string][] = [
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["globals", "packages/js-runtime/src/environments/global/index.ts"],
    ["modules", "packages/js-runtime/src/modules/index.ts"],
  ];
let imports = "";
for (const [name, text] of programs) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const lowered = lowerSourceTextModule(parsed.value, text);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const id = "generated-await-" + name;
  generated.push({
    id,
    module: lowered.value,
    dependencies: new Map([
      ["@tint/js-runtime/modules", "packages/js-runtime/src/modules/index.ts"],
      ["@tint/js-runtime/objects", "packages/js-runtime/src/objects/index.ts"],
      [
        "@tint/js-runtime/environments/global",
        "packages/js-runtime/src/environments/global/index.ts",
      ],
      [
        "@tint/js-runtime/environments/records",
        "packages/js-runtime/src/environments/records/index.ts",
      ],
    ]),
  });
  dependencies.push([name, id]);
  imports += "import {create as create_" + name + '} from "' + name + '";\n';
}
const objects = "packages/js-runtime/src/objects/index.ts",
  views = ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"];
verifyHostedFixture(
  `
${imports}
import {createObject,createErrorRealm,createCallableObject,createDataProperty,callObjectValue,getProperty,installPromiseIntrinsics,installArrayIntrinsics,wellKnownSymbol,drainScriptJobs,type ObjectHooks,type ScriptPropertyKey} from "objects";
import {createGlobalEnvironment} from "globals";
import {loadRequestedModules,finishLoadingImportedModule,linkModule,evaluateModule,settledModulePromise,getModuleNamespace,type ModuleRecord,type ModuleReferrer,type ModuleRequest,type ModuleLoadPayload} from "modules";
export function run():number {
 const object=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>a===b,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>{const result=callObjectValue(callee,receiver,args,object);if(result.error!=="none")throw "MODULE_AWAIT_CALL_INVARIANT";return result.value;}};
 const realm=createErrorRealm(object,hooks),global=createGlobalEnvironment<ScriptPropertyKey,unknown>(object,object,undefined,(name:string):ScriptPropertyKey=>name,hooks),log:{text:string;fault:number}={text:"",fault:0};
 installPromiseIntrinsics(object,realm,hooks,(promise,operation):void=>{});installArrayIntrinsics(object,realm,hooks);
 const owners:{leaf:ModuleRecord|undefined;root:ModuleRecord|undefined;loop:ModuleRecord|undefined}={leaf:undefined,root:undefined,loop:undefined};
 const logger=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver:unknown,args:readonly unknown[]):unknown=>{const label=args[0],active=realm.agent.activeContext;if(typeof label!=="string")throw "MODULE_AWAIT_LOG_INVARIANT";if(active===undefined)log.fault=60;else{if((label==="l"||label==="x")&&active.scriptOrModule!==owners.leaf)log.fault=61;if(label==="r"&&active.scriptOrModule!==owners.root)log.fault=62;if(label==="u"&&active.scriptOrModule!==owners.loop)log.fault=63;}log.text=log.text+label;return undefined;},realm.executionContext);
 createDataProperty<ScriptPropertyKey,unknown>(object,"log",logger,hooks);
 const disposable=createObject<ScriptPropertyKey,unknown>(realm.objectPrototype),dispose=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver:unknown,args:readonly unknown[]):unknown=>{log.text=log.text+"D";return undefined;},realm.executionContext);
 createDataProperty<ScriptPropertyKey,unknown>(disposable,wellKnownSymbol(realm.symbolRegistry,"asyncDispose"),dispose,hooks);createDataProperty<ScriptPropertyKey,unknown>(object,"disposable",disposable,hooks);
 const marker=createObject<ScriptPropertyKey,unknown>(undefined);createDataProperty<ScriptPropertyKey,unknown>(object,"marker",marker,hooks);
 const leaf=create_leaf(global,realm,undefined),sibling=create_sibling(global,realm,undefined),root=create_root(global,realm,undefined);owners.leaf=leaf;owners.root=root;
 const table=new Map<string,ModuleRecord>();table.set("./leaf",leaf);table.set("./sibling",sibling);
 realm.moduleLoader=(referrer:ModuleReferrer,request:ModuleRequest,hostDefined:unknown,payload:ModuleLoadPayload):void=>{const target=table.get(request.specifier);if(target===undefined)throw "MODULE_AWAIT_LOADER_INVARIANT";finishLoadingImportedModule(referrer,request,payload,{ok:true,module:target});};
 if(settledModulePromise(loadRequestedModules(root,hooks,undefined),realm).kind!=="fulfilled"||!linkModule(root).ok)return 64;
 const promise=evaluateModule(root,hooks);if(settledModulePromise(promise,realm).kind!=="pending"||log.text!=="ls")return 65;
 for(let i=0;i<200000;i++){const churn:{value:number}={value:i};if(churn.value!==i)return 66;}
 drainScriptJobs(realm.agent,(error:unknown):void=>{log.fault=67;});
 if(settledModulePromise(promise,realm).kind!=="fulfilled"||log.text!=="lsxr"||log.fault!==0)return 68;
 const namespace=getModuleNamespace(root);if(getProperty<ScriptPropertyKey,unknown>(namespace,"answer",namespace,hooks)!==42)return 69;
 const loop=create_loop(global,realm,undefined);owners.loop=loop;if(settledModulePromise(loadRequestedModules(loop,hooks,undefined),realm).kind!=="fulfilled"||!linkModule(loop).ok)return 70;
 const loopPromise=evaluateModule(loop,hooks);if(settledModulePromise(loopPromise,realm).kind!=="pending")return 71;
 drainScriptJobs(realm.agent,(error:unknown):void=>{log.fault=72;});
 if(settledModulePromise(loopPromise,realm).kind!=="fulfilled"||log.text!=="lsxruD"||log.fault!==0)return 73;
 const loopNamespace=getModuleNamespace(loop);if(getProperty<ScriptPropertyKey,unknown>(loopNamespace,"complete",loopNamespace,hooks)!==3)return 74;
 const failure=create_failure(global,realm,undefined);if(settledModulePromise(loadRequestedModules(failure,hooks,undefined),realm).kind!=="fulfilled"||!linkModule(failure).ok)return 75;
 const rejected=evaluateModule(failure,hooks);drainScriptJobs(realm.agent,(error:unknown):void=>{log.fault=76;});const outcome=settledModulePromise(rejected,realm);
 if(outcome.kind!=="rejected"||outcome.error!==marker||log.fault!==0||realm.agent.activeContext!==undefined)return 77;
 return 42;
}`,
  "module-await-lowering",
  dependencies,
  generated,
  views.map((name) => ({ module: objects, name, operation: "view" as const })),
  [
    {
      module: objects,
      namespace: "module-await-views",
      retainedExports: views,
    },
  ],
);
