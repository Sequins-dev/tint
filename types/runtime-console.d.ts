interface TintConsole {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  dir(value: unknown, options?: import("node:util").InspectOptions): void;
  dirxml(...args: unknown[]): void;
  assert(condition?: unknown, ...args: unknown[]): void;
  group(...args: unknown[]): void;
  groupCollapsed(...args: unknown[]): void;
  groupEnd(): void;
  count(label?: unknown): void;
  countReset(label?: unknown): void;
  time(label?: unknown): void;
  timeLog(label?: unknown, ...args: unknown[]): void;
  timeEnd(label?: unknown): void;
  trace(...args: unknown[]): void;
  table(value: unknown): void;
  clear(): void;
}
declare const console: TintConsole;

declare module "node:console" {
  import type { InspectOptions } from "node:util";
  export interface Writer {
    write(text: string): unknown;
  }
  export interface ConsoleOptions {
    stdout: Writer;
    stderr?: Writer;
    ignoreErrors?: boolean;
    colorMode?: boolean | "auto";
    inspectOptions?: InspectOptions | Map<Writer, InspectOptions>;
    groupIndentation?: number;
  }
  export class Console {
    constructor(stdout: Writer, stderr?: Writer, ignoreErrors?: boolean);
    constructor(options: ConsoleOptions);
  }
  export interface Console extends TintConsole {}
  export const log: TintConsole["log"];
  export const info: TintConsole["info"];
  export const debug: TintConsole["debug"];
  export const warn: TintConsole["warn"];
  export const error: TintConsole["error"];
  export const dir: TintConsole["dir"];
  export const dirxml: TintConsole["dirxml"];
  export const assert: TintConsole["assert"];
  export const group: TintConsole["group"];
  export const groupCollapsed: TintConsole["groupCollapsed"];
  export const groupEnd: TintConsole["groupEnd"];
  export const count: TintConsole["count"];
  export const countReset: TintConsole["countReset"];
  export const time: TintConsole["time"];
  export const timeLog: TintConsole["timeLog"];
  export const timeEnd: TintConsole["timeEnd"];
  export const trace: TintConsole["trace"];
  export const table: TintConsole["table"];
  export const clear: TintConsole["clear"];
  const exported: TintConsole & { Console: typeof Console };
  export default exported;
}
