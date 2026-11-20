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
  linux-dev:aarch64|x64-local:x86_64|x64-ssh:x86_64) ;;
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
printf 'READY\t%s\n' "$(printf '%s' "$identity" | base64 -w0)"

run() {
  index=$1
  seconds=$2
  image=$PWD/$3
  shift 3
  set -- "$image" "$@"
  if [ "$mode" = x64-qemu-dev ]; then
    set -- "$qemu" -L "$sysroot" "$@"
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
