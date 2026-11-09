#!/bin/zsh
S=/Users/stephenbelanger/.t3/worktrees/tint/t3-c0227322-base/.tint-bootstrap/a3/size
NODE=/Users/stephenbelanger/.nvm/versions/node/v24.12.0/bin/node
while pgrep -f "ub-dead2.zsh" >/dev/null; do sleep 15; done
cd /Users/stephenbelanger/.t3/worktrees/tint/t3-c0227322-base
for c in 1 4; do ~/.t3/tint-slots/slot runner 8 -- $NODE docs/results/eval-code-size-evidence-v1/time-native-pairs.ts $S/accept-main-e47c/test $S/accept-ven-v83/test $c 3 300000 $S/accept-pairs-ven83-case$c.json 2>> $S/accept-pairs-ven83.log; echo "$(date -u +%T) accept pair case $c exit $?"; done
