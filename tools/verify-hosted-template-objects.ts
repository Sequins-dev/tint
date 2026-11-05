import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
import {type ScriptPropertyKey,createObject,createErrorRealm,createScriptRecord,getScriptTemplateSite,getTemplateObject,getOwnProperty,testIntegrityLevel,viewObjectValue,type TemplateSite,type ObjectHooks} from "object";
export function run():number {
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):unknown=>{throw "UNEXPECTED_TEMPLATE_CALL";}};
 const first=createErrorRealm(createObject<ScriptPropertyKey,unknown>(undefined),hooks);
 const second=createErrorRealm(createObject<ScriptPropertyKey,unknown>(undefined),hooks);
 const owner=createScriptRecord(first,undefined),otherOwner=createScriptRecord(first,owner);
 const recipe:TemplateSite={cooked:["shared"],raw:["shared"]};
 const parsed=getScriptTemplateSite(owner,0,recipe);
 if(getScriptTemplateSite(owner,0,recipe)!==parsed)return 9;
 if(getScriptTemplateSite(otherOwner,0,recipe)===parsed)return 10;
 if(getScriptTemplateSite(owner,1,recipe)===parsed)return 11;
 const cached=getTemplateObject(parsed,first,hooks);
 if(getTemplateObject(parsed,second,hooks)===cached)return 12;
 for(let i=0;i<10000;i++){createObject<ScriptPropertyKey,unknown>(undefined);}
 if(getScriptTemplateSite(owner,0,recipe)!==parsed||getTemplateObject(parsed,first,hooks)!==cached)return 13;
 const site:TemplateSite={cooked:["a",undefined],raw:["a","invalid"]};
 const value=getTemplateObject(site,first,hooks);
 if(getTemplateObject(site,first,hooks)!==value)return 1;
 if(getTemplateObject(site,second,hooks)===value)return 2;
 const other:TemplateSite={cooked:["a",undefined],raw:["a","invalid"]};
 if(getTemplateObject(other,first,hooks)===value)return 3;
 const descriptor=getOwnProperty<ScriptPropertyKey,unknown>(value,"raw");
 if(descriptor===undefined||descriptor.writable||descriptor.enumerable||descriptor.configurable)return 4;
 const raw=viewObjectValue(descriptor.value,value);
 if(raw===undefined||!testIntegrityLevel<ScriptPropertyKey,unknown>(raw,true, (key):number=>-1)||!testIntegrityLevel<ScriptPropertyKey,unknown>(value,true, (key):number=>-1))return 5;
 if(raw.prototype!==first.arrayPrototype||value.prototype!==first.arrayPrototype)return 6;
 const missing=getOwnProperty<ScriptPropertyKey,unknown>(value,"1");
 if(missing===undefined||missing.value!==undefined)return 7;
 for(let i=0;i<10000;i++){createObject<ScriptPropertyKey,unknown>(undefined);}
 if(getTemplateObject(site,first,hooks)!==value)return 8;
 return 42;
}
`,
  "template-objects",
  [["object", "packages/js-runtime/src/objects/index.ts"]],
  [],
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewObjectValue",
      operation: "view",
    },
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewSymbolValue",
      operation: "view",
    },
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewBigIntValue",
      operation: "view",
    },
  ],
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
);
