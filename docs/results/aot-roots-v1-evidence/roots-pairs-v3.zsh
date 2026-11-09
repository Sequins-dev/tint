#!/bin/zsh
A=/Users/stephenbelanger/.t3/worktrees/tint/t3-c0227322-l2/.tint-bootstrap/a3/aot
T=/Users/stephenbelanger/.t3/worktrees/tint/t3-c0227322-l2/.tint-bootstrap/a3/toolchain-roots-v2
while pgrep -f "ven83-bench" >/dev/null; do sleep 15; done
while pgrep -f "selfbuild-roots-v2.ts" >/dev/null; do sleep 15; done
[ -d $T/.tint-bootstrap/smoke-project ] || { echo "no smoke project"; exit 1; }
echo "$(date -u +%T) start"
cd /Users/stephenbelanger/.t3/worktrees/tint/t3-c0227322-l2
~/.t3/tint-slots/slot runner 8 -- /Users/stephenbelanger/.nvm/versions/node/v24.12.0/bin/node $A/compiler-pairs.ts $A/stage1-main-e47c $A/stage1-roots-1955 3 600000 $A/roots-pairs-1955-smoke.json $T/.tint-bootstrap/smoke-project '{out}' --debug-symbols 2> $A/roots-pairs-1955-smoke.log
echo "$(date -u +%T) pairs exit $?"
