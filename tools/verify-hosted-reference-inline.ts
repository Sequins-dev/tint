import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `interface Item{value:number;next:Item|undefined}
function seek(node:Item|undefined,key:number):Item|undefined{while(node!==undefined){if(node.value===key)return node;node=node.next;}return undefined;}
function must(node:Item|undefined):Item{if(node===undefined)throw "missing";return node;}
function churn():void{for(let i=0;i<5000;i++){const bytes=new Uint32Array(64);bytes[0]=i;}}
export function run():number{const tail:Item={value:42,next:undefined},head:Item={value:7,next:tail};
const first=seek(head,7),second=seek(head,42),absent=seek(head,9);if(first!==head||second!==tail||absent!==undefined||seek(undefined,7)!==undefined)return 1;
if(head.value!==7||head.next!==tail)return 2;
let caught=false;try{must(undefined);}catch(error){if(error!=="missing")return 3;caught=true;}if(!caught||must(tail)!==tail)return 4;
churn();if(second===undefined||second.value!==42||first===undefined||first.next!==second||seek(head,42)!==second)return 5;
tail.value=43;if(seek(head,42)!==undefined||seek(head,43)!==tail)return 6;return 42;}`,
  "reference-inline",
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
