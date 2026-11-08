#!/bin/zsh
# usage: run-case.sh <image> <case> <outdir>  -- launches under LLDB, records initial/final state, pid, CPU time
img=$1; c=$2; out=$3; mkdir -p $out
lldb --no-lldbinit --batch \
 -o "process launch --stop-at-entry -- $c" \
 -o "script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); open('$out/pid','w').write(str(p.GetProcessID())); open('$out/initial.json','w').write(json.dumps({'state':p.GetState(),'pid':p.GetProcessID()})); assert p.GetState()==lldb.eStateStopped" \
 -o "continue" \
 -o "script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); s=p.GetState(); open('$out/final.json','w').write(json.dumps({'state':s,'exit':p.GetExitStatus()})); p.Kill() if s!=lldb.eStateExited else None" \
 $img > $out/lldb.log 2>&1
