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
    const expected = [1, 2, 3, 4].slice(start, end);
    for (const kind of [
      "Uint8Array",
      "Uint16Array",
      "Uint32Array",
      "Float64Array",
    ]) {
      checks += `{const a=new ${kind}(4);for(let i=0;i<4;i++)a[i]=i+1;const b=a.slice(${String(start)},${String(end)});if(b===a||b.buffer===a.buffer||b.byteOffset!==0||b.length!==${expected.length})return 1;`;
      for (const [i, value] of expected.entries())
        checks += `if(b[${i}]!==${value})return 2;`;
      checks += "b[0]=99;if(a[0]!==1)return 3;}\n";
    }
  }
}
verifyHostedFixture(
  `
function absent():Uint8Array|undefined{return undefined;}
function bound(a:Uint8Array,state:{n:number}):number{a[1]=42;state.n++;return 1;}
export function run():number{
 ${checks}
 const a=new Uint8Array(6);for(let i=0;i<6;i++)a[i]=i;
 const view=a.subarray(1,5),copy=view.slice(1,-1);if(copy.length!==2||copy[0]!==2||copy[1]!==3||copy.buffer===a.buffer)return 4;
 a[2]=99;if(copy[0]!==2)return 5;
 const state={n:0};if(absent()?.slice(bound(a,state))!==undefined||state.n!==0)return 6;
 const changed=a.slice(bound(a,state));if(changed[0]!==42||state.n!==1)return 7;
 const f=new Float64Array(3);f[0]=-0;f[1]=NaN;f[2]=Infinity;const g=f.slice();
 const zero=g[0];if(zero===undefined||1/zero!==-Infinity||!Number.isNaN(g[1])||g[2]!==Infinity)return 8;
 return 42;
}`,
  "typed-slice",
);
