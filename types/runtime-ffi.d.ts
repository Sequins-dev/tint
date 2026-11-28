declare module "node:ffi" {
  import type { Buffer } from "node:buffer";
  export type Pointer = bigint;
  export interface Signature {
    readonly arguments?: readonly string[];
    readonly return?: string;
  }
  export interface ForeignFunction<
    Arguments extends unknown[] = unknown[],
    Result = unknown,
  > {
    (...args: Arguments): Result;
    pointer: Pointer;
  }
  export class DynamicLibrary {
    constructor(path: string | null);
    readonly path: string;
    readonly symbols: Readonly<Record<string, Pointer>>;
    readonly functions: Readonly<Record<string, ForeignFunction>>;
    close(): void;
    [Symbol.dispose](): void;
    getSymbol(name: string): Pointer;
    getSymbols(): Readonly<Record<string, Pointer>>;
    getFunction<Args extends unknown[] = unknown[], Result = unknown>(
      name: string,
      signature: Signature,
    ): ForeignFunction<Args, Result>;
    getFunctions<Names extends string>(
      signatures: Record<Names, Signature>,
    ): Readonly<Record<Names, ForeignFunction>>;
    getFunctions(): Readonly<Record<string, ForeignFunction>>;
    registerCallback<Args extends unknown[]>(
      signature: Signature,
      callback: (...args: Args) => unknown,
    ): Pointer;
    registerCallback(callback: () => void): Pointer;
    unregisterCallback(pointer: Pointer): void;
    refCallback(pointer: Pointer): void;
    unrefCallback(pointer: Pointer): void;
  }
  export function dlopen<Names extends string = string>(
    path: string | null,
    signatures?: Record<Names, Signature>,
  ): {
    lib: DynamicLibrary;
    functions: Readonly<Record<Names, ForeignFunction>>;
    [Symbol.dispose](): void;
  };
  export function dlclose(library: DynamicLibrary): void;
  export function dlsym(library: DynamicLibrary, name: string): Pointer;
  export const suffix: string;
  export const types: Readonly<Record<string, string>>;
  export function getCurrentEventLoop(): Pointer;
  export function toBuffer(
    pointer: Pointer,
    length: number,
    copy?: boolean,
  ): Buffer;
  export function toArrayBuffer(
    pointer: Pointer,
    length: number,
    copy?: boolean,
  ): ArrayBuffer;
  export function toString(pointer: Pointer): string;
  export function getRawPointer(
    value: ArrayBufferLike | ArrayBufferView,
  ): Pointer;
  export function exportString(
    source: string,
    pointer: Pointer,
    length: number,
    encoding?: string,
  ): void;
  export function exportBuffer(
    source: Buffer,
    pointer: Pointer,
    length: number,
  ): void;
  export function exportArrayBuffer(
    source: ArrayBuffer,
    pointer: Pointer,
    length: number,
  ): void;
  export function exportArrayBufferView(
    source: ArrayBufferView,
    pointer: Pointer,
    length: number,
  ): void;
  export function getInt8(pointer: Pointer, offset?: number): number;
  export function setInt8(
    pointer: Pointer,
    offset: number,
    value: number,
  ): void;
  export function getUint8(pointer: Pointer, offset?: number): number;
  export function setUint8(
    pointer: Pointer,
    offset: number,
    value: number,
  ): void;
  export function getInt16(pointer: Pointer, offset?: number): number;
  export function setInt16(
    pointer: Pointer,
    offset: number,
    value: number,
  ): void;
  export function getUint16(pointer: Pointer, offset?: number): number;
  export function setUint16(
    pointer: Pointer,
    offset: number,
    value: number,
  ): void;
  export function getInt32(pointer: Pointer, offset?: number): number;
  export function setInt32(
    pointer: Pointer,
    offset: number,
    value: number,
  ): void;
  export function getUint32(pointer: Pointer, offset?: number): number;
  export function setUint32(
    pointer: Pointer,
    offset: number,
    value: number,
  ): void;
  export function getInt64(pointer: Pointer, offset?: number): bigint;
  export function setInt64(
    pointer: Pointer,
    offset: number,
    value: bigint,
  ): void;
  export function getUint64(pointer: Pointer, offset?: number): bigint;
  export function setUint64(
    pointer: Pointer,
    offset: number,
    value: bigint,
  ): void;
  export function getFloat32(pointer: Pointer, offset?: number): number;
  export function setFloat32(
    pointer: Pointer,
    offset: number,
    value: number,
  ): void;
  export function getFloat64(pointer: Pointer, offset?: number): number;
  export function setFloat64(
    pointer: Pointer,
    offset: number,
    value: number,
  ): void;
  const ffi: {
    DynamicLibrary: typeof DynamicLibrary;
    dlopen: typeof dlopen;
    dlclose: typeof dlclose;
    dlsym: typeof dlsym;
    suffix: typeof suffix;
    types: typeof types;
    getCurrentEventLoop: typeof getCurrentEventLoop;
    toBuffer: typeof toBuffer;
    toArrayBuffer: typeof toArrayBuffer;
    toString: typeof toString;
    getRawPointer: typeof getRawPointer;
    exportString: typeof exportString;
    exportBuffer: typeof exportBuffer;
    exportArrayBuffer: typeof exportArrayBuffer;
    exportArrayBufferView: typeof exportArrayBufferView;
    getInt8: typeof getInt8;
    setInt8: typeof setInt8;
    getUint8: typeof getUint8;
    setUint8: typeof setUint8;
    getInt16: typeof getInt16;
    setInt16: typeof setInt16;
    getUint16: typeof getUint16;
    setUint16: typeof setUint16;
    getInt32: typeof getInt32;
    setInt32: typeof setInt32;
    getUint32: typeof getUint32;
    setUint32: typeof setUint32;
    getInt64: typeof getInt64;
    setInt64: typeof setInt64;
    getUint64: typeof getUint64;
    setUint64: typeof setUint64;
    getFloat32: typeof getFloat32;
    setFloat32: typeof setFloat32;
    getFloat64: typeof getFloat64;
    setFloat64: typeof setFloat64;
  };
  export default ffi;
}
