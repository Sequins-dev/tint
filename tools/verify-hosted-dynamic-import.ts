import { verifyHostedFixture } from "./hosted-fixture.ts";
const objectModule = "packages/js-runtime/src/objects/index.ts";
const objectViews = ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"];
const referrer = "packages/js-runtime/src/modules/referrer.ts";
verifyHostedFixture(
  `
import {createSourceTextModule,evaluateImportCall,finishLoadingImportedModule,getModuleNamespace,type ModuleReferrer,type ModuleRequest,type ModuleLoadPayload,type SourceModuleShape} from "modules";
import {viewModuleRecord,viewScriptRecord} from "referrer";
import {createObject,createErrorRealm,createScriptRecord,runScriptContext,drainScriptJobs,type OrdinaryObject,type ScriptPropertyKey,type ObjectHooks} from "objects";
const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>a===b,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>undefined};
function reject(value:unknown):boolean{return viewModuleRecord(value)===undefined&&viewScriptRecord(value)===undefined;}
export function run():number{
 const ordinary=createObject<ScriptPropertyKey,unknown>(undefined),realm=createErrorRealm(ordinary,hooks);
 const shape:SourceModuleShape={requests:[],imports:[],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const module=createSourceTextModule(realm,shape,undefined,(environment):void=>{},():void=>{},():void=>{});
 const script=createScriptRecord(realm,42);
 if(viewModuleRecord(module)!==module||viewScriptRecord(module)!==undefined)return 60;
 if(viewScriptRecord(script)!==script||viewModuleRecord(script)!==undefined)return 61;
 if(!reject(ordinary)||!reject(42)||!reject(undefined))return 62;
 for(let index=0;index<1024;index++){const churn=new Uint32Array(8192);churn[0]=index;if(churn[0]!==index)return 63;}
 const keptModule=viewModuleRecord(module),keptScript=viewScriptRecord(script);
 if(keptModule!==module||keptScript!==script||keptScript===undefined||keptScript.realm!==realm||keptScript.hostDefined!==42)return 64;
 let loaded=0;
 realm.moduleLoader=(referrer:ModuleReferrer,request:ModuleRequest,hostDefined:unknown,payload:ModuleLoadPayload):void=>{
  if(referrer!==script||request.specifier!=="./target"||payload.kind!=="dynamic")throw "DYNAMIC_IMPORT_FIXTURE_LOADER";
  loaded++;finishLoadingImportedModule(referrer,request,payload,{ok:true,module});
 };
 const promise=runScriptContext<OrdinaryObject<ScriptPropertyKey,unknown>>(realm.agent,{realm,scriptOrModule:script},():OrdinaryObject<ScriptPropertyKey,unknown>=>evaluateImportCall("./target",undefined,hooks,realm));
 const promiseData=promise.internalPromiseData;
 if(promiseData===undefined||promiseData.state!=="pending"||loaded!==1)return 80;
 const failures:{count:number}={count:0};
 const jobs=drainScriptJobs(realm.agent,(error:unknown):void=>{failures.count++;});
 if(jobs!==2||failures.count!==0)return 81;
 const settled=promise.internalPromiseData;
 if(settled===undefined||settled.state!=="fulfilled"||settled.result!==getModuleNamespace(module))return 82;
 if(script.loadedRequests.length!==1||script.loadedRequests[0]?.module!==module)return 83;
 return 42;
}`,
  "dynamic-import-views",
  [
    ["modules", "packages/js-runtime/src/modules/index.ts"],
    ["referrer", referrer],
    ["objects", "packages/js-runtime/src/objects/index.ts"],
  ],
  [],
  [
    { module: referrer, name: "viewModuleRecord", operation: "view" },
    { module: referrer, name: "viewScriptRecord", operation: "view" },
    ...objectViews.map((name) => ({
      module: objectModule,
      name,
      operation: "view" as const,
    })),
  ],
  [
    {
      module: objectModule,
      namespace: "dynamic-import-object-views",
      retainedExports: objectViews,
    },
    {
      module: referrer,
      namespace: "module-referrer-views",
      retainedExports: ["viewModuleRecord", "viewScriptRecord"],
    },
  ],
);
