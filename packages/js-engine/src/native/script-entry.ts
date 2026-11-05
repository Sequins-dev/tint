import type { GlobalEnvironment } from "@tint/js-runtime/environments/global";
import type { ScriptPropertyKey, ScriptRecord } from "@tint/js-runtime/objects";
/** Image-selected frame for the lowered execute(global, script) entry. */
export interface ScriptEntryFrame {
  readonly $imports: unknown;
  readonly $argument0: GlobalEnvironment<ScriptPropertyKey, unknown>;
  readonly $argument1: ScriptRecord;
}
