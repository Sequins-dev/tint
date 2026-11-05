import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceTextModule,getImportMeta,type SourceModuleShape} from "modules";
import {createObject,createErrorRealm,getPrototype,isExtensible,ownKeys,createDataProperty,getOwnProperty,deleteProperty,hasProperty,type ScriptPropertyKey,type ObjectHooks} from "objects";
const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>a===b,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>undefined};
export function run():number{
 const realm=createErrorRealm(createObject<ScriptPropertyKey,unknown>(undefined),hooks);
 const shape:SourceModuleShape={requests:[],imports:[],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const first=createSourceTextModule(realm,shape,undefined,(environment):void=>{},():void=>{},():void=>{});
 const second=createSourceTextModule(realm,shape,undefined,(environment):void=>{},():void=>{},():void=>{});
 const meta=getImportMeta(first);
 if(getPrototype<ScriptPropertyKey,unknown>(meta)!==undefined||!isExtensible<ScriptPropertyKey,unknown>(meta)||ownKeys<ScriptPropertyKey,unknown>(meta,(key:ScriptPropertyKey):number=>-1).length!==0)return 60;
 if(getImportMeta(first)!==meta||getImportMeta(second)===meta)return 61;
 if(!createDataProperty<ScriptPropertyKey,unknown>(meta,"answer",42,hooks))return 62;
 const descriptor=getOwnProperty<ScriptPropertyKey,unknown>(meta,"answer");
 if(descriptor===undefined||descriptor.accessor||descriptor.value!==42||!descriptor.writable||!descriptor.enumerable||!descriptor.configurable)return 63;
 for(let index=0;index<1024;index++){const churn=new Uint32Array(8192);churn[0]=index;if(churn[0]!==index)return 64;}
 if(getImportMeta(first)!==meta||hasProperty<ScriptPropertyKey,unknown>(getImportMeta(second),"answer"))return 65;
 if(!deleteProperty<ScriptPropertyKey,unknown>(meta,"answer")||hasProperty<ScriptPropertyKey,unknown>(getImportMeta(first),"answer"))return 66;
 return 42;
}`,
  "module-import-meta",
  [
    ["modules", "packages/js-runtime/src/modules/index.ts"],
    ["objects", "packages/js-runtime/src/objects/index.ts"],
  ],
);
