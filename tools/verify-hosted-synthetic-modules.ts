import { verifyHostedFixture } from "./hosted-fixture.ts";
const objects = "packages/js-runtime/src/objects/index.ts";
verifyHostedFixture(
  `
import {createSyntheticModule,setSyntheticModuleExport,createSourceTextModule,loadRequestedModules,finishLoadingImportedModule,linkModule,evaluateModule,settledModulePromise,getModuleNamespace,getExportedNames,resolveExport,type ModuleRecord,type SourceModuleShape,type ModuleReferrer,type ModuleRequest,type ModuleLoadPayload} from "modules";
import {createObject,createErrorRealm,getProperty,runScriptContext,type ObjectHooks,type ScriptPropertyKey} from "objects";
import {getBindingValue,setMutableBinding,findBinding} from "records";
const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>a===b,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>undefined};
export function run():number{
 const witness=createObject<ScriptPropertyKey,unknown>(undefined),realm=createErrorRealm(witness,hooks),state:{calls:number;fail:number}={calls:0,fail:0};
 const synthetic=createSyntheticModule(realm,["default"],(current:ModuleRecord):void=>{const active=realm.agent.activeContext;if(active===undefined||active.scriptOrModule!==current)state.fail=60;state.calls++;setSyntheticModuleExport(current,"default",state.calls);},undefined);
 if(settledModulePromise(loadRequestedModules(synthetic,hooks,undefined),realm).kind!=="fulfilled"||!linkModule(synthetic).ok)return 61;
 const namespace=getModuleNamespace(synthetic);if(getProperty<ScriptPropertyKey,unknown>(namespace,"default",namespace,hooks)!==undefined||state.calls!==0)return 62;
 const first=evaluateModule(synthetic,hooks);if(settledModulePromise(first,realm).kind!=="fulfilled"||getProperty<ScriptPropertyKey,unknown>(namespace,"default",namespace,hooks)!==1)return 63;
 runScriptContext<void>(realm.agent,{realm,scriptOrModule:"caller"},():void=>{const second=evaluateModule(synthetic,hooks);if(first===second||settledModulePromise(second,realm).kind!=="fulfilled")state.fail=64;const active=realm.agent.activeContext;if(active===undefined||active.scriptOrModule!=="caller")state.fail=65;});
 if(state.fail!==0||state.calls!==2||synthetic.topLevelCapability!==undefined||synthetic.cycleRoot!==undefined)return 66;
 const names=getExportedNames(synthetic,[synthetic]),resolved=resolveExport(synthetic,"default",[{module:synthetic,exportName:"default"}]);if(names.length!==1||names[0]!=="default"||resolved===undefined||typeof resolved==="string"||resolved.module!==synthetic)return 67;
 const shape:SourceModuleShape={requests:[{specifier:"./value",attributes:[]}],imports:[{request:0,importName:"default",localName:"data"}],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const importer=createSourceTextModule(realm,shape,undefined,(environment):void=>{},():void=>{},():void=>{});realm.moduleLoader=(referrer:ModuleReferrer,request:ModuleRequest,hostDefined:unknown,payload:ModuleLoadPayload):void=>{finishLoadingImportedModule(referrer,request,payload,{ok:true,module:synthetic});};
 if(settledModulePromise(loadRequestedModules(importer,hooks,undefined),realm).kind!=="fulfilled"||!linkModule(importer).ok)return 68;
 const cell=findBinding<unknown>(importer.environment,"data");if(getBindingValue<unknown>(importer.environment,"data").value!==undefined)return 69;
 if(settledModulePromise(evaluateModule(importer,hooks),realm).kind!=="fulfilled"||getBindingValue<unknown>(importer.environment,"data").value!==3)return 70;
 if(!linkModule(synthetic).ok||getBindingValue<unknown>(importer.environment,"data").value!==undefined||findBinding<unknown>(importer.environment,"data")!==cell)return 71;
 evaluateModule(synthetic,hooks);if(getBindingValue<unknown>(importer.environment,"data").value!==4||setMutableBinding<unknown>(importer.environment,"data",99,true)!=="type")return 72;
 const rejected=createSyntheticModule(realm,[],(current:ModuleRecord):void=>{throw undefined;},undefined);if(settledModulePromise(loadRequestedModules(rejected,hooks,undefined),realm).kind!=="fulfilled"||!linkModule(rejected).ok)return 73;
 const rejectionA=evaluateModule(rejected,hooks),rejectionB=evaluateModule(rejected,hooks);if(rejectionA===rejectionB)return 74;const errorA=settledModulePromise(rejectionA,realm),errorB=settledModulePromise(rejectionB,realm);if(errorA.kind!=="rejected"||errorA.error!==undefined||errorB.kind!=="rejected"||errorB.error!==undefined||rejected.evaluationError!==undefined)return 75;
 for(let i=0;i<200000;i++){const value:{n:number}={n:i};if(value.n!==i)return 76;}
 if(getProperty<ScriptPropertyKey,unknown>(namespace,"default",namespace,hooks)!==4||getBindingValue<unknown>(importer.environment,"data").value!==4||realm.agent.activeContext!==undefined||state.fail!==0)return 77;
 return 42;
}`,
  "synthetic-modules",
  [
    ["modules", "packages/js-runtime/src/modules/index.ts"],
    ["objects", objects],
    ["records", "packages/js-runtime/src/environments/records/index.ts"],
  ],
  [],
  ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"].map((name) => ({
    module: objects,
    name,
    operation: "view" as const,
  })),
  [
    {
      module: objects,
      namespace: "synthetic-module-views",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
  { managedBytes: 4194304, allocationCapacity: 65536 },
);
