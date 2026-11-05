import { verifyHostedFixture } from "./hosted-fixture.ts";
const counts = [0, -0, -0.9, 0.9, 1, 1.9, 2, 3, 7, 8, 9, 31, 32, 33, NaN];
let checks = "";
for (const input of ["", "a", "ab", "😀", "\ud800"]) {
  for (const count of counts) {
    checks += `if(${JSON.stringify(input)}.repeat(${Number.isNaN(count) ? "NaN" : count})!==${JSON.stringify(input.repeat(count))})return 1;\n`;
  }
}
verifyHostedFixture(
  `
function invalid(s:string,n:number):boolean{try{s.repeat(n);return false;}catch(error){return error instanceof RangeError;}}
function source(state:{n:number}):string{state.n++;return "ab";}
function count(state:{n:number}):number{state.n=state.n*10+2;return 3;}
function absent():string|undefined{return undefined;}
export function run():number{
 ${checks}
 if("abc".repeat()!==""||"abc".repeat(undefined)!=="")return 2;
 if(!invalid("a",-1)||!invalid("",-1)||!invalid("a",Infinity)||!invalid("",Infinity)||!invalid("a",-Infinity))return 3;
 if(!invalid("a",2147483629)||!invalid("ab",2147483628))return 4;
 if("".repeat(1e308)!=="")return 5;
 const state={n:0};if(source(state).repeat(count(state))!=="ababab"||state.n!==12)return 6;
 state.n=0;if(absent()?.repeat(count(state))!==undefined||state.n!==0)return 7;
 if("ab".repeat(1024).length!==2048)return 8;
 return 42;
}`,
  "repeat",
);
