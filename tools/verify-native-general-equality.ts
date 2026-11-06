import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `type Element=number|"number"|"string";
interface Entry{readonly type:number;readonly element:Element;}
function element(n:number):Element|undefined{return n<50?n:n===50?"number":n===51?"string":undefined;}
export function run():number{
 const entries:Entry[]=[];
 for(let repeat=0;repeat<4;repeat++)for(let n=0;n<52;n++){
  const value=element(n);if(value===undefined)return 1;
  if(!entries.some(e=>e!==undefined&&e.element===value))entries.push({type:n,element:value});
 }
 if(entries.length!==52)return entries.length;
 for(let n=0;n<52;n++){const value=element(n);const found=entries.find(e=>e!==undefined&&e.element===value);if(found===undefined||found.type!==n)return 2;}
 return 42;
}`,
  "general-equality",
);
