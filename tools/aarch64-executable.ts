/** Node/tool composition for fixtures that author AArch64 instructions directly. */
import {
  buildExecutable,
  type ExecutableRequest,
} from "@tint/image/darwin/macho";
import {
  aarch64ImageRelocations,
  type AArch64AddressReference,
} from "@tint/codegen/aarch64/image-relocations";
export type AArch64ExecutableRequest = Omit<
  ExecutableRequest,
  "addressFixups" | "patchAddress"
> & {
  readonly addressFixups?: readonly AArch64AddressReference[];
};
export function buildAArch64Executable(request: AArch64ExecutableRequest) {
  return buildExecutable({
    ...request,
    ...aarch64ImageRelocations(request.addressFixups ?? []),
  });
}

import { emitModule, type EmissionOptions } from "@tint/codegen/aarch64/scalar";
import type { ModuleIR } from "@tint/ir/scalar";
import { darwinHostABI } from "@tint/platform/darwin/host-abi";
/** Existing native fixture tools target Darwin explicitly, not through a backend default. */
export function emitDarwinModule(
  module: ModuleIR,
  options: EmissionOptions = {},
) {
  return emitModule(module, {
    ...options,
    hostABI: options.hostABI ?? darwinHostABI(),
  });
}
