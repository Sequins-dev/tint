/** Explicit authority over one permanent executable arena. Implementations own
 * platform permissions/cache flushing and return exact positive safe addresses,
 * nonpositive mapping failures, and zero-only registration/write success. */
/** A function in published code, by byte offset (diagnostics only). */
export interface EngineCodeFunction {
  readonly name: string;
  readonly offset: number;
  readonly byteLength: number;
}
/** The local (non-import) functions of an emitted native module. */
export function engineCodeFunctions(
  functions: readonly {
    readonly import?: true;
    readonly name: string;
    readonly offset: number;
    readonly byteLength: number;
  }[],
): EngineCodeFunction[] {
  const result: EngineCodeFunction[] = [];
  for (const fn of functions) {
    if (fn === undefined) throw "engine code function invariant";
    if (fn.import !== true)
      result.push({
        name: fn.name,
        offset: fn.offset,
        byteLength: fn.byteLength,
      });
  }
  return result;
}
export interface EngineCodeStorageHost {
  readonly domain: () => number;
  readonly map: (byteLength: number) => number;
  readonly register: (address: number, byteLength: number) => number;
  readonly write: (
    address: number,
    capacity: number,
    offset: number,
    bytes: Uint8Array,
  ) => number;
  /** Optional observer of each successful publication, e.g. a JIT debugger
   * and perf-map registrar (see native/jit-debug.ts). */
  readonly published?: (
    address: number,
    bytes: Uint8Array,
    functions: readonly EngineCodeFunction[],
  ) => void;
}
export interface EngineCodeStorage {
  readonly domain: number;
  readonly publish: (
    bytes: Uint8Array,
    functions?: readonly EngineCodeFunction[],
  ) => number | undefined;
}
/** Engine-owned code remains live for the host's lifetime. Share one owner
 * across related realms; publication is serialized by its owning engine.
 * The opaque interface keeps mapping authority and mutable offsets private. */
export function createEngineCodeStorage(
  host: EngineCodeStorageHost,
  capacity: number,
): EngineCodeStorage {
  if (!Number.isSafeInteger(capacity) || capacity <= 0)
    throw new RangeError(
      "Code storage capacity must be a positive safe integer",
    );
  const domain = host.domain();
  if (!Number.isSafeInteger(domain) || domain <= 0)
    throw new RangeError("Code storage requires an issued context domain");
  const state = { address: 0, used: 0 };
  return {
    domain,
    publish: (
      bytes: Uint8Array,
      functions?: readonly EngineCodeFunction[],
    ): number | undefined => {
      if (host.domain() !== domain) return undefined;
      const offset = Math.ceil(state.used / 16) * 16;
      if (bytes.length > capacity - offset) return undefined;
      if (state.address === 0) {
        // Poison before requesting authority: a failure/throw never remaps a live
        // or partially registered arena. The host retains all mappings permanently.
        state.address = -1;
        const address = host.map(capacity);
        if (
          address <= 0 ||
          host.domain() !== domain ||
          host.register(address, capacity) !== 0 ||
          host.domain() !== domain
        )
          return undefined;
        state.address = address;
      }
      if (state.address < 0) return undefined;
      // Failed/throwing writes consume this identity; later writes use a new range.
      state.used = offset + bytes.length;
      if (
        host.write(state.address, capacity, offset, bytes) !== 0 ||
        host.domain() !== domain
      )
        return undefined;
      const published = host.published;
      if (published !== undefined)
        published(state.address + offset, bytes, functions ?? []);
      return state.address + offset;
    },
  };
}
