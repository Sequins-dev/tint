/** `node:os` on Darwin (docs/native-ffi.md, "Foreign memory"):
 * `userInfo()`, `networkInterfaces()` and `loadavg()` following Node's C++
 * bindings and libuv's BSD code (uv_os_get_passwd, uv_interface_addresses
 * in bsd-ifaddrs.c, uv_loadavg), over `tint:c/darwin-os`. Shared shaping
 * and formatting are `os.ts`'s.
 *
 * getpwuid_r fills a struct passwd whose string members point into the
 * caller's buffer, and getifaddrs returns a linked list of records and
 * sockaddrs that C allocates; both are read through `tint:ffi/unsafe`
 * views at the addresses C hands back. The passwd record and its buffer
 * live in external storage, because reading the strings allocates (a
 * collection may then run) while C's pointers into them are still in use.
 * `tint:c/darwin-os` has no linux-arm64 image, so this module fails at
 * resolution on Linux (UNDECLARED_IMPORT) instead of misreading glibc's
 * records; `os-linux.ts` is Linux's. */
import {
  passwd,
  PasswdResult,
  InterfaceList,
  geteuid,
  getpwuid_r,
  sockaddr,
  sockaddr_in,
  sockaddr_in6,
  ifaddrs,
  getifaddrs,
  freeifaddrs,
  LoadAverages,
  getloadavg,
} from "tint:c/darwin-os";
import { allocate, release, address, type View } from "tint:ffi";
import { viewAt, bytesAt, cStringAt } from "tint:ffi/unsafe";
import {
  assignMac,
  familyIPv4,
  familyIPv6,
  familyUnknown,
  interfaceLoopback,
  interfaceRunning,
  interfaceUp,
  interrupted,
  outOfRange,
  shapeInterfaces,
  systemError,
  type InterfaceAddress,
  type NetworkInterfaceInfo,
  type UserInfo,
} from "./os.ts";

/** sys/socket.h address families. */
const familyInet = 2,
  familyInet6 = 30,
  familyLink = 18;

/** libuv's uv_os_get_passwd: getpwuid_r(geteuid()) with a 2000-byte buffer
 * doubled on ERANGE and retried on EINTR. */
export function userInfo(): UserInfo {
  const uid = geteuid();
  const header = passwd.size + PasswdResult.size;
  for (let size = 2000; ; size *= 2) {
    const block = allocate(header + size);
    try {
      const record: number = address(block),
        slot = record + passwd.size;
      let status = 0;
      do status = getpwuid_r(uid, record, slot + PasswdResult.size, size, slot);
      while (status === interrupted);
      if (status === outOfRange) continue;
      if (status !== 0)
        throw systemError("uv_os_get_passwd", "E" + String(status), "errno");
      const found = viewAt(PasswdResult, slot).entry;
      if (found === 0)
        throw systemError(
          "uv_os_get_passwd",
          "ENOENT",
          "no such file or directory",
        );
      const entry = viewAt(passwd, found);
      return {
        uid: entry.pw_uid,
        gid: entry.pw_gid,
        username: cStringAt(entry.pw_name),
        homedir: cStringAt(entry.pw_dir),
        shell: entry.pw_shell === 0 ? null : cStringAt(entry.pw_shell),
      };
    } finally {
      release(block);
    }
  }
}
/** Whether libuv's uv__ifaddr_exclude drops `entry`: interfaces that are
 * not up and running, have no address, or (`physical`) are not link-level
 * (else are link-level: BSD reports the raw devices separately). */
function excluded(entry: View<ifaddrs>, physical: boolean): boolean {
  const flags = entry.ifa_flags;
  if ((flags & interfaceUp) === 0 || (flags & interfaceRunning) === 0)
    return true;
  if (entry.ifa_addr === 0) return true;
  const family = viewAt(sockaddr, entry.ifa_addr).sa_family;
  return physical ? family !== familyLink : family === familyLink;
}
/** A copy of the sockaddr at `at` as libuv stores it: a sockaddr_in6 for
 * AF_INET6, else a sockaddr_in; zeros for a null netmask. */
function sockaddrCopy(at: number): Uint8Array {
  const copy = new Uint8Array(sockaddr_in6.size);
  if (at === 0) return copy;
  const size =
    viewAt(sockaddr, at).sa_family === familyInet6
      ? sockaddr_in6.size
      : sockaddr_in.size;
  copy.set(bytesAt(at, size));
  return copy;
}
/** libuv's uv_interface_addresses over getifaddrs (BSD): the up and
 * running interfaces' addresses, then each one's link-level address. */
function interfaceAddresses(): InterfaceAddress[] {
  const head = InterfaceList.view(new Uint8Array(InterfaceList.size));
  if (getifaddrs(head) !== 0)
    throw systemError("uv_interface_addresses", "EIO", "i/o error");
  const list = head.head,
    addresses: InterfaceAddress[] = [];
  try {
    for (let at = list; at !== 0;) {
      const entry = viewAt(ifaddrs, at);
      at = entry.ifa_next;
      if (excluded(entry, false)) continue;
      const family = viewAt(sockaddr, entry.ifa_addr).sa_family;
      addresses.push({
        name: cStringAt(entry.ifa_name),
        family:
          family === familyInet
            ? familyIPv4
            : family === familyInet6
              ? familyIPv6
              : familyUnknown,
        address: sockaddrCopy(entry.ifa_addr),
        netmask: sockaddrCopy(entry.ifa_netmask),
        internal: (entry.ifa_flags & interfaceLoopback) !== 0,
        mac: "00:00:00:00:00:00",
      });
    }
    for (let at = list; at !== 0;) {
      const entry = viewAt(ifaddrs, at);
      at = entry.ifa_next;
      if (excluded(entry, true)) continue;
      // LLADDR: sdl_data after the name; libuv copies six bytes.
      const link = entry.ifa_addr,
        nameLength = bytesAt(link, 8)[5] ?? 0;
      assignMac(
        addresses,
        cStringAt(entry.ifa_name),
        bytesAt(link + 8 + nameLength, 6),
      );
    }
  } finally {
    freeifaddrs(list);
  }
  return addresses;
}
/** `os.networkInterfaces()`. */
export function networkInterfaces(): Record<string, NetworkInterfaceInfo[]> {
  return shapeInterfaces(interfaceAddresses());
}
/** `os.loadavg()`: the 1, 5 and 15 minute load averages (zeros when the
 * system does not report them, like uv_loadavg). */
export function loadavg(): number[] {
  const averages = LoadAverages.view(new Uint8Array(LoadAverages.size));
  if (getloadavg(averages, 3) !== 3) return [0, 0, 0];
  const values = averages.values;
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}
