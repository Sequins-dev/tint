import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `import {createJobQueue,enqueueJob,drainJobs} from "jobs";
interface Context {readonly id:number;}
export function run():number{
 const queue=createJobQueue<number>();
 let order=0,contexts=0,nested=-1;
 const execute=(job:()=>void,context:number):void=>{contexts=contexts*10+context;job();};
 enqueueJob<number>(queue,():void=>{
  order=order*10+1;
  enqueueJob<number>(queue,():void=>{order=order*10+3;},3);
  nested=drainJobs<number>(queue,execute);
  order=order*10+2;
 },1);
 enqueueJob<number>(queue,():void=>{order=order*10+4;},2);
 if(order!==0||queue.size!==2)return 1;
 if(drainJobs<number>(queue,execute)!==3||order!==1243||contexts!==123||nested!==0)return 2;
 if(queue.size!==0||queue.head!==undefined||queue.tail!==undefined||queue.draining)return 3;
 let caught=0,calls=0;
 enqueueJob<number>(queue,():void=>{calls++;throw 42;},1);
 enqueueJob<number>(queue,():void=>{calls++;},2);
 try{drainJobs<number>(queue,execute);return 4;}catch{caught++;}
 if(caught!==1||calls!==1||queue.size!==1||queue.draining)return 5;
 if(drainJobs<number>(queue,execute)!==1||calls!==2)return 6;
 let count=0;
 function repeat():void{count++;if(count<100000)enqueueJob<number>(queue,repeat,count);}
 enqueueJob<number>(queue,repeat,0);
 const total=drainJobs<number>(queue,(job:()=>void,context:number):void=>{
  if(context!==count)throw "job context";
  job();
 });
 if(total!==100000||count!==100000||queue.size!==0||queue.head!==undefined||queue.tail!==undefined)return 7;
 const retained=createJobQueue<Context>();
 for(let index=0;index<2000;index++)enqueueJob<Context>(retained,():void=>{}, {id:index});
 // Keep a bounded live set within the fixture's 4 MiB heap while churning
 // another queue through enough allocations to force collections.
 count=0;
 enqueueJob<number>(queue,repeat,0);
 if(drainJobs<number>(queue,(job:()=>void,context:number):void=>{job();})!==100000)return 9;
 let visited=0;
 const retainedCount=drainJobs<Context>(retained,(job:()=>void,context:Context):void=>{
  if(context.id!==visited)throw "retained job context";
  visited++;job();
 });
 if(retainedCount!==2000||visited!==2000||retained.head!==undefined||retained.tail!==undefined)return 8;
 return 42;
}`,
  "job-queue",
  [["jobs", "packages/js-runtime/src/jobs/index.ts"]],
);
