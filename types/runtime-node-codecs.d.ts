declare module "node:string_decoder" {
  import type { Buffer } from "node:buffer";
  export type StringDecoderEncoding =
    | "utf8"
    | "utf-8"
    | "utf16le"
    | "utf-16le"
    | "ucs2"
    | "ucs-2"
    | "latin1"
    | "binary"
    | "ascii"
    | "base64"
    | "base64url"
    | "hex";
  export class StringDecoder {
    constructor(
      encoding?: StringDecoderEncoding | Uppercase<StringDecoderEncoding>,
    );
    readonly encoding: StringDecoderEncoding;
    write(buffer: ArrayBufferView | string): string;
    end(buffer?: ArrayBufferView | string): string;
    text(buffer: Uint8Array, offset: number): string;
    readonly lastChar: Buffer;
    readonly lastNeed: number;
    readonly lastTotal: number;
  }
  const decoder: { StringDecoder: typeof StringDecoder };
  export default decoder;
}

declare module "node:querystring" {
  import type { Buffer } from "node:buffer";
  export interface ParseOptions {
    maxKeys?: number;
    decodeURIComponent?: (value: string) => string;
  }
  export interface StringifyOptions {
    encodeURIComponent?: (value: string) => string;
  }
  export type ParsedUrlQuery = Record<string, string | string[] | undefined>;
  export function parse(
    value: string,
    sep?: string,
    eq?: string,
    options?: ParseOptions,
  ): ParsedUrlQuery;
  export function stringify(
    value: object,
    sep?: string,
    eq?: string,
    options?: StringifyOptions,
  ): string;
  export function escape(value: unknown): string;
  export function unescape(value: string, decodeSpaces?: boolean): string;
  export function unescapeBuffer(value: string, decodeSpaces?: boolean): Buffer;
  export { stringify as encode, parse as decode };
  const querystring: {
    parse: typeof parse;
    stringify: typeof stringify;
    encode: typeof stringify;
    decode: typeof parse;
    escape: typeof escape;
    unescape: typeof unescape;
    unescapeBuffer: typeof unescapeBuffer;
  };
  export default querystring;
}
