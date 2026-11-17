declare module "tint:c/darwin-os" {
  // Darwin operating-system records and calls behind `node:os`
  // (packages/native-runtime/src/node/os.ts, docs/native-ffi.md, "Foreign
  // memory"). The layouts are Darwin's (BSD sockaddrs carry a length byte;
  // struct passwd has pw_change/pw_class/pw_expire), so Linux will bind
  // its own module.
  import type {
    i32,
    i64,
    u8,
    u16,
    u32,
    f64,
    char,
    usize,
    Ptr,
    Address,
    FixedArray,
    Layout,
  } from "tint:ffi";
  /** pwd.h */
  export interface passwd {
    pw_name: Address<char>;
    pw_passwd: Address<char>;
    pw_uid: u32;
    pw_gid: u32;
    pw_change: i64;
    pw_class: Address<char>;
    pw_gecos: Address<char>;
    pw_dir: Address<char>;
    pw_shell: Address<char>;
    pw_expire: i64;
  }
  export const passwd: Layout<passwd>;
  /** getpwuid_r's out-parameter (`struct passwd **`). */
  export interface PasswdResult {
    entry: Address<passwd>;
  }
  export const PasswdResult: Layout<PasswdResult>;
  /** unistd.h */
  export function geteuid(): u32;
  /** Returns 0 or an errno value; `*result` is `pwd` when found, else
   * NULL. The strings `pwd` points to live in `buffer`. */
  export function getpwuid_r(
    uid: u32,
    pwd: Address<passwd>,
    buffer: Address<char>,
    size: usize,
    result: Address<PasswdResult>,
  ): i32;
  /** sys/socket.h, netinet/in.h, net/if_dl.h */
  export interface sockaddr {
    sa_len: u8;
    sa_family: u8;
    sa_data: FixedArray<char, 14>;
  }
  export const sockaddr: Layout<sockaddr>;
  export interface sockaddr_in {
    sin_len: u8;
    sin_family: u8;
    sin_port: u16;
    /** struct in_addr: the address in network byte order. */
    sin_addr: u32;
    sin_zero: FixedArray<u8, 8>;
  }
  export const sockaddr_in: Layout<sockaddr_in>;
  export interface sockaddr_in6 {
    sin6_len: u8;
    sin6_family: u8;
    sin6_port: u16;
    sin6_flowinfo: u32;
    sin6_addr: FixedArray<u8, 16>;
    sin6_scope_id: u32;
  }
  export const sockaddr_in6: Layout<sockaddr_in6>;
  export interface sockaddr_dl {
    sdl_len: u8;
    sdl_family: u8;
    sdl_index: u16;
    sdl_type: u8;
    sdl_nlen: u8;
    sdl_alen: u8;
    sdl_slen: u8;
    sdl_data: FixedArray<char, 12>;
  }
  export const sockaddr_dl: Layout<sockaddr_dl>;
  /** ifaddrs.h: a linked list C allocates and `freeifaddrs` frees. */
  export interface ifaddrs {
    ifa_next: Address<ifaddrs>;
    ifa_name: Address<char>;
    ifa_flags: u32;
    ifa_addr: Address<sockaddr>;
    ifa_netmask: Address<sockaddr>;
    ifa_dstaddr: Address<sockaddr>;
    ifa_data: Address<void>;
  }
  export const ifaddrs: Layout<ifaddrs>;
  /** getifaddrs' out-parameter (`struct ifaddrs **`). */
  export interface InterfaceList {
    head: Address<ifaddrs>;
  }
  export const InterfaceList: Layout<InterfaceList>;
  /** Stores the list head in `*list`; 0, or -1 with errno set. */
  export function getifaddrs(list: Ptr<InterfaceList>): i32;
  export function freeifaddrs(list: Address<ifaddrs>): void;
  /** stdlib.h: up to `count` load averages; the number stored, or -1. */
  export interface LoadAverages {
    values: FixedArray<f64, 3>;
  }
  export const LoadAverages: Layout<LoadAverages>;
  export function getloadavg(averages: Ptr<LoadAverages>, count: i32): i32;
}
