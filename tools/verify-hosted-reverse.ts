import { verifyHostedFixture } from "./hosted-fixture.ts";
let checks = "";
for (const length of [0, 1, 2, 3, 4, 9]) {
  const values = Array.from({ length }, (_, i) => i + 1);
  for (const kind of [
    "list",
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
  ]) {
    const creation =
      kind === "list" ? `[${values.join(",")}]` : `new ${kind}(${length})`;
    const type = kind === "list" ? ":number[]" : "";
    checks += `{const a${type}=${creation};`;
    if (kind !== "list")
      for (let i = 0; i < length; i++) checks += `a[${i}]=${values[i]};`;
    checks += `if(a.reverse()!==a||a.length!==${length})return 1;`;
    for (const [i, value] of values.reverse().entries())
      checks += `if(a[${i}]!==${value})return 2;`;
    values.reverse();
    checks += "}\n";
  }
}
verifyHostedFixture(
  `
function absent():number[]|undefined{return undefined;}
export function run():number{
 ${checks}
 const a:(number|undefined)[]=[];a.length=5;a[1]=undefined;a[4]=42;
 if(a.reverse()!==a||a[0]!==42||a.indexOf(undefined)!==3||a.length!==5)return 3;
 if(a.reverse()!==a||a[4]!==42||a.indexOf(undefined)!==1)return 4;
 const strings:(string|undefined)[]=[];strings.length=4;strings[0]="a";strings[2]=undefined;
 strings.reverse();if(strings[3]!=="a"||strings.indexOf(undefined)!==1)return 5;
 const object={n:42},records=[object,{n:1}];records.reverse();if(records[1]!==object||records[0]?.n!==1)return 6;
 const floats=new Float64Array(3);floats[0]=-0;floats[1]=NaN;floats[2]=Infinity;
 floats.reverse();const zero=floats[2];if(floats[0]!==Infinity||!Number.isNaN(floats[1])||zero===undefined||1/zero!==-Infinity)return 7;
 if(absent()?.reverse()!==undefined)return 8;
 const alias=a;alias.reverse();if(a[0]!==42)return 9;
 return 42;
}`,
  "reverse",
);
