import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
function copy(value:number|string|boolean|null|undefined):unknown{return value;}
function bridge(value:unknown):unknown {
  if(typeof value==="number"||typeof value==="string"||typeof value==="boolean")
    return copy(value);
  if(value===null)return copy(null);
  if(value===undefined)return copy(undefined);
  return "not-primitive";
}
function pair(value:unknown):unknown {
  if(typeof value==="number"||typeof value==="string")return copy(value);
  return undefined;
}
export function run():number {
  if(bridge(42)!==42||bridge("x")!=="x"||bridge(true)!==true||bridge(false)!==false)return 1;
  if(bridge(null)!==null||bridge(undefined)!==undefined)return 2;
  if(bridge({x:1})!=="not-primitive")return 3;
  const zero=bridge(-0);if(typeof zero!=="number"||1/zero!==-Infinity)return 4;
  const nan=bridge(NaN);if(nan===nan)return 5;
  if(pair("x")!=="x"||pair(42)!==42)return 6;
  return 42;
}
`,
  "narrowed-primitives",
);
