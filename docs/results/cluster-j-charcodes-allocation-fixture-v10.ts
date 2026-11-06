
import {createObject,createErrorRealm,installPrimitiveIntrinsics,getOwnProperty,viewObjectValue,callObjectValue,type ObjectHooks,type ScriptPropertyKey} from "objects";
export function run():number {
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):unknown=>undefined};
 const root=createObject<ScriptPropertyKey,unknown>(undefined),realm=createErrorRealm(root,hooks);
 installPrimitiveIntrinsics(root,realm,hooks);
 const descriptor=getOwnProperty<ScriptPropertyKey,unknown>(root,"String");if(descriptor===undefined)return 1;
 const constructor=viewObjectValue(descriptor.value,realm.objectPrototype);if(constructor===undefined)return 2;
 const method=getOwnProperty<ScriptPropertyKey,unknown>(constructor,"fromCharCode");if(method===undefined)return 3;
 const args:unknown[]=[];for(let i=0;i<20000;i++)args.push(65+(i%26));
 const result=callObjectValue(method.value,undefined,args,root);if(result.error!=="none")return 4;
 const text=result.value;if(typeof text!=="string"||text.length!==20000)return 5;
 if(text.charCodeAt(0)!==65||text.charCodeAt(1)!==66)return 6;
 if(text.charCodeAt(19998)!==69||text.charCodeAt(19999)!==70)return 7;
 return 42;
}