import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtempSync} from 'node:fs';
import { createHash } from 'node:crypto';
import { startNativeHeartbeat } from '../../tools/test262-native-heartbeat.ts';
import { debugserverLaunchCommand } from '../../tools/native-debugger-session.ts';
const directory=resolve('.tint-bootstrap/perf/selfbuild-codegen-copy-v1');
mkdirSync(directory,{recursive:true});
const frozen=resolve('.tint-bootstrap/perf/codegen-copy-toolchain-v1');
const heartbeat=startNativeHeartbeat('native register-copy codegen selfbuild');
try {
  const snapshot=directory+'/source', stage1=directory+'/stage1', stage2=directory+'/stage2';
  heartbeat.phase('resuming existing frozen stage1; prior debugger handoff failed before execution');
  console.error('stage1 sha256='+createHash('sha256').update(readFileSync(stage1)).digest('hex'));
  heartbeat.phase('native stage2 under LLDB');
  const session=mkdtempSync(join(tmpdir(),'tint-p-self-'));console.error('debugger session='+session);
  const args=[snapshot,stage2,'--debug-symbols'];
  const initial=directory+'/initial.json', final=directory+'/final.json';
  const commands=[
    'settings set target.disable-aslr false',
    debugserverLaunchCommand(stage1,session,args,300000,'direct'),
    `script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); open(${JSON.stringify(initial)},'w').write(json.dumps({'state':'stopped' if p.GetState()==lldb.eStateStopped else str(p.GetState()),'pid':p.GetProcessID()})); assert p.GetState()==lldb.eStateStopped`,
    'continue',
    `script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); open(${JSON.stringify(final)},'w').write(json.dumps({'state':'exited' if p.GetState()==lldb.eStateExited else str(p.GetState()),'exitStatus':p.GetExitStatus()})); p.Kill() if p.GetState()!=lldb.eStateExited else None`,
  ];
  const second=spawnSync('/usr/bin/lldb',['--no-lldbinit','--batch',...commands.flatMap(command=>['-o',command]),stage1],{stdio:'inherit'});
  const start=JSON.parse(readFileSync(initial,'utf8')), end=JSON.parse(readFileSync(final,'utf8'));
  if(second.status!==0||start.state!=='stopped'||end.state!=='exited'||end.exitStatus!==0)throw Error('native stage2 failed: '+JSON.stringify(end));
  heartbeat.phase('comparing stage images and verifying DWARF');
  const a=readFileSync(stage1),b=readFileSync(stage2);if(!a.equals(b))throw Error('stage images differ');
  const dwarf=spawnSync('dwarfdump',['--verify',stage2],{stdio:'inherit'});if(dwarf.status!==0)throw Error('DWARF verification failed');
  writeFileSync(directory+'/result.json',JSON.stringify({snapshot,stage1,stage2,bytes:a.length,sha256:createHash('sha256').update(a).digest('hex'),initial:start,final:end,identical:true,dwarfExit:dwarf.status},null,2)+'\n');
}finally{heartbeat.close();}
