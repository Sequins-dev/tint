import { createHash } from "node:crypto";
import { nativeSelectionOrder } from "./native-selection-order.ts";
import {
  syntaxVariants,
  type SyntaxVariant,
  type TestMetadata,
} from "./test262.ts";

interface NativeVariantFile {
  readonly path: string;
  readonly sha256: string;
  readonly metadata: TestMetadata;
}
export interface NativeVariantSubset {
  readonly rootSelection: string;
  readonly requestedVariants: number;
  readonly variantSubsetSha256: string;
}
/** Resolve an explicit manifest against the pinned selection before native work.
 * Execution order stays identical to a directory run; no request is deduplicated
 * or silently discarded. The normalized identity also seals journal resumption. */
export function nativeVariantSelection<T extends NativeVariantFile>(
  files: readonly T[],
  rootSelection: string,
  manifest?: unknown,
): {
  readonly files: (T & { readonly variants: SyntaxVariant[] })[];
  readonly totalVariants: number;
  readonly subset?: NativeVariantSubset;
} {
  let requested: Set<string> | undefined;
  if (manifest !== undefined) {
    if (!Array.isArray(manifest) || manifest.length === 0)
      throw Error("variant manifest must be a nonempty array");
    requested = new Set<string>();
    const catalog = new Map(files.map((file) => [file.path, file]));
    for (const entry of manifest) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry))
        throw Error("invalid variant manifest entry");
      const { path, variant, sha256 } = entry;
      const file = typeof path === "string" ? catalog.get(path) : undefined;
      if (file === undefined)
        throw Error(
          "variant manifest path is outside the pinned selection: " +
            String(path),
        );
      if (!syntaxVariants(file.metadata).includes(variant))
        throw Error(
          "variant manifest variant differs from pinned metadata: " + path,
        );
      if (
        sha256 !== undefined &&
        (typeof sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(sha256) ||
          sha256 !== file.sha256)
      )
        throw Error(
          "variant manifest sha256 differs from pinned source: " + path,
        );
      const key = path + "\0" + variant;
      if (requested.has(key))
        throw Error(
          "duplicate variant manifest entry: " + path + " [" + variant + "]",
        );
      requested.add(key);
    }
  }
  const selected = nativeSelectionOrder(files).flatMap((file) => {
    const variants = syntaxVariants(file.metadata).filter(
      (variant) =>
        requested === undefined || requested.has(file.path + "\0" + variant),
    );
    return variants.length === 0 ? [] : [{ ...file, variants }];
  });
  const totalVariants = selected.reduce(
    (total, file) => total + file.variants.length,
    0,
  );
  return {
    files: selected,
    totalVariants,
    ...(requested === undefined
      ? {}
      : {
          subset: {
            rootSelection,
            requestedVariants: totalVariants,
            variantSubsetSha256: createHash("sha256")
              .update(
                JSON.stringify(
                  selected.flatMap((file) =>
                    file.variants.map((variant) => ({
                      path: file.path,
                      variant,
                      sha256: file.sha256,
                    })),
                  ),
                ),
              )
              .digest("hex"),
          },
        }),
  };
}
