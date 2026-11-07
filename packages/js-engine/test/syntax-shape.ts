/** Compare emitted syntax independently of per-occurrence identity hashes. */
export function syntaxShapeJSON(value: unknown): string {
  const serialized = JSON.stringify(value, (key, item) =>
    key === "nodeHash" ? undefined : item,
  );
  if (serialized === undefined) throw Error("missing syntax shape");
  return serialized;
}

export function syntaxShape(value: unknown): unknown {
  return JSON.parse(syntaxShapeJSON(value));
}
