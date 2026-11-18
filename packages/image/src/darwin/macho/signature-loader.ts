import { writeUnsigned } from "@tint/foundation/binary/bytes";

// Darwin arm64 LC_MAIN receives argc, argv, envp and apple in x0–x3.
// The final two words of data hold slide-independent offsets from their
// own addresses, filled by the image writer. See docs/large-images.md.
const instructions = [
  0xd10183ff, // sub sp, sp, #96
  0xa90207e0, // stp x0, x1, [sp, #32]
  0xa9030fe2, // stp x2, x3, [sp, #48]
  0xa90453f3, // stp x19, x20, [sp, #64]
  0xf9002bf5, // str x21, [sp, #80]
  0xf9400060, // ldr x0, [x3]
  0x91004000, // add x0, x0, #16 (skip "executable_path=")
  0xd2800001, // mov x1, #O_RDONLY
  0xd28000b0, // mov x16, #SYS_open
  0xd4001001, // svc #0x80
  0x540003c2, // b.cs fail
  0xaa0003f3, // mov x19, x0 (descriptor)
  0x10000414, // adr x20, tableDelta
  0xf9400289, // ldr x9, [x20]
  0x8b090294, // add x20, x20, x9
  0xf8408695, // ldr x21, [x20], #8 (count)
  0xa8c12a89, // next: ldp x9, x10, [x20], #16
  0xf840868b, // ldr x11, [x20], #8
  0xa9002be9, // stp x9, x10, [sp]
  0xf9000beb, // str x11, [sp, #16]
  0xaa1303e0, // mov x0, x19
  0xd2800c21, // mov x1, #F_ADDFILESIGS_RETURN
  0x910003e2, // mov x2, sp (mutable fsignatures)
  0xd2800b90, // mov x16, #SYS_fcntl
  0xd4001001, // svc #0x80
  0x540001e2, // b.cs fail
  0xf10006b5, // subs x21, x21, #1
  0x54fffea1, // b.ne next
  0xaa1303e0, // mov x0, x19
  0xd28000d0, // mov x16, #SYS_close
  0xd4001001, // svc #0x80
  0x100001f0, // adr x16, entryDelta
  0xf9400211, // ldr x17, [x16]
  0x8b110210, // add x16, x16, x17
  0xa94207e0, // ldp x0, x1, [sp, #32]
  0xa9430fe2, // ldp x2, x3, [sp, #48]
  0xa94453f3, // ldp x19, x20, [sp, #64]
  0xf9402bf5, // ldr x21, [sp, #80]
  0x910183ff, // add sp, sp, #96
  0xd61f0200, // br x16
  0xd2800fc0, // fail: mov x0, #126
  0xd2800030, // mov x16, #SYS_exit
  0xd4001001, // svc #0x80
  0xd4200000, // brk #0
];

export const loaderTableDelta = 176;
export const loaderEntryDelta = 184;

export function signatureLoader(): Uint8Array {
  const bytes = new Uint8Array(192);
  for (let i = 0; i < instructions.length; i++) {
    const word = instructions[i];
    if (
      word === undefined ||
      !writeUnsigned(bytes, i * 4, 4, word, "little").ok
    )
      throw "signature loader instruction invariant";
  }
  return bytes;
}
