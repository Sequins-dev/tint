import { verifyHostedFixture } from "./hosted-fixture.ts";
const values = "packages/js-runtime/src/objects/values.ts";
verifyHostedFixture(
  `
import {createSourceTextModule,linkModule,getModuleNamespace,type SourceModuleShape,type ModuleRecord,type ModuleLinkResult} from "modules";
import {createObject,createErrorRealm,createSourceFunction,callObjectValue,getProperty,viewObjectValue,runScriptContext,type ObjectHooks,type ScriptPropertyKey} from "objects";
import {createMutableBinding,initializeBinding,getBindingValue,setMutableBinding} from "records";
const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>a===b,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>undefined};
export function run():number{
 const realm=createErrorRealm(createObject<ScriptPropertyKey,unknown>(undefined),hooks),log:{text:string;failure:number}={text:"",failure:0};
 const owner:{module:ModuleRecord|undefined}={module:undefined};
 const aShape:SourceModuleShape={requests:[{specifier:"./b",attributes:[]}],imports:[],localExports:[{exportName:"x",localName:"x"},{exportName:"f",localName:"f"}],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const a=createSourceTextModule(realm,aShape,undefined,(environment):void=>{createMutableBinding<unknown>(environment,"x",false);createMutableBinding<unknown>(environment,"f",false);},():void=>{
  const current=owner.module;if(current===undefined)throw "LINK_FIXTURE_OWNER";
  const active=realm.agent.activeContext;if(active===undefined||active.scriptOrModule!==current)log.failure=61;
  log.text=log.text+"a";initializeBinding<unknown>(current.environment,"x",42);
  const f=createSourceFunction((receiver:unknown,args:readonly unknown[],callee:unknown,newTarget:unknown):unknown=>{const active=realm.agent.activeContext;return active!==undefined&&active.scriptOrModule===current?42:0;},true,realm,hooks,"f",0);
  initializeBinding<unknown>(current.environment,"f",f);
 }, (): void => {});owner.module=a;
 const bOwner:{module:ModuleRecord|undefined}={module:undefined};
 const bShape:SourceModuleShape={requests:[{specifier:"./a",attributes:[]}],imports:[{request:0,importName:"x",localName:"alias"}],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const b=createSourceTextModule(realm,bShape,undefined,(environment):void=>{},():void=>{const current=bOwner.module;if(current===undefined)throw "LINK_FIXTURE_OWNER";log.text=log.text+"b";if(getBindingValue<unknown>(current.environment,"alias").error!=="reference"||setMutableBinding<unknown>(current.environment,"alias",7,false)!=="type")log.failure=62;}, (): void => {});bOwner.module=b;
 a.loaded[0]=b;b.loaded[0]=a;a.status="unlinked";b.status="unlinked";
 const outside={value:1};
 const result=runScriptContext<ModuleLinkResult>(realm.agent,{realm,scriptOrModule:outside},():ModuleLinkResult=>linkModule(a));
 if(!result.ok||log.text!=="ba"||log.failure!==0||a.status!=="linked"||b.status!=="linked")return 60;
 if(realm.agent.activeContext!==undefined||getBindingValue<unknown>(b.environment,"alias").value!==42)return 63;
 const namespace=getModuleNamespace(a);
 for(let i=0;i<1024;i++){const bytes=new Uint32Array(8192);bytes[0]=i;if(bytes[0]!==i)return 64;}
 const f=getProperty<ScriptPropertyKey,unknown>(namespace,"f",namespace,hooks);
 const call=runScriptContext<boolean>(realm.agent,{realm,scriptOrModule:outside},():boolean=>{const invoked=callObjectValue(f,undefined,[],realm.objectPrototype);const active=realm.agent.activeContext;return invoked.error==="none"&&invoked.value===42&&active!==undefined&&active.scriptOrModule===outside;});if(!call)return 65;
 if(!linkModule(a).ok||log.text!=="ba")return 66;
 const empty:SourceModuleShape={requests:[],imports:[],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const child=createSourceTextModule(realm,empty,undefined,(environment):void=>{},():void=>{log.text=log.text+"c";}, (): void => {});child.status="unlinked";
 const rootShape:SourceModuleShape={requests:[{specifier:"./cycle",attributes:[]},{specifier:"./child",attributes:[]}],imports:[{request:1,importName:"absent",localName:"missing"}],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const root=createSourceTextModule(realm,rootShape,undefined,(environment):void=>{},():void=>{log.failure=67;}, (): void => {});root.status="unlinked";
 const cycleShape:SourceModuleShape={requests:[{specifier:"./root",attributes:[]}],imports:[],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const cycle=createSourceTextModule(realm,cycleShape,undefined,(environment):void=>{},():void=>{log.text=log.text+"d";}, (): void => {});cycle.status="unlinked";
 root.loaded[0]=cycle;root.loaded[1]=child;cycle.loaded[0]=root;
 const first=linkModule(root),second=linkModule(root);if(first.ok||second.ok)return 68;
 if(first.error===second.error||log.text!=="badc"||root.status!=="unlinked"||cycle.status!=="unlinked"||child.status!=="linked"||!cycle.environmentInitialized||root.environmentInitialized)return 69;
 const other=createErrorRealm(createObject<ScriptPropertyKey,unknown>(undefined),hooks,realm.symbolRegistry,realm.agent);
 const foreign=runScriptContext<ModuleLinkResult>(realm.agent,{realm:other,scriptOrModule:outside},():ModuleLinkResult=>linkModule(root));if(foreign.ok)return 70;const error=viewObjectValue(foreign.error,realm.objectPrototype);if(error===undefined||error.prototype!==other.prototypes.get("syntax")||realm.agent.activeContext!==undefined)return 71;
 return 42;
}`,
  "module-linking",
  [
    ["modules", "packages/js-runtime/src/modules/index.ts"],
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["records", "packages/js-runtime/src/environments/records/index.ts"],
  ],
  [],
  [{ module: values, name: "viewObjectValue", operation: "view" }],
  [
    {
      module: values,
      namespace: "module-link-views",
      retainedExports: ["viewObjectValue"],
    },
  ],
);
