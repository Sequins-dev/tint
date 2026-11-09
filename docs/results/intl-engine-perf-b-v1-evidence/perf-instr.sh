#!/bin/zsh
B=/Users/stephenbelanger/.t3/worktrees/tint/t3-f3c644cf/.tint-bootstrap/b-resume
for img in before-1 after-aot-1; do
  echo "=== $(date -u +%T) array64 $img"
  $B/perf-inferior.sh $B/perf/img/$img.json.array64 64 $B/perf/instr-array64-$img.tsv 1
done
for rep in 1 2 3; do
  for img in before-1 after-aot-1; do
    echo "=== $(date -u +%T) eval24 $img rep$rep load $(uptime | sed 's/.*load averages: //')"
    $B/perf-inferior.sh $B/perf/img/$img.json.eval24 2 $B/perf/instr-eval24-$img-rep$rep.tsv 1
  done
done
echo INSTR-DONE
