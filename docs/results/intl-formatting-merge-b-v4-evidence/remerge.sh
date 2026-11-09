#!/bin/zsh
# Recreate feat/intl-formatting-b on current main: merge H's parked engine,
# reapply recorded resolutions, cherry-pick the ECMA-402 cleanup, build, focused tests.
set -eu
cd /Users/stephenbelanger/.t3/worktrees/tint/t3-f3c644cf
B=.tint-bootstrap/b-resume
RESOLVED=5c6043f1   # merge on 6b104f7c whose resolutions are reused
CLEANUP=62cc83f5
git branch -f "$(git branch --show-current)-prev" HEAD
git reset -q --hard main
git merge --no-ff --no-commit park/intl-formatting-service-h >/dev/null 2>&1 || true
conf=$(git diff --name-only --diff-filter=U)
for f in ${(f)conf}; do
  case $f in
    docs/test262.md) git checkout --ours -- $f ;;
    tools/script-runtime-surface.test.ts) git show main:$f > $f; python3 $B/surface-delta.py ;;
    packages/js-runtime/src/objects/operations.ts) python3 $B/resolve-operations.py ;;
    packages/ts-native/src/runtime/index.ts|tools/test262-native-run.ts)
      if [ -n "$(git diff --name-only 6b104f7c main -- $f)" ]; then echo "MAIN CHANGED $f: resolve by hand"; exit 3; fi
      git checkout $RESOLVED -- $f ;;
    *) echo "NEW CONFLICT $f"; exit 2 ;;
  esac
  git add -- $f
done
# surface census also needs H's deltas when it merged cleanly
if [ -z "$(echo $conf | grep script-runtime-surface)" ]; then git show main:tools/script-runtime-surface.test.ts > tools/script-runtime-surface.test.ts; python3 $B/surface-delta.py; git add tools/script-runtime-surface.test.ts; fi
git commit -q -F <(git log -1 --format=%B $RESOLVED | sed 's/over main 6b104f7c (packed elements: anchors 114)/over main/')
git cherry-pick $CLEANUP >/dev/null
git cherry-pick 69687633 >/dev/null
pnpm build > $B/remerge-build.log 2>&1
export PATH=$HOME/.nvm/versions/node/v24.12.0/bin:$PATH
files=$(git diff --name-only --diff-filter=AMR main -- '*.test.ts' | tr '\n' ' ')
node --test --test-concurrency=3 ${=files} > $B/remerge-tests.log 2>&1 || { grep -E "^ℹ (tests|pass|fail)|^✖" $B/remerge-tests.log | sort -u; exit 4; }
grep -E "^ℹ (tests|pass|fail)" $B/remerge-tests.log
git log --oneline -3
echo REMERGE-OK base=$(git rev-parse --short main) head=$(git rev-parse --short HEAD)
