#!/bin/zsh
# Usage: slot <class> <max> -- command [args...]
# Runs the command once one of <max> machine-wide slots for <class> is free.
# Prints a waiting heartbeat every 30 s to stderr (progress rule). Stale slots (dead pid) are reclaimed.
set -u
cls=$1; max=$2; shift 2; [ "$1" = "--" ] && shift
root=$HOME/.t3/tint-slots/$cls; mkdir -p $root
start=$(date +%s); last=0; held=""
while [ -z "$held" ]; do
  # Refresh the coordinator cap (in $root/max) while queued; running jobs keep their slot.
  [ -f $root/max ] && max=$(cat $root/max)
  for i in $(seq 1 $max); do
    d=$root/slot-$i
    if mkdir $d 2>/dev/null; then echo $$ > $d/pid; echo "$PWD $*" > $d/cmd; held=$d; break; fi
    p=$(cat $d/pid 2>/dev/null)
    if [ -n "$p" ] && ! kill -0 $p 2>/dev/null; then rm -rf $d; fi
  done
  if [ -z "$held" ]; then
    now=$(date +%s)
    if (( now - last >= 30 )); then
      echo "[slot] waiting for $cls slot (max $max) for $((now-start))s; holders: $(cat $root/slot-*/cmd 2>/dev/null | cut -c1-80 | tr '\n' ';')" >&2; last=$now
    fi
    sleep 2
  fi
done
trap 'rm -rf $held' EXIT INT TERM HUP
echo "[slot] acquired $held after $(( $(date +%s) - start ))s" >&2
"$@"
