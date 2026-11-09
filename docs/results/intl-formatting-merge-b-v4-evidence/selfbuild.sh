#!/bin/zsh
set -eu
cd /Users/stephenbelanger/.t3/worktrees/tint/t3-f3c644cf
B=.tint-bootstrap/b-resume
T=$B/frozen-intl-v5
node $T/tools/bootstrap-compiler.ts $B/intl-stage1-v6 --source-root "$PWD/$T" --snapshot $B/intl-source-v6 --debug-symbols > $B/intl-bootstrap-v6.log 2>&1 &
p=$!
while kill -0 $p 2>/dev/null; do date -u; tail -n 1 $B/intl-bootstrap-v6.log 2>/dev/null || true; ps -p $p -o pid=,etime=,time= || true; sleep 30; done
wait $p
echo 'bootstrap exit=0'
lldb --no-lldbinit --batch -o 'settings set target.disable-aslr false' -o "process launch --stop-at-entry -- $PWD/$B/intl-source-v6 $PWD/$B/intl-stage2-v6 --debug-symbols" -o 'script assert lldb.process.GetState() == lldb.eStateStopped' -o continue -o 'script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 0' $B/intl-stage1-v6 > $B/intl-selfbuild-native-v6.log 2>&1 &
q=$!
while kill -0 $q 2>/dev/null; do date -u; tail -n 2 $B/intl-selfbuild-native-v6.log | cut -c1-160 2>/dev/null || true; ps -axo pid,etime,time,comm | awk '$NF ~ /intl-stage1-v6$/'; sleep 30; done
wait $q
grep 'exited with status = 0' $B/intl-selfbuild-native-v6.log
cmp $B/intl-stage1-v6 $B/intl-stage2-v6
codesign --verify --strict $B/intl-stage1-v6
codesign --verify --strict $B/intl-stage2-v6
dwarfdump --verify $B/intl-stage1-v6 > $B/intl-dwarf-v6.log 2>&1
shasum -a 256 $B/intl-stage1-v6 $B/intl-stage2-v6
ls -l $B/intl-stage1-v6 $B/intl-stage2-v6
echo 'selfbuild, comparison, signature and DWARF exit=0'
