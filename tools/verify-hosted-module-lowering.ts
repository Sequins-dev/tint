import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule, parseScript } from "@tint/typescript/syntax";
import { lowerSourceTextModule, lowerScript } from "@tint/js-engine/lowering";
import type { SourceModule } from "@tint/typescript/modules/model";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const programs: readonly [string, string][] = [
  [
    "a",
    'import {before} from "./b";export let count=40;export function inc(){count++;}export function early(){return 42;}export const remembered=before;log("a");',
  ],
  [
    "b",
    'import {early,count} from "./a";export const before=early();export let tdz;try{count;}catch(error){tdz=error;}log("b");',
  ],
  ["bridge1", 'import * as ns from "./a";export {ns};'],
  ["bridge2", 'export * as ns from "./a";'],
  [
    "root",
    'import {count,inc} from "./a";import {before} from "./b";import {ns as n1} from "./bridge1";import {ns as n2} from "./bridge2";import * as self from "./root";export * from "./bridge1";export * from "./bridge2";export {inc};export const result=before+count;inc();export const after=count;export let importError;try{count=19;}catch(error){importError=error;}export const top=this;export var local=1;export const selfNamespace=self;export const namespaceIdentity=n1===n2;using resource=disposable;log("r");',
  ],
  ["defaultClass", "export default class {} export class Named{}"],
  ["defaultFunction", "export default (function(){})"],
  ["mutableDefault", "export default function f(){f=42;return f;}export {f};"],
  ["template", "export function get(){return (strings=>strings)`value`;}"],
  [
    "dynamic",
    'export const meta=import.meta;export function readMeta(){return import.meta;}export const promise=import("./a");',
  ],
  ["otherMeta", "export default import.meta;"],
];
const generated: SourceModule[] = [],
  dependencies: [string, string][] = [
    ["globals", "packages/js-runtime/src/environments/global/index.ts"],
    ["modules", "packages/js-runtime/src/modules/index.ts"],
    ["objects", "packages/js-runtime/src/objects/index.ts"],
  ];
let imports = "";
for (const [name, text] of programs) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const lowered = lowerSourceTextModule(parsed.value, text);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const id = "generated-" + name;
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
  dependencies.push([id, id]);
  imports += `import {create as create_${name}} from "${id}";\n`;
}
const scriptSource = 'var scriptPromise=import("./a");';
const parsedScript = parseScript(createSourceTextView(scriptSource));
assert.ok(parsedScript.ok, JSON.stringify(parsedScript));
const loweredScript = lowerScript(parsedScript.value, scriptSource);
assert.ok(loweredScript.ok, JSON.stringify(loweredScript));
const scriptId = "generated-script-root";
generated.push({
  id: scriptId,
  module: loweredScript.value,
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
dependencies.push([scriptId, scriptId]);
imports += `import {execute as execute_scriptRoot} from "${scriptId}";\n`;
const objects = "packages/js-runtime/src/objects/index.ts";
const objectViews = ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"];
verifyHostedFixture(
  `
${imports}
import {createGlobalEnvironment} from "globals";
import {loadRequestedModules,finishLoadingImportedModule,linkModule,evaluateModule,settledModulePromise,getModuleNamespace,type ModuleRecord,type ModuleRequest,type ModuleReferrer,type ModuleLoadPayload} from "modules";
import {createObject,createCallableObject,createDataProperty,createErrorRealm,getProperty,hasProperty,callObjectValue,viewObjectValue,wellKnownSymbol,createScriptRecord,drainScriptJobs,getPrototype,isExtensible,type ScriptPropertyKey,type ObjectHooks} from "objects";
export function run():number {
 const object=createObject<ScriptPropertyKey,unknown>(undefined),log:{text:string}={text:""};
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(left:unknown,right:unknown):boolean=>left===right,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>{const result=callObjectValue(callee,receiver,args,object);if(result.error!=="none")throw "MODULE_FIXTURE_CALL_INVARIANT";return result.value;}};
 const realm=createErrorRealm(object,hooks),global=createGlobalEnvironment<ScriptPropertyKey,unknown>(object,object,object,(name:string):ScriptPropertyKey=>name,hooks);
 const logging=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver:unknown,args:readonly unknown[]):unknown=>{const text=args[0];if(typeof text!=="string")throw "MODULE_FIXTURE_LOG_INVARIANT";log.text=log.text+text;return undefined;},realm.executionContext);
 createDataProperty<ScriptPropertyKey,unknown>(object,"log",logging,hooks);
 const disposable=createObject<ScriptPropertyKey,unknown>(realm.objectPrototype),dispose=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver:unknown,args:readonly unknown[]):unknown=>{log.text=log.text+"d";return undefined;},realm.executionContext);
 createDataProperty<ScriptPropertyKey,unknown>(disposable,wellKnownSymbol(realm.symbolRegistry,"dispose"),dispose,hooks);createDataProperty<ScriptPropertyKey,unknown>(object,"disposable",disposable,hooks);
 const a=create_a(global,realm,"a"),b=create_b(global,realm,"b"),bridge1=create_bridge1(global,realm,"bridge1"),bridge2=create_bridge2(global,realm,"bridge2"),root=create_root(global,realm,"root");
 const table=new Map<string,ModuleRecord>();table.set("./a",a);table.set("./b",b);table.set("./bridge1",bridge1);table.set("./bridge2",bridge2);table.set("./root",root);
 const importedBy:{value:ModuleReferrer|undefined}={value:undefined};
 realm.moduleLoader=(referrer:ModuleReferrer,request:ModuleRequest,hostDefined:unknown,payload:ModuleLoadPayload):void=>{if(payload.kind==="dynamic")importedBy.value=referrer;const target=table.get(request.specifier);if(target===undefined)throw "MODULE_FIXTURE_LOADER_INVARIANT";finishLoadingImportedModule(referrer,request,payload,{ok:true,module:target});};
 if(settledModulePromise(loadRequestedModules(root,hooks,undefined),realm).kind!=="fulfilled"||!linkModule(root).ok)return 61;
 for(let i=0;i<200000;i++){const churn:{value:number}={value:i};if(churn.value!==i)return 62;}
 if(settledModulePromise(evaluateModule(root,hooks),realm).kind!=="fulfilled")return 63;
 if(log.text!=="bard")return 64;
 const namespace=getModuleNamespace(root),aNamespace=getModuleNamespace(a),bNamespace=getModuleNamespace(b);
 if(getProperty<ScriptPropertyKey,unknown>(namespace,"result",namespace,hooks)!==82||getProperty<ScriptPropertyKey,unknown>(namespace,"after",namespace,hooks)!==41)return 65;
 if(getProperty<ScriptPropertyKey,unknown>(namespace,"top",namespace,hooks)!==undefined||hasProperty<ScriptPropertyKey,unknown>(object,"local"))return 66;
 if(getProperty<ScriptPropertyKey,unknown>(namespace,"selfNamespace",namespace,hooks)!==namespace||getProperty<ScriptPropertyKey,unknown>(namespace,"namespaceIdentity",namespace,hooks)!==true||getProperty<ScriptPropertyKey,unknown>(namespace,"ns",namespace,hooks)!==aNamespace)return 67;
 const tdz=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(bNamespace,"tdz",bNamespace,hooks),object),immutable=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(namespace,"importError",namespace,hooks),object);
 if(tdz===undefined||tdz.prototype!==realm.prototypes.get("reference")||immutable===undefined||immutable.prototype!==realm.prototypes.get("type"))return 68;
 const increment=callObjectValue(getProperty<ScriptPropertyKey,unknown>(namespace,"inc",namespace,hooks),undefined,[],object);if(increment.error!=="none"||getProperty<ScriptPropertyKey,unknown>(aNamespace,"count",aNamespace,hooks)!==42)return 69;
 const dc=create_defaultClass(global,realm,undefined),df=create_defaultFunction(global,realm,undefined),t1=create_template(global,realm,undefined),t2=create_template(global,realm,undefined);
 const records:ModuleRecord[]=[dc,df,t1,t2];for(const record of records){if(record===undefined)throw "MODULE_FIXTURE_RECORD_INVARIANT";if(settledModulePromise(loadRequestedModules(record,hooks,undefined),realm).kind!=="fulfilled"||!linkModule(record).ok||settledModulePromise(evaluateModule(record,hooks),realm).kind!=="fulfilled")return 70;}
 const dcNamespace=getModuleNamespace(dc),dfNamespace=getModuleNamespace(df),defaultClass=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(dcNamespace,"default",dcNamespace,hooks),object),defaultFunction=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(dfNamespace,"default",dfNamespace,hooks),object);
 if(defaultClass===undefined||defaultFunction===undefined||getProperty<ScriptPropertyKey,unknown>(defaultClass,"name",defaultClass,hooks)!=="default"||getProperty<ScriptPropertyKey,unknown>(defaultFunction,"name",defaultFunction,hooks)!=="default")return 71;
 const n1=getModuleNamespace(t1),n2=getModuleNamespace(t2),get1=getProperty<ScriptPropertyKey,unknown>(n1,"get",n1,hooks),get2=getProperty<ScriptPropertyKey,unknown>(n2,"get",n2,hooks),first=callObjectValue(get1,undefined,[],object),again=callObjectValue(get1,undefined,[],object),other=callObjectValue(get2,undefined,[],object);
 if(first.error!=="none"||again.error!=="none"||other.error!=="none"||first.value!==again.value||first.value===other.value)return 72;
 const capability=root.topLevelCapability;if(capability===undefined||evaluateModule(root,hooks)!==capability.promise||log.text!=="bard")return 73;
 const early=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(aNamespace,"early",aNamespace,hooks),object),namedClass=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(dcNamespace,"Named",dcNamespace,hooks),object);
 if(early===undefined||early.internalRareSlots?.internalExoticSlots?.internalSourceText!=="function early(){return 42;}")return 74;
 if(namedClass===undefined||namedClass.internalRareSlots?.internalExoticSlots?.internalSourceText!=="class Named{}")return 75;
 const md=create_mutableDefault(global,realm,undefined);if(settledModulePromise(loadRequestedModules(md,hooks,undefined),realm).kind!=="fulfilled"||!linkModule(md).ok||settledModulePromise(evaluateModule(md,hooks),realm).kind!=="fulfilled")return 76;
 const mdNamespace=getModuleNamespace(md),mutableDefault=getProperty<ScriptPropertyKey,unknown>(mdNamespace,"default",mdNamespace,hooks),changed=callObjectValue(mutableDefault,undefined,[],object);
 if(changed.error!=="none"||changed.value!==42||getProperty<ScriptPropertyKey,unknown>(mdNamespace,"default",mdNamespace,hooks)!==42||getProperty<ScriptPropertyKey,unknown>(mdNamespace,"f",mdNamespace,hooks)!==42)return 77;
 const dynamic=create_dynamic(global,realm,undefined),otherMeta=create_otherMeta(global,realm,undefined);
 const dynamicRecords:readonly ModuleRecord[]=[dynamic,otherMeta];
 for(const record of dynamicRecords){if(record===undefined)throw "MODULE_FIXTURE_RECORD_INVARIANT";if(settledModulePromise(loadRequestedModules(record,hooks,undefined),realm).kind!=="fulfilled"||!linkModule(record).ok||settledModulePromise(evaluateModule(record,hooks),realm).kind!=="fulfilled")return 78;}
 const dynamicNamespace=getModuleNamespace(dynamic),meta=getProperty<ScriptPropertyKey,unknown>(dynamicNamespace,"meta",dynamicNamespace,hooks),metaObject=viewObjectValue(meta,object);
 if(metaObject===undefined||getPrototype<ScriptPropertyKey,unknown>(metaObject)!==undefined||!isExtensible<ScriptPropertyKey,unknown>(metaObject))return 79;
 const readMeta=getProperty<ScriptPropertyKey,unknown>(dynamicNamespace,"readMeta",dynamicNamespace,hooks),readAgain=callObjectValue(readMeta,undefined,[],object);
 if(readAgain.error!=="none"||readAgain.value!==meta)return 80;
 const otherMetaNamespace=getModuleNamespace(otherMeta);if(getProperty<ScriptPropertyKey,unknown>(otherMetaNamespace,"default",otherMetaNamespace,hooks)===meta)return 81;
 const dynamicPromise=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(dynamicNamespace,"promise",dynamicNamespace,hooks),object);
 if(dynamicPromise===undefined)return 82;
 const pending=dynamicPromise.internalRareSlots?.internalExoticSlots?.internalPromiseData;if(pending===undefined||pending.state!=="pending")return 82;
 const jobFailure:{count:number}={count:0};drainScriptJobs(realm.agent,(error:unknown):void=>{jobFailure.count++;});if(jobFailure.count!==0)return 83;
 const resolved=dynamicPromise.internalRareSlots?.internalExoticSlots?.internalPromiseData;if(resolved===undefined||resolved.state!=="fulfilled"||resolved.result!==aNamespace)return 84;
 if(dynamic.loadedRequests.length!==1||dynamic.loadedRequests[0]?.module!==a)return 85;
 const scriptRecord=createScriptRecord(realm,undefined),scriptCompletion=execute_scriptRoot(global,scriptRecord);
 if(scriptCompletion.error!=="none"||importedBy.value!==scriptRecord)return 86;
 const scriptPromise=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(object,"scriptPromise",object,hooks),object);
 if(scriptPromise===undefined)return 87;const scriptData=scriptPromise.internalRareSlots?.internalExoticSlots?.internalPromiseData;if(scriptData===undefined||scriptData.state!=="pending")return 87;
 drainScriptJobs(realm.agent,(error:unknown):void=>{jobFailure.count++;});if(jobFailure.count!==0)return 88;
 const scriptResult=scriptPromise.internalRareSlots?.internalExoticSlots?.internalPromiseData;if(scriptResult===undefined||scriptResult.state!=="fulfilled"||scriptResult.result!==aNamespace)return 89;
 return 42;
}`,
  "module-lowering",
  dependencies,
  generated,
  [
    ...objectViews.map((name) => ({
      module: objects,
      name,
      operation: "view" as const,
    })),
    ...["viewModuleRecord", "viewScriptRecord"].map((name) => ({
      module: "packages/js-runtime/src/modules/index.ts",
      name,
      operation: "view" as const,
    })),
  ],
  [
    {
      module: "packages/js-runtime/src/modules/index.ts",
      namespace: "module-referrer-views",
      retainedExports: ["viewModuleRecord", "viewScriptRecord"],
    },
    {
      module: objects,
      namespace: "module-lowering-views",
      retainedExports: objectViews,
    },
  ],
);
