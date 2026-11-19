/** `node:os` shared by every target (docs/native-ffi.md, "Foreign
 * memory"): the result shapes, libuv's error text and address formatting
 * (inet_ntop4/6), Node's lib/os.js shaping (getCIDR, grouping by name).
 * Each target's reader (`os-darwin.ts`, `os-linux.ts`) reads its C
 * library's records through `tint:ffi/unsafe` views and is the `node:os`
 * module for its target; importing one on the other target fails at
 * resolution (its binding module has no image there).
 *
 * KNOWN DEFECT (API shape, removed by the typed/untyped convergence):
 * typed code has no objects with dynamic keys, so `networkInterfaces`
 * returns a Map from interface name to the same arrays Node's plain object
 * holds. `userInfo` takes no options (Node's `encoding` option re-encodes
 * each string). */

import { systemError, type NativeSystemError } from "./errors.ts";

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
/** libuv's errno values the readers distinguish (the same on Darwin and
 * Linux) and the net/if.h interface flags (also shared). */
export const interrupted = 4,
  outOfRange = 34;
export const interfaceUp = 0x1,
  interfaceLoopback = 0x8,
  interfaceRunning = 0x40;
/** Address families after a reader normalizes them. */
export const familyUnknown = 0,
  familyIPv4 = 4,
  familyIPv6 = 6;
/** libuv's Unix status translation negates positive POSIX errno values.
 * Use the target's errno numbers and libuv's locale-independent descriptions
 * (Node 24.12.0 getSystemErrorMap on Darwin and Linux). */
export function passwdError(status: number, linux: boolean): NativeSystemError {
  const call = "uv_os_get_passwd";
  const errno = status === 0 ? 2 : status;
  if (errno === (linux ? 0 : 79))
    return systemError(
      call,
      -errno,
      "EFTYPE",
      "inappropriate file type or format",
    );
  if (errno === (linux ? 64 : 0))
    return systemError(call, -errno, "ENONET", "machine is not on the network");
  if (errno === (linux ? 121 : 0))
    return systemError(call, -errno, "EREMOTEIO", "remote I/O error");
  if (errno === (linux ? 49 : 0))
    return systemError(call, -errno, "EUNATCH", "protocol driver not attached");
  if (errno === 1)
    return systemError(call, -errno, "EPERM", "operation not permitted");
  if (errno === 2)
    return systemError(call, -errno, "ENOENT", "no such file or directory");
  if (errno === 3) return systemError(call, -errno, "ESRCH", "no such process");
  if (errno === 4)
    return systemError(call, -errno, "EINTR", "interrupted system call");
  if (errno === 5) return systemError(call, -errno, "EIO", "i/o error");
  if (errno === 6)
    return systemError(call, -errno, "ENXIO", "no such device or address");
  if (errno === 7)
    return systemError(call, -errno, "E2BIG", "argument list too long");
  if (errno === 8)
    return systemError(call, -errno, "ENOEXEC", "exec format error");
  if (errno === 9)
    return systemError(call, -errno, "EBADF", "bad file descriptor");
  if (errno === (linux ? 11 : 35))
    return systemError(
      call,
      -errno,
      "EAGAIN",
      "resource temporarily unavailable",
    );
  if (errno === 12)
    return systemError(call, -errno, "ENOMEM", "not enough memory");
  if (errno === 13)
    return systemError(call, -errno, "EACCES", "permission denied");
  if (errno === 14)
    return systemError(
      call,
      -errno,
      "EFAULT",
      "bad address in system call argument",
    );
  if (errno === 16)
    return systemError(call, -errno, "EBUSY", "resource busy or locked");
  if (errno === 17)
    return systemError(call, -errno, "EEXIST", "file already exists");
  if (errno === 18)
    return systemError(
      call,
      -errno,
      "EXDEV",
      "cross-device link not permitted",
    );
  if (errno === 19)
    return systemError(call, -errno, "ENODEV", "no such device");
  if (errno === 20)
    return systemError(call, -errno, "ENOTDIR", "not a directory");
  if (errno === 21)
    return systemError(
      call,
      -errno,
      "EISDIR",
      "illegal operation on a directory",
    );
  if (errno === 22)
    return systemError(call, -errno, "EINVAL", "invalid argument");
  if (errno === 23)
    return systemError(call, -errno, "ENFILE", "file table overflow");
  if (errno === 24)
    return systemError(call, -errno, "EMFILE", "too many open files");
  if (errno === 25)
    return systemError(
      call,
      -errno,
      "ENOTTY",
      "inappropriate ioctl for device",
    );
  if (errno === 26)
    return systemError(call, -errno, "ETXTBSY", "text file is busy");
  if (errno === 27) return systemError(call, -errno, "EFBIG", "file too large");
  if (errno === 28)
    return systemError(call, -errno, "ENOSPC", "no space left on device");
  if (errno === 29) return systemError(call, -errno, "ESPIPE", "invalid seek");
  if (errno === 30)
    return systemError(call, -errno, "EROFS", "read-only file system");
  if (errno === 31)
    return systemError(call, -errno, "EMLINK", "too many links");
  if (errno === 32) return systemError(call, -errno, "EPIPE", "broken pipe");
  if (errno === 34)
    return systemError(call, -errno, "ERANGE", "result too large");
  if (errno === (linux ? 36 : 63))
    return systemError(call, -errno, "ENAMETOOLONG", "name too long");
  if (errno === (linux ? 114 : 37))
    return systemError(
      call,
      -errno,
      "EALREADY",
      "connection already in progress",
    );
  if (errno === (linux ? 38 : 78))
    return systemError(call, -errno, "ENOSYS", "function not implemented");
  if (errno === (linux ? 88 : 38))
    return systemError(
      call,
      -errno,
      "ENOTSOCK",
      "socket operation on non-socket",
    );
  if (errno === (linux ? 89 : 39))
    return systemError(
      call,
      -errno,
      "EDESTADDRREQ",
      "destination address required",
    );
  if (errno === (linux ? 39 : 66))
    return systemError(call, -errno, "ENOTEMPTY", "directory not empty");
  if (errno === (linux ? 40 : 62))
    return systemError(
      call,
      -errno,
      "ELOOP",
      "too many symbolic links encountered",
    );
  if (errno === (linux ? 90 : 40))
    return systemError(call, -errno, "EMSGSIZE", "message too long");
  if (errno === (linux ? 91 : 41))
    return systemError(
      call,
      -errno,
      "EPROTOTYPE",
      "protocol wrong type for socket",
    );
  if (errno === (linux ? 92 : 42))
    return systemError(call, -errno, "ENOPROTOOPT", "protocol not available");
  if (errno === (linux ? 93 : 43))
    return systemError(
      call,
      -errno,
      "EPROTONOSUPPORT",
      "protocol not supported",
    );
  if (errno === (linux ? 94 : 44))
    return systemError(
      call,
      -errno,
      "ESOCKTNOSUPPORT",
      "socket type not supported",
    );
  if (errno === (linux ? 95 : 45))
    return systemError(
      call,
      -errno,
      "ENOTSUP",
      "operation not supported on socket",
    );
  if (errno === (linux ? 97 : 47))
    return systemError(
      call,
      -errno,
      "EAFNOSUPPORT",
      "address family not supported",
    );
  if (errno === (linux ? 98 : 48))
    return systemError(call, -errno, "EADDRINUSE", "address already in use");
  if (errno === (linux ? 99 : 49))
    return systemError(call, -errno, "EADDRNOTAVAIL", "address not available");
  if (errno === (linux ? 100 : 50))
    return systemError(call, -errno, "ENETDOWN", "network is down");
  if (errno === (linux ? 101 : 51))
    return systemError(call, -errno, "ENETUNREACH", "network is unreachable");
  if (errno === (linux ? 103 : 53))
    return systemError(
      call,
      -errno,
      "ECONNABORTED",
      "software caused connection abort",
    );
  if (errno === (linux ? 104 : 54))
    return systemError(call, -errno, "ECONNRESET", "connection reset by peer");
  if (errno === (linux ? 105 : 55))
    return systemError(call, -errno, "ENOBUFS", "no buffer space available");
  if (errno === (linux ? 106 : 56))
    return systemError(call, -errno, "EISCONN", "socket is already connected");
  if (errno === (linux ? 107 : 57))
    return systemError(call, -errno, "ENOTCONN", "socket is not connected");
  if (errno === (linux ? 108 : 58))
    return systemError(
      call,
      -errno,
      "ESHUTDOWN",
      "cannot send after transport endpoint shutdown",
    );
  if (errno === (linux ? 110 : 60))
    return systemError(call, -errno, "ETIMEDOUT", "connection timed out");
  if (errno === (linux ? 111 : 61))
    return systemError(call, -errno, "ECONNREFUSED", "connection refused");
  if (errno === (linux ? 61 : 96))
    return systemError(call, -errno, "ENODATA", "no data available");
  if (errno === (linux ? 112 : 64))
    return systemError(call, -errno, "EHOSTDOWN", "host is down");
  if (errno === (linux ? 113 : 65))
    return systemError(call, -errno, "EHOSTUNREACH", "host is unreachable");
  if (errno === (linux ? 71 : 100))
    return systemError(call, -errno, "EPROTO", "protocol error");
  if (errno === (linux ? 75 : 84))
    return systemError(
      call,
      -errno,
      "EOVERFLOW",
      "value too large for defined data type",
    );
  if (errno === (linux ? 84 : 92))
    return systemError(call, -errno, "EILSEQ", "illegal byte sequence");
  if (errno === (linux ? 125 : 89))
    return systemError(call, -errno, "ECANCELED", "operation canceled");
  const unknown = "Unknown system error " + String(-errno);
  return systemError(call, -errno, unknown, unknown);
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
export function hexByte(value: number): string {
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
/** One libuv uv_interface_address_t before Node's shaping: the address and
 * netmask as libuv's 28-byte union images (a sockaddr_in6 for AF_INET6,
 * else a sockaddr_in, zeros for a null netmask; the address is at offset
 * 4 or 8 and the IPv6 scope id at 24 on both targets) and the address
 * family normalized by the reader. */
export interface InterfaceAddress {
  readonly name: string;
  readonly family: number;
  readonly address: Uint8Array;
  readonly netmask: Uint8Array;
  readonly internal: boolean;
  mac: string;
}
/** Copy six link-level address bytes into every address of interface
 * `name` and its `name:alias` aliases (libuv's phys_addr fill). */
export function assignMac(
  addresses: InterfaceAddress[],
  name: string,
  physical: Uint8Array,
): void {
  let mac = "";
  for (let i = 0; i < 6; i++)
    mac += (i === 0 ? "" : ":") + hexByte(physical[i] ?? 0);
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
/** `os.networkInterfaces()`: Node's GetInterfaceAddresses formatting
 * (uv_ip4_name/uv_ip6_name, %02x MAC) and lib/os.js grouping by name. */
export function shapeInterfaces(
  addresses: readonly InterfaceAddress[],
): Map<string, NetworkInterfaceInfo[]> {
  const result = new Map<string, NetworkInterfaceInfo[]>();
  for (let i = 0; i < addresses.length; i++) {
    const item = addresses[i];
    if (item === undefined) throw "interface address invariant";
    const family = item.family;
    let address = "<unknown sa family>",
      netmask = "",
      name = "unknown";
    if (family === familyIPv4) {
      address = ip4Name(item.address, 4);
      netmask = ip4Name(item.netmask, 4);
      name = "IPv4";
    } else if (family === familyIPv6) {
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
    if (family === familyIPv6)
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
