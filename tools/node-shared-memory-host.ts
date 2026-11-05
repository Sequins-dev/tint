/** Genuine Node SAB/Atomics reference implementation of the trusted raw host.
 * Virtual numeric addresses stay in this Node-only adapter, never portable code. */
import type {
  NativeSharedMemoryHost,
  NativeSharedAtomicMemoryHost,
} from "@tint/native-runtime/shared-blocks";
interface Mapping {
  readonly base: number;
  readonly bytes: SharedArrayBuffer;
}
interface Kernel {
  readonly mappings: Map<number, Mapping>;
  failNextMap: boolean;
}
let nextAddress = 0x10000;
export class NodeSharedMemoryHost
  implements NativeSharedMemoryHost, NativeSharedAtomicMemoryHost
{
  readonly kernel: Kernel;
  readonly compareScratch: Uint32Array[] = [];
  beforeCompare: ((address: number, offset: number) => void) | undefined;
  constructor(kernel?: Kernel) {
    this.kernel = kernel ?? { mappings: new Map(), failNextMap: false };
  }
  mapMemory(length: number): number {
    if (this.kernel.failNextMap) {
      this.kernel.failNextMap = false;
      return -1;
    }
    if (
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      length > 32 * 1024 * 1024
    )
      return -1;
    const base = nextAddress;
    nextAddress += Math.ceil(length / 65536) * 65536;
    this.kernel.mappings.set(base, {
      base,
      bytes: new SharedArrayBuffer(length),
    });
    return base;
  }
  unmapMemory(address: number, length: number): number {
    const mapping = this.kernel.mappings.get(address);
    if (mapping === undefined || mapping.bytes.byteLength !== length) return -1;
    this.kernel.mappings.delete(address);
    return 0;
  }
  private view(
    address: number,
    length: number,
    offset: number,
    width: number,
    order: number,
  ): { mapping: Mapping; offset: number } | undefined {
    if (
      !Number.isSafeInteger(address) ||
      address <= 0 ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > length ||
      width > length - offset ||
      (address + offset) % width !== 0 ||
      (order !== 0 && order !== 1)
    )
      return undefined;
    const mapping = [...this.kernel.mappings.values()].find(
      (item) =>
        address >= item.base &&
        address + length <= item.base + item.bytes.byteLength,
    );
    return mapping === undefined
      ? undefined
      : { mapping, offset: address + offset - mapping.base };
  }
  readSharedUnsigned(
    address: number,
    length: number,
    offset: number,
    width: number,
    order: number,
  ): number {
    if (width !== 1 && width !== 2 && width !== 4) return -1;
    const view = this.view(address, length, offset, width, order);
    if (view === undefined) return -1;
    const array =
      width === 1
        ? new Uint8Array(view.mapping.bytes, view.offset, 1)
        : width === 2
          ? new Uint16Array(view.mapping.bytes, view.offset, 1)
          : new Uint32Array(view.mapping.bytes, view.offset, 1);
    return Atomics.load(array, 0);
  }
  writeSharedUnsigned(
    address: number,
    length: number,
    offset: number,
    width: number,
    value: number,
    order: number,
  ): number {
    if (
      (width !== 1 && width !== 2 && width !== 4) ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value >= 2 ** (width * 8)
    )
      return -1;
    const view = this.view(address, length, offset, width, order);
    if (view === undefined) return -1;
    const array =
      width === 1
        ? new Uint8Array(view.mapping.bytes, view.offset, 1)
        : width === 2
          ? new Uint16Array(view.mapping.bytes, view.offset, 1)
          : new Uint32Array(view.mapping.bytes, view.offset, 1);
    Atomics.store(array, 0, value);
    return 0;
  }
  compareExchangeSharedUnsigned(
    address: number,
    length: number,
    offset: number,
    width: number,
    expected: number,
    replacement: number,
  ): number {
    if (
      (width !== 1 && width !== 2 && width !== 4) ||
      !Number.isSafeInteger(expected) ||
      expected < 0 ||
      expected >= 2 ** (width * 8) ||
      !Number.isSafeInteger(replacement) ||
      replacement < 0 ||
      replacement >= 2 ** (width * 8)
    )
      return -1;
    const view = this.view(address, length, offset, width, 1);
    if (view === undefined) return -1;
    const array =
      width === 1
        ? new Uint8Array(view.mapping.bytes, view.offset, 1)
        : width === 2
          ? new Uint16Array(view.mapping.bytes, view.offset, 1)
          : new Uint32Array(view.mapping.bytes, view.offset, 1);
    return Atomics.compareExchange(array, 0, expected, replacement);
  }
  readSharedWord64(
    address: number,
    length: number,
    offset: number,
    order: number,
    scratch: Uint32Array,
  ): number {
    const view = this.view(address, length, offset, 8, order);
    if (view === undefined || scratch.length < 2) return -1;
    const value = Atomics.load(
      new BigUint64Array(view.mapping.bytes, view.offset, 1),
      0,
    );
    scratch[0] = Number(value & 0xffffffffn);
    scratch[1] = Number(value >> 32n);
    return 0;
  }
  writeSharedWord64(
    address: number,
    length: number,
    offset: number,
    order: number,
    lo: number,
    hi: number,
  ): number {
    const view = this.view(address, length, offset, 8, order);
    if (view === undefined || !part(lo) || !part(hi)) return -1;
    Atomics.store(
      new BigUint64Array(view.mapping.bytes, view.offset, 1),
      0,
      (BigInt(hi) << 32n) | BigInt(lo),
    );
    return 0;
  }
  compareExchangeSharedWord64(
    address: number,
    length: number,
    offset: number,
    lo: number,
    hi: number,
    replacementLo: number,
    replacementHi: number,
    scratch: Uint32Array,
  ): number {
    const view = this.view(address, length, offset, 8, 1);
    if (
      view === undefined ||
      scratch.length < 2 ||
      !part(lo) ||
      !part(hi) ||
      !part(replacementLo) ||
      !part(replacementHi)
    )
      return -1;
    this.compareScratch.push(scratch);
    this.beforeCompare?.(address, offset);
    const observed = Atomics.compareExchange(
      new BigUint64Array(view.mapping.bytes, view.offset, 1),
      0,
      (BigInt(hi) << 32n) | BigInt(lo),
      (BigInt(replacementHi) << 32n) | BigInt(replacementLo),
    );
    scratch[0] = Number(observed & 0xffffffffn);
    scratch[1] = Number(observed >> 32n);
    return 0;
  }
}
function part(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
