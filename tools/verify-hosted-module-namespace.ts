import { verifyHostedFixture } from "./hosted-fixture.ts";
const values = "packages/js-runtime/src/objects/values.ts";
verifyHostedFixture(
  `
import {createSourceTextModule,getModuleNamespace,type SourceModuleShape} from "modules";
import {createObject,createErrorRealm,wellKnownSymbol,createSymbolValue,getPrototype,setPrototype,isExtensible,preventExtensions,hasProperty,getProperty,getOwnProperty,defineOwnProperty,deleteProperty,setProperty,ownKeys,sameValue,viewObjectValue,runScriptContext,type ScriptPropertyKey,type ObjectHooks} from "objects";
import {createMutableBinding,initializeBinding,setMutableBinding} from "records";
import {emptyUpdate,valueField,writableField,configurableField,type DescriptorUpdate} from "descriptors";
const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>sameValue(a,b),call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>undefined};
export function run():number{
 const realm=createErrorRealm(createObject<ScriptPropertyKey,unknown>(undefined),hooks);
 const shape:SourceModuleShape={requests:[],imports:[],localExports:[{exportName:"2",localName:"x"},{exportName:"10",localName:"x"},{exportName:"z",localName:"x"},{exportName:"\uffff",localName:"x"},{exportName:"\u{10000}",localName:"x"},{exportName:"x",localName:"x"}],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const module=createSourceTextModule(realm,shape,undefined,(environment):void=>{createMutableBinding<unknown>(environment,"x",false);}, (): void => {},():void=>{});module.status="unlinked";
 const namespace=getModuleNamespace(module),tag=wellKnownSymbol(realm.symbolRegistry,"toStringTag");
 if(getModuleNamespace(module)!==namespace||getPrototype<ScriptPropertyKey,unknown>(namespace)!==undefined||isExtensible<ScriptPropertyKey,unknown>(namespace)||!preventExtensions<ScriptPropertyKey,unknown>(namespace))return 60;
 if(!setPrototype<ScriptPropertyKey,unknown>(namespace,undefined)||setPrototype<ScriptPropertyKey,unknown>(namespace,realm.objectPrototype))return 61;
 if(!hasProperty<ScriptPropertyKey,unknown>(namespace,"x")||getProperty<ScriptPropertyKey,unknown>(namespace,"missing",namespace,hooks)!==undefined)return 62;
 let caught=false;try{getProperty<ScriptPropertyKey,unknown>(namespace,"x",namespace,hooks);}catch(e){const error=viewObjectValue(e,realm.objectPrototype);caught=error!==undefined&&error.prototype===realm.prototypes.get("reference");}if(!caught)return 63;
 const other=createErrorRealm(createObject<ScriptPropertyKey,unknown>(undefined),hooks,realm.symbolRegistry,realm.agent);
 const fromOther=runScriptContext<boolean>(realm.agent,{realm:other,scriptOrModule:undefined},():boolean=>{try{getOwnProperty<ScriptPropertyKey,unknown>(namespace,"x");}catch(e){const error=viewObjectValue(e,realm.objectPrototype);return error!==undefined&&error.prototype===other.prototypes.get("reference");}return false;});if(!fromOther)return 64;
 const keys=ownKeys<ScriptPropertyKey,unknown>(namespace,(key:ScriptPropertyKey):number=>typeof key==="string"?-1:-2);
 if(keys.length!==7||keys[0]!=="10"||keys[1]!=="2"||keys[2]!=="x"||keys[3]!=="z"||keys[4]!=="\u{10000}"||keys[5]!=="\uffff"||keys[6]!==tag)return 65;
 initializeBinding<unknown>(module.environment,"x",-0);
 const same:DescriptorUpdate<unknown>={...emptyUpdate<unknown>(undefined),fields:valueField,value:-0};if(defineOwnProperty<ScriptPropertyKey,unknown>(namespace,"x",same,hooks)!=="accepted")return 66;
 const different:DescriptorUpdate<unknown>={...emptyUpdate<unknown>(undefined),fields:valueField,value:0};if(defineOwnProperty<ScriptPropertyKey,unknown>(namespace,"x",different,hooks)!=="rejected")return 67;
 const readonly:DescriptorUpdate<unknown>={...emptyUpdate<unknown>(undefined),fields:writableField,writable:false};if(defineOwnProperty<ScriptPropertyKey,unknown>(namespace,"x",readonly,hooks)!=="rejected")return 68;
 const configurable:DescriptorUpdate<unknown>={...emptyUpdate<unknown>(undefined),fields:configurableField,configurable:true};if(defineOwnProperty<ScriptPropertyKey,unknown>(namespace,"x",configurable,hooks)!=="rejected")return 69;
 if(setProperty<ScriptPropertyKey,unknown>(namespace,"x",7,{object:namespace,value:namespace},hooks)||deleteProperty<ScriptPropertyKey,unknown>(namespace,"x")||deleteProperty<ScriptPropertyKey,unknown>(namespace,tag))return 70;
 const symbol=createSymbolValue("new");if(defineOwnProperty<ScriptPropertyKey,unknown>(namespace,symbol,different,hooks)!=="rejected")return 71;
 setMutableBinding<unknown>(module.environment,"x",42,true);
 for(let i=0;i<1024;i++){const data=new Uint32Array(8192);data[0]=i;if(data[0]!==i)return 72;}
 if(getProperty<ScriptPropertyKey,unknown>(namespace,"x",namespace,hooks)!==42||getProperty<ScriptPropertyKey,unknown>(namespace,tag,namespace,hooks)!=="Module")return 73;
 const descriptor=getOwnProperty<ScriptPropertyKey,unknown>(namespace,"x");if(descriptor===undefined||descriptor.value!==42||!descriptor.writable||!descriptor.enumerable||descriptor.configurable)return 74;
 return 42;
}`,
  "module-namespace",
  [
    ["modules", "packages/js-runtime/src/modules/index.ts"],
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["records", "packages/js-runtime/src/environments/records/index.ts"],
    ["descriptors", "packages/js-runtime/src/descriptors/index.ts"],
  ],
  [],
  [{ module: values, name: "viewObjectValue", operation: "view" }],
  [
    {
      module: values,
      namespace: "module-object-views",
      retainedExports: ["viewObjectValue"],
    },
  ],
);
