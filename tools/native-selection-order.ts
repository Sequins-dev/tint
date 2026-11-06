/** Keep file identity and within-lane order stable when preparing native batches. */
export function nativeSelectionOrder<
  T extends {
    readonly metadata: { readonly negative?: { readonly phase: string } };
  },
>(files: readonly T[]): T[] {
  const syntax = (file: T): boolean =>
    file.metadata.negative?.phase === "parse" ||
    file.metadata.negative?.phase === "early";
  return [...files.filter(syntax), ...files.filter((file) => !syntax(file))];
}
