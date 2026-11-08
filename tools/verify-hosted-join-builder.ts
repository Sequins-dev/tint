import { verifyHostedFixture } from "./hosted-fixture.ts";
// Array.prototype.join lowers to one length pass, one allocation and one copy
// pass. Cover separators, absent elements, element kinds, empty and single
// lists, and joins whose conversions allocate between writes (GC may move the
// partially written result).
const separators = [undefined, "", ",", "|", "--", "😀"] as const;
const strings: readonly (readonly (string | undefined)[])[] = [
  [],
  ["a"],
  [undefined],
  ["a", "b", "c"],
  ["", "", ""],
  ["😀", undefined, "x", undefined],
  ["long-" + "y".repeat(40), "z"],
];
let checks = "";
let code = 10;
for (const list of strings)
  for (const separator of separators) {
    const expected = list.join(separator);
    checks += `if(strings(${JSON.stringify(list).replaceAll("null", "undefined")}).join(${separator === undefined ? "" : JSON.stringify(separator)})!==${JSON.stringify(expected)})return ${code};\n`;
    code++;
  }
const numbers = [[], [0], [1, -2.5, 1e21, NaN, Infinity], [3, 4, 5]];
for (const list of numbers)
  for (const separator of separators) {
    checks += `if(numbers([${list.map(String).join(",")}]).join(${separator === undefined ? "" : JSON.stringify(separator)})!==${JSON.stringify(list.join(separator))})return ${code};\n`;
    code++;
  }
verifyHostedFixture(
  `
function strings(values:readonly (string|undefined)[]):(string|undefined)[]{const out:(string|undefined)[]=[];for(const v of values)out.push(v);return out;}
function numbers(values:number[]):number[]{return values;}
function separator(present:boolean):string|undefined{return present?"+":undefined;}
export function run():number{
 ${checks}
 if([true,false,true].join("&")!=="true&false&true")return 2;
 if(["p","q"].join(separator(true))!=="p+q"||["p","q"].join(separator(false))!=="p,q")return 3;
 const many:string[]=[];for(let i=0;i<100000;i++)many.push("k"+String(i));
 const joined=many.join("|");
 if(joined.length!==${Array.from({ length: 100000 }, (_, i) => "k" + i).join("|").length})return 4;
 if(joined.slice(0,8)!=="k0|k1|k2"||joined.slice(joined.length-6)!=="k99999")return 5;
 const counts:number[]=[];for(let i=0;i<20000;i++)counts.push(i*1.5);
 const formatted=counts.join(",");
 if(formatted.length!==${Array.from({ length: 20000 }, (_, i) => i * 1.5).join(",").length}||formatted.slice(0,9)!=="0,1.5,3,4")return 6;
 if(new Uint8Array([7,8,9]).join("")!=="789")return 7;
 return 42;
}`,
  "join-builder",
  [],
  [],
  [],
  [],
  // About 120k short strings plus their lists exceed the default 4 MiB heap.
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
