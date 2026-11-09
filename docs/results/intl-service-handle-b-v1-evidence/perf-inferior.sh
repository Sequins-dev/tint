#!/bin/zsh
# Per-case inferior CPU under LLDB: the LLDB CLI launches each case (stop at
# entry asserted, then continue to exit) while perf-poll.py samples the live
# inferior's own user+system CPU every 2 ms. Usage: image cases out.tsv [reps]
set -u
B=${0:a:h}
image=${1:a}; cases=$2; out=$3; reps=${4:-1}
print -r -- "rep	case	exit	wall_s	inferior_cpu_s	samples	instructions	cycles" > $out
for rep in $(seq 1 $reps); do
  for i in $(seq 0 $((cases - 1))); do
    pollout=$(mktemp)
    /usr/bin/python3 $B/perf-poll.py $image 300 > $pollout &
    poller=$!
    t0=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
    res=$(lldb --no-lldbinit --batch -o "process launch --stop-at-entry -- $i" -o 'script assert lldb.process.GetState() == lldb.eStateStopped' -o continue $image 2>&1 | grep -o 'exited with status = -\?[0-9]*' | awk '{print $5}')
    t1=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
    wait $poller
    read pid cpu samples instr cycles < $pollout
    rm -f $pollout
    print -r -- "$rep	$i	${res:-?}	$(echo "$t1 - $t0" | bc)	$cpu	$samples	$instr	$cycles" >> $out
  done
done
