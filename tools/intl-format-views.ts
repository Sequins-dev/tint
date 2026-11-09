import type { NativeRecordBinding } from "@tint/compiler/native";

/** Checked record views over OrdinaryObject.internalIntlFormatData (see
 * packages/js-runtime/src/objects/intl-format-views.ts). Every native build
 * that constructs Intl.DateTimeFormat or Intl.DurationFormat objects binds
 * them and retains them in the ordinary-object runtime. */
export const intlFormatViewNames = [
  "viewDateTimeFormatter",
  "viewDurationFormatter",
  "viewDisplayNames",
] as const;

export function intlFormatRecordBindings(
  module: string,
): NativeRecordBinding[] {
  return intlFormatViewNames.map((name) => ({
    module,
    name,
    operation: "view" as const,
  }));
}
