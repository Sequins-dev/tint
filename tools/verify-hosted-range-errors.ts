import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
function effect(state:{n:number}):number{state.n++;return 65;}
function invalidPoint(n:number,state:{n:number}):boolean{
 try{String.fromCodePoint(n,effect(state));return false;}
 catch(error){return error instanceof RangeError;}
}
function invalidSet(n:number):boolean{
 const target=new Uint8Array(2);target.fill(9);
 try{target.set(new Uint8Array(2),n);return false;}
 catch(error){return error instanceof RangeError&&target[0]===9&&target[1]===9;}
}
function invalidMixed():boolean{
 const target=new Uint16Array(1);target[0]=9;
 try{target.set(new Uint8Array(2));return false;}
 catch(error){return error instanceof RangeError&&target[0]===9;}
}
function bad():void{String.fromCodePoint(-1);}
export function run():number{
 const state={n:0};
 for(const input of [-1,1114112,0.5,NaN,Infinity,-Infinity]){
  if(input===undefined||!invalidPoint(input,state))return 1;
 }
 if(state.n!==6)return 2;
 if(!invalidSet(-1)||!invalidSet(1)||!invalidSet(Infinity)||!invalidMixed())return 3;
 let finalized=0,caught=false;
 try{try{bad();}finally{finalized++;}}catch(error){caught=error instanceof RangeError;}
 if(!caught||finalized!==1)return 4;
 const target=new Uint8Array(2);target.set(new Uint8Array(1),-0.5);
 if(String.fromCodePoint(1114111).codePointAt(0)!==1114111)return 5;
 return 42;
}`,
  "range-errors",
);
