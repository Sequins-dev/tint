import { verifyHostedFixture } from "./hosted-fixture.ts";
const values = "packages/js-runtime/src/objects/values.ts";
verifyHostedFixture(
  `
import {createSourceTextModule,linkModule,evaluateModule,settledModulePromise,type ModuleRecord,type SourceModuleShape,type ModuleCapability} from "modules";
import {createObject,createErrorRealm,drainScriptJobs,type ObjectHooks,type ScriptPropertyKey} from "objects";
const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>a===b,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>undefined};
export function run():number {
 const realm=createErrorRealm(createObject<ScriptPropertyKey,unknown>(undefined),hooks);
 const log:{text:string;fault:number}={text:"",fault:0};
 const pending:{leaf:ModuleCapability|undefined;cycle:ModuleCapability|undefined;failure:ModuleCapability|undefined}={leaf:undefined,cycle:undefined,failure:undefined};
 const empty:SourceModuleShape={requests:[],imports:[],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const leaf=createSourceTextModule(realm,{...empty,hasTopLevelAwait:true},"leaf",(environment):void=>{},():void=>{},():void=>{log.fault=60;},(capability:ModuleCapability):void=>{log.text=log.text+"L";pending.leaf=capability;});
 const one:SourceModuleShape={...empty,requests:[{specifier:"leaf",attributes:[]}]};
 const a=createSourceTextModule(realm,one,"a",(environment):void=>{},():void=>{},():void=>{log.text=log.text+"A";});
 const b=createSourceTextModule(realm,one,"b",(environment):void=>{},():void=>{},():void=>{log.text=log.text+"B";});
 const sibling=createSourceTextModule(realm,empty,"sibling",(environment):void=>{},():void=>{},():void=>{log.text=log.text+"S";});
 const rootShape:SourceModuleShape={...empty,requests:[{specifier:"a",attributes:[]},{specifier:"sibling",attributes:[]},{specifier:"b",attributes:[]}]};
 const owner:{root:ModuleRecord|undefined}={root:undefined};
 const root=createSourceTextModule(realm,rootShape,"root",(environment):void=>{},():void=>{},():void=>{const active=realm.agent.activeContext;if(active===undefined||active.scriptOrModule!==owner.root)log.fault=61;log.text=log.text+"R";});owner.root=root;
 leaf.status="unlinked";a.status="unlinked";b.status="unlinked";sibling.status="unlinked";root.status="unlinked";
 a.loaded[0]=leaf;b.loaded[0]=leaf;root.loaded[0]=a;root.loaded[1]=sibling;root.loaded[2]=b;
 if(!linkModule(root).ok)return 62;
 const promise=evaluateModule(root,hooks);
 if(settledModulePromise(promise,realm).kind!=="pending"||log.text!=="LS"||root.status!=="evaluating-async"||evaluateModule(root,hooks)!==promise)return 63;
 for(let i=0;i<300000;i++){const churn:{value:number}={value:i};if(churn.value!==i)return 64;}
 const leafCapability=pending.leaf;if(leafCapability===undefined)return 65;
 leafCapability.functions.resolve(undefined);
 if(settledModulePromise(promise,realm).kind!=="pending"||log.text!=="LS")return 66;
 drainScriptJobs(realm.agent,(error:unknown):void=>{log.fault=67;});
 if(settledModulePromise(promise,realm).kind!=="fulfilled"||log.text!=="LSABR"||log.fault!==0||realm.agent.activeContext!==undefined)return 68;
 const cycleShape:SourceModuleShape={...empty,requests:[{specifier:"cycle",attributes:[]}]};
 const cycle=createSourceTextModule(realm,{...cycleShape,hasTopLevelAwait:true},"cycle",(environment):void=>{},():void=>{},():void=>{log.fault=69;},(capability:ModuleCapability):void=>{pending.cycle=capability;log.text=log.text+"C";});
 const member=createSourceTextModule(realm,cycleShape,"member",(environment):void=>{},():void=>{},():void=>{log.text=log.text+"M";});
 cycle.status="unlinked";member.status="unlinked";cycle.loaded[0]=member;member.loaded[0]=cycle;
 if(!linkModule(cycle).ok)return 70;
 const cyclePromise=evaluateModule(cycle,hooks),cycleCapability=pending.cycle;
 if(cycleCapability===undefined||settledModulePromise(cyclePromise,realm).kind!=="pending"||evaluateModule(member,hooks)!==cyclePromise||log.text!=="LSABRMC")return 71;
 cycleCapability.functions.resolve(undefined);drainScriptJobs(realm.agent,(error:unknown):void=>{log.fault=72;});
 if(settledModulePromise(cyclePromise,realm).kind!=="fulfilled"||member.cycleRoot!==cycle||member.status!=="evaluated")return 73;
 const failure=createSourceTextModule(realm,{...empty,hasTopLevelAwait:true},"failure",(environment):void=>{},():void=>{},():void=>{log.fault=74;},(capability:ModuleCapability):void=>{pending.failure=capability;});
 const parent=createSourceTextModule(realm,one,"parent",(environment):void=>{},():void=>{},():void=>{log.fault=75;});
 failure.status="unlinked";parent.status="unlinked";parent.loaded[0]=failure;
 if(!linkModule(parent).ok)return 76;
 const failurePromise=evaluateModule(parent,hooks),failureCapability=pending.failure;if(failureCapability===undefined)return 77;
 failureCapability.functions.reject(undefined);drainScriptJobs(realm.agent,(error:unknown):void=>{log.fault=78;});
 const outcome=settledModulePromise(failurePromise,realm),cached=parent.evaluationError;
 if(outcome.kind!=="rejected"||outcome.error!==undefined||cached===undefined||cached.error!==undefined||evaluateModule(parent,hooks)!==failurePromise)return 79;
 if(log.fault!==0||realm.agent.activeContext!==undefined)return 80;
 return 42;
}`,
  "module-async-evaluation",
  [
    ["modules", "packages/js-runtime/src/modules/index.ts"],
    ["objects", "packages/js-runtime/src/objects/index.ts"],
  ],
  [],
  [{ module: values, name: "viewObjectValue", operation: "view" }],
  [
    {
      module: values,
      namespace: "module-async-evaluation-views",
      retainedExports: ["viewObjectValue"],
    },
  ],
);
