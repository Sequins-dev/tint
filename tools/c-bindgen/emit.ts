// Emission (docs/native-ffi.md, "Binding generator"): one spec's facts for
// every target become one `declare module "tint:c/<library>"` in the
// documented declaration syntax, with `ByTarget` wherever targets differ.
// The text is formatted with prettier and re-read by the compiler's own
// declaration parser for every target, whose layouts must equal clang's.
// Declarations the syntax cannot express are reported and left out; a
// wrong layout is never emitted.
import { format } from "prettier";
import { cLayout, cScalarBytes, type CScalar } from "@tint/abi/c";
import { parseForeignDeclarations } from "@tint/compiler/native";
import type { RecordFact, TargetFacts, TypeFact } from "./facts.ts";
import {
  cTargetOf,
  exportedName,
  functionSpec,
  recordSpec,
  type BindingSpec,
  type FunctionSpec,
  type ParameterSpec,
  type PointerMode,
  type ResultSpec,
  type TargetName,
} from "./spec.ts";

/** A declaration the syntax cannot express on some target (left out). */
class Skip extends Error {}
/** A spec that asks for something its C declaration contradicts. */
export class SpecError extends Error {}

export interface Emission {
  /** The formatted declaration module. */
  readonly text: string;
  /** What was left out and why, one line each (also in the header). */
  readonly report: readonly string[];
}
export interface EmitOptions {
  /** The spec's path as the header names it. */
  readonly specPath: string;
  /** Emit for these targets only (default: the spec's). */
  readonly targets?: readonly TargetName[];
}

const ffiNames = [
  "ByTarget",
  "bool",
  "char",
  "i8",
  "u8",
  "i16",
  "u16",
  "i32",
  "u32",
  "i64",
  "u64",
  "isize",
  "usize",
  "f32",
  "f64",
  "Ptr",
  "Address",
  "CString",
  "CStringBytes",
  "FixedArray",
  "Layout",
  "OrErrno",
  "Variadic",
  "Available",
  "MayCallback",
  "Async",
  "Packed",
  "Union",
  "Aligned",
];

/** Per-target rendering context. */
interface Context {
  readonly target: TargetName;
  readonly facts: TargetFacts;
  readonly records: ReadonlyMap<string, RecordFact>;
  /** Records the module declares (on every target). */
  readonly emitted: ReadonlySet<string>;
  readonly aliases: ReadonlySet<string>;
}

function scalarText(
  type: TypeFact & { kind: "scalar" },
  context: Context,
): string {
  for (const alias of type.aliases)
    if (context.aliases.has(alias)) return alias;
  return type.scalar;
}
function pointeeText(type: TypeFact, context: Context): string {
  switch (type.kind) {
    case "scalar":
      return scalarText(type, context);
    case "record":
      return context.emitted.has(type.name) ? type.name : "void";
    default:
      return "void";
  }
}
function memberText(type: TypeFact, context: Context, opaque: boolean): string {
  switch (type.kind) {
    case "scalar":
      return scalarText(type, context);
    case "pointer":
      if (type.pointee.kind === "function" && !opaque)
        throw new Skip(
          "is a function pointer (Callback<…> lands with Phase 4; list it in `opaque` to bind Address<void>)",
        );
      return `Address<${pointeeText(type.pointee, context)}>`;
    case "record":
      if (!context.emitted.has(type.name))
        throw new Skip(
          `holds record ${type.name} by value, which is not emitted`,
        );
      return type.name;
    case "array":
      return `FixedArray<${memberText(type.element, context, opaque)}, ${type.length}>`;
    case "unsupported":
      throw new Skip(type.reason);
    default:
      throw new Skip(`has no binding type (${type.kind})`);
  }
}
/** The C types a record is an array of (all its members' element type),
 * as structural keys. */
function elementKeys(record: RecordFact): Set<string> {
  const keys = new Set<string>();
  for (const field of record.fields) {
    let type = field.type;
    while (type.kind === "array") type = type.element;
    keys.add(structuralKey(type));
  }
  return keys;
}
function structuralKey(type: TypeFact): string {
  switch (type.kind) {
    case "scalar":
      return type.scalar;
    case "pointer":
      return "*";
    case "record":
      return "record " + type.name;
    case "array":
      return `${structuralKey(type.element)}[${type.length}]`;
    default:
      return type.kind;
  }
}
/** An emitted record standing for a pointer-sized C value: it must take
 * one general register exactly like the value (8 bytes, no floats). */
function wordRecord(
  name: string,
  original: TypeFact,
  context: Context,
  what: string,
): string {
  const record = context.records.get(name);
  if (record === undefined || !context.emitted.has(name))
    throw new SpecError(`${what}: record ${name} is not emitted`);
  const wordSized =
    original.kind === "pointer" ||
    (original.kind === "scalar" && cScalarBytes(original.scalar) === 8);
  if (!wordSized)
    throw new SpecError(
      `${what}: only a pointer or 64-bit integer passes as record ${name}`,
    );
  if (record.size !== 8 || hasFloat(record, context))
    throw new SpecError(
      `${what}: record ${name} must be 8 bytes without floating-point members to pass like a word`,
    );
  return name;
}
function hasFloat(record: RecordFact, context: Context): boolean {
  const visit = (type: TypeFact): boolean => {
    if (type.kind === "scalar")
      return type.scalar === "f32" || type.scalar === "f64";
    if (type.kind === "array") return visit(type.element);
    if (type.kind === "record") {
      const inner = context.records.get(type.name);
      return inner !== undefined && hasFloat(inner, context);
    }
    return false;
  };
  return record.fields.some((field) => visit(field.type));
}
function parameterText(
  type: TypeFact,
  choice: ParameterSpec,
  context: Context,
  what: string,
): string {
  if (choice.record !== undefined)
    return wordRecord(choice.record, type, context, what);
  if (type.kind !== "pointer") {
    if (choice.as !== undefined || choice.pointee !== undefined)
      throw new SpecError(`${what} is not a pointer`);
    if (type.kind === "record") {
      if (!context.emitted.has(type.name))
        throw new Skip(
          `${what} passes record ${type.name} by value, which is not emitted`,
        );
      return type.name;
    }
    if (type.kind === "scalar") return scalarText(type, context);
    if (type.kind === "unsupported") throw new Skip(`${what}: ${type.reason}`);
    throw new Skip(`${what} has no binding type (${type.kind})`);
  }
  const pointee = type.pointee;
  const charPointee =
    pointee.kind === "scalar" &&
    (pointee.scalar === "char" ||
      pointee.scalar === "i8" ||
      pointee.scalar === "u8");
  let mode: PointerMode;
  if (choice.as !== undefined) mode = choice.as;
  else if (pointee.kind === "function")
    throw new Skip(
      `${what} is a function pointer (Callback<…> lands with Phase 4; bind it \`as: "Address"\` to pass an opaque address)`,
    );
  else if (
    charPointee &&
    pointee.kind === "scalar" &&
    pointee.scalar === "char" &&
    type.constPointee
  )
    mode = "CString";
  else mode = "Ptr";
  if (mode === "CString" || mode === "CStringBytes") {
    if (!charPointee)
      throw new SpecError(`${what}: ${mode} needs a char pointer`);
    if (choice.pointee !== undefined)
      throw new SpecError(`${what}: ${mode} takes no pointee`);
    return mode;
  }
  if (mode === "Ptr" && pointee.kind === "function")
    throw new SpecError(`${what}: a function pointer is not a borrowed view`);
  return `${mode}<${pointeeOverride(pointee, choice.pointee, context, what)}>`;
}
function pointeeOverride(
  pointee: TypeFact,
  name: string | undefined,
  context: Context,
  what: string,
): string {
  if (name === undefined) return pointeeText(pointee, context);
  const record = context.records.get(name);
  if (record === undefined || !context.emitted.has(name))
    throw new SpecError(`${what}: pointee record ${name} is not emitted`);
  if (pointee.kind === "void") return name;
  if (pointee.kind === "record") {
    if (pointee.name !== name)
      throw new SpecError(
        `${what}: the C pointee is record ${pointee.name}, not ${name}`,
      );
    return name;
  }
  const keys = elementKeys(record);
  if (keys.size !== 1 || !keys.has(structuralKey(pointee)))
    throw new SpecError(
      `${what}: record ${name} is not an array of the C pointee (${structuralKey(pointee)})`,
    );
  return name;
}
function resultText(
  type: TypeFact,
  choice: ResultSpec,
  context: Context,
  what: string,
): string {
  if (choice.discard === true) return "void";
  if (choice.record !== undefined)
    return wordRecord(choice.record, type, context, what);
  if (choice.errno === true) {
    if (type.kind === "pointer") return "OrErrno<isize>";
    if (
      type.kind === "scalar" &&
      (type.scalar === "i32" ||
        type.scalar === "i64" ||
        type.scalar === "isize")
    )
      return `OrErrno<${type.scalar}>`;
    throw new SpecError(
      `${what}: OrErrno needs a signed 32/64-bit or pointer result`,
    );
  }
  switch (type.kind) {
    case "void":
      return "void";
    case "scalar":
      return scalarText(type, context);
    case "pointer":
      if (type.pointee.kind === "function")
        throw new Skip(
          `${what} is a function pointer (Callback<…> lands with Phase 4)`,
        );
      return `Address<${pointeeText(type.pointee, context)}>`;
    case "record":
      if (!context.emitted.has(type.name))
        throw new Skip(
          `${what} returns record ${type.name} by value, which is not emitted`,
        );
      return type.name;
    case "unsupported":
      throw new Skip(`${what}: ${type.reason}`);
    default:
      throw new Skip(`${what} has no binding type (${type.kind})`);
  }
}
/** C default argument promotion of a variadic argument's type. */
function promoted(type: TypeFact): TypeFact {
  if (type.kind !== "scalar") return type;
  const scalar: CScalar = type.scalar;
  if (scalar === "f32") return { kind: "scalar", scalar: "f64", aliases: [] };
  if (cScalarBytes(scalar) < 4)
    return { kind: "scalar", scalar: "i32", aliases: [] };
  return type;
}

/** One text, or `ByTarget` over the targets' texts when they differ. A
 * type alias some targets reach and others spell differently (glibc's
 * `fchmod` takes `__mode_t`) is used for all targets where it means the
 * same width. */
function merged(
  texts: ReadonlyMap<TargetName, string>,
  aliases: ReadonlyMap<string, ReadonlyMap<TargetName, string>> = new Map(),
): string {
  const values = [...new Set(texts.values())];
  if (values.length === 1) return values[0]!;
  const named = values.filter((value) => aliases.has(value));
  if (named.length === 1) {
    const alias = aliases.get(named[0]!)!;
    if (
      [...texts].every(
        ([target, text]) => text === named[0] || alias.get(target) === text,
      )
    )
      return named[0]!;
  }
  return `ByTarget<{ ${[...texts]
    .map(([target, text]) => `"${target}": ${text}`)
    .join("; ")} }>`;
}
function literal(value: number): string {
  return value < 256 ? String(value) : "0x" + value.toString(16);
}
/** A doc comment wrapped to 80 columns. */
function docComment(text: string | undefined, indent: string): string {
  if (text === undefined) return "";
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const prefix = lines.length === 0 ? "/** " : " * ";
    if (
      line !== "" &&
      indent.length + prefix.length + line.length + word.length + 4 > 80
    ) {
      lines.push(line);
      line = word;
    } else line = line === "" ? word : line + " " + word;
  }
  lines.push(line);
  return (
    lines
      .map(
        (item, position) =>
          `${indent}${position === 0 ? "/** " : " * "}${item}`,
      )
      .join("\n") + " */\n"
  );
}

export async function emitBinding(
  spec: BindingSpec,
  factsByTarget: ReadonlyMap<TargetName, TargetFacts>,
  options: EmitOptions,
): Promise<Emission> {
  const targets = options.targets ?? spec.targets;
  const facts = new Map<TargetName, TargetFacts>();
  for (const target of targets) {
    if (!spec.targets.includes(target))
      throw new SpecError(`${spec.library} does not target ${target}`);
    const item = factsByTarget.get(target);
    if (item === undefined)
      throw new Error(
        `no ${target} facts for ${spec.library}: extract them on a ${target} host`,
      );
    facts.set(target, item);
  }
  const report: string[] = [];
  const skip = (name: string, reason: string, on?: readonly TargetName[]) => {
    const where =
      on === undefined || on.length === targets.length
        ? ""
        : ` (${on.join(", ")})`;
    const line = `${name}${where}: ${reason}`;
    if (!report.includes(line)) report.push(line);
  };
  // Extraction's skips, merged across targets.
  const skippedReasons = new Map<string, Map<string, TargetName[]>>();
  for (const [target, item] of facts)
    for (const entry of item.skipped) {
      const reasons =
        skippedReasons.get(entry.name) ?? new Map<string, TargetName[]>();
      skippedReasons.set(entry.name, reasons);
      const on = reasons.get(entry.reason) ?? [];
      on.push(target);
      reasons.set(entry.reason, on);
    }
  for (const [name, reasons] of skippedReasons)
    for (const [reason, on] of reasons) skip(name, reason, on);

  // Aliases kept as `type` declarations: scalars only.
  const aliasTexts = new Map<string, Map<TargetName, string>>();
  for (const name of spec.aliases ?? []) {
    const texts = new Map<TargetName, string>();
    try {
      for (const [target, item] of facts) {
        const fact = item.aliases.find((alias) => alias.name === name);
        if (fact === undefined) throw new Skip("not extracted");
        if (fact.type.kind === "unsupported") throw new Skip(fact.type.reason);
        if (fact.type.kind !== "scalar")
          throw new Skip("only scalar typedefs become type aliases");
        texts.set(target, fact.type.scalar);
      }
      aliasTexts.set(name, texts);
    } catch (error) {
      if (!(error instanceof Skip)) throw error;
      skip("alias " + name, error.message);
    }
  }
  const aliasNames = new Set(aliasTexts.keys());

  // Records: the spec's and their by-value dependencies, present and
  // expressible on every target, with identical shapes up to member types.
  const recordSpecs = new Map(
    (spec.records ?? []).map((item) => [
      recordSpec(item).name,
      recordSpec(item),
    ]),
  );
  const order: string[] = [];
  for (const item of facts.values())
    for (const record of item.records)
      if (!order.includes(record.name)) order.push(record.name);
  const listed = [...recordSpecs.keys()];
  order.sort((a, b) => {
    const ia = listed.indexOf(a),
      ib = listed.indexOf(b);
    return (ia < 0 ? listed.length : ia) - (ib < 0 ? listed.length : ib);
  });
  for (const name of recordSpecs.keys())
    for (const [target, item] of facts)
      if (
        !item.records.some((record) => record.name === name) &&
        !item.skipped.some((entry) => entry.name === "record " + name)
      )
        skip("record " + name, "not extracted", [target]);
  let emitted = new Set(
    order.filter((name) =>
      [...facts.values()].every((item) =>
        item.records.some((record) => record.name === name),
      ),
    ),
  );
  for (const name of order)
    if (!emitted.has(name))
      skip(
        "record " + name,
        "missing on " +
          [...facts]
            .filter(
              ([, item]) =>
                !item.records.some((record) => record.name === name),
            )
            .map(([target]) => target)
            .join(", "),
      );
  const contexts = (): Map<TargetName, Context> =>
    new Map(
      [...facts].map(([target, item]) => [
        target,
        {
          target,
          facts: item,
          records: new Map(item.records.map((record) => [record.name, record])),
          emitted,
          aliases: aliasNames,
        },
      ]),
    );
  const recordTexts = new Map<string, string>();
  for (let changed = true; changed;) {
    changed = false;
    recordTexts.clear();
    const byTarget = contexts();
    for (const name of order) {
      if (!emitted.has(name)) continue;
      try {
        recordTexts.set(
          name,
          recordText(name, recordSpecs.get(name), byTarget),
        );
      } catch (error) {
        if (!(error instanceof Skip)) throw error;
        skip("record " + name, error.message);
        emitted = new Set([...emitted].filter((item) => item !== name));
        changed = true;
        break;
      }
    }
  }
  const byTarget = contexts();

  // Functions, in spec order.
  const functionTexts: string[] = [];
  const declaredFunctions: string[] = [];
  for (const item of (spec.functions ?? []).map(functionSpec)) {
    const name = exportedName(item);
    // Extraction already reported functions it could not read.
    if (skippedReasons.has("function " + item.name)) continue;
    try {
      functionTexts.push(functionText(item, byTarget));
      declaredFunctions.push(name);
    } catch (error) {
      if (!(error instanceof Skip)) throw error;
      skip("function " + name, error.message);
    }
  }
  // Availability queries.
  const availability = [...(spec.availability ?? [])];
  if (spec.optional === true)
    for (const name of declaredFunctions) {
      if (availability.some((query) => query.function === name)) continue;
      const base = name.replace(/\$/g, "_");
      availability.push({
        name: "has" + base[0]!.toUpperCase() + base.slice(1),
        function: name,
      });
    }
  for (const query of availability)
    if (!declaredFunctions.includes(query.function))
      throw new SpecError(
        `availability query ${query.name} names undeclared function ${query.function}`,
      );

  // Constants.
  const constantTexts: string[] = [];
  for (const name of spec.constants ?? []) {
    const texts = new Map<TargetName, string>();
    try {
      for (const [target, item] of facts) {
        const fact = item.constants.find((constant) => constant.name === name);
        if (fact === undefined)
          throw new Skip(`not an integer constant on ${target}`);
        const value = BigInt(fact.value);
        if (value < 0n)
          throw new Skip(
            `is negative on ${target} (${fact.value}); constants are non-negative literals`,
          );
        if (value > BigInt(Number.MAX_SAFE_INTEGER))
          throw new Skip(`exceeds 2^53 on ${target} (${fact.value})`);
        texts.set(target, literal(Number(value)));
      }
      constantTexts.push(`  export const ${name}: ${merged(texts)};\n`);
    } catch (error) {
      if (!(error instanceof Skip)) throw error;
      if (!report.some((line) => line.startsWith("constant " + name)))
        skip("constant " + name, error.message);
    }
  }

  const body: string[] = [];
  for (const [name, texts] of aliasTexts)
    body.push(`  type ${name} = ${merged(texts)};\n`);
  body.push(...constantTexts);
  for (const name of order) {
    const text = recordTexts.get(name);
    if (text !== undefined) body.push(text);
  }
  body.push(...functionTexts);
  for (const query of availability)
    body.push(
      `  export function ${query.name}(): Available<"${query.function}">;\n`,
    );
  const bodyText = body.join("");
  const used = ffiNames.filter((name) =>
    new RegExp(`\\b${name}\\b`).test(bodyText),
  );
  const clangs = [...facts]
    .map(([target, item]) => `${item.clang} (${target})`)
    .join(", ");
  const header =
    `// Generated by tools/c-bindgen.ts from ${options.specPath}; do not edit.\n` +
    `// clang: ${clangs}.\n` +
    (report.length === 0
      ? ""
      : `// Not bound:\n${report.map((line) => `//   ${line}\n`).join("")}`);
  const summary = spec.summary.map((line) => `  // ${line}\n`).join("");
  const text =
    header +
    `declare module "tint:c/${spec.library}" {\n` +
    summary +
    (used.length === 0
      ? ""
      : `  import type { ${used.join(", ")} } from "tint:ffi";\n`) +
    bodyText +
    "}\n";
  const formatted = await format(text, { parser: "typescript" });
  verifyEmission(spec, formatted, facts);
  return { text: formatted, report };

  function recordText(
    name: string,
    item:
      | {
          readonly opaque?: readonly string[];
          readonly layout?: boolean;
          readonly doc?: string;
        }
      | undefined,
    contexts: ReadonlyMap<TargetName, Context>,
  ): string {
    const opaque = new Set(item?.opaque ?? []);
    const shapes = new Set<string>();
    let first: RecordFact | undefined;
    for (const context of contexts.values()) {
      const record = context.records.get(name)!;
      first ??= record;
      shapes.add(
        JSON.stringify([
          record.union,
          record.packed,
          record.alignment,
          record.fields.map((field) => field.name),
        ]),
      );
    }
    if (first === undefined) throw new Skip("no facts");
    if (shapes.size !== 1)
      throw new Skip(
        "differs between targets beyond member types (members, packing or alignment): bind it in per-target specs",
      );
    for (const member of opaque)
      if (!first.fields.some((field) => field.name === member))
        throw new SpecError(`record ${name} has no member ${member}`);
    const bases: string[] = [];
    if (first.union) bases.push("Union");
    if (first.packed) bases.push("Packed");
    const alignments = new Map<TargetName, string>();
    for (const [target, context] of contexts) {
      const record = context.records.get(name)!;
      if (record.alignment > 0)
        alignments.set(target, String(record.alignment));
    }
    if (alignments.size > 0) bases.push(`Aligned<${merged(alignments)}>`);
    const lines: string[] = [];
    for (const [position, field] of first.fields.entries()) {
      const texts = new Map<TargetName, string>();
      for (const [target, context] of contexts) {
        const fact = context.records.get(name)!.fields[position]!;
        try {
          texts.set(
            target,
            memberText(fact.type, context, opaque.has(field.name)),
          );
        } catch (error) {
          if (error instanceof Skip)
            throw new Skip(`member ${field.name} ${error.message}`);
          throw error;
        }
      }
      lines.push(`    ${field.name}: ${merged(texts, aliasTexts)};\n`);
    }
    return (
      docComment(item?.doc, "  ") +
      `  export interface ${name}${bases.length === 0 ? "" : " extends " + bases.join(", ")} {\n` +
      lines.join("") +
      "  }\n" +
      (item === undefined || item.layout !== false
        ? `  export const ${name}: Layout<${name}>;\n`
        : "")
    );
  }

  function functionText(
    item: FunctionSpec,
    contexts: ReadonlyMap<TargetName, Context>,
  ): string {
    const name = exportedName(item);
    const parameterNames = new Map<number, string>();
    const parameterTexts: Map<TargetName, string>[] = [];
    const variadicTexts: Map<TargetName, string>[] = [];
    const resultTexts = new Map<TargetName, string>();
    let count = -1;
    for (const [target, context] of contexts) {
      const fact = context.facts.functions.find((fn) => fn.name === item.name);
      if (fact === undefined) throw new Skip(`not extracted on ${target}`);
      if (count >= 0 && fact.parameters.length !== count)
        throw new Skip("takes different parameters on different targets");
      count = fact.parameters.length;
      if (fact.variadic && item.variadic === undefined)
        throw new Skip(
          "is variadic: give each call shape's argument types in `variadic` (one spec entry per shape, `variant` names them)",
        );
      if (!fact.variadic && item.variadic !== undefined)
        throw new SpecError(`${item.name} is not variadic`);
      const choices = item.parameters ?? {};
      for (const key of Object.keys(choices))
        if (
          !(/^\d+$/.test(key) && Number(key) < fact.parameters.length) &&
          !fact.parameters.some((parameter) => parameter.name === key)
        )
          throw new SpecError(`${item.name} has no parameter ${key}`);
      for (const [position, parameter] of fact.parameters.entries()) {
        const raw = choices[String(position)] ?? choices[parameter.name];
        const choice: ParameterSpec =
          raw === undefined ? {} : typeof raw === "string" ? { as: raw } : raw;
        if (!parameterNames.has(position))
          parameterNames.set(
            position,
            choice.name ?? identifier(parameter.name, position),
          );
        const texts = (parameterTexts[position] ??= new Map());
        texts.set(
          target,
          parameterText(
            parameter.type,
            choice,
            context,
            `parameter ${parameter.name}`,
          ),
        );
      }
      for (const [position, spelling] of (item.variadic ?? []).entries()) {
        const named = context.facts.types.find(
          (type) => type.name === spelling,
        );
        if (named === undefined)
          throw new Skip(`variadic type ${spelling} was not extracted`);
        const type = promoted(named.type);
        if (type.kind !== "scalar" && type.kind !== "pointer")
          throw new Skip(
            `variadic argument type ${spelling} has no binding type`,
          );
        const texts = (variadicTexts[position] ??= new Map());
        texts.set(
          target,
          `Variadic<${parameterText(type, {}, context, "variadic " + spelling)}>`,
        );
      }
      const rawResult = item.result;
      const resultChoice: ResultSpec =
        rawResult === undefined
          ? {}
          : rawResult === "OrErrno"
            ? { errno: true }
            : rawResult === "void"
              ? { discard: true }
              : rawResult;
      resultTexts.set(
        target,
        resultText(fact.result, resultChoice, context, "the result"),
      );
    }
    const seen = new Set<string>();
    for (const [position, parameter] of parameterNames) {
      if (seen.has(parameter)) {
        if (
          Object.values(item.parameters ?? {}).some(
            (choice) => typeof choice !== "string" && choice.name === parameter,
          )
        )
          throw new SpecError(`${item.name} names two parameters ${parameter}`);
        parameterNames.set(position, `arg${position}`);
      }
      seen.add(parameterNames.get(position)!);
    }
    const parameters = parameterTexts.map(
      (texts, position) =>
        `${parameterNames.get(position)}: ${merged(texts, aliasTexts)}`,
    );
    for (const [position, texts] of variadicTexts.entries())
      parameters.push(`${"variadic" + position}: ${merged(texts, aliasTexts)}`);
    let result = merged(resultTexts, aliasTexts);
    if (item.callClass === "may-callback") result = `MayCallback<${result}>`;
    if (item.callClass === "async") result = `Async<${result}>`;
    return (
      docComment(item.doc, "  ") +
      `  export function ${name}(${parameters.join(", ")}): ${result};\n`
    );
  }
}
/** A header parameter name usable in TypeScript, without the reserved
 * `__` prefix system headers use. */
function identifier(name: string, position: number): string {
  const plain = name.replace(/^_+/, "");
  return /^[A-Za-z$][\w$]*$/.test(plain) && !reserved.has(plain)
    ? plain
    : `arg${position}`;
}
const reserved = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "let",
  "static",
  "yield",
  "await",
  "interface",
  "package",
  "private",
  "protected",
  "public",
]);

/** The emitted module, read back by the compiler's declaration parser for
 * every target: it must parse, and each record's layout must be clang's. */
export function verifyEmission(
  spec: BindingSpec,
  text: string,
  facts: ReadonlyMap<TargetName, TargetFacts>,
): void {
  for (const [target, item] of facts) {
    const parsed = parseForeignDeclarations(text, cTargetOf(target));
    if (!parsed.ok)
      throw new Error(
        `generated tint:c/${spec.library} does not parse for ${target}: ${parsed.error.message} at ${text.slice(parsed.error.offset, parsed.error.offset + 60)}`,
      );
    for (const record of parsed.value.records) {
      const fact = item.records.find(
        (candidate) => candidate.name === record.name,
      );
      if (fact === undefined)
        throw new Error(
          `generated record ${record.name} has no ${target} facts`,
        );
      const layout = cLayout(record.type, cTargetOf(target));
      if (!layout.ok)
        throw new Error(`generated record ${record.name}: ${layout.error}`);
      const ours = [
        layout.value.size,
        layout.value.alignment,
        ...layout.value.offsets,
      ].join(" ");
      const clangs = [
        fact.size,
        fact.align,
        ...fact.fields.map((field) => field.offset),
      ].join(" ");
      if (ours !== clangs)
        throw new Error(
          `generated record ${record.name} lays out as ${ours} on ${target}, clang as ${clangs}`,
        );
    }
  }
}
