import type { Module } from "../syntax/model.ts";
export interface SourceModule {
  /** Optional source-position provider; offsets are original UTF-16 positions. */
  readonly sourcePosition?: (
    offset: number,
  ) => { readonly line: number; readonly column: number } | undefined;
  readonly id: string;
  readonly module: Module;
  readonly dependencies: ReadonlyMap<string, string>;
}
