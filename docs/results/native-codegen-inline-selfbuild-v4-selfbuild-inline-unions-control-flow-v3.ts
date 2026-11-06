import { spawnSync,spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtempSync} from 'node:fs';
import { createHash } from 'node:crypto';
import { startNativeHeartbeat } from '../../tools/test262-native-heartbeat.ts';
import { debugserverLaunchCommand } from '../../tools/native-debugger-session.ts';
const directory=resolve('.tint-bootstrap/perf/selfbuild-inline-unions-control-flow-v3');
mkdirSync(directory);
const frozen=resolve('.tint-bootstrap/perf/codegen-inline-union-toolchain-v5');
process.env.TINT_P_REPORT_CAPTURE=directory+'/reports.jsonl';
const heartbeat=startNativeHeartbeat('native inline union and control flow selfbuild');
try {
  const snapshot=directory+'/source', stage1=directory+'/stage1', stage2=directory+'/stage2';
  const original=resolve('.tint-bootstrap/perf/selfbuild-inline-unions-control-flow-v2');
  if(!readFileSync(original+'/stage1').length)throw Error('missing stage1');
  const image=original+'/stage1', inputs=original+'/source';
  heartbeat.phase('native stage2 under LLDB');
  const session=mkdtempSync(join(tmpdir(),'tint-p-self-'));console.error('debugger session='+session);
  const args=[inputs,stage2,'--debug-symbols'];
  const initial=directory+'/initial.json', final=directory+'/final.json';
  const commands=[
    'settings set target.disable-aslr false',
    'command script import '+resolve('.tint-bootstrap/perf/p_capture_report_v1.py'),
    'script bp=lldb.debugger.GetSelectedTarget().BreakpointCreateByRegex("program:packages/compiler/src/cli.ts:report "); assert bp.GetNumLocations()>0; bp.SetScriptCallbackFunction("p_capture_report_v1.capture")',
    debugserverLaunchCommand(image,session,args,300000,'direct'),
    `script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); open(${JSON.stringify(initial)},'w').write(json.dumps({'state':'stopped' if p.GetState()==lldb.eStateStopped else str(p.GetState()),'pid':p.GetProcessID()})); assert p.GetState()==lldb.eStateStopped`,
    'continue',
    `script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); open(${JSON.stringify(final)},'w').write(json.dumps({'state':'exited' if p.GetState()==lldb.eStateExited else str(p.GetState()),'exitStatus':p.GetExitStatus()})); p.Kill() if p.GetState()!=lldb.eStateExited else None`,
  ];
  const observer=spawn('python3',[resolve('.tint-bootstrap/perf/observe-selfbuild-cpu-v1.py'),directory],{stdio:'inherit'});
  const observed=new Promise((resolve,reject)=>{observer.once('close',status=>status===0?resolve(undefined):reject(Error('CPU observer status '+status)));});
  const second=spawnSync('/usr/bin/lldb',['--no-lldbinit','--batch',...commands.flatMap(command=>['-o',command]),image],{stdio:'inherit'});
  await observed;
  const start=JSON.parse(readFileSync(initial,'utf8')), end=JSON.parse(readFileSync(final,'utf8'));
  if(second.status!==0||start.state!=='stopped'||end.state!=='exited'||end.exitStatus!==0)throw Error('native stage2 failed: '+JSON.stringify(end));
  heartbeat.phase('comparing stage images and verifying DWARF');
  const a=readFileSync(image),b=readFileSync(stage2);if(!a.equals(b))throw Error('stage images differ');
  const dwarf=spawnSync('dwarfdump',['--verify',stage2],{stdio:'inherit'});if(dwarf.status!==0)throw Error('DWARF verification failed');
  writeFileSync(directory+'/result.json',JSON.stringify({snapshot:inputs,stage1:image,stage2,bytes:a.length,sha256:createHash('sha256').update(a).digest('hex'),initial:start,final:end,identical:true,dwarfExit:dwarf.status,cpu:JSON.parse(readFileSync(directory+'/cpu.json','utf8'))},null,2)+'\n');
}finally{heartbeat.close();}
