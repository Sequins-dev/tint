import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceTextModule,getExportedNames,resolveExport,type ModuleRecord,type SourceModuleShape} from "modules";
import {createObject,createErrorRealm,type ScriptPropertyKey,type ObjectHooks} from "objects";
import {createMutableBinding,hasBinding} from "records";
const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>a===b,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>undefined};
function moduleRecord(shape:SourceModuleShape):ModuleRecord{
 const realm=createErrorRealm(createObject<ScriptPropertyKey,unknown>(undefined),hooks);
 const module=createSourceTextModule(realm,shape,undefined,(environment):void=>{createMutableBinding<unknown>(environment,"x",false);},():void=>{}, (): void => {});
 module.status="unlinked";return module;
}
export function run():number{
 const leafShape:SourceModuleShape={requests:[],imports:[],localExports:[{exportName:"x",localName:"x"},{exportName:"default",localName:"x"}],indirectExports:[],starExports:[],hasTopLevelAwait:false};
 const leaf=moduleRecord(leafShape),other=moduleRecord(leafShape);
 const starShape:SourceModuleShape={requests:[{specifier:"./a",attributes:[]},{specifier:"./b",attributes:[]}],imports:[],localExports:[],indirectExports:[],starExports:[0,1],hasTopLevelAwait:false};
 const root=moduleRecord(starShape);root.loaded[0]=leaf;root.loaded[1]=other;
 if(resolveExport(root,"x")!=="ambiguous"||resolveExport(root,"default")!==undefined)return 60;
 root.loaded[1]=leaf;const same=resolveExport(root,"x");if(same===undefined||typeof same==="string"||same.module!==leaf||same.bindingName!=="x")return 61;
 const a=moduleRecord(starShape),b=moduleRecord(starShape);a.loaded[0]=b;a.loaded[1]=leaf;b.loaded[0]=a;b.loaded[1]=leaf;
 const namespaceShape:SourceModuleShape={requests:[{specifier:"./a",attributes:[]}],imports:[{request:0,importName:undefined,localName:"ns"}],localExports:[],indirectExports:[{exportName:"space",request:0,importName:undefined}],starExports:[],hasTopLevelAwait:false};
 const namespace=moduleRecord(namespaceShape);namespace.loaded[0]=a;
 const namespaceOther=moduleRecord(namespaceShape);namespaceOther.loaded[0]=a;
 const namespaceDiamond=moduleRecord(starShape);namespaceDiamond.loaded[0]=namespace;namespaceDiamond.loaded[1]=namespaceOther;
 if(hasBinding<unknown>(namespace.environment,"ns"))return 62;
 for(let i=0;i<1024;i++){const bytes=new Uint32Array(8192);bytes[0]=i;if(bytes[0]!==i)return 63;}
 const result=resolveExport(a,"x");if(result===undefined||typeof result==="string"||result.module!==leaf)return 64;
 if(resolveExport(a,"missing")!==undefined)return 65;
 const names=getExportedNames(a);if(names.length!==1||names[0]!=="x")return 66;
 const ns=resolveExport(namespace,"space");if(ns===undefined||typeof ns==="string"||ns.module!==a||ns.bindingName!==undefined)return 67;
 const diamond=resolveExport(namespaceDiamond,"space");if(diamond===undefined||typeof diamond==="string"||diamond.module!==a||diamond.bindingName!==undefined)return 68;
 return 42;
}`,
  "module-resolution",
  [
    ["modules", "packages/js-runtime/src/modules/index.ts"],
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["records", "packages/js-runtime/src/environments/records/index.ts"],
  ],
);
