import type { RegExpLegacyState } from "./regexp-legacy-state.ts";
import type { RegExpProgram } from "@tint/foundation/regexp/engine";
import type { RegExpFlags } from "@tint/foundation/regexp/syntax";
/** Brand and original pattern state; absence of a program is an execution gap. */
export interface RegExpData {
  readonly legacyState: RegExpLegacyState;
  readonly legacyEnabled: boolean;
  readonly originalSource: string;
  readonly originalFlags: string;
  readonly flags: RegExpFlags;
  readonly program: RegExpProgram | undefined;
}
