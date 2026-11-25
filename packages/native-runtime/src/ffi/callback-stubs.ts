import { TARGET_AAPCS64 } from "tint:c/dl";
/** These host capabilities are scoped to the registration-stub owner. */
export function mapCallbackMemory(size: number): number {
  throw "HOST_UNAVAILABLE";
}
export function writeCallbackMemory(
  address: number,
  size: number,
  offset: number,
  code: Uint8Array,
): number {
  throw "HOST_UNAVAILABLE";
}
export function unmapCallbackMemory(address: number, size: number): number {
  throw "HOST_UNAVAILABLE";
}

/** The shared runtime-signature callback thunk, emitted by the backend. */
export function runtimeCallbackAddress(): number {
  throw "HOST_UNAVAILABLE";
}
export function runtimeI32CallbackAddress(): number {
  throw "HOST_UNAVAILABLE";
}

// Each owned mapping contains just a tail jump and three raw words. The thunk
// owns the native frame and guards the thread before touching any managed state.
const bytesPerStub = 48;

function writeWord(code: Uint8Array, offset: number, value: bigint): void {
  for (let index = 0; index < 8; index++)
    code[offset + index] = Number((value >> BigInt(index * 8)) & 255n);
}

export function allocateCallbackStub(
  id: number,
  owner: number,
  unaryI32: boolean,
): number {
  const code = new Uint8Array(bytesPerStub);
  const target = BigInt(
    unaryI32 ? runtimeI32CallbackAddress() : runtimeCallbackAddress(),
  );
  const thread = BigInt(owner);
  if (TARGET_AAPCS64 === 2) {
    // movabs r10, id; movabs rax, thread; movabs r11, entry; jmp r11
    code[0] = 0x49;
    code[1] = 0xba;
    writeWord(code, 2, BigInt(id));
    code[10] = 0x48;
    code[11] = 0xb8;
    writeWord(code, 12, thread);
    code[20] = 0x49;
    code[21] = 0xbb;
    writeWord(code, 22, target);
    code[30] = 0x41;
    code[31] = 0xff;
    code[32] = 0xe3;
  } else {
    // ldr x16, +24; ldr x15, +28; ldr x17, +32; br x17
    writeWord(code, 0, 0x580000ef580000d0n);
    writeWord(code, 8, 0xd61f022058000111n);
    writeWord(code, 24, BigInt(id));
    writeWord(code, 32, thread);
    writeWord(code, 40, target);
  }
  const address = mapCallbackMemory(bytesPerStub);
  if (address <= 0) return address;
  if (writeCallbackMemory(address, bytesPerStub, 0, code) === 0) return address;
  unmapCallbackMemory(address, bytesPerStub);
  return -1;
}

export function releaseCallbackStub(address: number): void {
  if (unmapCallbackMemory(address, bytesPerStub) !== 0)
    throw "FFI_CALLBACK_UNMAP_FAILED";
}
