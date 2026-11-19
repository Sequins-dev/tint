#!/bin/sh
# Run on the arm64 Linux dev machine. Files are visible through the home mount.
set -eu
test "$(uname -s):$(uname -m)" = Linux:aarch64
pins=$(cd "$(dirname "$0")" && pwd)/x64-sysroot.sha256
scratch=${1:?"usage: sh tools/setup-x64-sysroot.sh /absolute/shared/t3-directory"}
root=$scratch/tint-x64-sysroot
qemu=$scratch/tint-x64-qemu
archive=https://snapshot.debian.org/file
mkdir -p "$scratch"
temporary=$(mktemp -d "$scratch/.tint-x64-setup.XXXXXX")
unpacked=$(mktemp -d)
trap 'rm -rf "$temporary" "$unpacked"' EXIT
cd "$temporary"

extract() {
  package=$1
  archive_id=$2
  sha256=$3
  destination=$4
  printf '%s\n' "$package"
  curl -fLsS --retry 2 --max-time 120 "$archive/$archive_id" -o package.deb
  printf '%s  package.deb\n' "$sha256" | sha256sum -c
  dpkg-deb -x package.deb "$destination"
  rm package.deb
}

if [ ! -e "$root" ]; then
  extract 'libc6_2.36-9+deb12u14_amd64.deb' c534c6c7f912b61ca26b7cf4082235a0343b8751 \
    ba4f88f73dbc3ae9055f3c20f4523bfdbaf1ad13ff95e258924f77d20b4fbedf "$unpacked"
  extract 'coreutils_9.1-1_amd64.deb' a2f7017395e57d6da64f4562578213dd19568939 \
    61038f857e346e8500adf53a2a0a20859f4d3a3b51570cc876b153a2d51a3091 "$unpacked"
  install -D "$unpacked/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2" root/lib64/ld-linux-x86-64.so.2
  install -D "$unpacked/lib/x86_64-linux-gnu/libc.so.6" root/lib/x86_64-linux-gnu/libc.so.6
  install -D "$unpacked/bin/true" root/usr/bin/true
  (cd root && sha256sum -c "$pins")
  mv -nT root "$root"
fi
(cd "$root" && sha256sum -c "$pins")
printf 'sysroot manifest '
sha256sum "$pins"

if [ ! -e "$qemu" ]; then
  extract 'qemu-user-static_7.2+dfsg-7+deb12u18+b3_arm64.deb' 29bb5c8126d79b55f5624b5a09d8b5427ea3469d \
    e420c417c12b42ca774795b62888d5388da0e08c1ef263dea1490e5ce4e32a0b "$unpacked/qemu"
  install -D "$unpacked/qemu/usr/bin/qemu-x86_64-static" qemu/qemu-x86_64-static
  mv -nT qemu "$qemu"
fi
"$qemu/qemu-x86_64-static" --version | head -n 1
