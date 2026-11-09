import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir,loadavg} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startNativeHeartbeat} from '../../../tools/test262-native-heartbeat.ts';
import {debugserverLaunchCommand,cleanupDebuggerSession} from '../../../tools/native-debugger-session.ts';
const [before,after,pairsArg,timeoutArg,output,...workload]=process.argv.slice(2), caseArg='compiler', pairs=Number(pairsArg), timeoutMs=Number(timeoutArg), heartbeat=startNativeHeartbeat('A3 paired compiler CPU repetitions');
const inputs=[before,after].map(binary=>({binary,sha256:createHash('sha256').update(readFileSync(binary)).digest('hex')}));
const outputs=[];
if(!(pairs>0)||!(timeoutMs>0))throw Error('pairs/timeout');
const observations=[];
try{for(let pair=0;pair<pairs;pair++){for(const index of pair%2?[1,0]:[0,1]){
 const directory=mkdtempSync(join(tmpdir(),'tint-p-cpu-')),report=join(directory,'result.json');
 const binary=inputs[index].binary, loadAverageBefore=loadavg();
 heartbeat.phase('pair '+pair+' image '+index+' under LLDB');
 const script=`import json,time,ctypes,struct
p=lldb.debugger.GetSelectedTarget().GetProcess()
assert p.GetState()==lldb.eStateStopped
pid=p.GetProcessID()
lib=ctypes.CDLL('/usr/lib/libproc.dylib')
class Timebase(ctypes.Structure):
    _fields_=[('numer',ctypes.c_uint32),('denom',ctypes.c_uint32)]
base=Timebase()
assert ctypes.CDLL('/usr/lib/libSystem.B.dylib').mach_timebase_info(ctypes.byref(base))==0
def usage():
    buf=ctypes.create_string_buffer(1024)
    if lib.proc_pid_rusage(pid,4,ctypes.byref(buf))!=0:return None
    user,system=struct.unpack_from('QQ',buf.raw,16)
    instructions,cycles=struct.unpack_from('QQ',buf.raw,248)
    return {'userTicks':user,'systemTicks':system,'instructions':instructions,'cycles':cycles}
first=usage()
assert first is not None
started=time.monotonic_ns()
last=first
last_at=started
probes=0
lldb.debugger.SetAsync(True)
err=p.Continue()
assert err.Success(),err.GetCString()
while True:
    now=time.monotonic_ns()
    sample=usage()
    if sample is not None:last,last_at=sample,now
    probes+=1
    state=p.GetState()
    if state==lldb.eStateExited or (state==lldb.eStateStopped and now-started>1000000000):break
    if now-started>${timeoutMs}*1000000:break
    time.sleep(0.001)
ended=time.monotonic_ns()
result={'initial':{'state':'stopped','pid':pid},'final':{'state':'exited' if p.GetState()==lldb.eStateExited else str(p.GetState()),'exitStatus':p.GetExitStatus()},'inferiorWallMs':(ended-started)/1e6,'cpuLowerBoundMs':((last['userTicks']-first['userTicks'])+(last['systemTicks']-first['systemTicks']))*base.numer/base.denom/1e6,'unobservedCPUWallBoundMs':(ended-last_at)/1e6,'instructions':last['instructions']-first['instructions'],'cycles':last['cycles']-first['cycles'],'probes':probes,'timebase':{'numer':base.numer,'denom':base.denom},'firstCPU':first,'lastCPU':last}
open(${JSON.stringify(report)},'w').write(json.dumps(result))
if p.GetState()!=lldb.eStateExited:p.Kill()
lldb.debugger.SetAsync(False)
`;
 const commands=['settings set target.disable-aslr false',debugserverLaunchCommand(binary,directory,workload.map(a=>a==='{out}'?join(directory,'out'):a),timeoutMs,'direct'),'script exec('+JSON.stringify(script)+')'];
 try{
 const result=spawnSync('/usr/bin/lldb',['--no-lldbinit','--batch',...commands.flatMap(command=>['-o',command]),binary],{encoding:'utf8',timeout:timeoutMs+20000,maxBuffer:1048576});
 const observation={pair,index,loadAverageBefore,loadAverageAfter:loadavg(),...JSON.parse(readFileSync(report,'utf8'))};observations.push(observation);console.error(JSON.stringify(observation));
 if(observation.final.state!=='exited'||observation.final.exitStatus!==0)console.error('NON-0 OUTCOME '+JSON.stringify(observation.final));
 try{observation.outputSha256=createHash('sha256').update(readFileSync(join(directory,'out'))).digest('hex')}catch{observation.outputSha256=null}
 }finally{cleanupDebuggerSession(directory);rmSync(directory,{recursive:true,force:true});}
}}}finally{heartbeat.close();writeFileSync(output,JSON.stringify({kind:'native-compiler-cpu-benchmark',workload,timeoutMs,scope:'Fresh-process alternating repetitions of exact retained images; canonical complete reports own coverage. proc_pid_rusage V4 instruction/cycle and user/system CPU counters converted through mach_timebase_info, sampled every 1 ms between initial stop and final exit. CPU is a lower bound; the final unobserved wall interval bounds missing CPU. Monotonic inferior-wall includes debugger resume/exit handling and excludes launch.',inputs,observations},null,2)+'\n',{flag:'wx'});}
