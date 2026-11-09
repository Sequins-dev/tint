#!/bin/zsh
cd /Users/stephenbelanger/.t3/worktrees/tint/t3-f3c644cf
export PATH=$HOME/.nvm/versions/node/v24.12.0/bin:$PATH TINT_TEST262_DEBUGGER_LAUNCH=debugserver-direct
for t in tools/verify-test262-native-temporal-core-locale.ts tools/verify-test262-native-temporal-partial-locale.ts tools/verify-hosted-date-time-calendar.ts tools/verify-hosted-date-time-format-api.ts tools/verify-hosted-date-time-parts.ts tools/verify-hosted-date-time-pattern.ts tools/verify-hosted-date-time-range.ts tools/verify-hosted-date-time-skeleton.ts tools/verify-hosted-date-time-zone-data.ts tools/verify-hosted-date-time-zone-name.ts tools/verify-hosted-duration-format.ts tools/verify-hosted-locale-data-pack.ts tools/verify-hosted-runtime-shared-collections.ts tools/verify-hosted-runtime-specialization-sharing.ts tools/verify-hosted-syntax-hash.ts tools/verify-hosted-temporal-date-start-of-day.ts tools/verify-hosted-temporal-date-time-format.ts tools/verify-hosted-unit-format.ts ; do
  echo "=== $(date -u +%T) START $t"
  start=$(date +%s)
  node $t > .tint-bootstrap/b-resume/nv4-$(basename $t .ts).log 2>&1
  code=$?
  echo "=== $(date -u +%T) END $t exit=$code $(($(date +%s)-start))s"
  tail -3 .tint-bootstrap/b-resume/nv4-$(basename $t .ts).log | cut -c1-200
done
echo ALL-DONE
