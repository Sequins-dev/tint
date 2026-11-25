import { verifyHostedFixture } from "./hosted-fixture.ts";

// String strict equality compares pointers, lengths, then the first four
// UTF-16 units inline (masked to the length) before the full helper. Checked
// natively for lengths 0..9, a mismatch at every unit position, code units
// with high bytes, and literals against runtime-built strings (distinct
// objects with equal content), in both operand orders and as branches.
const alphabet = ["a", "b", "é", "中", "\ud83d", "z"];
const words: string[] = [""];
for (let length = 1; length <= 9; length++) {
  let text = "";
  for (let i = 0; i < length; i++) text += alphabet[(i * 7 + length) % 6];
  words.push(text);
  // One variant per position with a single unit changed.
  for (let at = 0; at < length; at++)
    words.push(
      text.slice(0, at) + (text[at] === "q" ? "r" : "q") + text.slice(at + 1),
    );
}
let expected = 0;
for (let i = 0; i < words.length; i++)
  for (let j = 0; j < words.length; j++)
    if (words[i] === words[j]) expected += i * 131 + j;
const literal = (text: string): string => JSON.stringify(text);
verifyHostedFixture(
  `const words:string[]=[${words.map(literal).join(",")}];
function rebuilt(text:string):string {
 let out="";
 for(let i=0;i<text.length;i++) out+=text.slice(i,i+1);
 return out;
}
export function run():number {
 const copies:string[]=[];
 for(let i=0;i<words.length;i++){
  const word=words[i];
  if(word===undefined) return 7;
  copies.push(rebuilt(word));
 }
 let total=0;
 for(let i=0;i<words.length;i++)
  for(let j=0;j<words.length;j++){
   const a=words[i], b=copies[j];
   if(a===undefined||b===undefined) return 2;
   const same=a===b;
   if(same!==(b===a)) return 3;
   if(same!==!(a!==b)) return 4;
   if(a===b) total+=i*131+j;
  }
 if(total!==${expected}) return 5;
 const a="load", b="call";
 if(rebuilt(a)===b||rebuilt("")!=="") return 6;
 return 42;
}`,
  "string-equal",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 4194304,
    allocationCapacity: 262144,
    rootCapacity: 4096,
    stackBytes: 1048576,
  },
);
