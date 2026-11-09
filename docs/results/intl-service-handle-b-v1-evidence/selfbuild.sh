#!/bin/zsh
set -eu
cd /Users/stephenbelanger/.t3/worktrees/tint/t3-f3c644cf
B=.tint-bootstrap/b-resume
T=$B/frozen-handle-v4
node $T/tools/bootstrap-compiler.ts $B/handle-stage1-v4 --source-root "$PWD/$T" --snapshot $B/handle-source-v4 --debug-symbols > $B/handle-bootstrap-v4.log 2>&1 &
p=$!
while kill -0 $p 2>/dev/null; do date -u; tail -n 1 $B/handle-bootstrap-v4.log 2>/dev/null || true; ps -p $p -o pid=,etime=,time= || true; sleep 30; done
wait $p
echo 'bootstrap exit=0'
lldb --no-lldbinit --batch -o 'settings set target.disable-aslr false' -o "process launch --stop-at-entry -- $PWD/$B/handle-source-v4 $PWD/$B/handle-stage2-v4 --debug-symbols" -o 'script assert lldb.process.GetState() == lldb.eStateStopped' -o continue -o 'script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 0' $B/handle-stage1-v4 > $B/handle-selfbuild-native-v4.log 2>&1 &
q=$!
while kill -0 $q 2>/dev/null; do date -u; tail -n 2 $B/handle-selfbuild-native-v4.log | cut -c1-160 2>/dev/null || true; ps -axo pid,etime,time,comm | awk '$NF ~ /handle-stage1-v4$/'; sleep 30; done
wait $q
grep 'exited with status = 0' $B/handle-selfbuild-native-v4.log
cmp $B/handle-stage1-v4 $B/handle-stage2-v4
codesign --verify --strict $B/handle-stage1-v4
codesign --verify --strict $B/handle-stage2-v4
dwarfdump --verify $B/handle-stage1-v4 > $B/handle-dwarf-v4.log 2>&1
shasum -a 256 $B/handle-stage1-v4 $B/handle-stage2-v4
ls -l $B/handle-stage1-v4 $B/handle-stage2-v4
echo 'selfbuild, comparison, signature and DWARF exit=0'
