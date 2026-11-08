#!/bin/zsh
# usage: ab.sh <out.jsonl> <rounds> <imgA> <imgB> <case>... : alternating matched native runs under LLDB, user CPU via /usr/bin/time
P=${0:A:h}; out=$1; rounds=$2; A=$3; B=$4; shift 4; : > $out
for round in $(seq 1 $rounds); do
  if (( round % 2 )); then order=($A $B); else order=($B $A); fi
  for c in "$@"; do for img in $order; do
    d=$P/ab-runs/$(basename $(dirname $img))-r$round-c$c; rm -rf $d; mkdir -p $d
    load=$(sysctl -n vm.loadavg | awk '{print $2}')
    /usr/bin/time -p $P/run-case.sh $img $c $d 2> $d/time.txt
    u=$(awk '/^user/{print $2}' $d/time.txt); s=$(awk '/^sys/{print $2}' $d/time.txt); r=$(awk '/^real/{print $2}' $d/time.txt)
    echo "{\"round\":$round,\"image\":\"$(basename $(dirname $img))\",\"case\":$c,\"user\":$u,\"sys\":$s,\"real\":$r,\"load1\":$load,\"initial\":$(cat $d/initial.json),\"final\":$(cat $d/final.json)}" >> $out
  done; done
done
echo DONE >> $out
