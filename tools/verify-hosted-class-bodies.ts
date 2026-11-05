import { verifyHostedFixture } from "./hosted-fixture.ts";

// Executes the typed class checker natively; class machine-code lowering is separate.
verifyHostedFixture(
  `
import {createSourceText} from "source";
import {parseModule} from "syntax";
import {checkClosureModule} from "checker";
import {lowerModuleEntries} from "lowering";
export function run():number {
 const cases:{text:string;valid:boolean;initialization:boolean}[]=[
  {text:"class C{x:number;constructor(x:number){this.x=x;}m():number{return this.x;}}function run():number{return new C(42).m();}",valid:true,initialization:false},
  {text:"class C{static x:number=1;static y:number=C.x+1;static m():number{return this.y;}}",valid:true,initialization:false},
  {text:"class C{x:number;constructor(flag:boolean){if(flag)this.x=1;else this.x=2;}}",valid:true,initialization:false},
  {text:"class C{x:number;constructor(flag:boolean){if(flag)throw 1;this.x=2;}}",valid:true,initialization:false},
  {text:"class C{x:number|undefined;m():number|undefined{return this.x;}}",valid:true,initialization:false},
  {text:"class C{x:number;constructor(flag:boolean){if(flag)this.x=1;}}",valid:false,initialization:true},
  {text:"class C{x:number;constructor(value:number=(this.x=1)){}}",valid:false,initialization:true},
  {text:"class C{static x:number=C.y;static y:number=1;}",valid:false,initialization:true},
  {text:"class C{y:number=(this.x=1);x:number;}",valid:false,initialization:true},
  {text:"class C{x:number;constructor(){const escape=()=>this.x;this.x=1;}}",valid:false,initialization:true},
  {text:"class C{x:number;constructor(){this.x='bad';}}",valid:false,initialization:false},
 ];
 for(let index=0;index<cases.length;index++){
  const item=cases[index];if(item===undefined)return 1;
  const bytes=new TextEncoder().encode(item.text);
  const source=createSourceText(bytes,bytes.length);if(!source.ok)return 2;
  const parsed=parseModule(source.value);if(!parsed.ok)return 3;
  const checked=checkClosureModule(parsed.value);
  if(checked.ok!==item.valid)return 10+index;
  if(!checked.ok){if(item.initialization&&checked.error.code!=="UNINITIALIZED")return 30+index;}
  else {
   const lowered=lowerModuleEntries(checked.value,checked.value.bindings.functions.map((fn):number=>fn.id),{pointerSize:8,wordSize:8,allocationAlignment:16,frameAlignment:16,maxAlignment:16},4096);
   if(lowered.ok)return 50+index;
   if(lowered.error!=="typed class declarations require class construction lowering")return 70+index;
  }
 }
 return 42;
}
`,
  "class-bodies",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["lowering", "packages/ts-native/src/closure/lowering/index.ts"],
  ],
);
