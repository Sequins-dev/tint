import type { BindingSpec } from "../spec.ts";

/** glibc's records and calls behind `node:os` on Linux (node/os-linux.ts). */
export default {
  library: "linux-os",
  summary: [
    "glibc's operating-system records and calls behind `node:os` on Linux",
    '(docs/native-ffi.md, "Foreign memory"): struct passwd without Darwin\'s',
    "pw_change/pw_class/pw_expire, sockaddrs with a 16-bit family and no",
    "length byte, and AF_PACKET's sockaddr_ll for link-level addresses.",
    "Darwin binds `tint:c/darwin-os`.",
  ],
  targets: ["linux-arm64"],
  headers: [
    "pwd.h",
    "unistd.h",
    "stdlib.h",
    "ifaddrs.h",
    "sys/socket.h",
    "netinet/in.h",
    "linux/if_packet.h",
  ],
  prelude: `
struct PasswdResult { struct passwd *entry; };
struct InterfaceList { struct ifaddrs *head; };
struct LoadAverages { double values[3]; };
`,
  records: [
    "passwd",
    {
      name: "PasswdResult",
      doc: "getpwuid_r's out-parameter (`struct passwd **`).",
    },
    "sockaddr",
    "sockaddr_in",
    "sockaddr_in6",
    "sockaddr_ll",
    {
      name: "ifaddrs",
      doc: "A linked list C allocates and `freeifaddrs` frees (`ifa_ifu` is the broadcast/destination union).",
    },
    {
      name: "InterfaceList",
      doc: "getifaddrs' out-parameter (`struct ifaddrs **`).",
    },
    "LoadAverages",
  ],
  functions: [
    "geteuid",
    {
      name: "getpwuid_r",
      parameters: {
        0: { name: "uid" },
        1: { name: "pwd", as: "Address" },
        2: { name: "buffer", as: "Address" },
        3: { name: "size" },
        4: { name: "result", as: "Address", pointee: "PasswdResult" },
      },
      doc: "Returns 0 or an errno value; `*result` is `pwd` when found, else NULL. The strings `pwd` points to live in `buffer`.",
    },
    {
      name: "getifaddrs",
      parameters: { 0: { name: "list", pointee: "InterfaceList" } },
      doc: "Stores the list head in `*list`; 0, or -1 with errno set.",
    },
    { name: "freeifaddrs", parameters: { 0: { name: "list", as: "Address" } } },
    {
      name: "getloadavg",
      parameters: {
        0: { name: "averages", pointee: "LoadAverages" },
        1: { name: "count" },
      },
      doc: "Up to `count` load averages; the number stored, or -1.",
    },
  ],
} satisfies BindingSpec;
