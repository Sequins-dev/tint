import type { ExecutableImageRequest } from "@tint/image/executable";
import {
  buildExecutable,
  type MachODylibVersion,
} from "@tint/image/darwin/macho";
import { buildElfExecutable } from "@tint/image/linux/elf";
import type { LinuxAArch64Target, NativeTarget } from "@tint/platform/target";
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
    return writeElfImage(target, image, identifier);
  if ((image.probes ?? []).length > 0)
    return { ok: false, error: "USDT probes are an ELF image facility" };
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
/** ELF images load every library through DT_NEEDED, which has no
 * optional form: a missing library fails the launch. Optional libraries
 * never reach this writer (their bindings load them with dlopen at first
 * use and import none of their symbols: docs/native-ffi.md, "Optional
 * libraries on ELF"), so a weak library here is rejected rather than
 * silently bound to zero. Entitlement requests have
 * no ELF counterpart: debuggers attach under the usual ptrace policy. */
function writeElfImage(
  target: LinuxAArch64Target,
  image: ExecutableImageRequest,
  identifier: string,
): ImageWriteResult {
  const needed: string[] = [];
  for (const library of image.libraries ?? []) {
    if (library === undefined) throw "image library invariant";
    if (library.weak)
      return {
        ok: false,
        error:
          "optional library " +
          library.name +
          " cannot be loaded by " +
          target.name +
          " images",
      };
    needed.push(library.name);
  }
  const built = buildElfExecutable({
    code: image.code,
    entryOffset: image.entryOffset,
    maxByteLength: image.maxByteLength,
    symbols: image.symbols,
    dataSymbols: image.dataSymbols,
    textSections: image.readOnlySections,
    unwind: image.unwind,
    data: image.data,
    imports: image.imports,
    addressFixups: image.addressFixups,
    patchAddress: image.patchAddress,
    debug: image.debug,
    probes: image.probes,
    linux: { interpreter: target.interpreter, needed, identifier },
  });
  if (!built.ok) return { ok: false, error: "ELF image: " + built.error };
  return { ok: true, value: built.value.bytes };
}
