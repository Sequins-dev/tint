import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `function word(value:unknown):"a"|"b"{if(value==="a"||value==="b")return value;return "a";}
function mixed(value:unknown):"a"|1|true{if(value==="a"||value===1||value===true)return value;return "a";}
function zero(value:unknown):0{if(value===0)return value;return 0;}
export function run():number{
 const values:unknown[]=["a","b","c",1,true,false,undefined,null,{value:"b"}];
 for(let i=0;i<values.length;i++){const value=values[i];if(word(value)!==(i===1?"b":"a"))return 1;const result=mixed(value);if(i===3?result!==1:i===4?result!==true:result!=="a")return 2;}
 if(1/zero(-0)!==-Infinity||1/zero(0)!==Infinity)return 3;
 return 42;
}`,
  "unknown-literal-narrowing",
);
