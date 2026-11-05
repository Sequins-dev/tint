import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
function array(present:boolean):number[]|undefined{if(present)return [1,2,3];return undefined;}
function map(present:boolean):Map<string,number>|undefined{if(present)return new Map<string,number>();return undefined;}
function set(present:boolean):Set<number>|undefined{if(present)return new Set<number>();return undefined;}
function bytes(present:boolean):Uint8Array|undefined{if(present)return new Uint8Array(3);return undefined;}
function effect(state:{n:number}):number{state.n++;return 42;}
export function run():number{
 const state={n:0};
 if(array(false)?.push(effect(state))!==undefined||state.n!==0)return 1;
 const values=array(true);
 if(values?.push(4)!==4||values?.pop()!==4)return 2;
 if(values?.slice(1)?.[0]!==2)return 3;
 if(values?.map(n=>n*2)?.[2]!==6)return 4;
 if(values?.filter(n=>n>1)?.length!==2)return 5;
 if(values?.includes(3)!==true||values?.indexOf(3)!==2)return 6;
 const m=map(true);if(m?.set("x",42)?.get("x")!==42||m?.size!==1)return 7;
 if(map(false)?.set("x",effect(state))!==undefined||state.n!==0)return 8;
 if(m?.delete("x")!==true||m?.has("x")!==false)return 9;
 const s=set(true);if(s?.add(42)?.has(42)!==true||s?.size!==1)return 10;
 if(set(false)?.add(effect(state))!==undefined||state.n!==0)return 11;
 s?.clear();if(s?.size!==0)return 12;
 const b=bytes(true);if(b?.fill(42)?.[1]!==42)return 13;
 if(bytes(false)?.fill(effect(state))!==undefined||state.n!==0)return 14;
 b?.set(new Uint8Array(1),1);if(b?.[1]!==0)return 15;
 if(b?.subarray(1)?.length!==2)return 16;
 return 42;
}`,
  "optional-collections",
);
