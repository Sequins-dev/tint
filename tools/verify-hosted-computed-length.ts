import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
function key(state:{n:number}):"length"{state.n=state.n*10+2;return "length";}
function array(state:{n:number}):number[]{state.n=state.n*10+1;return [1,2,3];}
function absent():number[]|undefined{return undefined;}
function none():string|null|undefined{return null;}
function narrow(n:number|undefined,flags:number[]):number{if(n===undefined||flags[n]===1)return 0;return n+1;}
function resize(a:number[]):"length"{a.push(42);return "length";}
export function run():number{
 const state={n:0};if(array(state)[key(state)]!==3||state.n!==12)return 1;
 const a=[1,2,3];if(a["length"]!==3||a[resize(a)]!==4)return 2;
 const strings=["x"],records=[{n:42}];if(strings["length"]!==1||records["length"]!==1)return 3;
 if("😀"["length"]!==2||""["length"]!==0)return 4;
 if(new Uint8Array(3)["length"]!==3||new Uint16Array(4)["length"]!==4||new Uint32Array(5)["length"]!==5||new Float64Array(6)["length"]!==6)return 5;
 state.n=0;if(absent()?.[key(state)]!==undefined||state.n!==0)return 6;
 if(none()?.["length"]!==undefined)return 7;
 if(narrow(undefined,a)!==0||narrow(0,[1])!==0||narrow(0,[2])!==1)return 8;
 const readonly:readonly number[]=a;if(readonly["length"]!==4)return 9;
 return 42;
}`,
  "computed-length",
);
