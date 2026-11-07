import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `type Box={value:number};
function hold(value:Box,bytes:Uint32Array,text:string,callback:()=>number,flag:boolean):()=>number {
 return ()=>value.value+(bytes[0]??0)+callback()+(flag?1:0)+(text==="capture-42"?1:1000);
}
function forward(value:Box):()=>()=>Box{return ()=>()=>value;}
function mutable(value:Box):()=>Box{const read:()=>Box=()=>value;value={value:13};return read;}
function makeText(seed:number):string{return "capture-"+seed;}
export function run():number {
 const value:Box={value:10},bytes=new Uint32Array(2),context:Box={value:10};bytes[0]=20;
 const read=hold(value,bytes,makeText(42),()=>context.value,true),outer=forward(value),inner=outer(),changed=mutable(value);
 if(read()!==42||changed().value!==13)return 1;
 value.value=11;bytes[0]=21;context.value=12;
 if(read()!==46||inner()!==value)return 2;
 for(let i=0;i<3000;i++){const scratch=new Uint32Array(64);scratch[0]=i;}
 if(read()!==46||inner()!==value||outer()().value!==11||changed().value!==13)return 3;
 return 42;
}`,
  "word-captures",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 524288,
    allocationCapacity: 32768,
    rootCapacity: 4096,
    stackBytes: 1048576,
  },
);
