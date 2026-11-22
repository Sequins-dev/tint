# Shared by the platform gate entry points. The caller supplies a checkout.
gate_root=$(git rev-parse --show-toplevel)
cd "$gate_root"
gate_head=$(git rev-parse HEAD)
mkdir -p .tint-bootstrap
gate_output=$(mktemp -d "$gate_root/.tint-bootstrap/gate.XXXXXXXX")
unset TINT_GATE_LAUNCH_LOCK
export TINT_GATE_EVIDENCE="$gate_output"
export TINT_GATE_LOCK_TIMING="$gate_output/locks.tsv"
gate_started=$(date +%s)
gate_status() {
  gate_exit=$?
  sum=0
  if [ -f "$TINT_GATE_LOCK_TIMING" ]; then
    sum=$(awk -F '\t' -v lock="${TINT_GATE_EXCLUSIVE_LOCK:-}" '$2 == lock { sum += $4 } END { print sum + 0 }' "$TINT_GATE_LOCK_TIMING")
  fi
  if [ -s "$gate_output/stalls.tsv" ]; then
    awk -F '\t' '{ printf "STALL step=%s timeout-seconds=%s pid=%s report=%s status=%s\n", $1, $2, $3, $4, $5 }' "$gate_output/stalls.tsv"
  fi
  printf 'gate-exit=%s wall-seconds=%s exclusive-lock-ms=%s evidence=%s\n' \
    "$gate_exit" "$(( $(date +%s) - gate_started ))" "$sum" "$gate_output"
}
trap gate_status EXIT
printf 'head=%s evidence=%s\n' "$gate_head" "$gate_output"

# Each step gets its own log. Exit checks stay outside pipelines.
run_step() {
  step_name=$1 step_resource=$2
  shift 2
  step_log="$gate_output/$step_name.log"
  run_step_logged "$step_name" "$step_resource" "$step_log" "$step_log" "$@"
}

run_step_logged() {
  step_name=$1 step_resource=$2 step_log=$3 step_stderr=$4
  shift 4
  step_started=$(date +%s)
  printf '%s start %s resource=%s log=%s\n' "$(date -u +%FT%TZ)" "$step_name" "$step_resource" "$step_log"
  case "$step_resource" in
    unlocked) ;;
    memory)
      set -- env TINT_GATE_STEP_READY="$gate_output/ready-$step_name" \
        node tools/gate/lock.ts memory "$step_name" "$@"
      ;;
    exclusive)
      set -- env TINT_GATE_STEP_READY="$gate_output/ready-$step_name" \
        TINT_GATE_STEP_TIMEOUT="${gate_step_timeout:?}" \
        sh tools/gate/exclusive-step.sh "$step_name" "$@"
      ;;
    watchdog|memory-watchdog)
      set -- node tools/gate/lock.ts watchdog "$step_name" "$@"
      if [ "$step_resource" = memory-watchdog ]; then
        set -- env TINT_GATE_STEP_READY="$gate_output/ready-$step_name" \
          node tools/gate/lock.ts memory "$step_name" "$@"
      fi
      set -- env TINT_GATE_STEP_TIMEOUT="${gate_step_timeout:?}" "$@"
      ;;
    *) return 2 ;;
  esac
  # A single descriptor preserves output order when stdout and stderr share a log.
  step_exit=0
  if [ "$step_log" = "$step_stderr" ]; then
    "$@" >"$step_log" 2>&1 || step_exit=$?
  else
    "$@" >"$step_log" 2>"$step_stderr" || step_exit=$?
  fi
  if [ -s "$gate_output/stalls.tsv" ]; then
    step_exit=$(awk -F '\t' 'NR == 1 {print $5 ? $5 : 124}' "$gate_output/stalls.tsv")
  fi
  printf '%s finish %s exit=%s wall-seconds=%s\n' \
    "$(date -u +%FT%TZ)" "$step_name" "$step_exit" "$(( $(date +%s) - step_started ))"
  if [ "$step_exit" -ne 0 ]; then
    tail -n 25 "$step_stderr" >&2
  fi
  return "$step_exit"
}

storage_tests() {
  run_step storage unlocked node --test packages/ir/test/function-store.test.ts tools/function-store-files.test.ts
  printf 'storage-tests=0 %s\n' "$(grep -E '^ℹ (pass|fail) ' "$step_log" | tr '\n' ' ')"
}

bootstrap() {
  run_step bootstrap "$1" env TZ=UTC node tools/bootstrap-compiler.ts \
    "$gate_output/stage1" --snapshot "$gate_output/source"
  echo bootstrap=0
}

stage_step() {
  gate_step_timeout=${TINT_GATE_STAGE_TIMEOUT:-1800} run_step "$@"
}

stage_lldb() {
  stage_resource=$1 stage_input=$2 stage_output=$3
  TINT_GATE_INFERIOR_PID_FILE="$gate_output/$stage_output.pid" \
    stage_step "$stage_output" "$stage_resource" env TZ=UTC sh -c '
    cd "$1" || exit
    exec lldb --no-lldbinit --batch \
      -o "settings set target.disable-aslr false" \
      -o "process launch --stop-at-entry -- source $3" \
      -o "script assert lldb.process.GetState() == lldb.eStateStopped" \
      -o "script import os; open(os.environ[\"TINT_GATE_INFERIOR_PID_FILE\"], \"w\").write(str(lldb.process.GetProcessID()))" \
      -o continue \
      -o "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 0" \
      "./$2"
  ' tint-stage "$gate_output" "$stage_input" "$stage_output"
  grep 'exited with status = 0 ' "$step_log"
  test -s "$gate_output/$stage_output"
}
