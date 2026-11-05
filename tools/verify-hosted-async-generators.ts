import { verifyHostedFixture } from "./hosted-fixture.ts";

// Handwritten continuation segments verify the request protocol independently
// of source lowering and the ordinary-object Promise adapter.
verifyHostedFixture(
  `import {createAsyncGeneratorRecord,enqueueAsyncGenerator,type AsyncGeneratorHooks,type AsyncGeneratorCapability,type AsyncGeneratorOutcome} from "generators";
import {createJobQueue,enqueueJob,drainJobs} from "jobs";
export function run():number {
 const jobs=createJobQueue<number>();
 let scheduled=0;
 const results:number[]=[];
 const capability:AsyncGeneratorCapability<number>={resolve:(value:number):void=>{results.push(value);},reject:(value:number):void=>{results.push(-value);}};
 const hooks:AsyncGeneratorHooks<number>={
  undefinedValue:0,
  exceptionValue:(error:unknown):number=>{if(typeof error==="number")return error;throw error;},
  iteratorResult:(value:number,done:boolean):number=>value+(done?1000:0),
  awaitValue:(value:number,resolve:(value:number)=>void,reject:(value:number)=>void):void=>{
   if(value===-1)throw 42;
   scheduled++;enqueueJob<number>(jobs,():void=>{if(value<0)reject(-value);else resolve(value);},0);
  }
 };
 let step=0;
 const generator=createAsyncGeneratorRecord<number>((kind:string,value:number):AsyncGeneratorOutcome<number>=>{
  step++;
  if(step===1){if(value!==0)throw 1;return {kind:"await",value:19};}
  if(step===2)return {kind:"yield",value};
  return {kind:"return",value};
 });
 enqueueAsyncGenerator<number>(generator,"next",99,capability,hooks);
 enqueueAsyncGenerator<number>(generator,"next",42,capability,hooks);
 if(results.length!==0||scheduled!==1)return 1;
 if(drainJobs<number>(jobs,(job:()=>void,context:number):void=>{job();})!==1)return 2;
 if(results.length!==2||results[0]!==19||results[1]!==1042)return 3;
 if(generator.state!=="completed"||generator.continuation!==undefined||generator.head!==undefined||generator.tail!==undefined)return 4;
 let started=0;
 const untouched=createAsyncGeneratorRecord<number>((kind:string,value:number):AsyncGeneratorOutcome<number>=>{started++;return {kind:"return",value};});
 enqueueAsyncGenerator<number>(untouched,"return",23,capability,hooks);
 enqueueAsyncGenerator<number>(untouched,"next",0,capability,hooks);
 if(results.length!==2||started!==0)return 5;
 if(drainJobs<number>(jobs,(job:()=>void,context:number):void=>{job();})!==1)return 6;
 if(results[2]!==1023||results[3]!==1000||untouched.state!=="completed")return 7;
 let recoveringStep=0;
 const recovering=createAsyncGeneratorRecord<number>((kind:string,value:number):AsyncGeneratorOutcome<number>=>{
  recoveringStep++;
  if(recoveringStep===1)return {kind:"yield",value:1};
  if(kind!=="throw")throw 2;
  return {kind:"return",value};
 });
 enqueueAsyncGenerator<number>(recovering,"next",0,capability,hooks);
 enqueueAsyncGenerator<number>(recovering,"return",-42,capability,hooks);
 if(results.length!==5)return 8;
 if(drainJobs<number>(jobs,(job:()=>void,context:number):void=>{job();})!==1)return 9;
 if(results[5]!==1042)return 10;
 let syncStep=0;
 const sync=createAsyncGeneratorRecord<number>((kind:string,value:number):AsyncGeneratorOutcome<number>=>{
  syncStep++;if(syncStep===1)return {kind:"await",value:-1};
  if(kind!=="throw")throw 3;
  return {kind:"return",value};
 });
 enqueueAsyncGenerator<number>(sync,"next",0,capability,hooks);
 if(results[6]!==1042||scheduled!==3)return 11;
 let manyStep=0;
 const many=createAsyncGeneratorRecord<number>((kind:string,value:number):AsyncGeneratorOutcome<number>=>{
  manyStep++;if(manyStep===1)return {kind:"await",value:0};return {kind:"return",value:42};
 });
 enqueueAsyncGenerator<number>(many,"next",0,capability,hooks);
 for(let i=0;i<20000;i++)enqueueAsyncGenerator<number>(many,"next",0,capability,hooks);
 if(drainJobs<number>(jobs,(job:()=>void,context:number):void=>{job();})!==1)return 12;
 if(results.length!==20008||results[7]!==1042||results[20007]!==1000)return 13;
 if(many.head!==undefined||many.tail!==undefined||many.continuation!==undefined)return 14;
 return 42;
}`,
  "async-generator-protocol",
  [
    ["generators", "packages/js-runtime/src/iterators/index.ts"],
    ["jobs", "packages/js-runtime/src/jobs/index.ts"],
  ],
);
