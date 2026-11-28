declare module "node:path" {
  export interface ParsedPath {
    root: string;
    dir: string;
    base: string;
    ext: string;
    name: string;
  }
  export interface FormatInputPathObject {
    root?: string;
    dir?: string;
    base?: string;
    ext?: string;
    name?: string;
  }
  export interface PlatformPath {
    sep: string;
    delimiter: string;
    resolve(...paths: string[]): string;
    normalize(path: string): string;
    isAbsolute(path: string): boolean;
    join(...paths: string[]): string;
    relative(from: string, to: string): string;
    toNamespacedPath(path: string): string;
    dirname(path: string): string;
    basename(path: string, suffix?: string): string;
    extname(path: string): string;
    format(pathObject: FormatInputPathObject): string;
    parse(path: string): ParsedPath;
    posix: PlatformPath;
    win32: PlatformPath;
  }
  export const posix: PlatformPath;
  export const win32: PlatformPath;
  export const sep: string;
  export const delimiter: string;
  export function resolve(...paths: string[]): string;
  export function normalize(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function join(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function toNamespacedPath(path: string): string;
  export function dirname(path: string): string;
  export function basename(path: string, suffix?: string): string;
  export function extname(path: string): string;
  export function format(pathObject: FormatInputPathObject): string;
  export function parse(path: string): ParsedPath;
  export default posix;
}
declare module "node:path/posix" {
  export * from "node:path";
  export { posix as default } from "node:path";
}
declare module "node:path/win32" {
  export * from "node:path";
  export { win32 as default } from "node:path";
}
