import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
function grow(a:number[],state:{n:number}):number{a.push(9);state.n=state.n*10+1;return 1;}
function second(state:{n:number}):number{state.n=state.n*10+2;return 2;}
function absent():number[]|undefined{return undefined;}
export function run():number{
 const a:number[]=[];if(a.shift()!==undefined||a.length!==0||a.unshift()!==0)return 1;
 if(a.unshift(1,2,3)!==3||a.join()!=="1,2,3")return 2;
 const alias=a;if(alias.shift()!==1||a.join()!=="2,3")return 3;
 if(a.shift()!==2||a.shift()!==3||a.shift()!==undefined||a.length!==0)return 4;
 const sparse:(number|undefined)[]=[];sparse.length=5;sparse[2]=undefined;sparse[4]=42;
 if(sparse.shift()!==undefined||sparse.length!==4||sparse.indexOf(undefined)!==1||sparse[3]!==42)return 5;
 if(sparse.unshift(7,undefined)!==6||sparse[0]!==7||sparse.indexOf(undefined)!==1||sparse.slice(2).indexOf(undefined)!==1||sparse[5]!==42)return 6;
 if(sparse.unshift()!==6||sparse.slice(2,3).indexOf(undefined)!==-1)return 7;
 const strings:(string|undefined)[]=[];strings.length=3;strings[1]="x";strings.unshift(undefined,"a");
 if(strings.shift()!==undefined||strings.shift()!=="a"||strings.shift()!==undefined||strings.shift()!=="x"||strings.shift()!==undefined)return 8;
 const obj={n:42},objects=[obj];objects.unshift(obj);if(objects.shift()!==obj||objects.shift()!==obj)return 9;
 const state={n:0};a.unshift(grow(a,state),second(state));if(state.n!==12||a.join()!=="1,2,9")return 10;
 state.n=0;if(absent()?.unshift(second(state))!==undefined||state.n!==0||absent()?.shift()!==undefined)return 11;
 const floats=[-0,NaN,Infinity];const zero=floats.shift();if(zero===undefined||1/zero!==-Infinity||!Number.isNaN(floats.shift())||floats.shift()!==Infinity)return 12;
 return 42;
}`,
  "shift",
);
