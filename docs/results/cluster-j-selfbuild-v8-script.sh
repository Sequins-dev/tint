#!/bin/zsh
set -eu
export TINT_TEST262_HEARTBEAT_MS=30000 TINT_TEST262_STALL_MS=150000
test ! -e .tint-bootstrap/j-string-stage1-v8
test ! -e .tint-bootstrap/j-string-source-v8
node .tint-bootstrap/cluster-j-toolchain-v8/tools/bootstrap-compiler.ts .tint-bootstrap/j-string-stage1-v8 --source-root "$PWD/.tint-bootstrap/cluster-j-toolchain-v8" --snapshot .tint-bootstrap/j-string-source-v8 --debug-symbols > .tint-bootstrap/j-selfbuild-v8-bootstrap.log 2>&1 &
j_boot_pid=$!
while kill -0 "$j_boot_pid" 2>/dev/null; do
 date -u
 tail -n 3 .tint-bootstrap/j-selfbuild-v8-bootstrap.log || true
 ps -p "$j_boot_pid" -o pid,etime,time,%cpu,state || true
 sleep 30
done
wait "$j_boot_pid"
echo 'Frozen bootstrap exit=0'
lldb --no-lldbinit --batch --one-line-on-crash 'bt 25' -o 'settings set target.disable-aslr false' -o "process launch --stop-at-entry -- $PWD/.tint-bootstrap/j-string-source-v8 $PWD/.tint-bootstrap/j-string-stage2-v8 --debug-symbols" -o "script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); open('.tint-bootstrap/j-selfbuild-v8-initial.json','w').write(json.dumps({'state':'stopped' if p.GetState()==lldb.eStateStopped else str(p.GetState()),'pid':p.GetProcessID()})); assert p.GetState()==lldb.eStateStopped" -o continue -o "script p=lldb.debugger.GetSelectedTarget().GetProcess(); open('.tint-bootstrap/j-selfbuild-v8-final.json','w').write(json.dumps({'state':'exited' if p.GetState()==lldb.eStateExited else str(p.GetState()),'exitStatus':p.GetExitStatus()})); assert p.GetState()==lldb.eStateExited and p.GetExitStatus()==0" .tint-bootstrap/j-string-stage1-v8 > .tint-bootstrap/j-selfbuild-v8-native.log 2>&1 &
j_native_pid=$!
while kill -0 "$j_native_pid" 2>/dev/null; do
 date -u
 tail -n 3 .tint-bootstrap/j-selfbuild-v8-native.log || true
 ps -p "$j_native_pid" -o pid,etime,time,state || true
 ps -axo pid,ppid,time,etime,%cpu,state,comm | awk '$NF ~ /j-string-stage1-v8$/ {print}'
 sleep 30
done
wait "$j_native_pid"
node --input-type=module - <<'JS'
import {readFileSync} from 'node:fs';
const initial=JSON.parse(readFileSync('.tint-bootstrap/j-selfbuild-v8-initial.json','utf8')),final=JSON.parse(readFileSync('.tint-bootstrap/j-selfbuild-v8-final.json','utf8'));
if(initial.state!=='stopped'||!Number.isSafeInteger(initial.pid)||initial.pid<=0||final.state!=='exited'||final.exitStatus!==0)throw Error(JSON.stringify({initial,final}));
console.log('Independent native initial/final states verified');
JS
cmp .tint-bootstrap/j-string-stage1-v8 .tint-bootstrap/j-string-stage2-v8
codesign --verify .tint-bootstrap/j-string-stage1-v8
codesign --verify .tint-bootstrap/j-string-stage2-v8
dwarfdump --verify .tint-bootstrap/j-string-stage1-v8 > .tint-bootstrap/j-selfbuild-v8-dwarf.log 2>&1
shasum -a 256 .tint-bootstrap/j-string-stage1-v8 .tint-bootstrap/j-string-stage2-v8
echo 'Frozen selfbuild, comparison, signatures and DWARF exit=0'
