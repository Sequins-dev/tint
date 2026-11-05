import { verifyHostedFixture } from "./hosted-fixture.ts";
let checks = "";
for (const input of ["", "x", "😀", "abc"]) {
  for (const length of [undefined, -Infinity, -1, 0, 1, 2.9, 5, 8, NaN]) {
    for (const filler of [undefined, "", "0", "ab", "😀"]) {
      for (const method of ["padStart", "padEnd"] as const) {
        const expected = input[method](length ?? 0, filler);
        checks += `if(${JSON.stringify(input)}.${method}(${String(length)},${JSON.stringify(filler)})!==${JSON.stringify(expected)})return 1;\n`;
      }
    }
  }
}
verifyHostedFixture(
  `
function size(state:{n:number}):number{state.n=state.n*10+1;return 5;}
function fill(state:{n:number}):string{state.n=state.n*10+2;return "ab";}
function absent():string|undefined{return undefined;}
function optional(s:string,n:number|undefined,f:string|undefined):string{return s.padStart(n,f);}
export function run():number{
 ${checks}
 if("x".padStart()!=="x"||"x".padEnd()!=="x")return 2;
 if(optional("x",4,undefined)!=="   x"||optional("x",undefined,"0")!=="x")return 3;
 const state={n:0};if("x".padStart(size(state),fill(state))!=="ababx"||state.n!==12)return 4;
 state.n=0;if(absent()?.padEnd(size(state),fill(state))!==undefined||state.n!==0)return 5;
 if("x".padStart(Infinity,"")!=="x"||"x".padEnd(1e100,"")!=="x")return 6;
 let caught=0;try{"x".padStart(Infinity);}catch(e){if(e instanceof RangeError)caught++;}
 try{"x".padEnd(2147483629,"0");}catch(e){if(e instanceof RangeError)caught++;}
 if(caught!==2)return 7;
 if("x".padEnd(1024,"ab").length!==1024)return 8;
 return 42;
}`,
  "padding",
);
