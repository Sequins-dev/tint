// Parity between two versions of a binding (docs/native-ffi.md, "Binding
// generator"): every difference in what they declare, one line each. It
// replaced the hand-written bindings with generated ones (no layout or
// signature changed), and `pnpm bindgen check` uses it to describe what a
// regeneration would change. Parameter names and comments are not compared;
// pointers to non-record memory compare equal whatever their scalar
// pointee (`Ptr<u8>` and `Ptr<void>` are the same borrowed bytes).
import {
  cLayout,
  type CFunctionDeclaration,
  type CLibraryDeclaration,
  type CTarget,
  type CType,
} from "@tint/abi/c";

/** A C type as parity compares it. */
export function typeKey(type: CType): string {
  switch (type.kind) {
    case "void":
      return "void";
    case "scalar":
      return type.scalar;
    case "pointer":
      return type.pointee.kind === "record" ? "*" + type.pointee.name : "*";
    case "record":
      return type.name;
    case "array":
      return `${typeKey(type.element)}[${type.length}]`;
  }
}
function layoutKey(type: CType, target: CTarget): string {
  const layout = cLayout(type, target);
  return layout.ok
    ? `size ${layout.value.size} align ${layout.value.alignment} offsets [${layout.value.offsets.join(", ")}]`
    : layout.error;
}
function functionKey(fn: CFunctionDeclaration): string {
  const signature = fn.signature;
  return [
    fn.symbol,
    `(${signature.parameters
      .map(
        (type, position) => `${typeKey(type)} ${fn.parameterForms[position]}`,
      )
      .join(", ")})`,
    `fixed ${signature.fixedParameters}`,
    `${typeKey(signature.result)} ${fn.resultForm}`,
    signature.errno,
    signature.callClass,
  ].join(" ");
}

/** What `generated` (the newer version) declares differently from
 * `written` on `target`. */
export function bindingDifferences(
  written: CLibraryDeclaration,
  generated: CLibraryDeclaration,
  target: CTarget,
): string[] {
  const differences: string[] = [];
  if (written.module !== generated.module)
    differences.push(`module: ${written.module} vs ${generated.module}`);
  const generatedRecords = new Map(
    generated.records.map((record) => [record.name, record]),
  );
  for (const record of written.records) {
    const other = generatedRecords.get(record.name);
    if (other === undefined) {
      differences.push(`record ${record.name}: only hand-written`);
      continue;
    }
    const ours = layoutKey(record.type, target),
      theirs = layoutKey(other.type, target);
    if (ours !== theirs)
      differences.push(`record ${record.name}: layout ${ours} vs ${theirs}`);
    if (record.type.kind !== "record" || other.type.kind !== "record") continue;
    if (
      record.type.union !== other.type.union ||
      record.type.packed !== other.type.packed
    )
      differences.push(`record ${record.name}: union/packed markers differ`);
    const names = record.type.fields.map((field) => field.name).join(", "),
      otherNames = other.type.fields.map((field) => field.name).join(", ");
    if (names !== otherNames) {
      differences.push(
        `record ${record.name}: members (${names}) vs (${otherNames})`,
      );
      continue;
    }
    for (const [position, field] of record.type.fields.entries()) {
      const a = typeKey(field.type),
        b = typeKey(other.type.fields[position]!.type);
      if (a !== b)
        differences.push(
          `record ${record.name} member ${field.name}: ${a} vs ${b}`,
        );
    }
  }
  const writtenRecords = new Set(written.records.map((record) => record.name));
  for (const record of generated.records)
    if (!writtenRecords.has(record.name))
      differences.push(`record ${record.name}: only generated`);
  const writtenLayouts = new Set(written.layouts),
    generatedLayouts = new Set(generated.layouts);
  for (const name of writtenLayouts)
    if (!generatedLayouts.has(name) && generatedRecords.has(name))
      differences.push(`Layout ${name}: only hand-written`);
  for (const name of generatedLayouts)
    if (!writtenLayouts.has(name) && writtenRecords.has(name))
      differences.push(`Layout ${name}: only generated`);
  const generatedFunctions = new Map(
    generated.functions.map((fn) => [fn.name, fn]),
  );
  for (const fn of written.functions) {
    const other = generatedFunctions.get(fn.name);
    if (other === undefined)
      differences.push(`function ${fn.name}: only hand-written`);
    else if (functionKey(fn) !== functionKey(other))
      differences.push(
        `function ${fn.name}: ${functionKey(fn)} vs ${functionKey(other)}`,
      );
  }
  const writtenFunctions = new Set(written.functions.map((fn) => fn.name));
  for (const fn of generated.functions)
    if (!writtenFunctions.has(fn.name))
      differences.push(`function ${fn.name}: only generated`);
  const generatedConstants = new Map(
    generated.constants.map((item) => [item.name, item.value]),
  );
  for (const item of written.constants) {
    const value = generatedConstants.get(item.name);
    if (value === undefined)
      differences.push(`constant ${item.name}: only hand-written`);
    else if (value !== item.value)
      differences.push(`constant ${item.name}: ${item.value} vs ${value}`);
  }
  const writtenConstants = new Set(written.constants.map((item) => item.name));
  for (const item of generated.constants)
    if (!writtenConstants.has(item.name))
      differences.push(`constant ${item.name}: only generated`);
  const queries = (declaration: CLibraryDeclaration) =>
    declaration.availability
      .map((query) => `${query.name}:${query.symbol}`)
      .sort()
      .join(", ");
  if (queries(written) !== queries(generated))
    differences.push(
      `availability: (${queries(written)}) vs (${queries(generated)})`,
    );
  return differences;
}
