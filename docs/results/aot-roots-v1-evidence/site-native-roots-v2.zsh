#!/bin/zsh
while pgrep -f "ub-run.zsh|ub-dead2.zsh|ub-roots.zsh|accept-pairs-v83" >/dev/null; do sleep 15; done
cd /Users/stephenbelanger/.t3/worktrees/tint/t3-c0227322-l2 || exit 1
T=.tint-bootstrap/a3/toolchain-roots-v2
NODE=/Users/stephenbelanger/.nvm/versions/node/v24.12.0/bin/node
ROOT=/Users/stephenbelanger/Code/nodejs/tint/.tint-bootstrap/test262
for part in language:language builtins:built-ins staging:staging; do
  name=${part%%:*}; dir=${part#*:}
  base=.tint-bootstrap/a3/size/site-$name-roots-v2
  echo "$(date -u +%FT%TZ) start $name"
  env -u TZ TINT_TEST262_HEARTBEAT_MS=30000 TINT_TEST262_STALL_MS=150000 TINT_TEST262_CONTAINMENT_MS=300000 TINT_TEST262_DEBUGGER_LAUNCH=debugserver-direct TINT_TEST262_DEBUGGER_TRACE=0 TINT_TEST262_VARIANTS="$PWD/.tint-bootstrap/a3/size/site-$name-variants.json" TINT_TEST262_SOURCES="$PWD/$T/source-snapshot.json" TINT_TEST262_JOURNAL="$PWD/$base.jsonl" ~/.t3/tint-slots/slot runner 8 -- $NODE $T/tools/test262-native-run.ts $ROOT $dir 64 > $base.json 2> $base.log < /dev/null
  echo "$(date -u +%FT%TZ) end $name exit $?"
done
