// Extraction (docs/native-ffi.md, "Binding generator"): clang reads a spec's
// headers for the host's target and reports the selected declarations as
// facts. Types come from clang's JSON AST; every record layout and constant
// value comes from a probe program clang compiles and the host runs, and a
// record is kept only when the declaration syntax reproduces clang's layout
// exactly. Clang is a dev-time generator and test oracle here, never part
// of a Tint build.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CScalar } from "@tint/abi/c";
import {
  layoutDisagreement,
  type ConstantFact,
  type FieldFact,
  type FunctionFact,
  type NamedTypeFact,
  type RecordFact,
  type SkippedFact,
  type TargetFacts,
  type TypeFact,
} from "./facts.ts";
import {
  cTargetOf,
  functionSpec,
  headersFor,
  recordSpec,
  type BindingSpec,
  type TargetName,
} from "./spec.ts";

/** One node of clang's JSON AST (the fields extraction reads). */
interface AstNode {
  readonly id: string;
  readonly kind: string;
  readonly name?: string;
  readonly tagUsed?: string;
  readonly completeDefinition?: boolean;
  readonly isImplicit?: boolean;
  readonly isBitfield?: boolean;
  readonly inline?: boolean;
  readonly storageClass?: string;
  readonly mangledName?: string;
  readonly variadic?: boolean;
  readonly type?: { readonly qualType: string };
  readonly ownedTagDecl?: { readonly id: string; readonly kind: string };
  readonly decl?: { readonly id: string; readonly kind: string };
  readonly inner?: readonly AstNode[];
}

/** The target the host runs (extraction runs its probe there). */
export function hostTarget(): TargetName | undefined {
  if (process.arch !== "arm64") return undefined;
  return process.platform === "darwin"
    ? "darwin-arm64"
    : process.platform === "linux"
      ? "linux-arm64"
      : undefined;
}
export function clangCommand(): string {
  return process.env.CLANG ?? "clang";
}
/** `clang --version`'s first line without its parenthesized build
 * details: "Apple clang version 17.0.0", "Debian clang version 19.1.7". */
export function clangVersion(): string {
  const result = spawnSync(clangCommand(), ["--version"], { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error("clang is not available: " + (result.stderr ?? ""));
  const line = result.stdout.split("\n")[0] ?? "";
  return line.replace(/\s*\([^)]*\)/g, "").trim();
}

const qualifierWords = new Set([
  "const",
  "volatile",
  "restrict",
  "__restrict",
  "_Nullable",
  "_Nonnull",
  "_Null_unspecified",
  "__unaligned",
]);
const builtinWords = new Set([
  "unsigned",
  "signed",
  "short",
  "long",
  "int",
  "char",
  "_Bool",
  "bool",
  "float",
  "double",
  "void",
  "__int128",
  "_Float16",
  "__fp16",
  "__bf16",
  "_Complex",
  "_Atomic",
]);
const vaListNames = new Set([
  "va_list",
  "__builtin_va_list",
  "__gnuc_va_list",
  "__darwin_va_list",
  "__va_list",
]);
/** Typedefs that name the pointer-sized integers. */
const pointerSizedNames: ReadonlyMap<string, CScalar> = new Map([
  ["size_t", "usize"],
  ["uintptr_t", "usize"],
  ["ssize_t", "isize"],
  ["intptr_t", "isize"],
  ["ptrdiff_t", "isize"],
]);
const anonymousMarker = /(?:[A-Za-z_]\w*::)?\((?:unnamed|anonymous)[^()]*\)/g;
const anonymousType = /\((?:unnamed|anonymous)\b/;

function builtinScalar(words: readonly string[]): TypeFact {
  const count = (word: string) => words.filter((item) => item === word).length;
  const text = words.join(" ");
  if (
    count("_Complex") > 0 ||
    count("_Atomic") > 0 ||
    count("__int128") > 0 ||
    count("_Float16") > 0 ||
    count("__fp16") > 0 ||
    count("__bf16") > 0
  )
    return unsupported(`${text} has no binding type`);
  if (count("void") > 0) return { kind: "void" };
  if (count("_Bool") > 0 || count("bool") > 0) return scalar("bool");
  if (count("float") > 0) return scalar("f32");
  if (count("double") > 0)
    return count("long") > 0
      ? unsupported("long double has no binding type")
      : scalar("f64");
  const unsigned = count("unsigned") > 0;
  if (count("char") > 0)
    return count("unsigned") > 0
      ? scalar("u8")
      : count("signed") > 0
        ? scalar("i8")
        : scalar("char");
  if (count("short") > 0) return scalar(unsigned ? "u16" : "i16");
  if (count("long") > 0) return scalar(unsigned ? "u64" : "i64");
  return scalar(unsigned ? "u32" : "i32");
}
function scalar(name: CScalar, aliases: readonly string[] = []): TypeFact {
  return { kind: "scalar", scalar: name, aliases };
}
function unsupported(reason: string): TypeFact {
  return { kind: "unsupported", reason };
}

/** clang's view of one target's headers: its declarations, indexed. */
class HeaderIndex {
  readonly typedefs = new Map<string, AstNode>();
  readonly functions = new Map<string, AstNode>();
  readonly nodes = new Map<string, AstNode>();
  /** Tag name to the record with its definition (else a declaration). */
  readonly tags = new Map<string, AstNode>();
  readonly enumTags = new Map<string, AstNode>();
  /** Record id to the typedef naming it (for anonymous typedef'd records). */
  readonly typedefOf = new Map<string, string>();
  /** Record id to its enclosing record and the field declared with it, for
   * anonymous member records (`union { ... } ifa_ifu;`). */
  readonly anonymousOwner = new Map<
    string,
    { readonly parent: string; readonly field: string; readonly depth: number }
  >();
  constructor(root: AstNode) {
    for (const node of root.inner ?? []) {
      if (node.kind === "TypedefDecl" && node.name !== undefined) {
        this.typedefs.set(node.name, node);
        const record = typedefRecord(node);
        if (record !== undefined && !this.typedefOf.has(record))
          this.typedefOf.set(record, node.name);
      } else if (
        node.kind === "FunctionDecl" &&
        node.name !== undefined &&
        node.isImplicit !== true
      )
        this.functions.set(node.name, node);
    }
    this.visit(root);
  }
  private visit(node: AstNode): void {
    this.nodes.set(node.id, node);
    if (
      node.kind === "RecordDecl" &&
      node.name !== undefined &&
      node.name !== ""
    ) {
      const known = this.tags.get(node.name);
      if (known === undefined || node.completeDefinition === true)
        this.tags.set(node.name, node);
    }
    if (node.kind === "EnumDecl" && node.name !== undefined && node.name !== "")
      this.enumTags.set(node.name, node);
    const inner = node.inner ?? [];
    for (let index = 0; index < inner.length; index++) {
      const child = inner[index]!;
      if (
        node.kind === "RecordDecl" &&
        child.kind === "FieldDecl" &&
        child.name !== undefined &&
        child.type !== undefined &&
        anonymousType.test(child.type.qualType)
      ) {
        for (let back = index - 1; back >= 0; back--) {
          const candidate = inner[back]!;
          if (
            candidate.kind === "RecordDecl" &&
            (candidate.name === undefined || candidate.name === "")
          ) {
            if (!this.anonymousOwner.has(candidate.id))
              this.anonymousOwner.set(candidate.id, {
                parent: node.id,
                field: child.name,
                depth: (child.type.qualType.match(/\[/g) ?? []).length,
              });
            break;
          }
        }
      }
      this.visit(child);
    }
  }
}
/** The record a typedef names directly (`typedef struct {...} T`). */
function typedefRecord(node: AstNode): string | undefined {
  let type = node.inner?.[0];
  while (type !== undefined) {
    if (type.kind === "RecordType" && type.decl !== undefined)
      return type.decl.id;
    if (type.kind === "ElaboratedType") {
      if (
        type.ownedTagDecl !== undefined &&
        type.ownedTagDecl.kind === "RecordDecl"
      )
        return type.ownedTagDecl.id;
      type = type.inner?.[0];
      continue;
    }
    return undefined;
  }
  return undefined;
}

interface PendingRecord {
  readonly name: string;
  readonly c: string;
  readonly node: AstNode;
}

/** Extracts `spec`'s facts on the host (which must run `target`). */
export function extractFacts(
  spec: BindingSpec,
  target: TargetName,
): TargetFacts {
  if (hostTarget() !== target)
    throw new Error(
      `facts for ${target} are extracted on a ${target} host (this host runs ${hostTarget() ?? "an unsupported target"})`,
    );
  const directory = mkdtempSync(join(tmpdir(), "tint-c-bindgen-"));
  try {
    return extractIn(spec, target, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The spec's headers and prelude as one source. The prelude is C; for a
 * C++ consumer (the prototype oracle) it keeps C linkage and spelling. */
export function headerText(
  spec: BindingSpec,
  target: TargetName,
  language: "c" | "c++" = "c",
): string {
  const prelude = spec.prelude ?? "";
  return (
    headersFor(spec, target)
      .map((header) => `#include <${header}>`)
      .join("\n") +
    "\n" +
    (language === "c++"
      ? `#define _Bool bool\nextern "C" {\n${prelude}\n}\n#undef _Bool`
      : prelude) +
    "\n"
  );
}
export function clangArguments(spec: BindingSpec): string[] {
  return (spec.defines ?? []).map((define) => "-D" + define);
}
/** clang's first diagnostic without its file location. */
function firstError(stderr: string): string {
  const line =
    stderr.split("\n").find((item) => item.includes("error:")) ?? stderr;
  return line.replace(/^.*?error:\s*/, "").trim();
}

function extractIn(
  spec: BindingSpec,
  target: TargetName,
  directory: string,
): TargetFacts {
  const header = join(directory, "bindings.h");
  writeFileSync(header, headerText(spec, target));
  const dumped = spawnSync(
    clangCommand(),
    [
      ...clangArguments(spec),
      "-x",
      "c",
      // Library builtins (strlen, memcpy) would otherwise take clang's
      // predeclared types, losing the header's size_t.
      "-fno-builtin",
      "-fsyntax-only",
      "-Xclang",
      "-ast-dump=json",
      header,
    ],
    { encoding: "utf8", maxBuffer: 1 << 30 },
  );
  if (dumped.status !== 0)
    throw new Error(
      `clang could not read ${spec.library}'s headers:\n${dumped.stderr}`,
    );
  const index = new HeaderIndex(JSON.parse(dumped.stdout) as AstNode);
  const skipped: SkippedFact[] = [];
  const recordNames = new Map<string, string>();
  const pending = new Map<string, PendingRecord>();
  const order: string[] = [];
  const enums = new Map<string, string>();

  function recordNode(name: string): AstNode | undefined {
    const typedef = index.typedefs.get(name);
    if (typedef !== undefined) {
      const id = typedefRecord(typedef);
      if (id !== undefined) return index.nodes.get(id);
    }
    return index.tags.get(name);
  }
  function spelling(node: AstNode): string {
    if (node.name !== undefined && node.name !== "")
      return `${node.tagUsed ?? "struct"} ${node.name}`;
    const typedef = index.typedefOf.get(node.id);
    if (typedef !== undefined) return typedef;
    const owner = index.anonymousOwner.get(node.id);
    const parent =
      owner === undefined ? undefined : index.nodes.get(owner.parent);
    if (owner === undefined || parent === undefined)
      throw new Error("anonymous record without an owner");
    return `__typeof__(((${spelling(parent)} *)0)->${owner.field}${"[0]".repeat(owner.depth)})`;
  }
  /** The emitted name of record `node`: claimed by the spec, else its tag,
   * typedef or `<parent>_<member>` for anonymous member records. */
  function recordName(node: AstNode): string {
    const claimed = recordNames.get(node.id);
    if (claimed !== undefined) return claimed;
    let name: string | undefined;
    if (node.name !== undefined && node.name !== "") name = node.name;
    else name = index.typedefOf.get(node.id);
    if (name === undefined) {
      const owner = index.anonymousOwner.get(node.id);
      const parent =
        owner === undefined ? undefined : index.nodes.get(owner.parent);
      name =
        owner === undefined || parent === undefined
          ? ""
          : recordName(parent) + "_" + owner.field;
    }
    if (name !== "") recordNames.set(node.id, name);
    return name;
  }

  function parseType(text: string, anonymous: AstNode | undefined): TypeFact {
    const marked = text.replace(anonymousMarker, " @anon ");
    if (marked.includes("__attribute__"))
      return unsupported(`attributed type ${text}`);
    const open = marked.indexOf("(");
    if (open >= 0) return declaratorType(marked, open, anonymous, text);
    const tokens =
      marked.match(/@anon|\.\.\.|[A-Za-z_]\w*|\d+|[*[\](),]/g) ?? [];
    let position = 0;
    const words: string[] = [];
    let baseConst = false;
    while (position < tokens.length) {
      const token = tokens[position]!;
      if (!/^[A-Za-z_@]/.test(token)) break;
      if (token === "const") baseConst = true;
      if (!qualifierWords.has(token)) words.push(token);
      position++;
    }
    let base = baseType(words, anonymous, text);
    // Pointer levels, each with the qualifiers written after its star.
    const levelConst: boolean[] = [baseConst];
    while (tokens[position] === "*") {
      position++;
      let isConst = false;
      while (
        position < tokens.length &&
        qualifierWords.has(tokens[position]!)
      ) {
        if (tokens[position] === "const") isConst = true;
        position++;
      }
      base = {
        kind: "pointer",
        pointee: base,
        constPointee: levelConst[levelConst.length - 1]!,
      };
      levelConst.push(isConst);
    }
    const lengths: number[] = [];
    while (tokens[position] === "[") {
      const length = tokens[position + 1];
      if (length === "]") return unsupported(`flexible array ${text}`);
      if (
        length === undefined ||
        !/^\d+$/.test(length) ||
        tokens[position + 2] !== "]"
      )
        return unsupported(`array ${text}`);
      lengths.push(Number(length));
      position += 3;
    }
    if (position !== tokens.length) return unsupported(`C type ${text}`);
    for (let level = lengths.length - 1; level >= 0; level--) {
      const length = lengths[level]!;
      if (length === 0) return unsupported(`zero-length array ${text}`);
      base = { kind: "array", element: base, length };
    }
    return base;
  }
  /** A type spelled with parentheses: a function type `R (P, ...)`, or
   * pointers to one `R (*)(P, ...)`; `open` is the first parenthesis. */
  function declaratorType(
    marked: string,
    open: number,
    anonymous: AstNode | undefined,
    text: string,
  ): TypeFact {
    const prefix = marked.slice(0, open).trim();
    const rest = marked.slice(open);
    const pointers =
      /^\(\s*((?:\*\s*(?:const|volatile|restrict|__restrict|_Nullable|_Nonnull|_Null_unspecified)?\s*)+)\)\s*(.*)$/s.exec(
        rest,
      );
    if (pointers !== null) {
      const stars = (pointers[1]!.match(/\*/g) ?? []).length;
      const tail = pointers[2]!;
      if (!tail.startsWith("(")) return unsupported(`pointer to array ${text}`);
      let type = declaratorType(
        prefix + " " + tail,
        prefix.length + 1,
        anonymous,
        text,
      );
      for (let level = 0; level < stars; level++)
        type = { kind: "pointer", pointee: type, constPointee: false };
      return type;
    }
    // A function returning a function pointer: `R (*(P, ...))(Q, ...)`.
    const returning = /^\(\s*\*\s*(\(.*\))\s*\)\s*(\(.*\))$/s.exec(rest);
    if (returning !== null) {
      const parameters = declaratorType(
        `int ${returning[1]!}`,
        4,
        anonymous,
        text,
      );
      if (parameters.kind !== "function") return parameters;
      return {
        ...parameters,
        result: parseType(`${prefix} (*)${returning[2]!}`, anonymous),
      };
    }
    // A function type: the parameter list closes the spelling.
    let depth = 0,
      close = -1;
    for (let position = 0; position < rest.length; position++) {
      if (rest[position] === "(") depth++;
      else if (rest[position] === ")" && --depth === 0) {
        close = position;
        break;
      }
    }
    if (close !== rest.length - 1 || prefix.includes("("))
      return unsupported(`C type ${text}`);
    const parameters: TypeFact[] = [];
    let variadic = false;
    const inner = rest.slice(1, close).trim();
    if (inner !== "" && inner !== "void")
      for (const item of splitParameters(inner)) {
        if (item === "...") variadic = true;
        else parameters.push(parseType(item, anonymous));
      }
    return {
      kind: "function",
      parameters,
      result: parseType(prefix, anonymous),
      variadic,
    };
  }
  function baseType(
    words: readonly string[],
    anonymous: AstNode | undefined,
    text: string,
  ): TypeFact {
    const first = words[0];
    if (first === undefined) return unsupported(`C type ${text}`);
    if (first === "struct" || first === "union") {
      const tag = words[1];
      const node =
        tag === "@anon"
          ? anonymous
          : tag === undefined
            ? undefined
            : index.tags.get(tag);
      if (node === undefined) return unsupported(`record ${text}`);
      return { kind: "record", name: recordName(node) };
    }
    if (first === "enum") {
      const tag = words[1];
      if (tag === undefined || tag === "@anon")
        return unsupported(`enum ${text}`);
      return enumType(`enum ${tag}`, []);
    }
    if (words.every((word) => builtinWords.has(word)))
      return builtinScalar(words);
    if (words.length !== 1) return unsupported(`C type ${text}`);
    return typedefType(first);
  }
  function enumType(c: string, aliases: readonly string[]): TypeFact {
    const placeholder = "enum:" + c;
    enums.set(c, placeholder);
    return {
      kind: "scalar",
      scalar: "i32",
      aliases: [placeholder, ...aliases],
    };
  }
  function typedefType(name: string): TypeFact {
    if (vaListNames.has(name)) return unsupported("va_list");
    const typedef = index.typedefs.get(name);
    if (typedef === undefined || typedef.type === undefined)
      return unsupported(`unknown type ${name}`);
    const recordId = typedefRecord(typedef);
    if (recordId !== undefined) {
      const node = index.nodes.get(recordId);
      if (node === undefined) return unsupported(`record ${name}`);
      return { kind: "record", name: recordName(node) };
    }
    const target = typedef.type.qualType;
    if (
      /^enum\b/.test(target) &&
      !target.includes("*") &&
      !target.includes("[")
    )
      return enumType(name, [name]);
    const resolved = parseType(target, undefined);
    if (resolved.kind === "function" && resolved.name === undefined)
      return { ...resolved, name };
    if (
      resolved.kind === "pointer" &&
      resolved.pointee.kind === "function" &&
      resolved.pointee.name === undefined
    )
      return { ...resolved, pointee: { ...resolved.pointee, name } };
    if (resolved.kind !== "scalar") return resolved;
    const sized = pointerSizedNames.get(name);
    return scalar(sized ?? resolved.scalar, [name, ...resolved.aliases]);
  }

  // Records: the spec's, then every record they hold by value.
  for (const item of spec.records ?? []) {
    const { name } = recordSpec(item);
    const node = recordNode(name);
    if (node === undefined) {
      skipped.push({
        name: "record " + name,
        reason: "not declared by the headers",
      });
      continue;
    }
    if (recordNames.has(node.id) && recordNames.get(node.id) !== name)
      throw new Error(
        `records ${recordNames.get(node.id)} and ${name} are one C record`,
      );
    recordNames.set(node.id, name);
  }
  const fieldsOf = new Map<string, FieldFact[]>();
  const recordSkip = new Map<string, string>();
  function collect(node: AstNode): void {
    const name = recordName(node);
    if (pending.has(name) || recordSkip.has(name)) return;
    if (node.completeDefinition !== true) {
      recordSkip.set(name, "an incomplete (opaque) record has no layout");
      return;
    }
    pending.set(name, { name, c: spelling(node), node });
    order.push(name);
    const fields: FieldFact[] = [];
    const inner = node.inner ?? [];
    let reason: string | undefined;
    for (let position = 0; position < inner.length; position++) {
      const child = inner[position]!;
      if (child.kind !== "FieldDecl") continue;
      if (child.name === undefined || child.name === "") {
        reason = "an anonymous member (C11) has no member name";
        break;
      }
      if (child.isBitfield === true) {
        reason = `member ${child.name} is a bitfield`;
        break;
      }
      let anonymous: AstNode | undefined;
      for (let back = position - 1; back >= 0; back--) {
        const candidate = inner[back]!;
        if (
          candidate.kind === "RecordDecl" &&
          (candidate.name === undefined || candidate.name === "")
        ) {
          anonymous = candidate;
          break;
        }
      }
      const type = parseType(child.type?.qualType ?? "", anonymous);
      const problem = memberProblem(type);
      if (problem !== undefined) {
        reason = `member ${child.name}: ${problem}`;
        break;
      }
      fields.push({ name: child.name, type, offset: -1 });
      for (const dependency of byValueRecords(type)) {
        const dependencyNode = nodeOfRecord(dependency);
        if (dependencyNode !== undefined) collect(dependencyNode);
        const dependencySkip = recordSkip.get(dependency);
        if (dependencySkip !== undefined) {
          reason = `member ${child.name}: record ${dependency}: ${dependencySkip}`;
          break;
        }
      }
      if (reason !== undefined) break;
    }
    if (reason === undefined && fields.length === 0)
      reason = "an empty record has no C layout";
    if (reason !== undefined) {
      recordSkip.set(name, reason);
      pending.delete(name);
      order.splice(order.indexOf(name), 1);
      return;
    }
    fieldsOf.set(name, fields);
  }
  function nodeOfRecord(name: string): AstNode | undefined {
    for (const [id, claimed] of recordNames)
      if (claimed === name) return index.nodes.get(id);
    return undefined;
  }
  for (const item of spec.records ?? []) {
    const { name } = recordSpec(item);
    const node = nodeOfRecord(name);
    if (node !== undefined) collect(node);
  }

  // Functions.
  const functions: FunctionFact[] = [];
  const seenFunctions = new Set<string>();
  for (const item of spec.functions ?? []) {
    const { name } = functionSpec(item);
    if (seenFunctions.has(name)) continue;
    seenFunctions.add(name);
    const node = index.functions.get(name);
    if (node === undefined || node.type === undefined) {
      skipped.push({
        name: "function " + name,
        reason: "not declared by the headers",
      });
      continue;
    }
    if (node.storageClass === "static" || node.inline === true) {
      skipped.push({
        name: "function " + name,
        reason: "a static or inline header function has no symbol to bind",
      });
      continue;
    }
    const symbol = (node.mangledName ?? name).replace(
      target === "darwin-arm64" ? /^_/ : /^$/,
      "",
    );
    if (symbol !== name) {
      skipped.push({
        name: "function " + name,
        reason: `the header binds it to symbol ${symbol} (asm label)`,
      });
      continue;
    }
    const parameters = (node.inner ?? [])
      .filter((child) => child.kind === "ParmVarDecl")
      .map((child, position) => ({
        name: child.name ?? `arg${position}`,
        type: parseType(child.type?.qualType ?? "", undefined),
      }));
    functions.push({
      name,
      parameters,
      result: resultType(node.type.qualType),
      variadic: node.variadic === true,
    });
  }
  function resultType(text: string): TypeFact {
    const type = parseType(text, undefined);
    return type.kind === "function" ? type.result : type;
  }

  const aliases: NamedTypeFact[] = [];
  for (const name of spec.aliases ?? [])
    aliases.push({ name, type: typedefOrBuiltin(name) });
  const types: NamedTypeFact[] = [];
  const typeNames = new Set<string>();
  for (const item of spec.functions ?? [])
    for (const name of functionSpec(item).variadic ?? [])
      if (!typeNames.has(name)) {
        typeNames.add(name);
        types.push({ name, type: parseType(name, undefined) });
      }
  function typedefOrBuiltin(name: string): TypeFact {
    return index.typedefs.has(name)
      ? typedefType(name)
      : unsupported(`typedef ${name} is not declared by the headers`);
  }

  // Constants: each must be an integer constant expression.
  const constantNames = [...new Set(spec.constants ?? [])];
  const checked = checkConstants(spec, directory, header, constantNames);
  for (const [name, reason] of checked.rejected)
    skipped.push({ name: "constant " + name, reason });

  // The probe: layouts, enum widths and constant values, from clang.
  const probe = runProbe(
    spec,
    directory,
    header,
    order.map((name) => pending.get(name)!),
    fieldsOf,
    [...enums.keys()].sort(),
    checked.accepted,
  );
  const enumScalars = new Map<string, CScalar>();
  for (const [c, width] of probe.enums) {
    const value = enumScalar(width.size, width.signed);
    if (value !== undefined) enumScalars.set("enum:" + c, value);
  }
  const resolveEnums = (type: TypeFact): TypeFact =>
    substituteEnums(type, enumScalars);
  const records: RecordFact[] = [];
  for (const name of order) {
    const record = pending.get(name)!;
    const layout = probe.records.get(name);
    if (layout === undefined) throw new Error("probe missed record " + name);
    const fields = fieldsOf.get(name)!.map((field, position) => ({
      name: field.name,
      type: resolveEnums(field.type),
      offset: layout.offsets[position]!,
    }));
    const packed = (record.node.inner ?? []).some(
      (child) => child.kind === "PackedAttr",
    );
    const aligned = (record.node.inner ?? []).some(
      (child) => child.kind === "AlignedAttr",
    );
    records.push({
      name,
      c: record.c,
      union: record.node.tagUsed === "union",
      packed,
      alignment: aligned ? layout.align : 0,
      size: layout.size,
      align: layout.align,
      fields,
    });
  }
  // Keep a record only when the declaration syntax reproduces clang's
  // layout; drop records that hold a dropped one by value.
  const kept = new Map(records.map((record) => [record.name, record]));
  const cTarget = cTargetOf(target);
  for (let changed = true; changed;) {
    changed = false;
    for (const record of [...kept.values()]) {
      let reason = layoutDisagreement(record, kept, cTarget);
      for (const field of record.fields)
        for (const dependency of byValueRecords(field.type))
          if (!kept.has(dependency))
            reason ??= `member ${field.name}: record ${dependency} has no confirmed layout`;
      if (reason !== undefined) {
        kept.delete(record.name);
        recordSkip.set(record.name, reason);
        changed = true;
      }
    }
  }
  for (const item of spec.records ?? []) {
    const { name } = recordSpec(item);
    const reason = recordSkip.get(name);
    if (reason !== undefined) skipped.push({ name: "record " + name, reason });
  }
  for (const [name, reason] of [...recordSkip].sort(([a], [b]) =>
    a < b ? -1 : 1,
  ))
    if (!skipped.some((item) => item.name === "record " + name))
      skipped.push({ name: "record " + name, reason });
  return {
    spec: spec.library,
    target,
    clang: clangVersion(),
    aliases: aliases.map((item) => ({
      name: item.name,
      type: resolveEnums(item.type),
    })),
    types: types.map((item) => ({
      name: item.name,
      type: resolveEnums(item.type),
    })),
    records: records.filter((record) => kept.has(record.name)),
    functions: functions.map((item) => ({
      name: item.name,
      parameters: item.parameters.map((parameter) => ({
        name: parameter.name,
        type: resolveEnums(parameter.type),
      })),
      result: resolveEnums(item.result),
      variadic: item.variadic,
    })),
    constants: checked.accepted.map((name) => ({
      name,
      value: probe.constants.get(name)!,
    })) satisfies ConstantFact[],
    skipped,
  };
}

/** A parameter list's items, split at top-level commas. */
function splitParameters(text: string): string[] {
  const items: string[] = [];
  let depth = 0,
    start = 0;
  for (let position = 0; position < text.length; position++) {
    const character = text[position];
    if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") depth--;
    else if (character === "," && depth === 0) {
      items.push(text.slice(start, position).trim());
      start = position + 1;
    }
  }
  items.push(text.slice(start).trim());
  return items;
}
/** Why a member type cannot be declared, if it cannot. */
function memberProblem(type: TypeFact): string | undefined {
  switch (type.kind) {
    case "unsupported":
      return type.reason;
    case "void":
      return "void member";
    case "function":
      return "a function member";
    case "array":
      return memberProblem(type.element);
    default:
      return undefined;
  }
}
/** Records `type` contains by value (members, array elements). */
export function byValueRecords(type: TypeFact): string[] {
  if (type.kind === "record") return [type.name];
  if (type.kind === "array") return byValueRecords(type.element);
  return [];
}
function enumScalar(size: number, signed: boolean): CScalar | undefined {
  switch (size) {
    case 1:
      return signed ? "i8" : "u8";
    case 2:
      return signed ? "i16" : "u16";
    case 4:
      return signed ? "i32" : "u32";
    case 8:
      return signed ? "i64" : "u64";
    default:
      return undefined;
  }
}
function substituteEnums(
  type: TypeFact,
  enums: ReadonlyMap<string, CScalar>,
): TypeFact {
  switch (type.kind) {
    case "scalar": {
      const placeholder = type.aliases.find((alias) =>
        alias.startsWith("enum:"),
      );
      if (placeholder === undefined) return type;
      const width = enums.get(placeholder);
      if (width === undefined)
        return unsupported(`${placeholder.slice(5)} has no integer width`);
      return scalar(
        width,
        type.aliases.filter((alias) => alias !== placeholder),
      );
    }
    case "pointer":
      return {
        kind: "pointer",
        pointee: substituteEnums(type.pointee, enums),
        constPointee: type.constPointee,
      };
    case "array":
      return {
        kind: "array",
        element: substituteEnums(type.element, enums),
        length: type.length,
      };
    case "function":
      return {
        ...type,
        parameters: type.parameters.map((item) => substituteEnums(item, enums)),
        result: substituteEnums(type.result, enums),
      };
    default:
      return type;
  }
}

/** Which constants are integer constant expressions (the rest with
 * clang's reason). One compile checks them all; a failure is narrowed down
 * one constant at a time. */
function checkConstants(
  spec: BindingSpec,
  directory: string,
  header: string,
  names: readonly string[],
): { accepted: string[]; rejected: [string, string][] } {
  const check = (subset: readonly string[]) => {
    const source = join(directory, "constants.c");
    writeFileSync(
      source,
      `#include "${header}"\n` +
        subset
          .map(
            (name, position) =>
              `_Static_assert(${integerTest(name)}, "${name} is not an integer");\n` +
              `static const unsigned long long tint_constant_${position} = (unsigned long long)(${name});`,
          )
          .join("\n") +
        "\n",
    );
    return spawnSync(
      clangCommand(),
      [
        ...clangArguments(spec),
        "-x",
        "c",
        "-fsyntax-only",
        "-Wno-unused-const-variable",
        source,
      ],
      { encoding: "utf8" },
    );
  };
  if (names.length === 0 || check(names).status === 0)
    return { accepted: [...names], rejected: [] };
  const accepted: string[] = [],
    rejected: [string, string][] = [];
  for (const name of names) {
    const result = check([name]);
    if (result.status === 0) accepted.push(name);
    else rejected.push([name, firstError(result.stderr)]);
  }
  return { accepted, rejected };
}
function integerTest(name: string): string {
  return `_Generic((${name}), _Bool: 1, char: 1, signed char: 1, unsigned char: 1, short: 1, unsigned short: 1, int: 1, unsigned int: 1, long: 1, unsigned long: 1, long long: 1, unsigned long long: 1, default: 0)`;
}

interface ProbeResult {
  readonly records: Map<
    string,
    { size: number; align: number; offsets: number[] }
  >;
  readonly enums: Map<string, { size: number; signed: boolean }>;
  readonly constants: Map<string, string>;
}
function runProbe(
  spec: BindingSpec,
  directory: string,
  header: string,
  records: readonly PendingRecord[],
  fields: ReadonlyMap<string, readonly FieldFact[]>,
  enums: readonly string[],
  constants: readonly string[],
): ProbeResult {
  const lines: string[] = [];
  for (const record of records) {
    lines.push(
      `  printf("record %s %zu %zu", ${JSON.stringify(record.name)}, sizeof(${record.c}), _Alignof(${record.c}));`,
    );
    for (const field of fields.get(record.name) ?? [])
      lines.push(`  printf(" %zu", offsetof(${record.c}, ${field.name}));`);
    lines.push(`  printf("\\n");`);
  }
  for (const c of enums)
    lines.push(
      `  printf("enum %s %zu %d\\n", ${JSON.stringify(c)}, sizeof(${c}), (int)((${c})-1 < (${c})0));`,
    );
  for (const name of constants)
    lines.push(
      `  if ((${name}) < 0) printf("constant %s %lld\\n", "${name}", (long long)(${name}));`,
      `  else printf("constant %s %llu\\n", "${name}", (unsigned long long)(${name}));`,
    );
  const source = join(directory, "probe.c"),
    binary = join(directory, "probe");
  writeFileSync(
    source,
    `#include "${header}"
#include <stdio.h>
#include <stddef.h>
int main(void) {
${lines.join("\n")}
  return 0;
}
`,
  );
  const compiled = spawnSync(
    clangCommand(),
    [...clangArguments(spec), "-x", "c", "-w", "-o", binary, source],
    { encoding: "utf8" },
  );
  if (compiled.status !== 0)
    throw new Error(
      `the layout probe for ${spec.library} did not compile:\n${compiled.stderr}`,
    );
  const run = spawnSync(binary, [], { encoding: "utf8" });
  if (run.status !== 0)
    throw new Error(
      `the layout probe for ${spec.library} failed:\n${run.stderr}`,
    );
  const result: ProbeResult = {
    records: new Map(),
    enums: new Map(),
    constants: new Map(),
  };
  for (const line of run.stdout.split("\n")) {
    if (line === "") continue;
    const parts = line.split(" ");
    if (parts[0] === "record")
      result.records.set(parts[1]!, {
        size: Number(parts[2]),
        align: Number(parts[3]),
        offsets: parts.slice(4).map(Number),
      });
    else if (parts[0] === "enum")
      result.enums.set(parts.slice(1, -2).join(" "), {
        size: Number(parts[parts.length - 2]),
        signed: parts[parts.length - 1] === "1",
      });
    else if (parts[0] === "constant")
      result.constants.set(parts[1]!, parts[2]!);
  }
  return result;
}
