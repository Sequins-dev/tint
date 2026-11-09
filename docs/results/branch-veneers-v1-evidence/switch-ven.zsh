#!/bin/zsh
B=/Users/stephenbelanger/.t3/worktrees/tint/t3-c0227322-base/.tint-bootstrap/a3/size
S=/Users/stephenbelanger/.t3/worktrees/tint/t3-c0227322/.tint-bootstrap/a3/size
pkill -f site-native-ven-v79.zsh
while true; do
  R=$(pgrep -f "toolchain-ven-v79/tools/test262-native-run" | head -1)
  [[ -z "$R" ]] && break
  L=$(tail -1 $B/site-language-ven-v79.log)
  if [[ "$L" == *'phase="compiling batch'* ]] && [[ -z "$(pgrep -P $R)" ]]; then kill $R; sleep 1; echo "$(date -u +%T) stopped v79 at: $L" | cut -c1-200; break; fi
  sleep 2
done
sleep 3
$B/site-native-ven-v80.zsh > $B/site-native-ven-v80.out 2>&1
echo "$(date -u +%T) v80 natives done"
for f in bench-build-ven-v80.json accept-build-ven-v80.json; do while [ ! -s $S/$f ]; do sleep 10; done; done
P=$(node -e 'console.log(require(process.argv[1]).path)' $S/bench-build-ven-v80.json); rm -rf $S/bench-ven-v80; cp -R $(dirname $P) $S/bench-ven-v80
node -e 'const fs=require("fs"),c=require("crypto"),d=process.argv[1];const fx=JSON.parse(fs.readFileSync(d+"/fixture.json","utf8"));const sha=b=>c.createHash("sha256").update(b).digest("hex");fs.writeFileSync(d+"/test.manifest.json",JSON.stringify({kind:"a3-codegen-benchmark-image",imageSha256:sha(fs.readFileSync(d+"/test")),fixtureSha256:sha(JSON.stringify(fx.cases)),sourceSnapshot:fx.sourceSnapshot},null,2)+"\n")' $S/bench-ven-v80
P=$(node -e 'console.log(require(process.argv[1]).path)' $S/accept-build-ven-v80.json); rm -rf $S/accept-ven-v80; cp -R $(dirname $P) $S/accept-ven-v80
cd /Users/stephenbelanger/.t3/worktrees/tint/t3-c0227322
for c in 0 1 2 3; do ~/.t3/tint-slots/slot runner 8 -- /Users/stephenbelanger/.nvm/versions/node/v24.12.0/bin/node docs/results/eval-code-size-evidence-v1/time-native-pairs.ts $S/bench-main-7b19/test $S/bench-ven-v80/test $c 3 300000 $S/pairs-ven80-case$c.json 2>> $S/pairs-ven.log; echo "$(date -u +%T) pair case $c exit $?"; done
for img in ven-v80 main-7b19; do for c in 1 4; do ~/.t3/tint-slots/slot runner 8 -- /Users/stephenbelanger/.nvm/versions/node/v24.12.0/bin/node docs/results/eval-site-size-benchmark-v1.ts once $S/accept-$img/test $c >> $S/accept-ven80-$img.jsonl 2>> $S/accept-ven.log; echo "$(date -u +%T) accept $img case $c exit $?"; done; done
echo "$(date -u +%T) all done"
