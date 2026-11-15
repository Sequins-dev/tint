import type { NativeModule } from "@tint/codegen/aarch64/scalar";

/** Functions with reference-holding frame words, in emission order, and
 * those words: the candidates every safepoint map of the function is drawn
 * from. Offsets are stack-pointer relative (frameOffset is always 0). */
export function frameRoots(native: NativeModule): {
  readonly function: number;
  readonly frameOffset: number;
  readonly offsets: readonly number[];
  readonly generalOffsets: readonly number[];
}[] {
  const result: {
    function: number;
    frameOffset: number;
    offsets: readonly number[];
    generalOffsets: readonly number[];
  }[] = [];
  for (const fn of native.functions) {
    const roots = fn.frameRoots;
    if (roots !== undefined)
      result.push({
        function: fn.id,
        frameOffset: 0,
        offsets: roots.references,
        generalOffsets: roots.generals,
      });
  }
  return result;
}
