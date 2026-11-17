/** `node:os` facts read from memory C owns (docs/native-ffi.md, "Foreign
 * memory"): `userInfo()`, `networkInterfaces()` and `loadavg()`, following
 * Node's C++ bindings and libuv on Darwin (uv_os_get_passwd,
 * uv_interface_addresses, uv_loadavg) and Node's lib/os.js shaping.
 *
 * getpwuid_r fills a struct passwd whose string members point into the
 * caller's buffer, and getifaddrs returns a linked list of records and
 * sockaddrs that C allocates; both are read through `tint:ffi/unsafe`
 * views at the addresses C hands back. The passwd record and its buffer
 * live in external storage, because reading the strings allocates (a
 * collection may then run) while C's pointers into them are still in use.
 *
 * KNOWN DEFECT (typed-pipeline gaps, docs/native-ffi.md#known-defects):
 * Node throws a SystemError (`ERR_SYSTEM_ERROR`) when libuv fails; the
 * typed pipeline constructs only TypeError and RangeError, so these are
 * TypeErrors with Node's messages. Typed code has no objects with dynamic
 * keys, so `networkInterfaces` returns a Map from interface name to the
 * same arrays Node's object holds. `userInfo` takes no options (Node's
 * `encoding` option re-encodes each string). */
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

/** `os.userInfo()`'s result, in Node's property order. */
export interface UserInfo {
  uid: number;
  gid: number;
  username: string;
  homedir: string;
  shell: string | null;
}
/** One address of `os.networkInterfaces()`, in Node's property order;
 * `scopeid` only for IPv6. */
export interface NetworkInterfaceInfo {
  address: string;
  netmask: string;
  family: string;
  mac: string;
  internal: boolean;
  cidr: string | null;
  scopeid?: number;
}
/** Darwin errno values and address families (sys/errno.h, sys/socket.h). */
const interrupted = 4,
  outOfRange = 34,
  noEntry = 2;
const familyInet = 2,
  familyInet6 = 30,
  familyLink = 18;
/** net/if.h interface flags. */
const interfaceUp = 0x1,
  interfaceLoopback = 0x8,
  interfaceRunning = 0x40;

function systemError(call: string, code: string, text: string): TypeError {
  return new TypeError(
    "A system error occurred: " +
      call +
      " returned " +
      code +
      " (" +
      text +
      ")",
  );
}
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
const hexDigits = "0123456789abcdef";
function hex(value: number): string {
  let text = "";
  do {
    text = hexDigits.charAt(value % 16) + text;
    value = Math.floor(value / 16);
  } while (value > 0);
  return text;
}
function hexByte(value: number): string {
  return hexDigits.charAt(value >> 4) + hexDigits.charAt(value & 15);
}
/** inet_ntop4: dotted decimal of the 4 bytes at `bytes[start]`. */
function ip4Name(bytes: Uint8Array, start: number): string {
  return (
    String(bytes[start] ?? 0) +
    "." +
    String(bytes[start + 1] ?? 0) +
    "." +
    String(bytes[start + 2] ?? 0) +
    "." +
    String(bytes[start + 3] ?? 0)
  );
}
/** libuv's inet_ntop6 (from BIND): the longest run of two or more zero
 * words (the first of equal runs) becomes `::`; IPv4-compatible and mapped
 * addresses end in dotted decimal. */
function ip6Name(bytes: Uint8Array): string {
  const words: number[] = [];
  for (let i = 0; i < 8; i++)
    words.push((bytes[i * 2] ?? 0) * 256 + (bytes[i * 2 + 1] ?? 0));
  let bestBase = -1,
    bestLength = 0,
    currentBase = -1,
    currentLength = 0;
  for (let i = 0; i < 8; i++) {
    if (words[i] === 0) {
      if (currentBase === -1) {
        currentBase = i;
        currentLength = 1;
      } else currentLength++;
    } else if (currentBase !== -1) {
      if (bestBase === -1 || currentLength > bestLength) {
        bestBase = currentBase;
        bestLength = currentLength;
      }
      currentBase = -1;
    }
  }
  if (currentBase !== -1 && (bestBase === -1 || currentLength > bestLength)) {
    bestBase = currentBase;
    bestLength = currentLength;
  }
  if (bestBase !== -1 && bestLength < 2) bestBase = -1;
  let text = "";
  for (let i = 0; i < 8; i++) {
    if (bestBase !== -1 && i >= bestBase && i < bestBase + bestLength) {
      if (i === bestBase) text += ":";
      continue;
    }
    if (i !== 0) text += ":";
    if (
      i === 6 &&
      bestBase === 0 &&
      (bestLength === 6 ||
        (bestLength === 7 && words[7] !== 1) ||
        (bestLength === 5 && words[5] === 65535))
    )
      return text + ip4Name(bytes, 12);
    text += hex(words[i] ?? 0);
  }
  if (bestBase !== -1 && bestBase + bestLength === 8) text += ":";
  return text;
}
/** Node's countBinaryOnes (lib/os.js), with its int32 arithmetic. */
function countBinaryOnes(value: number): number {
  let n = value - ((value >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0xf0f0f0f) * 0x1010101) >>> 24;
}
/** Whether `value`'s binary digits (Number#toString(2)) contain "01". */
function hasZeroThenOne(value: number): boolean {
  if (!Number.isInteger(value) || value <= 0) return false;
  let previous = 1;
  let bit = 1;
  while (bit * 2 <= value) bit *= 2;
  for (; bit >= 1; bit /= 2) {
    const current = Math.floor(value / bit) % 2;
    if (previous === 0 && current === 1) return true;
    previous = current;
  }
  return false;
}
/** parseInt(part, radix) for the digits a formatted netmask holds. */
function parseDigits(part: string, radix: number): number {
  let value = 0,
    digits = 0;
  for (let i = 0; i < part.length; i++) {
    const digit = hexDigits.indexOf(part.charAt(i));
    if (digit < 0 || digit >= radix) break;
    value = value * radix + digit;
    digits++;
  }
  return digits === 0 ? NaN : value;
}
/** Node's getCIDR (lib/os.js): the prefix length a contiguous netmask
 * names, else null. */
function cidrOf(
  address: string,
  netmask: string,
  family: string,
): string | null {
  let ones = 0,
    split = ".",
    range = 10,
    groupLength = 8,
    hasZeros = false,
    lastPosition = 0;
  if (family === "IPv6") {
    split = ":";
    range = 16;
    groupLength = 16;
  }
  for (let i = 0; i < netmask.length; i++) {
    if (netmask.charAt(i) !== split) {
      if (i + 1 < netmask.length) continue;
      i++;
    }
    const part = netmask.slice(lastPosition, i);
    lastPosition = i + 1;
    if (part === "") continue;
    if (hasZeros) {
      if (part !== "0") return null;
    } else {
      const binary = parseDigits(part, range),
        binaryOnes = countBinaryOnes(binary);
      ones += binaryOnes;
      if (binaryOnes !== groupLength) {
        if (hasZeroThenOne(binary)) return null;
        hasZeros = true;
      }
    }
  }
  return address + "/" + String(ones);
}
/** One libuv uv_interface_address_t before Node's shaping. */
interface InterfaceAddress {
  readonly name: string;
  readonly address: Uint8Array;
  readonly netmask: Uint8Array;
  readonly internal: boolean;
  mac: string;
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
      addresses.push({
        name: cStringAt(entry.ifa_name),
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
      const name = cStringAt(entry.ifa_name);
      // LLADDR: sdl_data after the name; libuv copies six bytes.
      const link = entry.ifa_addr,
        nameLength = bytesAt(link, 8)[5] ?? 0,
        physical = bytesAt(link + 8 + nameLength, 6);
      let mac = "";
      for (let i = 0; i < 6; i++)
        mac += (i === 0 ? "" : ":") + hexByte(physical[i] ?? 0);
      // Alias interfaces (name:alias) share the physical address.
      for (let i = 0; i < addresses.length; i++) {
        const item = addresses[i];
        if (item === undefined) throw "interface address invariant";
        if (
          item.name.startsWith(name) &&
          (item.name.length === name.length ||
            item.name.charAt(name.length) === ":")
        )
          item.mac = mac;
      }
    }
  } finally {
    freeifaddrs(list);
  }
  return addresses;
}
/** `os.networkInterfaces()`: Node's GetInterfaceAddresses formatting
 * (uv_ip4_name/uv_ip6_name, %02x MAC) and lib/os.js grouping by name. */
export function networkInterfaces(): Map<string, NetworkInterfaceInfo[]> {
  const result = new Map<string, NetworkInterfaceInfo[]>();
  const addresses = interfaceAddresses();
  for (let i = 0; i < addresses.length; i++) {
    const item = addresses[i];
    if (item === undefined) throw "interface address invariant";
    const family = item.address[1] ?? 0;
    let address = "<unknown sa family>",
      netmask = "",
      name = "unknown";
    if (family === familyInet) {
      address = ip4Name(item.address, 4);
      netmask = ip4Name(item.netmask, 4);
      name = "IPv4";
    } else if (family === familyInet6) {
      address = ip6Name(item.address.subarray(8, 24));
      netmask = ip6Name(item.netmask.subarray(8, 24));
      name = "IPv6";
    }
    const entry: NetworkInterfaceInfo = {
      address,
      netmask,
      family: name,
      mac: item.mac,
      internal: item.internal,
      cidr: cidrOf(address, netmask, name),
    };
    if (family === familyInet6)
      entry.scopeid =
        (item.address[24] ?? 0) +
        (item.address[25] ?? 0) * 256 +
        (item.address[26] ?? 0) * 65536 +
        (item.address[27] ?? 0) * 16777216;
    const existing = result.get(item.name);
    if (existing !== undefined) existing.push(entry);
    else result.set(item.name, [entry]);
  }
  return result;
}
/** `os.loadavg()`: the 1, 5 and 15 minute load averages (zeros when the
 * system does not report them, like uv_loadavg). */
export function loadavg(): number[] {
  const averages = LoadAverages.view(new Uint8Array(LoadAverages.size));
  if (getloadavg(averages, 3) !== 3) return [0, 0, 0];
  const values = averages.values;
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}
