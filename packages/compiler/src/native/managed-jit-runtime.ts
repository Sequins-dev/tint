import type { SourceModule } from "@tint/typescript/modules/model";
import type { BlockStatement, Statement } from "@tint/typescript/syntax";
import type { ManagedSurfaceLayoutRuntime } from "./managed-directory.ts";

/** A managed entry never lowers a runtime-provider body: every provider
 * operation it reaches is imported from the image, and lowering rejects any
 * runtime body that enters the JIT module. Preparation therefore needs only
 * the providers' declarations. Named functions must annotate parameters and
 * results, so replacing their block bodies with a throw preserves every
 * checked signature while sparing each entry the specialization, checking and
 * collection-demand discovery of helper internals. Other statements are kept.
 * The owner derives this once per immutable runtime and reuses it. */
export function declareManagedJitRuntime(
  runtime: ManagedSurfaceLayoutRuntime,
): ManagedSurfaceLayoutRuntime {
  const modules: SourceModule[] = [];
  for (const source of runtime.modules) {
    if (source === undefined) throw "managed JIT runtime module invariant";
    const statements: Statement[] = [];
    for (const statement of source.module.statements) {
      if (statement === undefined)
        throw "managed JIT runtime statement invariant";
      if (statement.kind !== "function" || statement.body.kind !== "block") {
        statements.push(statement);
        continue;
      }
      const span = statement.body,
        thrown: Statement[] = [];
      thrown.push({
        start: span.start,
        end: span.end,
        kind: "throw",
        expression: {
          start: span.start,
          end: span.end,
          kind: "string",
          value: "MANAGED_JIT_RUNTIME_DECLARATION",
        },
      });
      const body: BlockStatement = {
        start: span.start,
        end: span.end,
        kind: "block",
        statements: thrown,
      };
      statements.push({ ...statement, kind: "function", body });
    }
    modules.push({
      id: source.id,
      module: { ...source.module, statements },
      dependencies: source.dependencies,
    });
  }
  return { ...runtime, modules };
}
