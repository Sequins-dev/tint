import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
type Key=string|{id:number};
function identity(key:Key):Key{return key;}
function read(key:Key):number{return typeof key==="string"?key.length:key.id;}
export function run():number {
  const key={id:42},other={id:42};
  const map=new Map<Key,number>();
  map.set(key,42);map.set("text",4);
  if(map.has(other)||map.get(key)!==42||map.get("text")!==4)return 1;
  const set=new Set<Key>();set.add(key);set.add("text");set.add(key);
  if(set.size!==2||set.has(other))return 2;
  const list:Key[]=[key,"text"];
  let total=0;for(const item of list){if(item===undefined)return 10;total+=read(item);}
  if(total!==46)return 9;
  if(!list.includes(key)||list.includes(other)||list.indexOf("text")!==1)return 11;
  const values:unknown[]=[NaN,key,"text",undefined];
  if(!values.includes(NaN)||values.indexOf(NaN)!==-1||!values.includes(key)||values.includes(other)||!values.includes(undefined))return 12;
  const first=list[0],second=list[1];
  if(first===undefined||second===undefined||read(identity(first))!==42||read(second)!==4)return 3;
  const general=new Map<unknown,unknown>();
  general.set(key,"record");general.set("text",key);
  general.set(NaN,42);general.set(-0,1);general.set(0,2);
  if(general.size!==4||general.get(NaN)!==42||general.get(-0)!==2)return 4;
  for(let i=0;i<30000;i++){const garbage:Key[]=[{id:i},"discard"];if(garbage.length!==2)return 5;}
  if(map.get(key)!==42||map.has(other)||!set.has(key)||list[0]!==key)return 6;
  if(general.get(key)!=="record"||general.get("text")!==key)return 7;
  map.delete(key);if(map.has(key)||map.size!==1)return 8;
  return 42;
}
`,
  "mixed-collections",
);
