import { verifyHostedFixture } from "./hosted-fixture.ts";
let checks = "";
for (const start of [
  undefined,
  -Infinity,
  -7,
  -2.9,
  0,
  2.9,
  7,
  Infinity,
  NaN,
]) {
  for (const end of [
    undefined,
    -Infinity,
    -7,
    -1.9,
    0,
    3.9,
    7,
    Infinity,
    NaN,
  ]) {
    const expected = [1, 2, 3, 4].fill(42, start, end);
    for (const kind of [
      "list",
      "Uint8Array",
      "Uint16Array",
      "Uint32Array",
      "Float64Array",
    ]) {
      checks +=
        kind === "list"
          ? "{const a=[1,2,3,4];"
          : `{const a=new ${kind}(4);for(let i=0;i<4;i++)a[i]=i+1;`;
      checks += `if(a.fill(42,${String(start)},${String(end)})!==a)return 1;`;
      for (const [i, value] of expected.entries())
        checks += `if(a[${i}]!==${value})return 2;`;
      checks += "}\n";
    }
  }
}
verifyHostedFixture(
  `
function grow(a:number[],state:{n:number}):number{a.push(0);state.n=state.n*10+1;return 42;}
function begin(state:{n:number}):number{state.n=state.n*10+2;return 1;}
function end(state:{n:number}):undefined{state.n=state.n*10+3;return undefined;}
function absent():number[]|undefined{return undefined;}
export function run():number{
 ${checks}
 const a=[1,2],state={n:0};a.fill(grow(a,state),begin(state),end(state));
 if(a.length!==3||a[0]!==1||a[1]!==42||a[2]!==42||state.n!==123)return 3;
 state.n=0;if(absent()?.fill(grow(a,state))!==undefined||state.n!==0)return 4;
 const sparse:(number|undefined)[]=[];sparse.length=5;sparse.fill(undefined,1,4);
 if(sparse.indexOf(undefined)!==1||sparse.slice(4).indexOf(undefined)!==-1)return 5;
 const strings:(string|undefined)[]=[];strings.length=3;strings.fill("x");if(strings.join()!=="x,x,x")return 6;
 const obj={n:42},records=[{n:1},{n:2}];records.fill(obj);if(records[0]!==obj||records[1]!==obj)return 7;
 const floats=new Float64Array(3);floats.fill(-0);const zero=floats[1];if(zero===undefined||1/zero!==-Infinity)return 8;
 floats.fill(NaN);if(!Number.isNaN(floats[0]))return 9;
 const words=new Uint8Array(2);words.fill(258);if(words[0]!==2||words[1]!==2)return 10;
 return 42;
}`,
  "fill",
);
