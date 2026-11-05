import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `import {createPromiseRecord,createResolvingFunctions,performPromiseThen,type PromiseHooks,type PromiseCompletion,type PromiseResolvingFunctions} from "promises";
import {createJobQueue,enqueueJob,drainJobs} from "jobs";
export function run():number{
 const queue=createJobQueue<number>();
 let calls=0,gets=0,rejections=0,handled=0,remaining=0;
 const hooks:PromiseHooks<number>={
  sameValue:(a:number,b:number):boolean=>a===b,
  isObject:(value:number):boolean=>value>=100,
  isCallable:(value:number):boolean=>value>=1000,
  getThen:(value:number):PromiseCompletion<number>=>{
   gets++;
   if(value===101)return {kind:"throw",value:19};
   if(value===100||value===102||value===103)return {kind:"normal",value:1001};
   return {kind:"normal",value:-1};
  },
  callThen:(method:number,receiver:number,functions:PromiseResolvingFunctions<number>):PromiseCompletion<number>=>{
   calls++;
   if(method!==1001)throw "then method";
   if(receiver===103&&remaining>0){remaining--;functions.resolve(103);}
   else if(receiver===102)functions.resolve(100);
   else functions.resolve(42);
   functions.reject(19);
   return {kind:"throw",value:1};
  },
  callHandler:(handler:number,value:number):PromiseCompletion<number>=>{
   if(handler===2002)return {kind:"throw",value};
   return {kind:"normal",value:value+1};
  },
  typeError:():number=>-2,
  enqueue:(job:()=>void,callback:number|undefined):void=>{enqueueJob<number>(queue,job,callback===undefined?-1:callback);},
  rejectionTracker:(promise,operation):void=>{if(operation==="reject")rejections++;else handled++;},
 };
 const p=createPromiseRecord<number>(10000,-1),q=createPromiseRecord<number>(10001,-1);
 const resolve=createResolvingFunctions<number>(p,hooks),child=createResolvingFunctions<number>(q,hooks);
 performPromiseThen<number>(p,2001,-1,child,hooks);
 resolve.resolve(102);resolve.reject(3);
 if(p.state!=="pending"||gets!==1||calls!==0||queue.size!==1)return 1;
 const execute=(job:()=>void,context:number):void=>{job();};
 if(drainJobs<number>(queue,execute)!==3||calls!==2||gets!==2)return 2;
 if(p.state!=="fulfilled"||p.result!==42||q.state!=="fulfilled"||q.result!==43)return 3;
 if(p.fulfillReactions!==undefined||p.rejectReactions!==undefined)return 4;
 const rejected=createPromiseRecord<number>(10002,-1),forwarded=createPromiseRecord<number>(10003,-1);
 createResolvingFunctions<number>(rejected,hooks).resolve(101);
 if(rejected.state!=="rejected"||rejected.result!==19||rejections!==1)return 5;
 performPromiseThen<number>(rejected,-1,-1,createResolvingFunctions<number>(forwarded,hooks),hooks);
 if(handled!==1||forwarded.state!=="pending")return 6;
 drainJobs<number>(queue,execute);
 if(forwarded.state!=="rejected"||forwarded.result!==19||rejections!==2)return 7;
 const cycle=createPromiseRecord<number>(10004,-1);
 createResolvingFunctions<number>(cycle,hooks).resolve(10004);
 if(cycle.state!=="rejected"||cycle.result!==-2)return 8;
 const thrown=createPromiseRecord<number>(10005,-1);
 performPromiseThen<number>(p,2002,-1,createResolvingFunctions<number>(thrown,hooks),hooks);
 if(thrown.state!=="pending")return 9;
 drainJobs<number>(queue,execute);
 if(thrown.state!=="rejected"||thrown.result!==42)return 10;
 const deep=createPromiseRecord<number>(10006,-1);
 remaining=9999;
 createResolvingFunctions<number>(deep,hooks).resolve(103);
 if(drainJobs<number>(queue,execute)!==10000||deep.state!=="fulfilled"||deep.result!==42)return 11;
 return 42;
}`,
  "promise-protocol",
  [
    ["promises", "packages/js-runtime/src/promises/index.ts"],
    ["jobs", "packages/js-runtime/src/jobs/index.ts"],
  ],
);
