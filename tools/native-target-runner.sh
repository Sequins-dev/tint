#!/bin/sh
# Batch entry point on Linux. The host stages setup, jobs and image checksums.
set -eu
ulimit -c 0
. ./setup
printf 'STARTED\n'

unavailable() {
  printf 'UNAVAILABLE\t%s\n' "$1"
  exit 0
}

command -v perl >/dev/null || unavailable 'perl is missing'
command -v timeout >/dev/null || unavailable 'timeout is missing'
identity=$(uname -smr)
case "$mode:$(uname -m)" in
  linux-dev:aarch64|x64-ssh:x86_64) ;;
  x64-qemu-dev:aarch64)
    command -v "$qemu" >/dev/null || unavailable "QEMU is missing at $qemu"
    (cd "$sysroot" && sha256sum -c --status "$OLDPWD/sysroot.sha256") ||
      unavailable "pinned sysroot missing or mismatched at $sysroot"
    identity="$identity | $("$qemu" --version | head -n 1)"
    unset LD_LIBRARY_PATH LD_PRELOAD QEMU_LD_PREFIX QEMU_SET_ENV QEMU_UNSET_ENV
    ;;
  *) unavailable "incompatible runner host: $identity" ;;
esac
sha256sum -c --status images.sha256
if [ "${debugger:-}" = lldb ]; then
  command -v lldb >/dev/null || unavailable 'lldb is missing'
  identity="$identity | $(lldb --version | head -n 1)"
fi
printf 'READY\t%s\n' "$(printf '%s' "$identity" | base64 -w0)"

debug_run() {
  seconds=$1
  shift
  batch_dir=$PWD
  : >stdout
  : >stderr
  launcher_status=0
  (
    cd "${inferior_cwd:-$batch_dir}"
    timeout -k 1 "$seconds" lldb --no-lldbinit --batch \
      -o 'settings set target.disable-aslr false' \
      -o "process launch --stop-at-entry -o \"$batch_dir/stdout\" -e \"$batch_dir/stderr\"" \
      -o 'script assert lldb.process.GetState() == lldb.eStateStopped; print("TINT_LLDB_AT_ENTRY")' \
      -o continue \
      -o 'script p=lldb.process; t=p.GetSelectedThread(); print("TINT_LLDB_EXIT", p.GetExitStatus()) if p.GetState() == lldb.eStateExited else print("TINT_LLDB_SIGNAL", t.GetStopReasonDataAtIndex(0)) if t.GetStopReason() == lldb.eStopReasonSignal else None' \
      -- "$@"
  ) </dev/null >debugger-log 2>&1 || launcher_status=$?
  value=
  if [ "$launcher_status" -eq 124 ] || [ "$launcher_status" -eq 137 ]; then
    kind=timed-out
  elif grep -qx 'TINT_LLDB_AT_ENTRY' debugger-log && [ "$launcher_status" -eq 0 ]; then
    value=$(sed -n 's/^TINT_LLDB_EXIT \([0-9][0-9]*\)$/\1/p' debugger-log)
    if [ -n "$value" ]; then
      kind=exited
    else
      signal=$(sed -n 's/^TINT_LLDB_SIGNAL \([0-9][0-9]*\)$/\1/p' debugger-log)
      if [ -n "$signal" ]; then
        kind=signaled
        value=$(kill -l "$signal")
        value=SIG${value#SIG}
      else
        kind=runner-error
        value='LLDB stopped without an inferior exit or signal'
      fi
    fi
  else
    kind=runner-error
    value='LLDB launch failed before confirmed entry'
  fi
  if [ "$kind" != exited ]; then cat debugger-log >>stderr; fi
}

run() {
  index=$1
  seconds=$2
  image=$PWD/$3
  shift 3
  set -- "$image" "$@"
  if [ "$mode" = x64-qemu-dev ]; then
    set -- "$qemu" -L "$sysroot" "$@"
  fi
  if [ "${debugger:-}" = lldb ]; then
    debug_run "$seconds" "$@"
    printf 'RESULT\t%s\t%s\t%s\t%s\t%s\n' "$index" "$kind" "$value" \
      "$(base64 -w0 stdout)" "$(base64 -w0 stderr)"
    return
  fi
  # Perl preserves waitpid's signal bits. The outer timeout manages the
  # process group and its exit code never substitutes for the inferior's.
  rm -f status
  launcher_status=0
  timeout -k 1 "$seconds" perl -e '
    $path = shift;
    $cwd = shift;
    chdir $cwd or die "$cwd: $!";
    $status = system { $ARGV[0] } @ARGV;
    open $file, ">", $path or die $!;
    print $file $status;
    close $file or die $!;
  ' -- "$PWD/status" "${inferior_cwd:-$PWD}" "$@" </dev/null >stdout 2>stderr || launcher_status=$?
  value=
  case "$launcher_status" in
    124|137) kind=timed-out ;;
    0)
      status=$(cat status)
      if [ "$status" -lt 0 ]; then
        kind=runner-error
        value='could not exec image'
      elif [ "$((status & 127))" -ne 0 ]; then
        kind=signaled
        value=$(kill -l "$((status & 127))")
        value=SIG${value#SIG}
      else
        kind=exited
        value=$((status >> 8))
      fi
      ;;
    *) kind=runner-error; value="launch supervisor exited $launcher_status" ;;
  esac
  printf 'RESULT\t%s\t%s\t%s\t%s\t%s\n' "$index" "$kind" "$value" \
    "$(base64 -w0 stdout)" "$(base64 -w0 stderr)"
}
. ./jobs
