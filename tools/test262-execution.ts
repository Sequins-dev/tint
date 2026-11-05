import type { SyntaxVariant, TestMetadata } from "./test262.ts";
export interface ExecutionPlan {
  readonly source: string;
  readonly goal: "script" | "module";
  readonly harness: readonly string[];
  readonly asynchronous: boolean;
  readonly canSuspend: boolean;
}
export type ExecutionOutcome =
  | { readonly kind: "completed" }
  | {
      readonly kind: "error";
      readonly phase: "parse" | "resolution" | "runtime" | "harness";
      readonly type: string;
      readonly message: string;
    }
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "timeout"; readonly detail?: string }
  | { readonly kind: "crash"; readonly detail: string };
export type ExecutionStatus =
  "pass" | "fail" | "unsupported" | "timeout" | "harness-error" | "crash";
/** Preserve Script/Module semantics; never wrap a test in a function or rewrite assertions. */
export function executionPlan(
  source: string,
  variant: SyntaxVariant,
  metadata: TestMetadata,
): ExecutionPlan {
  if (
    metadata.flags.includes("CanBlockIsTrue") &&
    metadata.flags.includes("CanBlockIsFalse")
  )
    throw new Error("conflicting Test262 CanBlock requirements");
  const raw = metadata.flags.includes("raw");
  const parseNegative =
    metadata.negative?.phase === "parse" ||
    metadata.negative?.phase === "early";
  const asynchronous = metadata.flags.includes("async");
  return {
    source: variant === "strict" && !raw ? '"use strict";\n' + source : source,
    goal: variant === "module" ? "module" : "script",
    harness:
      raw || parseNegative
        ? []
        : [
            "assert.js",
            "sta.js",
            ...(asynchronous ? ["doneprintHandle.js"] : []),
            ...metadata.includes,
          ],
    asynchronous,
    canSuspend: !metadata.flags.includes("CanBlockIsFalse"),
  };
}
export function judgeExecution(
  metadata: TestMetadata,
  outcome: ExecutionOutcome,
): ExecutionStatus {
  if (
    outcome.kind === "unsupported" ||
    outcome.kind === "timeout" ||
    outcome.kind === "crash"
  )
    return outcome.kind;
  if (outcome.kind === "error" && outcome.phase === "harness")
    return "harness-error";
  const negative = metadata.negative;
  if (negative === undefined)
    return outcome.kind === "completed" ? "pass" : "fail";
  const phase = negative.phase === "early" ? "parse" : negative.phase;
  return outcome.kind === "error" &&
    outcome.phase === phase &&
    outcome.type === negative.type
    ? "pass"
    : "fail";
}
export function executionTotals(statuses: readonly ExecutionStatus[]) {
  const count = (status: ExecutionStatus) =>
    statuses.filter((value) => value === status).length;
  const passed = count("pass");
  return {
    total: statuses.length,
    passed,
    failed: count("fail"),
    unsupported: count("unsupported"),
    timeouts: count("timeout"),
    harnessErrors: count("harness-error"),
    crashes: count("crash"),
    passFraction: statuses.length === 0 ? null : passed / statuses.length,
  };
}
export interface ExecutionJob {
  readonly plan: ExecutionPlan;
  readonly filename: string;
  readonly harness: readonly {
    readonly filename: string;
    readonly source: string;
  }[];
  readonly timeoutMs: number;
}
