import {
  nativeSyntaxHost,
  nativeSyntaxDependencies,
} from "./native-syntax-kernel.ts";
export { nativeSyntaxHost } from "./native-syntax-kernel.ts";
import { buildMacOSProgram } from "@tint/compiler/build";
import { projectBuildRequest, projectRoots } from "@tint/compiler/cli";
import type { SourceModule } from "@tint/typescript/modules/model";
import type { ExecutionPlan, ExecutionOutcome } from "./test262-execution.ts";
import { parsedNativeHost, nativeSelectorHost } from "./test262-native.ts";
import {
  workspaceModules,
  type WorkspaceSourceSnapshot,
} from "./workspace-sources.ts";

export function nativeSyntaxBatchModules(
  plans: readonly ExecutionPlan[],
): SourceModule[] {
  if (plans.length === 0) throw new Error("empty syntax batch");
  const hosts = plans.map((plan, index) =>
    parsedNativeHost(
      `test262-syntax-case-${index}`,
      nativeSyntaxHost(plan),
      nativeSyntaxDependencies,
    ),
  );
  return [
    ...hosts,
    nativeSelectorHost(
      hosts.map((host) => host.id),
      "test262-syntax-host",
    ),
  ];
}
export function createNativeSyntaxBuilder() {
  const build = createNativeSyntaxImageBuilder();
  return (plan: ExecutionPlan) =>
    build([
      parsedNativeHost(
        "test262-syntax-host",
        nativeSyntaxHost(plan),
        nativeSyntaxDependencies,
      ),
    ]);
}
export function createNativeSyntaxBatchBuilder(
  snapshot?: WorkspaceSourceSnapshot,
) {
  const build = createNativeSyntaxImageBuilder(snapshot);
  return (plans: readonly ExecutionPlan[]) =>
    build(nativeSyntaxBatchModules(plans));
}
function createNativeSyntaxImageBuilder(snapshot?: WorkspaceSourceSnapshot) {
  let runtimeModules: readonly SourceModule[] | undefined;
  return (
    hosts: readonly SourceModule[],
  ):
    | { readonly ok: true; readonly bytes: Uint8Array }
    | { readonly ok: false; readonly outcome: ExecutionOutcome } => {
    runtimeModules ??= workspaceModules(
      [...projectRoots(), ...nativeSyntaxDependencies.values()],
      snapshot,
    );
    const modules: SourceModule[] = [...runtimeModules, ...hosts];
    const request = projectBuildRequest(modules, () => {});
    const built = buildMacOSProgram({
      ...request,
      allowDebugger: true,
      entry: "test262-syntax-host",
      start: "run",
      identifier: "tint-test262-native-syntax",
    });
    if (!built.ok)
      return {
        ok: false,
        outcome: {
          kind: "unsupported",
          reason: "native syntax compilation: " + JSON.stringify(built.error),
        },
      };
    return { ok: true, bytes: built.value };
  };
}
