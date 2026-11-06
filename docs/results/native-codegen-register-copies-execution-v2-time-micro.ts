import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startNativeHeartbeat} from '../../tools/test262-native-heartbeat.ts';
import {debugserverLaunchCommand,cleanupDebuggerSession} from '../../tools/native-debugger-session.ts';
import {nativeDebuggerInitialState,nativeDebuggerOutcome} from '../../tools/test262-native-process.ts';
const [before,after,output]=process.argv.slice(2), heartbeat=startNativeHeartbeat('native execution-only paired benchmark');
const inputs=[before,after].map(binary=>({binary,manifest:JSON.parse(readFileSync(binary+'.manifest.json','utf8'))}));
const observations=[];
try{for(let pair=0;pair<4;pair++){for(const index of pair%2?[1,0]:[0,1]){
 const directory=mkdtempSync(join(tmpdir(),'tint-perf-')),initial=join(directory,'initial.json'),final=join(directory,'final.json');
 const binary=inputs[index].binary;
 heartbeat.phase('pair '+pair+' image '+index+' under LLDB');
 const commands=['settings set target.disable-aslr false',debugserverLaunchCommand(binary,directory,[],300000,'direct'),
 `script import json,time; p=lldb.debugger.GetSelectedTarget().GetProcess(); open(${JSON.stringify(initial)},'w').write(json.dumps({'state':'stopped' if p.GetState()==lldb.eStateStopped else str(p.GetState()),'pid':p.GetProcessID(),'monotonicNs':time.monotonic_ns()})); assert p.GetState()==lldb.eStateStopped`,
 'continue',
 `script import json,time; now=time.monotonic_ns(); p=lldb.debugger.GetSelectedTarget().GetProcess(); open(${JSON.stringify(final)},'w').write(json.dumps({'state':'exited' if p.GetState()==lldb.eStateExited else str(p.GetState()),'exitStatus':p.GetExitStatus(),'monotonicNs':now})); p.Kill() if p.GetState()!=lldb.eStateExited else None`];
 const started=performance.now();
 try{
 const result=spawnSync('/usr/bin/lldb',['--no-lldbinit','--batch',...commands.flatMap(command=>['-o',command]),binary],{encoding:'utf8',timeout:300000,maxBuffer:1048576});
 const wallMs=performance.now()-started;
 const first=JSON.parse(readFileSync(initial,'utf8')),last=JSON.parse(readFileSync(final,'utf8'));
 if(!nativeDebuggerInitialState(first))throw Error('initial stop not established');
 const outcome=nativeDebuggerOutcome(last),inferiorWallMs=(last.monotonicNs-first.monotonicNs)/1000000;
 const observation={pair,index,outcome,debuggerWallMs:wallMs,inferiorWallMs,debuggerOverheadMs:wallMs-inferiorWallMs,initial:first,final:last};observations.push(observation);console.error(JSON.stringify(observation));
 if(outcome.kind!=='completed'||result.status!==0)throw Error('native failure '+result.stderr);
 }finally{cleanupDebuggerSession(directory);rmSync(directory,{recursive:true,force:true});}
}}}finally{heartbeat.close();writeFileSync(output,JSON.stringify({kind:'native-execution-only-benchmark',scope:'Bespoke operation benchmark, not Test262 coverage. Monotonic timestamps surround LLDB continue; inferior interval includes debugger resume/exit handling but excludes launch.',inputs,observations},null,2)+'\n',{flag:'wx'});}
