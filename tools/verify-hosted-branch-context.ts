import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `export function run():number{
let trace=0;
function hit(d:number,v:boolean):boolean{trace=trace*10+d;return v;}
function stop():boolean{throw 19;}
if(hit(1,false)&&hit(2,true))return 1;
if(trace!==1)return 2;
if(!(hit(3,true)||hit(4,true)))return 3;
if(trace!==13)return 4;
if(!((hit(5,true)&&hit(6,false))||hit(7,true)))return 5;
if(trace!==13567)return 6;
let caught=false;
try{if(false&&stop())return 7;}catch{ return 8; }
try{if(true||stop()){}else return 9;}catch{ return 10; }
try{if(hit(8,true)&&stop())return 11;}catch{caught=true;}
finally{trace=trace*10+9;}
if(!caught||trace!==1356789)return 12;
trace=0;let n=0;
while(n<3&&hit(1,true)){n++;if(n<3)continue;}
if(n!==3||trace!==111)return 13;
trace=0;
for(n=0;n<3&&hit(2,true);n++){if(n<2)continue;}
if(n!==3||trace!==222)return 14;
trace=0;n=0;
do{n++;if(n<3)continue;}while(n<3&&hit(3,true));
if(n!==3||trace!==33)return 15;
trace=0;
const chosen=(hit(4,false)||hit(5,true))?hit(6,true):hit(7,true);
if(!chosen||trace!==456)return 16;
function and(a:number,b:number):number{return a&&b;}
function or(a:number,b:number):number{return a||b;}
if(and(0,99)!==0||and(4,99)!==99||or(0,99)!==99||or(4,99)!==4)return 17;
if(1/and(-0,99)!==-Infinity||and(NaN,99)===and(NaN,99))return 18;
if(or(NaN,99)!==99)return 19;
function nullable(v:number|undefined):number{if(v??7)return 1;return 0;}
if(nullable(undefined)!==1||nullable(0)!==0||nullable(NaN)!==0)return 20;
if(!("0"&&"x"))return 21;
if(""&&"x")return 21;
if(0&&4)return 22;
if(!(2&&4))return 22;
if(NaN&&4)return 22;
return 42;}`,
  "branch-context",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 4194304,
    allocationCapacity: 131072,
    rootCapacity: 8192,
    stackBytes: 1048576,
  },
);
