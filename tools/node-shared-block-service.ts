/** Node-only reference capability. Never imported by portable storage/runtime code. */
import type {
  SharedBlockDescriptor,
  SharedBlockAtomics,
  SharedBlockNotifications,
  SharedBlockService,
  SharedOrder,
  SharedResult,
  SharedStatus,
  SharedUnsignedWidth,
} from "@tint/js-runtime/bytes/shared";
import { sharedUpdateValue } from "@tint/js-runtime/bytes/shared";

interface NodeSharedBlock {
  readonly descriptor: SharedBlockDescriptor;
  readonly payload: SharedArrayBuffer;
  readonly length: BigUint64Array<SharedArrayBuffer>;
}
let nextEngineId = 1;

export class NodeSharedBlockService implements SharedBlockService {
  readonly engineId = nextEngineId++;
  readonly blocks = new Map<number, NodeSharedBlock>();
  private nextBlockId = 1;

  readonly notifications: SharedBlockNotifications = {
    notify: (handle, offset, width, count) => {
      if (width !== 4 && width !== 8)
        return { ok: false, error: "invalid-width" };
      if (count < 0 || (count !== Infinity && !Number.isInteger(count)))
        return { ok: false, error: "invalid-value" };
      const access = this.access(handle, offset, width, "seq-cst");
      if (!access.ok) return access;
      const payload = access.value.payload;
      const value =
        width === 4
          ? Atomics.notify(new Int32Array(payload, offset, 1), 0, count)
          : Atomics.notify(new BigInt64Array(payload, offset, 1), 0, count);
      return { ok: true, value };
    },
  };

  readonly atomics: SharedBlockAtomics = {
    compareExchangeUnsigned: (handle, offset, width, expected, replacement) => {
      if (width !== 1 && width !== 2 && width !== 4)
        return { ok: false, error: "invalid-width" };
      const access = this.access(handle, offset, width, "seq-cst");
      if (!access.ok) return access;
      const maximum = width === 1 ? 255 : width === 2 ? 65535 : 4294967295;
      if (
        !validLength(expected) ||
        expected > maximum ||
        !validLength(replacement) ||
        replacement > maximum
      )
        return { ok: false, error: "invalid-value" };
      const data =
        width === 1
          ? new Uint8Array(access.value.payload, offset, 1)
          : width === 2
            ? new Uint16Array(access.value.payload, offset, 1)
            : new Uint32Array(access.value.payload, offset, 1);
      return {
        ok: true,
        value: Atomics.compareExchange(data, 0, expected, replacement),
      };
    },
    compareExchangeWord64: (
      handle,
      offset,
      expectedLo,
      expectedHi,
      replacementLo,
      replacementHi,
      scratch,
    ) => {
      const access = this.access(handle, offset, 8, "seq-cst");
      if (!access.ok) return access.error;
      if (
        scratch.length < 2 ||
        !part(expectedLo) ||
        !part(expectedHi) ||
        !part(replacementLo) ||
        !part(replacementHi)
      )
        return "invalid-value";
      const observed = Atomics.compareExchange(
        new BigUint64Array(access.value.payload, offset, 1),
        0,
        (BigInt(expectedHi) << 32n) | BigInt(expectedLo),
        (BigInt(replacementHi) << 32n) | BigInt(replacementLo),
      );
      scratch[0] = Number(observed & 0xffffffffn);
      scratch[1] = Number(observed >> 32n);
      return "none";
    },
    updateUnsigned: (handle, offset, width, operation, operand) => {
      if (width !== 1 && width !== 2 && width !== 4)
        return { ok: false, error: "invalid-width" };
      const access = this.access(handle, offset, width, "seq-cst");
      if (!access.ok) return access;
      const maximum = width === 1 ? 255 : width === 2 ? 65535 : 4294967295;
      if (!validLength(operand) || operand > maximum)
        return { ok: false, error: "invalid-value" };
      const data =
        width === 1
          ? new Uint8Array(access.value.payload, offset, 1)
          : width === 2
            ? new Uint16Array(access.value.payload, offset, 1)
            : new Uint32Array(access.value.payload, offset, 1);
      // The same retry loop as the native leaf, so sharedUpdateValue is
      // checked against Node's own Atomics arithmetic.
      let previous = Atomics.load(data, 0);
      for (;;) {
        const observed = Atomics.compareExchange(
          data,
          0,
          previous,
          sharedUpdateValue(operation, previous, operand, width),
        );
        if (observed === previous) return { ok: true, value: previous };
        previous = observed;
      }
    },
  };

  create(
    initial: number,
    maximum: number,
    growable: boolean,
  ): SharedResult<SharedBlockDescriptor> {
    if (
      !validLength(initial) ||
      !validLength(maximum) ||
      initial > maximum ||
      (!growable && initial !== maximum)
    )
      return { ok: false, error: "invalid-length" };
    // A bounded reference adapter reserves once, independently of logical length.
    if (maximum > 16 * 1024 * 1024)
      return { ok: false, error: "allocation-limit" };
    const handle = this.nextBlockId++;
    const descriptor = {
      handle,
      blockId: handle,
      maxByteLength: maximum,
      growable,
    };
    try {
      const payload = new SharedArrayBuffer(maximum);
      const length = new BigUint64Array(new SharedArrayBuffer(8));
      Atomics.store(length, 0, BigInt(initial));
      this.blocks.set(handle, { descriptor, payload, length });
      return { ok: true, value: descriptor };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return { ok: false, error: "allocation-limit" };
    }
  }

  describe(handle: number): SharedResult<SharedBlockDescriptor> {
    const block = this.blocks.get(handle);
    return block === undefined
      ? { ok: false, error: "invalid-handle" }
      : { ok: true, value: block.descriptor };
  }

  length(handle: number, order: SharedOrder): SharedResult<number> {
    const block = this.blocks.get(handle);
    if (block === undefined) return { ok: false, error: "invalid-handle" };
    if (!validOrder(order)) return { ok: false, error: "invalid-order" };
    // Metadata always uses Atomics; seq-cst is also a valid stronger unordered read.
    const length = Atomics.load(block.length, 0);
    if (length === undefined) throw Error("NODE_SHARED_LENGTH_INVARIANT");
    return { ok: true, value: Number(length) };
  }

  grow(handle: number, target: number): SharedStatus {
    const block = this.blocks.get(handle);
    if (block === undefined) return "invalid-handle";
    if (!block.descriptor.growable) return "fixed-length";
    if (!validLength(target) || target > block.descriptor.maxByteLength)
      return "invalid-length";
    const replacement = BigInt(target);
    // Equality deliberately also performs CAS. A stale smaller grow cannot shrink.
    for (;;) {
      const current = Atomics.load(block.length, 0);
      if (replacement < current) return "invalid-length";
      if (
        Atomics.compareExchange(block.length, 0, current, replacement) ===
        current
      )
        return "none";
    }
  }

  private access(
    handle: number,
    offset: number,
    width: number,
    order: SharedOrder,
  ): SharedResult<NodeSharedBlock> {
    const block = this.blocks.get(handle);
    if (block === undefined) return { ok: false, error: "invalid-handle" };
    if (!validOrder(order)) return { ok: false, error: "invalid-order" };
    if (width !== 1 && width !== 2 && width !== 4 && width !== 8)
      return { ok: false, error: "invalid-width" };
    if (!validLength(offset)) return { ok: false, error: "invalid-range" };
    if (offset % width !== 0) return { ok: false, error: "unaligned" };
    const length = Number(Atomics.load(block.length, 0));
    if (offset > length || width > length - offset)
      return { ok: false, error: "invalid-range" };
    return { ok: true, value: block };
  }

  readUnsigned(
    handle: number,
    offset: number,
    width: SharedUnsignedWidth,
    order: SharedOrder,
  ): SharedResult<number> {
    if (width !== 1 && width !== 2 && width !== 4)
      return { ok: false, error: "invalid-width" };
    const access = this.access(handle, offset, width, order);
    if (!access.ok) return access;
    const data =
      width === 1
        ? new Uint8Array(access.value.payload, offset, 1)
        : width === 2
          ? new Uint16Array(access.value.payload, offset, 1)
          : new Uint32Array(access.value.payload, offset, 1);
    const value = order === "seq-cst" ? Atomics.load(data, 0) : data[0];
    if (value === undefined) throw Error("NODE_SHARED_READ_INVARIANT");
    return { ok: true, value };
  }

  writeUnsigned(
    handle: number,
    offset: number,
    width: SharedUnsignedWidth,
    value: number,
    order: SharedOrder,
  ): SharedStatus {
    if (width !== 1 && width !== 2 && width !== 4) return "invalid-width";
    const access = this.access(handle, offset, width, order);
    if (!access.ok) return access.error;
    if (!validLength(value) || value >= 2 ** (8 * width))
      return "invalid-value";
    const data =
      width === 1
        ? new Uint8Array(access.value.payload, offset, 1)
        : width === 2
          ? new Uint16Array(access.value.payload, offset, 1)
          : new Uint32Array(access.value.payload, offset, 1);
    if (order === "seq-cst") Atomics.store(data, 0, value);
    else data[0] = value;
    return "none";
  }

  readWord64(
    handle: number,
    offset: number,
    order: SharedOrder,
    scratch: Uint32Array,
  ): SharedStatus {
    const access = this.access(handle, offset, 8, order);
    if (!access.ok) return access.error;
    if (scratch.length < 2) return "invalid-value";
    const data = new BigUint64Array(access.value.payload, offset, 1);
    const value = order === "seq-cst" ? Atomics.load(data, 0) : data[0];
    if (value === undefined) throw Error("NODE_SHARED_WORD_INVARIANT");
    scratch[0] = Number(value & 0xffffffffn);
    scratch[1] = Number(value >> 32n);
    return "none";
  }

  writeWord64(
    handle: number,
    offset: number,
    order: SharedOrder,
    lo: number,
    hi: number,
  ): SharedStatus {
    const access = this.access(handle, offset, 8, order);
    if (!access.ok) return access.error;
    if (
      !validLength(lo) ||
      !validLength(hi) ||
      lo > 0xffffffff ||
      hi > 0xffffffff
    )
      return "invalid-value";
    const value = (BigInt(hi) << 32n) | BigInt(lo);
    const data = new BigUint64Array(access.value.payload, offset, 1);
    if (order === "seq-cst") Atomics.store(data, 0, value);
    else data[0] = value;
    return "none";
  }
}
function validLength(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
function validOrder(order: SharedOrder): boolean {
  return order === "unordered" || order === "seq-cst";
}

function part(value: number): boolean {
  return validLength(value) && value <= 0xffffffff;
}
