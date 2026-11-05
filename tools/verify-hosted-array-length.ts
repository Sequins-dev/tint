import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
function invalid(a:number[],n:number):boolean{const previous=a.length;try{a.length=n;return false;}catch(error){return error instanceof RangeError&&a.length===previous;}}
function receiver(a:number[],state:{n:number}):number[]{state.n=state.n*10+1;return a;}
function key(state:{n:number}):"length"{state.n=state.n*10+2;return "length";}
function size(state:{n:number}):number{state.n=state.n*10+3;return 1;}
function reset(a:number[]):number{a.length=0;return 2;}
export function run():number{
 const a=[1,2,3],alias=a;
 if((a.length=1)!==1||alias.length!==1||a[1]!==undefined)return 1;
 a.length=3;if(a[1]!==undefined||a[2]!==undefined||a.indexOf(undefined)!==-1||!a.includes(undefined))return 2;
 const state={n:0};if((receiver(a,state)[key(state)]=size(state))!==1||state.n!==123||a.length!==1)return 3;
 if(!invalid(a,-1)||!invalid(a,1.5)||!invalid(a,NaN)||!invalid(a,Infinity)||!invalid(a,4294967296))return 4;
 const assigned=(a.length=-0);if(1/assigned!==-Infinity||1/a.length!==Infinity)return 5;
 if((a.length=4294967295)!==4294967295||a.at(-1)!==undefined)return 6;
 a.length=0;
 const objects=[{n:1},{n:2}];objects.length=1;objects.length=2;
 if(objects[1]!==undefined||objects[0]?.n!==1)return 7;
 objects["length"]=0;if(objects.length!==0)return 8;
 const strings=["a","b"];strings.length=1;strings.length=3;
 if(strings.join()!=="a,,")return 9;
 a.length=3;if(a.length++!==3||a.length!==4||--a.length!==3)return 10;
 a.length+=reset(a);if(a.length!==5)return 11;
 a.length=0;state.n=0;a.length&&=size(state);if(state.n!==0||a.length!==0)return 12;
 a.length||=size(state);if(state.n!==3||a.length!==1)return 13;
 a.length??=size(state);if(state.n!==3||a.length!==1)return 14;
 a.length&&=size(state);if(state.n!==33||a.length!==1)return 15;
 a.length=4294967295;try{a.length++;return 16;}catch(error){if(!(error instanceof RangeError)||a.length!==4294967295)return 17;}
 a.length=0;try{a.length--;return 18;}catch(error){if(!(error instanceof RangeError)||a.length!==0)return 19;}
 a.length=3;try{a.length/=2;return 20;}catch(error){if(!(error instanceof RangeError)||a.length!==3)return 21;}
 a.length%=2;a.length<<=2;if(a.length!==4)return 22;
 return 42;
}`,
  "array-length",
);
