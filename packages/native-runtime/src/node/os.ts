/** `node:os` shared by every target (docs/native-ffi.md, "Foreign
 * memory"): the result shapes, libuv's error text and address formatting
 * (inet_ntop4/6), Node's lib/os.js shaping (getCIDR, grouping by name).
 * Each target's reader (`os-darwin.ts`, `os-linux.ts`) reads its C
 * library's records through `tint:ffi/unsafe` views and is the `node:os`
 * module for its target; importing one on the other target fails at
 * resolution (its binding module has no image there).
 *
 * KNOWN DEFECT (typed-pipeline gaps, docs/native-ffi.md#known-defects):
 * Node throws a SystemError (`ERR_SYSTEM_ERROR`) when libuv fails; the
 * typed pipeline constructs only TypeError and RangeError, so these are
 * TypeErrors with Node's messages.
 * KNOWN DEFECT (API shape, removed by the typed/untyped convergence):
 * typed code has no objects with dynamic keys, so `networkInterfaces`
 * returns a Map from interface name to the same arrays Node's plain object
 * holds. `userInfo` takes no options (Node's `encoding` option re-encodes
 * each string). */

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
export function systemError(
  call: string,
  code: string,
  text: string,
): TypeError {
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
