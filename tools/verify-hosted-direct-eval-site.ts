import { verifyHostedFixture } from "./hosted-fixture.ts";

const globalModule = "packages/js-runtime/src/environments/global/index.ts";
verifyHostedFixture(
  `
import {createObject,createErrorRealm,createScriptRecord,type ScriptRecord,type ScriptPropertyKey,type ObjectHooks} from "objects";
import {createDeclarativeEnvironment,createMutableBinding,initializeBinding,getBindingValue} from "records";
import {createGlobalEnvironment,createGlobalScope,createDeclarativeScope,viewDirectEvalSite,type DirectEvalSite,type DirectEvalCatch} from "global";
const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>a===b,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>undefined};
function check(value:unknown):number{
 const site=viewDirectEvalSite(value);
 if(site===undefined)return 60;
 const caught=site.catches;
 if(caught===undefined)return 61;
 const outer=caught.outer;
 if(outer===undefined||outer.outer!==undefined)return 62;
 const lexicalOuter=site.lexical.outer;
 if(site.lexical.declarative!==caught.record||lexicalOuter===undefined)return 63;
 if(lexicalOuter.declarative!==outer.record)return 63;
 if(site.lexical.global!==site.variables.global||site.variables.outer!==undefined)return 64;
 if(getBindingValue<unknown>(caught.record,"inner").value!==23||getBindingValue<unknown>(outer.record,"outer").value!==19)return 65;
 if(site.scriptOrModule!==site.thisValue||site.newTarget!==undefined)return 66;
 return 42;
}
function make():ScriptRecord{
 const object=createObject<ScriptPropertyKey,unknown>(undefined);
 const global=createGlobalEnvironment<ScriptPropertyKey,unknown>(object,object,object,(name:string):ScriptPropertyKey=>name,hooks);
 const variables=createGlobalScope<ScriptPropertyKey,unknown>(global);
 const a=createDeclarativeEnvironment<unknown>(undefined),b=createDeclarativeEnvironment<unknown>(undefined);
 createMutableBinding<unknown>(a,"outer",false);initializeBinding<unknown>(a,"outer",19);
 createMutableBinding<unknown>(b,"inner",false);initializeBinding<unknown>(b,"inner",23);
 const first:DirectEvalCatch<unknown>={record:a,outer:undefined};
 const catches:DirectEvalCatch<unknown>={record:b,outer:first};
 const lexical=createDeclarativeScope<ScriptPropertyKey,unknown>(createDeclarativeScope<ScriptPropertyKey,unknown>(variables,a),b);
 const site:DirectEvalSite={scriptOrModule:object,lexical,variables,catches,thisValue:object,newTarget:undefined,home:undefined,derived:undefined,activeFunction:undefined,privateEnvironment:undefined};
 if(viewDirectEvalSite(site)!==site)throw "SITE_IDENTITY";
 return createScriptRecord(createErrorRealm(object,hooks),site);
}
function rejectOtherRecords(carrier:ScriptRecord):number{
 const site=viewDirectEvalSite(carrier.hostDefined);
 if(site===undefined)return 67;
 if(viewDirectEvalSite(carrier)!==undefined||viewDirectEvalSite(createObject<ScriptPropertyKey,unknown>(undefined))!==undefined||viewDirectEvalSite(site.variables)!==undefined||viewDirectEvalSite(site.catches)!==undefined)return 68;
 if(viewDirectEvalSite(7)!==undefined||viewDirectEvalSite("s")!==undefined||viewDirectEvalSite(undefined)!==undefined||viewDirectEvalSite(null)!==undefined||viewDirectEvalSite(true)!==undefined)return 69;

 return 42;
}
export function run():number{
 const carrier=make();
 const rejection=rejectOtherRecords(carrier);
 if(rejection!==42)return rejection;
 for(let i=0;i<1024;i++){const bytes=new Uint32Array(8192);bytes[0]=i;if(bytes[0]!==i)return 70;}
 return check(carrier.hostDefined);
}`,
  "direct-eval-site",
  [
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["records", "packages/js-runtime/src/environments/records/index.ts"],
    ["global", globalModule],
  ],
  [],
  [{ module: globalModule, name: "viewDirectEvalSite", operation: "view" }],
  [
    {
      module: globalModule,
      namespace: "global-environment",
      retainedExports: ["viewDirectEvalSite"],
    },
  ],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
