#!/bin/zsh
set -eu
cd /Users/stephenbelanger/.t3/worktrees/tint/t3-f3c644cf
B=.tint-bootstrap/b-resume
T=$B/frozen-dn-v3
node $T/tools/bootstrap-compiler.ts $B/dn-stage1-v3 --source-root "$PWD/$T" --snapshot $B/dn-source-v3 --debug-symbols > $B/dn-bootstrap-v3.log 2>&1 &
p=$!
while kill -0 $p 2>/dev/null; do date -u; tail -n 1 $B/dn-bootstrap-v3.log 2>/dev/null || true; ps -p $p -o pid=,etime=,time= || true; sleep 30; done
wait $p
echo 'bootstrap exit=0'
lldb --no-lldbinit --batch -o 'settings set target.disable-aslr false' -o "process launch --stop-at-entry -- $PWD/$B/dn-source-v3 $PWD/$B/dn-stage2-v3 --debug-symbols" -o 'script assert lldb.process.GetState() == lldb.eStateStopped' -o continue -o 'script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 0' $B/dn-stage1-v3 > $B/dn-selfbuild-native-v3.log 2>&1 &
q=$!
while kill -0 $q 2>/dev/null; do date -u; tail -n 2 $B/dn-selfbuild-native-v3.log | cut -c1-160 2>/dev/null || true; ps -axo pid,etime,time,comm | awk '$NF ~ /dn-stage1-v3$/'; sleep 30; done
wait $q
grep 'exited with status = 0' $B/dn-selfbuild-native-v3.log
cmp $B/dn-stage1-v3 $B/dn-stage2-v3
codesign --verify --strict $B/dn-stage1-v3
codesign --verify --strict $B/dn-stage2-v3
dwarfdump --verify $B/dn-stage1-v3 > $B/dn-dwarf-v3.log 2>&1
shasum -a 256 $B/dn-stage1-v3 $B/dn-stage2-v3
ls -l $B/dn-stage1-v3 $B/dn-stage2-v3
echo 'selfbuild, comparison, signature and DWARF exit=0'
