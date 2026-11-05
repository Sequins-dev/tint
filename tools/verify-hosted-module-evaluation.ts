import { verifyHostedFixture } from "./hosted-fixture.ts";
const values = "packages/js-runtime/src/objects/values.ts";
verifyHostedFixture(
  `
import {createLoweredSourceModule,canonicalModuleRequest,createSourceTextModule,loadRequestedModules,finishLoadingImportedModule,linkModule,evaluateModule,settledModulePromise,type ModuleRecord,type ModuleRequest,type GraphLoadingState,type ModuleReferrer,type ModuleLoadPayload,type SourceModuleShape} from "modules";
import {createGlobalEnvironment} from "globals";
import {createObject,createErrorRealm,viewObjectValue,runScriptContext,enqueueScriptJob,drainScriptJobs,type ObjectHooks,type ScriptPropertyKey,type ScriptCompletionRecord} from "objects";
const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>a===b,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>undefined};
export function run():number {
 const canonical=canonicalModuleRequest({specifier:"m",attributes:[{key:"\uE000",value:"bmp"},{key:"𐀀",value:"astral"}]}),firstAttribute=canonical.attributes[0],secondAttribute=canonical.attributes[1];
 if(firstAttribute===undefined||secondAttribute===undefined||firstAttribute.key!=="𐀀"||secondAttribute.key!=="\uE000")return 92;
 const realm=createErrorRealm(createObject<ScriptPropertyKey,unknown>(undefined),hooks);
 const log:{text:string;failure:number}={text:"",failure:0};
 const empty:SourceModuleShape={requests:[],imports:[],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const leaf=createSourceTextModule(realm,empty,"leaf",(environment):void=>{},():void=>{},():void=>{log.text=log.text+"l";});
 const aShape:SourceModuleShape={requests:[{specifier:"leaf",attributes:[]}],imports:[],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const a=createSourceTextModule(realm,aShape,"a",(environment):void=>{},():void=>{},():void=>{log.text=log.text+"a";});
 const owner:{root:ModuleRecord|undefined}={root:undefined};
 const rootShape:SourceModuleShape={requests:[{specifier:"a",attributes:[]},{specifier:"leaf",attributes:[]}],imports:[],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const root=createSourceTextModule(realm,rootShape,"root",(environment):void=>{},():void=>{},():void=>{
  const current=owner.root,active=realm.agent.activeContext;if(current===undefined||active===undefined||active.scriptOrModule!==current)log.failure=70;
  log.text=log.text+"r";
  enqueueScriptJob(realm.agent,():void=>{const active=realm.agent.activeContext;if(active===undefined||active.scriptOrModule!==owner.root)log.failure=71;log.text=log.text+"j";},realm.executionContext);
 });owner.root=root;
 realm.moduleLoader=(referrer:ModuleReferrer,request:ModuleRequest,hostDefined:unknown,payload:ModuleLoadPayload):void=>{
  if(root.status!=="new")log.failure=72;
  log.text=log.text+request.specifier+",";
  if(request.specifier==="a")finishLoadingImportedModule(referrer,request,payload,{ok:true,module:a});
  else if(request.specifier==="leaf")finishLoadingImportedModule(referrer,request,payload,{ok:true,module:leaf});
  else finishLoadingImportedModule(referrer,request,payload,{ok:false,error:42});
 };
 const loading=loadRequestedModules(root,hooks, undefined);if(settledModulePromise(loading,realm).kind!=="fulfilled"||root.status!=="unlinked"||a.status!=="unlinked"||leaf.status!=="unlinked"||log.text!=="a,leaf,leaf,")return 73;
 if(!linkModule(root).ok)return 74;
 for(let i=0;i<200000;i++){const churn:{value:number}={value:i};if(churn.value!==i)return 75;}
 const promise=evaluateModule(root,hooks);if(settledModulePromise(promise,realm).kind!=="fulfilled"||log.text!=="a,leaf,leaf,lar")return 76;
 if(evaluateModule(root,hooks)!==promise)return 77;
 if(drainScriptJobs(realm.agent,(error:unknown):void=>{log.failure=78;})!==1||log.text!=="a,leaf,leaf,larj"||log.failure!==0)return 78;
 const error=createObject<ScriptPropertyKey,unknown>(undefined),failure=createSourceTextModule(realm,empty,undefined,(environment):void=>{},():void=>{},():void=>{throw error;});failure.status="unlinked";linkModule(failure);
 const rejected=evaluateModule(failure,hooks),outcome=settledModulePromise(rejected,realm);const cached=failure.evaluationError;if(outcome.kind!=="rejected"||outcome.error!==error||cached===undefined||cached.error!==error)return 79;
 const undefinedFailure=createSourceTextModule(realm,empty,undefined,(environment):void=>{},():void=>{},():void=>{throw undefined;});undefinedFailure.status="unlinked";linkModule(undefinedFailure);const undefinedOutcome=settledModulePromise(evaluateModule(undefinedFailure,hooks),realm);if(undefinedOutcome.kind!=="rejected"||undefinedOutcome.error!==undefined||undefinedFailure.evaluationError===undefined)return 80;
 const missing=createSourceTextModule(realm,{requests:[{specifier:"missing",attributes:[]}],imports:[],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false},undefined,(environment):void=>{},():void=>{}, (): void => {});
 const missingOutcome=settledModulePromise(loadRequestedModules(missing,hooks, undefined),realm);if(missingOutcome.kind!=="rejected"||missingOutcome.error!==42||missing.status!=="new")return 81;
 const attributes=createSourceTextModule(realm,{requests:[{specifier:"leaf",attributes:[{key:"type",value:"json"}]}],imports:[],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false},undefined,(environment):void=>{},():void=>{}, (): void => {});
 const attrOutcome=settledModulePromise(loadRequestedModules(attributes,hooks, undefined),realm);if(attrOutcome.kind!=="rejected")return 82;const syntax=viewObjectValue(attrOutcome.error,realm.objectPrototype);if(syntax===undefined||syntax.prototype!==realm.prototypes.get("syntax"))return 83;
 const cycleShape:SourceModuleShape={requests:[{specifier:"root",attributes:[]}],imports:[],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const cycleRoot=createSourceTextModule(realm,cycleShape,undefined,(environment):void=>{},():void=>{},():void=>{throw error;});
 const cycleMember=createSourceTextModule(realm,cycleShape,undefined,(environment):void=>{},():void=>{},():void=>{log.text=log.text+"c";});
 cycleRoot.status="unlinked";cycleMember.status="unlinked";cycleRoot.loaded[0]=cycleMember;cycleMember.loaded[0]=cycleRoot;
 if(!linkModule(cycleRoot).ok)return 84;
 const cyclePromise=evaluateModule(cycleRoot,hooks),cycleOutcome=settledModulePromise(cyclePromise,realm),cycleError=cycleMember.evaluationError;
 if(cycleOutcome.kind!=="rejected"||cycleOutcome.error!==error||cycleError===undefined||cycleError.error!==error||cycleMember.cycleRoot!==undefined)return 85;
 const memberPromise=evaluateModule(cycleMember,hooks),memberOutcome=settledModulePromise(memberPromise,realm);
 if(memberPromise===cyclePromise||memberOutcome.kind!=="rejected"||memberOutcome.error!==error||evaluateModule(cycleRoot,hooks)!==cyclePromise||log.text!=="a,leaf,leaf,larjmissing,c")return 86;
 const lateShape:SourceModuleShape={requests:[{specifier:"a",attributes:[]},{specifier:"leaf",attributes:[]}],imports:[],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const late=createSourceTextModule(realm,lateShape,undefined,(environment):void=>{},():void=>{},():void=>{});
 const payload:{value:GraphLoadingState|undefined}={value:undefined};
 realm.moduleLoader=(referrer:ModuleReferrer,request:ModuleRequest,hostDefined:unknown,state:ModuleLoadPayload):void=>{if(state.kind!=="graph")throw "MODULE_FIXTURE_PAYLOAD";payload.value=state;};
 const latePromise=loadRequestedModules(late,hooks,undefined),state=payload.value,firstRequest=lateShape.requests[0],secondRequest=lateShape.requests[1];
 if(state===undefined||firstRequest===undefined||secondRequest===undefined)return 87;
 finishLoadingImportedModule(late,firstRequest,state,{ok:false,error:19});finishLoadingImportedModule(late,secondRequest,state,{ok:true,module:leaf});
 const lateOutcome=settledModulePromise(latePromise,realm);
 if(lateOutcome.kind!=="rejected"||lateOutcome.error!==19||late.loaded[1]!==leaf||late.status!=="new")return 88;
 const overlapShape:SourceModuleShape={requests:[{specifier:"leaf",attributes:[]}],imports:[],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const overlap=createSourceTextModule(realm,overlapShape,undefined,(environment):void=>{},():void=>{},():void=>{});
 const overlapping:{first:GraphLoadingState|undefined;second:GraphLoadingState|undefined}={first:undefined,second:undefined};
 realm.moduleLoader=(referrer:ModuleReferrer,request:ModuleRequest,hostDefined:unknown,state:ModuleLoadPayload):void=>{if(state.kind!=="graph")throw "MODULE_FIXTURE_PAYLOAD";if(overlapping.first===undefined)overlapping.first=state;else overlapping.second=state;};
 const firstLoad=loadRequestedModules(overlap,hooks,undefined),secondLoad=loadRequestedModules(overlap,hooks,undefined),firstState=overlapping.first,secondState=overlapping.second,overlapRequest=overlapShape.requests[0];
 if(firstState===undefined||secondState===undefined||overlapRequest===undefined)return 89;
 finishLoadingImportedModule(overlap,overlapRequest,firstState,{ok:true,module:leaf});
 if(settledModulePromise(firstLoad,realm).kind!=="fulfilled"||!linkModule(overlap).ok||settledModulePromise(evaluateModule(overlap,hooks),realm).kind!=="fulfilled")return 90;
 finishLoadingImportedModule(overlap,overlapRequest,secondState,{ok:true,module:leaf});
 if(settledModulePromise(secondLoad,realm).kind!=="fulfilled"||overlap.status!=="evaluated"||leaf.status!=="evaluated")return 91;
 const globalObject=createObject<ScriptPropertyKey,unknown>(undefined),global=createGlobalEnvironment<ScriptPropertyKey,unknown>(globalObject,globalObject,undefined,(name:string):ScriptPropertyKey=>name,hooks);
 const source=createLoweredSourceModule(global,realm,undefined,empty,{variables:["v","v"],lexical:[{name:"c",constant:true}],functions:[]},(scope,environment):readonly unknown[]=>[],(scope,environment):ScriptCompletionRecord=>({error:"none",value:undefined}));
 source.status="unlinked";if(!linkModule(source).ok||settledModulePromise(evaluateModule(source,hooks),realm).kind!=="fulfilled")return 93;
 const badCompletion=createLoweredSourceModule(global,realm,undefined,empty,{variables:[],lexical:[],functions:[]},(scope,environment):readonly unknown[]=>[],(scope,environment):ScriptCompletionRecord=>({error:"invalid",value:undefined}));badCompletion.status="unlinked";linkModule(badCompletion);
 let faultObserved=false;try{evaluateModule(badCompletion,hooks);}catch(error){faultObserved=error==="MODULE_COMPLETION_INVARIANT";}
 if(!faultObserved||badCompletion.evaluationError!==undefined||badCompletion.executionFault===undefined)return 94;
 return 42;
}`,
  "module-evaluation",
  [
    ["modules", "packages/js-runtime/src/modules/index.ts"],
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["globals", "packages/js-runtime/src/environments/global/index.ts"],
  ],
  [],
  [{ module: values, name: "viewObjectValue", operation: "view" }],
  [
    {
      module: values,
      namespace: "module-evaluation-views",
      retainedExports: ["viewObjectValue"],
    },
  ],
);
