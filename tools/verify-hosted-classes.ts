import { verifyHostedFixture } from "./hosted-fixture.ts";

// Runtime class contracts only; source class syntax is validated separately as
// the frontend gains support. This fixture is not a Test262 pass.
verifyHostedFixture(
  `
import {type ScriptPropertyKey,
 createSourceFunction,createDerivedClass,constructSuper,getDerivedThis,createObject,createErrorRealm,createBaseClass,defineClassMethod,defineClassAccessor,initializeClassFields,
 createDataProperty,defineOwnProperty,getOwnProperty,getProperty,preventExtensions,
 viewObjectValue,callObjectValue,constructObjectValue,constructObject,createConstructorObject,
 sameValue,type ObjectHooks,type ClassField,
} from "object";
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>sameValue(a,b),call:(callee,receiver,args):unknown=>{
   const called=callObjectValue(callee,receiver,args,root);if(called.error!=="none")throw "CALL_FAILED";return called.value;
 }};
 const realm=createErrorRealm(root,hooks);
 let trace=0, setters=0;
 const fields:ClassField[]=[
  {name:"x",initialize:(receiver,args):unknown=>{trace=trace*10+1;return 41;}},
  {name:"y",initialize:(receiver,args):unknown=>{trace=trace*10+2;const object=viewObjectValue(receiver,root);if(object===undefined)throw "INSTANCE";const x=getProperty<ScriptPropertyKey,unknown>(object,"x",receiver,hooks);return typeof x==="number"?x+1:0;}},
 ];
 const c=createBaseClass("C",1,(receiver,args,newTarget):unknown=>{trace=trace*10+3;return undefined;},fields,realm,hooks);
 const prototype=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(c,"prototype",c,hooks),root);
 if(prototype===undefined)return 1;
 const setter=createConstructorObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{setters++;return undefined;},(args,target):unknown=>root);
 defineOwnProperty<ScriptPropertyKey,unknown>(prototype,"x",{fields:8,value:undefined,writable:false,enumerable:false,configurable:false,get:undefined,set:setter},hooks);
 defineClassMethod(prototype,"get",0,(receiver,args):unknown=>{const object=viewObjectValue(receiver,root);return object===undefined?undefined:getProperty<ScriptPropertyKey,unknown>(object,"y",receiver,hooks);},realm,hooks);
 defineClassMethod(c,"self",0,(receiver,args):unknown=>receiver,realm,hooks);
 const built=constructObjectValue(c,[],root);
 const first=viewObjectValue(built.value,root);
 if(built.error!=="none"||first===undefined)return 2;
 if(trace!==123||setters!==0)return 3;
 const descriptor=getOwnProperty<ScriptPropertyKey,unknown>(first,"x");
 if(descriptor===undefined||!descriptor.writable||!descriptor.enumerable||!descriptor.configurable)return 4;
 if(first.prototype!==prototype)return 5;
 const method=getProperty<ScriptPropertyKey,unknown>(first,"get",first,hooks);
 if(callObjectValue(method,first,[],root).value!==42)return 6;
 const borrowed=createObject<ScriptPropertyKey,unknown>(root);createDataProperty<ScriptPropertyKey,unknown>(borrowed,"y",19,hooks);
 if(callObjectValue(method,borrowed,[],root).value!==19)return 7;
 if(constructObjectValue(method,[],root).error!=="type")return 8;
 let caught=false;
 try{callObjectValue(c,undefined,[],root);}catch(error){const object=viewObjectValue(error,root);caught=object!==undefined&&object.prototype===realm.prototypes.get("type");}
 if(!caught)return 9;
 const second=constructObjectValue(c,[],root);
 if(second.value===first||trace!==123123)return 10;
 const statics:ClassField[]=[{name:"identity",initialize:(receiver,args):unknown=>{
  const method=getProperty<ScriptPropertyKey,unknown>(c,"self",c,hooks);return callObjectValue(method,receiver,[],root).value;
 }}];
 initializeClassFields(c,statics,realm,hooks);
 if(getProperty<ScriptPropertyKey,unknown>(c,"identity",c,hooks)!==c)return 11;
 const other=createObject<ScriptPropertyKey,unknown>(root);
 const replacement=createBaseClass("Replacement",0,(receiver,args,newTarget):unknown=>other,fields,realm,hooks);
 if(constructObjectValue(replacement,[],root).value!==other)return 12;
 if(trace!==12312312)return 13;
 const primitive=createBaseClass("Primitive",0,(receiver,args,newTarget):unknown=>42,[],realm,hooks);
 if(viewObjectValue(constructObjectValue(primitive,[],root).value,root)===undefined)return 14;
 const defaultClass=createBaseClass("Default",0,undefined,[],realm,hooks);
 const inherited=constructObject<ScriptPropertyKey,unknown>(c,[],{value:defaultClass,object:defaultClass},undefined);
 const inheritedObject=viewObjectValue(inherited.value,root);
 if(inheritedObject===undefined||inheritedObject.prototype!==getProperty<ScriptPropertyKey,unknown>(defaultClass,"prototype",defaultClass,hooks))return 15;
 let bodyCalled=false;
 const throwingFields:ClassField[]=[{name:"x",initialize:(receiver,args):unknown=>{throw 42;}}];
 const throwing=createBaseClass("Throwing",0,(receiver,args,newTarget):unknown=>{bodyCalled=true;return undefined;},throwingFields,realm,hooks);
 caught=false;try{constructObjectValue(throwing,[],root);}catch(error){caught=error===42;}
 if(!caught||bodyCalled)return 16;
 const sealedFields:ClassField[]=[{name:"x",initialize:(receiver,args):unknown=>{const object=viewObjectValue(receiver,root);if(object===undefined)throw "INSTANCE";preventExtensions<ScriptPropertyKey,unknown>(object);return 1;}}];
 const sealed=createBaseClass("Sealed",0,undefined,sealedFields,realm,hooks);
 caught=false;try{constructObjectValue(sealed,[],root);}catch(error){const object=viewObjectValue(error,root);caught=object!==undefined&&object.prototype===realm.prototypes.get("type");}
 if(!caught)return 17;
 const accessors=createObject<ScriptPropertyKey,unknown>(root);
 defineClassAccessor(accessors,"value",false,(receiver,args):unknown=>receiver,realm,hooks);
 defineClassAccessor(accessors,"value",true,(receiver,args):unknown=>args[0],realm,hooks);
 const accessorDescriptor=getOwnProperty<ScriptPropertyKey,unknown>(accessors,"value");
 if(accessorDescriptor===undefined||accessorDescriptor.enumerable||!accessorDescriptor.configurable)return 18;
 const getter=viewObjectValue(accessorDescriptor.get,root),accessorSetter=viewObjectValue(accessorDescriptor.set,root);
 if(getter===undefined||accessorSetter===undefined)return 19;
 if(getter.internalConstruct!==undefined||accessorSetter.internalConstruct!==undefined)return 20;
 if(getProperty<ScriptPropertyKey,unknown>(getter,"name",getter,hooks)!=="get value"||getProperty<ScriptPropertyKey,unknown>(accessorSetter,"name",accessorSetter,hooks)!=="set value")return 21;
 if(getProperty<ScriptPropertyKey,unknown>(getter,"length",getter,hooks)!==0||getProperty<ScriptPropertyKey,unknown>(accessorSetter,"length",accessorSetter,hooks)!==1)return 22;
 if(callObjectValue(getter,42,[],root).value!==42)return 23;
 const derivedPrototype=createObject<ScriptPropertyKey,unknown>(prototype);
 let derivedFields=0;
 const extra:ClassField[]=[{name:"z",initialize:(receiver,args):unknown=>{derivedFields++;return 99;}}];
 const derived=createDerivedClass("Derived",0,undefined,extra,realm,hooks,c,derivedPrototype);
 const derivedResult=constructObjectValue(derived,[17],root);
 const derivedInstance=viewObjectValue(derivedResult.value,root);
 if(derivedInstance===undefined||derivedInstance.prototype!==derivedPrototype||derived.prototype!==c)return 24;
 if(derivedFields!==1||getProperty<ScriptPropertyKey,unknown>(derivedInstance,"y",derivedInstance,hooks)!==42||getProperty<ScriptPropertyKey,unknown>(derivedInstance,"z",derivedInstance,hooks)!==99)return 25;
 const explicit=createDerivedClass("Explicit",0,(context,args,constructor):unknown=>{const made=constructSuper<ScriptPropertyKey,unknown>(context,constructor.prototype,args,undefined);if(made.error!=="none")throw "SUPER";return getDerivedThis<ScriptPropertyKey,unknown>(context).value;},[],realm,hooks,c,derivedPrototype);
 if(constructObjectValue(explicit,[],root).error!=="none")return 26;
 const returnsObject=createDerivedClass("ReturnObject",0,(context,args,constructor):unknown=>other,extra,realm,hooks,realm.functionPrototype,createObject<ScriptPropertyKey,unknown>(undefined));
 if(constructObjectValue(returnsObject,[],root).value!==other||derivedFields!==1)return 27;
 const returnsPrimitive=createDerivedClass("ReturnPrimitive",0,(context,args,constructor):unknown=>42,[],realm,hooks,c,derivedPrototype);
 caught=false;try{constructObjectValue(returnsPrimitive,[],root);}catch(error){const object=viewObjectValue(error,root);caught=object!==undefined&&object.prototype===realm.prototypes.get("type");}if(!caught)return 28;
 const noSuper=createDerivedClass("NoSuper",0,(context,args,constructor):unknown=>undefined,[],realm,hooks,c,derivedPrototype);
 caught=false;try{constructObjectValue(noSuper,[],root);}catch(error){const object=viewObjectValue(error,root);caught=object!==undefined&&object.prototype===realm.prototypes.get("reference");}if(!caught)return 29;
 const nullDerived=createDerivedClass("Null",0,undefined,[],realm,hooks,realm.functionPrototype,createObject<ScriptPropertyKey,unknown>(undefined));
 caught=false;try{constructObjectValue(nullDerived,[],root);}catch(error){const object=viewObjectValue(error,root);caught=object!==undefined&&object.prototype===realm.prototypes.get("type");}if(!caught)return 30;
 let observedTarget:unknown=undefined,observedCallee:unknown=undefined;
 const source=createSourceFunction((receiver,args,callee,newTarget):unknown=>{observedTarget=newTarget;observedCallee=callee;return undefined;},true,realm,hooks);
 callObjectValue(source,other,[],root);
 if(observedTarget!==undefined||observedCallee!==source)return 31;
 constructObjectValue(source,[],root);
 if(observedTarget!==source||observedCallee!==source)return 32;
 constructObject<ScriptPropertyKey,unknown>(source,[],{value:defaultClass,object:defaultClass},undefined);
 if(observedTarget!==defaultClass||observedCallee!==source)return 33;
 const base=createBaseClass("Target",0,(receiver,args,newTarget):unknown=>{observedTarget=newTarget;return undefined;},[],realm,hooks);
 constructObjectValue(base,[],root);
 if(observedTarget!==base)return 34;
 const targetDerived=createDerivedClass("TargetDerived",0,undefined,[],realm,hooks,base,createObject<ScriptPropertyKey,unknown>(root));
 constructObjectValue(targetDerived,[],root);
 if(observedTarget!==targetDerived)return 35;
 callObjectValue(source,other,[],root);
 if(observedTarget!==undefined)return 36;
 return 42;
}
`,
  "classes",
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
