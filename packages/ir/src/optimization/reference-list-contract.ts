import {
  recordHeaderBytes,
  scalarByteLength,
  type ModuleIR,
  type ScalarType,
  type ReturnType,
} from "../scalar/index.ts";
export function referenceListHeader(module: ModuleIR, id: number): boolean {
  const layout = module.records?.[id];
  if (
    layout === undefined ||
    layout.byteLength !== recordHeaderBytes + 16 ||
    layout.fields.length !== 2
  )
    return false;
  const length = layout.fields[0],
    root = layout.fields[1];
  return (
    length !== undefined &&
    root !== undefined &&
    length.type === "number" &&
    length.offset === recordHeaderBytes &&
    length.mutable &&
    root.type === "optional-reference" &&
    root.offset === recordHeaderBytes + 8 &&
    root.mutable &&
    length.stateOffset === undefined &&
    length.presenceOffset === undefined &&
    root.stateOffset === undefined &&
    root.presenceOffset === undefined
  );
}
export function referenceListPayload(
  module: ModuleIR,
  id: number,
): ScalarType | undefined {
  const type = module.records?.[id]?.fields[0]?.type;
  return type === "optional-reference" ||
    type === "optional-string" ||
    type === "primitive" ||
    type === "general" ||
    type === "optional-boolean"
    ? type
    : undefined;
}
export function referenceListCell(module: ModuleIR, id: number): boolean {
  const layout = module.records?.[id];
  if (layout === undefined || layout.fields.length !== 1) return false;
  const field = layout.fields[0];
  return (
    field !== undefined &&
    layout.byteLength === recordHeaderBytes + scalarByteLength(field.type) &&
    field.offset === recordHeaderBytes &&
    referenceListPayload(module, id) !== undefined &&
    field.mutable &&
    field.stateOffset === undefined &&
    field.presenceOffset === undefined
  );
}
export function listFunctionSignature(
  module: ModuleIR,
  id: number,
  parameters: readonly ScalarType[],
  result: ReturnType,
): boolean {
  const fn = module.functions[id];
  if (
    fn === undefined ||
    fn.environment !== undefined ||
    fn.closureEnvironment !== undefined ||
    fn.returnType !== result ||
    fn.parameters.length !== parameters.length
  )
    return false;
  for (let i = 0; i < parameters.length; i++) {
    const slot = fn.parameters[i];
    if (slot === undefined || fn.slots[slot] !== parameters[i]) return false;
  }
  return true;
}
