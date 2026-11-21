import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The event loop fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

verifyHostedFixture(
  `
import {createEventLoop} from 'loop';
import {createJobQueue,enqueueJob,drainJobs} from 'jobs';

export function run(): number {
  const jobs=createJobQueue<undefined>();
  let time=0, polls=0, trace="";
  const loop=createEventLoop({
    now:():number=>time,
    poll:(timeout:number):void=>{
      if(!Number.isFinite(timeout))throw "unexpected indefinite wait";
      time+=timeout;polls++;
    },
    drainMicrotasks:():void=>{
      drainJobs<undefined>(jobs,(job:()=>void,_context:undefined):void=>job());
    }
  });
  loop.nextTick(():void=>{trace+="T";loop.nextTick(():void=>{trace+="t";});});
  enqueueJob<undefined>(jobs,():void=>{
    trace+="P";loop.nextTick(():void=>{trace+="p";});
  },undefined);
  enqueueJob<undefined>(jobs,():void=>{trace+="M";},undefined);
  loop.run("microtask");
  if(trace!=="PMTpt")return 1;
  if(polls!==0)return 2;

  trace="";
  loop.enqueueIO(():void=>{
    trace+="I";
    loop.setTimeout(():void=>{trace+="D";},0);
    loop.setImmediate(():void=>{
      trace+="C";
      loop.nextTick(():void=>{trace+="T";});
      enqueueJob<undefined>(jobs,():void=>{trace+="M";},undefined);
      loop.setImmediate(():void=>{trace+="c";});
    });
    loop.enqueueClose(():void=>{trace+="X";});
  });
  const skipped=loop.setTimeout(():void=>{trace+="!";},20);
  loop.clearTimeout(skipped);
  const unreferenced=loop.setTimeout(():void=>{trace+="!";},100);
  unreferenced.unref();
  loop.run("callback");
  if(trace!=="ICTMXcD")return 3;
  if(polls!==3||time!==1)return 4;
  if(unreferenced.hasRef())return 5;
  unreferenced.ref();
  if(!unreferenced.hasRef())return 6;
  loop.clearInterval(unreferenced);

  const abrupt=loop.setImmediate(():void=>{throw "abrupt";});
  let caught=false;
  loop.setImmediate(():void=>{trace+="A";});
  try {loop.run("callback");}catch(error){caught=error==="abrupt";}
  if(!caught||abrupt.hasRef()||trace!=="ICTMXcD")return 7;
  loop.run("callback");
  return trace==="ICTMXcDA"?42:8;
}
`,
  "event-loop-phases-v1",
  [
    ["loop", "packages/native-runtime/src/event-loop.ts"],
    ["jobs", "packages/js-runtime/src/jobs/index.ts"],
  ],
);
