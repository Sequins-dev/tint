import type { ExecutableImageRequest } from "@tint/image/executable";
import {
  buildExecutable,
  type MachODylibVersion,
} from "@tint/image/darwin/macho";
import type { NativeTarget } from "@tint/platform/target";
import type { ForeignLibrary } from "./native/index.ts";

export type ImageWriteResult =
  | { readonly ok: true; readonly value: Uint8Array }
  | { readonly ok: false; readonly error: string };

/** Lay out (and, where the target requires, sign) an executable image in
 * the target's object format. `identifier` names the program (the Mach-O
 * code-signing identifier); `foreignLibraries` supply each library's
 * target-specific load facts. */
export function writeExecutableImage(
  target: NativeTarget,
  image: ExecutableImageRequest,
  identifier: string,
  foreignLibraries: readonly ForeignLibrary[],
): ImageWriteResult {
  if (target.objectFormat === "elf")
    return {
      ok: false,
      error: target.name + " executable images (ELF) are not implemented",
    };
  const dylibVersions: MachODylibVersion[] = [];
  for (const library of image.libraries ?? []) {
    if (library === undefined) throw "image library invariant";
    const name = library.name,
      foreign = foreignLibraries.find(
        (item) => item !== undefined && item.image.name === name,
      );
    if (foreign === undefined) return { ok: false, error: "library " + name };
    dylibVersions.push({
      name,
      currentVersion: foreign.image.currentVersion,
      compatibilityVersion: foreign.image.compatibilityVersion,
    });
  }
  const built = buildExecutable({
    ...image,
    identifier,
    minimumOS: target.minimumOS,
    sdk: target.sdk,
    dylibVersions,
  });
  if (!built.ok) return { ok: false, error: built.error };
  return { ok: true, value: built.value.bytes };
}
