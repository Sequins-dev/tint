import type { SourceModule } from "@tint/typescript/modules/model";
import type { BuildRequest } from "@tint/compiler/build";

/** A compiler-owned source projection and its checked AOT composition request.
 * The original frozen source identity remains intact; the unit index additionally
 * pins every precompiled artifact and the frozen tooling that generated adapters. */
export interface NativeServiceImageSource {
  transformModules<T extends { readonly id: string }>(
    modules: readonly T[],
  ): (T | SourceModule)[];
  readonly surface: NonNullable<BuildRequest["managedSurfaces"]>[number];
  readonly runtimes: BuildRequest["runtimes"];
  readonly recordBindings: NonNullable<BuildRequest["recordBindings"]>;
}
export interface NativeServiceImagePlan extends NativeServiceImageSource {
  readonly services: NonNullable<BuildRequest["nativeServices"]>;
  readonly identity: {
    readonly nativeLinkingMode: "aot-native-services-v1";
    readonly nativeServiceUnitIndexSha256: string;
  };
}
