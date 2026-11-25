import { verifyHostedFixture } from "./hosted-fixture.ts";

// Typed-array set() shares the native memory mover (pair, word and byte
// stages, forward and backward). Checked natively against the host engine for
// every length 0..40 at several offsets, including overlapping views of the
// same buffer in both directions and 1/2/4/8-byte element types.
const body = `
function checksum(bytes:Uint8Array):number{
 let h=2166136261;
 for(let i=0;i<bytes.length;i++) h=Math.imul(h^(bytes[i]??0),16777619)>>>0;
 return h;
}
function mix(h:number,x:number):number{ return Math.imul(h^(x>>>0),16777619)>>>0; }
function sumWords(a:Uint32Array):number{ let h=2166136261; for(let i=0;i<a.length;i++) h=mix(h,a[i]??0); return h; }
function sumHalves(a:Uint16Array):number{ let h=2166136261; for(let i=0;i<a.length;i++) h=mix(h,a[i]??0); return h; }
function sumWide(a:Float64Array):number{ let h=2166136261; for(let i=0;i<a.length;i++) h=mix(h,Math.round((a[i]??0)*3000)); return h; }
function fill(bytes:Uint8Array):void{ for(let i=0;i<bytes.length;i++) bytes[i]=(i*37+11)&255; }
function moves():number[]{
 const out:number[]=[];
 for(let length=0;length<=40;length++){
  for(let shift=0;shift<=9;shift+=3){
   const bytes=new Uint8Array(96);
   fill(bytes);
   // Overlapping forward (destination after source) and backward copies.
   bytes.set(bytes.subarray(8,8+length),8+shift);
   bytes.set(bytes.subarray(40+shift,40+shift+length),40);
   out.push(checksum(bytes));
  }
  const words=new Uint32Array(24),wide=new Float64Array(12),halves=new Uint16Array(48);
  for(let i=0;i<24;i++) words[i]=i*2654435761>>>0;
  for(let i=0;i<12;i++) wide[i]=i/3;
  for(let i=0;i<48;i++) halves[i]=i*977&65535;
  const n=length%12;
  words.set(words.subarray(0,n),3);
  wide.set(wide.subarray(1,1+(n%10)),0);
  halves.set(halves.subarray(5,5+n),1);
  out.push(sumWords(words),sumWide(wide),sumHalves(halves));
 }
 return out;
}
`;
const host = new Function(
  body.replace(
    /:number\[\]|:number|:Uint8Array|:Uint32Array|:Uint16Array|:Float64Array|:void/g,
    "",
  ) + "return {moves};",
)() as { moves: () => number[] };
const expected = host.moves();
verifyHostedFixture(
  `${body}
const expected:number[]=[${expected.join(",")}];
export function run():number {
 const got=moves();
 if(got.length!==expected.length)return 2;
 for(let i=0;i<got.length;i++){
  const want=expected[i],have=got[i];
  if(want===undefined||have===undefined)return 3;
  if(have!==want)return 10+(i%200);
 }
 return 42;
}`,
  "memory-move",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 4194304,
    allocationCapacity: 65536,
    rootCapacity: 4096,
    stackBytes: 1048576,
  },
);
