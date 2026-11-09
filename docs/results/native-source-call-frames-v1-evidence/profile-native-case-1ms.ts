import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,openSync,closeSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';import {tmpdir,loadavg} from 'node:os';import {createHash} from 'node:crypto';
import {startNativeHeartbeat} from '../../../tools/test262-native-heartbeat.ts';
import {debugserverLaunchCommand,cleanupDebuggerSession} from '../../../tools/native-debugger-session.ts';
const [binaryArg,caseArg,directoryArg,offsetsArg,containArg]=process.argv.slice(2),containMs=Number(containArg??'60000'),binary=resolve(binaryArg),directory=resolve(directoryArg);mkdirSync(directory);
const heartbeat=startNativeHeartbeat('symbolized native workload profile '+caseArg),session=mkdtempSync(join(tmpdir(),'tint-p-prof-'));
const initial=directory+'/initial.json',final=directory+'/final.json',fd=openSync(directory+'/lldb.log','wx');
const commands=['settings set target.disable-aslr false',debugserverLaunchCommand(binary,session,[caseArg],containMs,'direct'),
 `script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); open(${JSON.stringify(initial)},'w').write(json.dumps({'state':'stopped' if p.GetState()==lldb.eStateStopped else str(p.GetState()),'pid':p.GetProcessID()})); assert p.GetState()==lldb.eStateStopped`,
 'continue',`script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); open(${JSON.stringify(final)},'w').write(json.dumps({'state':'exited' if p.GetState()==lldb.eStateExited else str(p.GetState()),'exitStatus':p.GetExitStatus()})); p.Kill() if p.GetState()!=lldb.eStateExited else None`];
const started=Date.now(),startLoad=loadavg(),samples=[];let timedOut=false,done=false,activeSampler,initialState;
const child=spawn('/usr/bin/lldb',['--no-lldbinit','--batch',...commands.flatMap(x=>['-o',x]),binary],{stdio:['ignore',fd,fd],detached:true});
const exited=new Promise(resolve=>child.once('close',(code,signal)=>{done=true;resolve({code,signal});}));
const observer=spawn('python3',[resolve('.tint-bootstrap/perf/observe-selfbuild-cpu-v2.py'),directory],{stdio:'inherit'});const observerExit=new Promise(resolve=>observer.once('close',resolve));
const outerDeadline=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGKILL');}catch{}},containMs+5000);let deadline=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGKILL');}catch{}},containMs);
let lastSample=-Infinity;let nextSample=0;const offsets=(offsetsArg??'500,20000,40000').split(',').map(Number);let initialObservedAt=0;
try{
 while(!done){
  if(initialState===undefined&&existsSync(initial)){initialState=JSON.parse(readFileSync(initial,'utf8'));if(initialState.state!=='stopped')throw Error('no initial stop');clearTimeout(deadline);deadline=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGKILL');}catch{}},containMs);initialObservedAt=Date.now();heartbeat.phase('inferior '+initialState.pid+' collecting native samples');}
  if(initialState!==undefined&&activeSampler===undefined&&nextSample<offsets.length&&Date.now()-initialObservedAt>=offsets[nextSample]){
   lastSample=Date.now();nextSample++;const index=samples.length,path=directory+'/sample-'+index+'.txt',log=openSync(directory+'/sample-'+index+'.log','wx');
   const record={index,path,startUTC:new Date().toISOString(),loadBefore:loadavg()};samples.push(record);console.error('sampling '+JSON.stringify(record));
   const sampler=spawn('/usr/bin/sample',[String(initialState.pid),'1','1','-file',path],{stdio:['ignore',log,log]});activeSampler=new Promise(resolve=>sampler.once('close',status=>{closeSync(log);Object.assign(record,{status,endUTC:new Date().toISOString(),loadAfter:loadavg()});activeSampler=undefined;resolve(undefined);}));
  }
  await new Promise(r=>setTimeout(r,250));
 }
 const exit=await exited;clearTimeout(deadline);if(activeSampler!==undefined)await activeSampler;
 if(initialState===undefined)observer.kill('SIGTERM');await observerExit;
 const end=existsSync(final)?JSON.parse(readFileSync(final,'utf8')):undefined;
 const result={kind:'native-workload-profile',conformance:false,binary,imageSha256:createHash('sha256').update(readFileSync(binary)).digest('hex'),selectedCase:caseArg,containmentMs:containMs,outerContainmentMs:containMs+5000,containmentScope:'60 seconds after initial stop, also bounded by the original J 65-second outer watchdog including launch',startedUTC:new Date(started).toISOString(),wallMs:Date.now()-started,startLoad,endLoad:loadavg(),initial:initialState,final:end,timedOut,debugger:exit,cpu:existsSync(directory+'/cpu.json')?JSON.parse(readFileSync(directory+'/cpu.json','utf8')):null,samples};
 writeFileSync(directory+'/report.json',JSON.stringify(result,null,2)+'\n');console.error(JSON.stringify(result));
}finally{clearTimeout(outerDeadline);clearTimeout(deadline);if(!done){try{process.kill(-child.pid,'SIGKILL');}catch{}}cleanupDebuggerSession(session);closeSync(fd);heartbeat.close();}
