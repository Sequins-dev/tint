#!/bin/zsh
# usage: compiler-ab.sh <out.jsonl> <rounds> <stage1-A> <stage1-B> <snapshot-dir>
# Alternating matched native compiler runs under LLDB (stop-at-entry asserted, exit 0), user CPU via /usr/bin/time.
P=${0:A:h}; out=$1; rounds=$2; A=$3; B=$4; snap=$5; : > $out
for round in $(seq 1 $rounds); do
  if (( round % 2 )); then order=($A $B); else order=($B $A); fi
  for img in $order; do
    label=$(basename $(dirname $img)); d=$P/compiler-ab-runs/$label-r$round; rm -rf $d; mkdir -p $d
    load=$(sysctl -n vm.loadavg | awk '{print $2}')
    /usr/bin/time -p lldb --no-lldbinit --batch \
      -o "process launch --stop-at-entry -- $snap $d/out" \
      -o "script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); open('$d/initial.json','w').write(json.dumps({'state':p.GetState()})); assert p.GetState()==lldb.eStateStopped" \
      -o "continue" \
      -o "script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); s=p.GetState(); open('$d/final.json','w').write(json.dumps({'state':s,'exit':p.GetExitStatus()}))" \
      $img > $d/lldb.log 2> $d/time.txt
    u=$(awk '/^user/{print $2}' $d/time.txt); r=$(awk '/^real/{print $2}' $d/time.txt); bytes=$(stat -f %z $d/out 2>/dev/null || echo 0)
    echo "{\"round\":$round,\"compiler\":\"$label\",\"user\":$u,\"real\":$r,\"load1\":$load,\"outBytes\":$bytes,\"initial\":$(cat $d/initial.json),\"final\":$(cat $d/final.json)}" >> $out
  done
done
echo DONE >> $out
