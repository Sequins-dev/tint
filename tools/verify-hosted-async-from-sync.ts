import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {resumeAsyncFromSyncIterator,type AsyncIteratorHooks,type AsyncIteratorCapability,type IteratorRecord} from "iterators";
import {createJobQueue,enqueueJob,drainJobs} from "jobs";
export function run():number {
 const jobs=createJobQueue<number>();
 const results:number[]=[];
 let mode=0,closed=0,arity=0,reads=0;
 const hooks:AsyncIteratorHooks<number>={
  undefinedValue:0,exceptionValue:(error:unknown):number=>{if(typeof error==="number")return error;throw error;},
  get:(object:number,key:string):number=>{
   if(object===1){if(key==="return")return mode===1?0:3;if(key==="throw")return 0;throw 91;}
   if(object!==10)throw 92;
   if(key==="done"){reads=1;return 0;}
   if(key==="value"){if(reads!==1)throw 93;reads=2;return 42;}
   throw 94;
  },
  call:(method:number,receiver:number,args:readonly number[]):number=>{
   if(receiver!==1)throw 95;
   if(method===2){arity=args.length;return 10;}
   if(method===3){closed++;if(args.length!==0)throw 96;if(mode===3)throw 19;return 10;}
   throw 97;
  },
  isObject:(value:number):boolean=>value===10,
  isCallable:(value:number):boolean=>value===2||value===3,
  isNullish:(value:number):boolean=>value===0,
  truthy:(value:number):boolean=>value!==0,
  typeError:():number=>99,
  iteratorResult:(value:number,done:boolean):number=>value+(done?1000:0),
  awaitValue:(value:number,resolve:(value:number)=>void,reject:(value:number)=>void):void=>{
   if(mode===3)throw 42;
   enqueueJob<number>(jobs,():void=>{if(mode===2)reject(value);else resolve(value);},0);
  }
 };
 const record:IteratorRecord<number>={iterator:1,nextMethod:2,done:false};
 const capability:AsyncIteratorCapability<number>={resolve:(value:number):void=>{results.push(value);},reject:(reason:number):void=>{results.push(-reason);}};
 resumeAsyncFromSyncIterator<number>(record,"next",[],capability,hooks);
 if(arity!==0||reads!==2||results.length!==0)return 1;
 if(drainJobs<number>(jobs,(job:()=>void,context:number):void=>{job();})!==1)return 2;
 if(results[0]!==42)return 3;
 resumeAsyncFromSyncIterator<number>(record,"next",[0,19],capability,hooks);
 if(arity!==1)return 4;
 drainJobs<number>(jobs,(job:()=>void,context:number):void=>{job();});
 mode=1;resumeAsyncFromSyncIterator<number>(record,"return",[42],capability,hooks);
 if(results[2]!==1042||jobs.size!==0)return 5;
 mode=0;resumeAsyncFromSyncIterator<number>(record,"throw",[42],capability,hooks);
 if(results[3]!==-99||closed!==1)return 6;
 mode=2;resumeAsyncFromSyncIterator<number>(record,"next",[],capability,hooks);
 drainJobs<number>(jobs,(job:()=>void,context:number):void=>{job();});
 if(results[4]!==-42||closed!==2)return 7;
 mode=3;resumeAsyncFromSyncIterator<number>(record,"next",[],capability,hooks);
 if(results[5]!==-42||closed!==3)return 8;
 resumeAsyncFromSyncIterator<number>(record,"throw",[],capability,hooks);
 if(results[6]!==-19||closed!==4)return 9;
 return 42;
}`,
  "async-from-sync-protocol",
  [
    ["iterators", "packages/js-runtime/src/iterators/index.ts"],
    ["jobs", "packages/js-runtime/src/jobs/index.ts"],
  ],
);
