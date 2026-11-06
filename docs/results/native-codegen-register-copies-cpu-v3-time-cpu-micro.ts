import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startNativeHeartbeat} from '../../tools/test262-native-heartbeat.ts';
import {debugserverLaunchCommand,cleanupDebuggerSession} from '../../tools/native-debugger-session.ts';
const [before,after,output]=process.argv.slice(2), heartbeat=startNativeHeartbeat('native execution and CPU paired benchmark');
const inputs=[before,after].map(binary=>({binary,manifest:JSON.parse(readFileSync(binary+'.manifest.json','utf8'))}));
for(const input of inputs)if(createHash('sha256').update(readFileSync(input.binary)).digest('hex')!==input.manifest.imageSha256)throw Error('image differs from manifest');
if(inputs[0].manifest.fixtureSha256!==inputs[1].manifest.fixtureSha256)throw Error('benchmark sources differ');
const observations=[];
try{for(let pair=0;pair<4;pair++){for(const index of pair%2?[1,0]:[0,1]){
 const directory=mkdtempSync(join(tmpdir(),'tint-p-cpu-')),report=join(directory,'result.json');
 const binary=inputs[index].binary;
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
    if lib.proc_pid_rusage(pid,0,ctypes.byref(buf))!=0:return None
    user,system=struct.unpack_from('QQ',buf.raw,16)
    return {'userTicks':user,'systemTicks':system}
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
    if now-started>300000000000:break
    time.sleep(0.001)
ended=time.monotonic_ns()
result={'initial':{'state':'stopped','pid':pid},'final':{'state':'exited' if p.GetState()==lldb.eStateExited else str(p.GetState()),'exitStatus':p.GetExitStatus()},'inferiorWallMs':(ended-started)/1e6,'cpuLowerBoundMs':((last['userTicks']-first['userTicks'])+(last['systemTicks']-first['systemTicks']))*base.numer/base.denom/1e6,'unobservedCPUWallBoundMs':(ended-last_at)/1e6,'probes':probes,'timebase':{'numer':base.numer,'denom':base.denom},'firstCPU':first,'lastCPU':last}
open(${JSON.stringify(report)},'w').write(json.dumps(result))
if p.GetState()!=lldb.eStateExited:p.Kill()
lldb.debugger.SetAsync(False)
`;
 const commands=['settings set target.disable-aslr false',debugserverLaunchCommand(binary,directory,[],300000,'direct'),'script exec('+JSON.stringify(script)+')'];
 try{
 const result=spawnSync('/usr/bin/lldb',['--no-lldbinit','--batch',...commands.flatMap(command=>['-o',command]),binary],{encoding:'utf8',timeout:310000,maxBuffer:1048576});
 const observation={pair,index,...JSON.parse(readFileSync(report,'utf8'))};observations.push(observation);console.error(JSON.stringify(observation));
 if(observation.final.state!=='exited'||observation.final.exitStatus!==42||result.status!==0)throw Error('native failure '+result.stdout+'\n'+result.stderr);
 }finally{cleanupDebuggerSession(directory);rmSync(directory,{recursive:true,force:true});}
}}}finally{heartbeat.close();writeFileSync(output,JSON.stringify({kind:'native-execution-and-cpu-benchmark',scope:'Bespoke same-source operation benchmark; not Test262 coverage. proc_pid_rusage V0 user/system CPU counters converted through mach_timebase_info, sampled every 1 ms between initial stop and final exit. CPU is a lower bound; the final unobserved wall interval bounds missing CPU. Monotonic inferior-wall includes debugger resume/exit handling and excludes launch.',inputs,observations},null,2)+'\n',{flag:'wx'});}
