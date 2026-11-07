/** Compare emitted syntax independently of per-occurrence identity hashes. */
export function syntaxShapeJSON(value: unknown): string {
  const serialized = JSON.stringify(value, (key, item) =>
    key === "nodeHash" ? undefined : item,
  );
  if (serialized === undefined) throw Error("missing syntax shape");
  return serialized;
}

export function syntaxShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(syntaxShape);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "nodeHash")
      .map(([key, item]) => [key, syntaxShape(item)]),
  );
}
