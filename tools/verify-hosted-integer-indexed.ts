import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createIntegerIndexedObject,createObject,createExoticObject,createDataProperty,getProperty,setProperty,hasProperty,deleteProperty,ownKeys,getOwnProperty,defineOwnProperty,preventExtensions,type ObjectHooks} from "objects";
import {canonicalNumericIndex} from "index";
import {emptyUpdate,valueField} from "descriptors";
export function run():number{
 let length=2,conversions=0,fixed=false;const values:number[]=[19,23];
 const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):number=>{throw "UNEXPECTED_CALL";}};
 const valid=(i:number):boolean=>Number.isInteger(i)&&!(i===0&&1/i<0)&&i>=0&&i<length;
 const parent=createExoticObject<string,number>(undefined,{get:(o,k,r,h):number=>99,hasProperty:(o,k):boolean=>true});
 const object=createIntegerIndexedObject<string,number>(parent,{
 numericIndex:canonicalNumericIndex,valid,read:(i):number=>{const value=values[i];if(value===undefined)throw "INDEX_INVARIANT";return value;},
 write:(i,v):void=>{conversions++;if(v===-1)length=0;if(valid(i))values[i]=v;},
 length:():number=>length,fromIndex:(i):string=>String(i),keyOrder:(key):number=>-1,canPreventExtensions:():boolean=>fixed},hooks);
 if(getProperty<string,number>(object,"0",0,hooks)!==19||getProperty<string,number>(object,"-0",0,hooks)!==0||getProperty<string,number>(object,"01",0,hooks)!==99||hasProperty<string,number>(object,"NaN"))return 1;
 if(!setProperty<string,number>(object,"9",42,{object,value:0},hooks)||conversions!==1)return 2;
 const update={...emptyUpdate<number>(0),fields:valueField,value:42};
 if(defineOwnProperty<string,number>(object,"9",update,hooks)!=="rejected"||conversions!==1)return 3;
 const other=createObject<string,number>(undefined);
 if(!setProperty<string,number>(object,"0",42,{object:other,value:0},hooks)||values[0]!==19||conversions!==1)return 4;
 const assigned=getOwnProperty<string,number>(other,"0");if(assigned===undefined||assigned.value!==42)return 5;
 const descriptor=getOwnProperty<string,number>(object,"0");if(descriptor===undefined||!descriptor.configurable||deleteProperty<string,number>(object,"0"))return 6;
 if(!createDataProperty<string,number>(object,"name",31,hooks))return 7;
 if(!setProperty<string,number>(object,"0",-1,{object,value:0},hooks)||values[0]!==19||conversions!==2)return 8;
 const keys=ownKeys<string,number>(object,(key):number=>-1);if(keys.length!==1||keys[0]!=="name")return 9;
 length=2;if(getProperty<string,number>(object,"0",0,hooks)!==19||preventExtensions<string,number>(object))return 10;
 fixed=true;if(!preventExtensions<string,number>(object)||createDataProperty<string,number>(object,"extra",42,hooks))return 11;
 return 42;
}`,
  "integer-indexed",
  [
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["index", "packages/js-runtime/src/objects/integer-index.ts"],
    ["descriptors", "packages/js-runtime/src/descriptors/index.ts"],
  ],
);
