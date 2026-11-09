#!/bin/zsh
B=/Users/stephenbelanger/.t3/worktrees/tint/t3-c0227322-base/.tint-bootstrap/a3; S=$B/size
NODE=/Users/stephenbelanger/.nvm/versions/node/v24.12.0/bin/node
R=/Users/stephenbelanger/.t3/worktrees/tint/t3-c0227322-base/docs/results
build() { # toolchain label
  local tc=$B/toolchain-$1
  mkdir -p $tc/docs/results/eval-code-size-evidence-v1
  cp $R/eval-code-size-benchmark-v1.ts $R/eval-site-size-benchmark-v1.ts $tc/docs/results/
  cp $R/eval-code-size-evidence-v1/time-native-pairs.ts $tc/docs/results/eval-code-size-evidence-v1/ 2>/dev/null
  (cd $tc && TINT_BUILD_ONLY=1 $NODE docs/results/eval-code-size-benchmark-v1.ts build > $S/bench-build-$1.json 2> $S/bench-build-$1.log; echo "bench $1 exit $?")
  (cd $tc && TINT_BUILD_ONLY=1 $NODE docs/results/eval-site-size-benchmark-v1.ts build > $S/accept-build-$1.json 2> $S/accept-build-$1.log; echo "accept $1 exit $?")
  for kind in bench accept; do
    P=$($NODE -e 'console.log(require(process.argv[1]).path)' $S/$kind-build-$1.json); rm -rf $S/$kind-$1; cp -R $(dirname $P) $S/$kind-$1
  done
  $NODE -e 'const fs=require("fs"),c=require("crypto"),d=process.argv[1];const fx=JSON.parse(fs.readFileSync(d+"/fixture.json","utf8"));const sha=b=>c.createHash("sha256").update(b).digest("hex");fs.writeFileSync(d+"/test.manifest.json",JSON.stringify({kind:"a3-codegen-benchmark-image",imageSha256:sha(fs.readFileSync(d+"/test")),fixtureSha256:sha(JSON.stringify(fx.cases)),sourceSnapshot:fx.sourceSnapshot},null,2)+"\n")' $S/bench-$1
}
build ven-v83 &
build main-e47c &
wait
echo "$(date -u +%T) builds done"

echo "$(date -u +%T) natives done"
cd /Users/stephenbelanger/.t3/worktrees/tint/t3-c0227322-base
for c in 0 1 2 3; do ~/.t3/tint-slots/slot runner 8 -- $NODE docs/results/eval-code-size-evidence-v1/time-native-pairs.ts $S/bench-main-e47c/test $S/bench-ven-v83/test $c 3 300000 $S/pairs-ven83b-case$c.json 2>> $S/pairs-ven83b.log; echo "$(date -u +%T) pair case $c exit $?"; done
for img in ven-v83 main-e47c; do for c in 1 4; do ~/.t3/tint-slots/slot runner 8 -- $NODE docs/results/eval-site-size-benchmark-v1.ts once $S/accept-$img/test $c >> $S/accept-ven83b-$img.jsonl 2>> $S/accept-ven83b.log; echo "$(date -u +%T) accept $img case $c exit $?"; done; done
echo "$(date -u +%T) all done"
