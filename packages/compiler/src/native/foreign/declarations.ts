import { scan, type Token } from "@tint/typescript/syntax";
import { createSourceTextView } from "@tint/source/text";
import {
  cScalar,
  type CAvailabilityDeclaration,
  type CField,
  type CFunctionDeclaration,
  type CLibraryDeclaration,
  type CRecordDeclaration,
  type CScalar,
  type CSignature,
  type CType,
  type CValueForm,
  type CCallClass,
} from "@tint/abi/c";
/** A parse or resolution failure at a UTF-16 offset of the declaration. */
export interface ForeignDeclarationError {
  readonly message: string;
  readonly offset: number;
}
export type ForeignDeclarationResult =
  | { readonly ok: true; readonly value: CLibraryDeclaration }
  | { readonly ok: false; readonly error: ForeignDeclarationError };
/** A type reference as written: `name<arguments>`, or a numeric or string
 * literal (`name` empty; `text` holds a string literal's value). */
interface TypeReference {
  readonly name: string;
  readonly arguments: readonly TypeReference[];
  readonly number: number;
  readonly text: string | undefined;
  readonly offset: number;
}
interface FieldSyntax {
  readonly name: string;
  readonly type: TypeReference;
  readonly offset: number;
}
interface InterfaceSyntax {
  readonly name: string;
  readonly bases: readonly TypeReference[];
  readonly fields: readonly FieldSyntax[];
  readonly offset: number;
}
interface FunctionSyntax {
  readonly name: string;
  readonly parameters: readonly FieldSyntax[];
  readonly result: TypeReference;
  readonly offset: number;
}
interface LayoutSyntax {
  readonly name: string;
  readonly record: TypeReference;
  readonly offset: number;
}
interface AliasSyntax {
  readonly name: string;
  readonly type: TypeReference;
  readonly offset: number;
}
// KNOWN DEFECT (typed-pipeline gap, docs/native-ffi.md#known-defects): declared at
// module level because nested type declarations are rejected.
interface Operand {
  readonly type: CType;
  readonly form: CValueForm;
  readonly variadic: boolean;
}
/** The `tint:ffi` C scalar width aliases. */
function scalarNamed(name: string): CScalar | undefined {
  switch (name) {
    case "bool":
    case "char":
    case "i8":
    case "u8":
    case "i16":
    case "u16":
    case "i32":
    case "u32":
    case "i64":
    case "u64":
    case "isize":
    case "usize":
    case "f32":
    case "f64":
      return name;
    default:
      return undefined;
  }
}
/** Names `tint:ffi` exports; a binding may import only these. */
function ffiExport(name: string): boolean {
  if (scalarNamed(name) !== undefined) return true;
  switch (name) {
    case "Ptr":
    case "Address":
    case "Available":
    case "CString":
    case "CStringBytes":
    case "FixedArray":
    case "Layout":
    case "OrErrno":
    case "Variadic":
    case "MayCallback":
    case "Async":
    case "Packed":
    case "Union":
    case "Aligned":
      return true;
    default:
      return false;
  }
}
/** Parse a C binding declaration module (docs/native-ffi.md):
 *
 *     declare module "tint:c/<library>" {
 *       import type { i32, u32, Ptr, Layout } from "tint:ffi";
 *       type CC_LONG = u32;
 *       export interface CC_SHA256_CTX { count: FixedArray<u32, 2>; ... }
 *       export const CC_SHA256_CTX: Layout<CC_SHA256_CTX>;
 *       export function CC_SHA256_Init(c: Ptr<CC_SHA256_CTX>): i32;
 *     }
 *
 * The reading is purely syntactic: interfaces are C records (declaration
 * order is member order; `extends Packed`, `Union` or `Aligned<N>` opt into
 * other layouts), functions are prototypes and the width aliases fix C
 * types. Anything else fails explicitly. */
export function parseForeignDeclarations(
  text: string,
): ForeignDeclarationResult {
  const scanned = scan(createSourceTextView(text));
  if (!scanned.ok)
    return {
      ok: false,
      error: { message: scanned.error.message, offset: scanned.error.start },
    };
  const tokens = scanned.value;
  let position = 0,
    pendingClose = 0;
  let failure: ForeignDeclarationError | undefined;
  function current(): Token {
    const token = tokens[position] ?? tokens[tokens.length - 1];
    if (token === undefined) throw "declaration token invariant";
    return token;
  }
  function fail(message: string, offset: number): false {
    if (failure === undefined) failure = { message, offset };
    return false;
  }
  function at(value: string): boolean {
    const token = current();
    return token.kind !== "string" && token.value === value;
  }
  function eat(value: string): boolean {
    if (!at(value)) return false;
    position++;
    return true;
  }
  function expect(value: string): boolean {
    if (eat(value)) return true;
    return fail("expected '" + value + "'", current().start);
  }
  function identifier(): string | undefined {
    const token = current();
    if (token.kind !== "identifier") {
      fail("expected a name", token.start);
      return undefined;
    }
    position++;
    return token.value;
  }
  function typeReference(): TypeReference | undefined {
    const token = current();
    if (token.kind === "number") {
      position++;
      const value = Number(token.value);
      return {
        name: "",
        arguments: [],
        number: value,
        text: undefined,
        offset: token.start,
      };
    }
    if (token.kind === "string") {
      position++;
      return {
        name: "",
        arguments: [],
        number: NaN,
        text: token.value,
        offset: token.start,
      };
    }
    if (token.kind !== "identifier" && !at("void")) {
      fail("expected a C type", token.start);
      return undefined;
    }
    position++;
    const args: TypeReference[] = [];
    if (eat("<")) {
      for (;;) {
        const argument = typeReference();
        if (argument === undefined) return undefined;
        args.push(argument);
        if (eat(",")) continue;
        // `>>` closes two argument lists.
        if (pendingClose > 0) pendingClose--;
        else if (at(">>")) {
          position++;
          pendingClose = 1;
        } else if (!expect(">")) return undefined;
        break;
      }
    }
    if (at("[") || at("|") || at("&") || at("?")) {
      fail("only named C types are supported in declarations", current().start);
      return undefined;
    }
    return {
      name: token.value,
      arguments: args,
      number: NaN,
      text: undefined,
      offset: token.start,
    };
  }
  function terminator(): boolean {
    if (eat(";") || eat(",")) return true;
    // Automatic semicolon insertion between members.
    return current().lineBreakBefore || at("}")
      ? true
      : fail("expected ';'", current().start);
  }
  if (!eat("declare") || !eat("module"))
    return {
      ok: false,
      error: {
        message: 'expected declare module "tint:c/<library>"',
        offset: current().start,
      },
    };
  const moduleToken = current();
  if (
    moduleToken.kind !== "string" ||
    !moduleToken.value.startsWith("tint:c/") ||
    moduleToken.value.length <= 7
  )
    return {
      ok: false,
      error: {
        message: 'binding modules are named "tint:c/<library>"',
        offset: moduleToken.start,
      },
    };
  position++;
  const moduleName = moduleToken.value;
  const interfaces: InterfaceSyntax[] = [],
    functions: FunctionSyntax[] = [],
    layouts: LayoutSyntax[] = [],
    aliases: AliasSyntax[] = [];
  const imported = new Set<string>(),
    declared = new Set<string>();
  function declare(name: string, offset: number): boolean {
    if (declared.has(name))
      return fail("duplicate declaration " + name, offset);
    if (ffiExport(name)) return fail(name + " is a tint:ffi type name", offset);
    declared.add(name);
    return true;
  }
  function member(): boolean {
    const start = current().start;
    if (eat("import")) {
      if (!expect("type") || !expect("{")) return false;
      while (!at("}")) {
        const name = identifier();
        if (name === undefined) return false;
        if (at("as"))
          return fail("tint:ffi imports cannot be renamed", current().start);
        if (!ffiExport(name))
          return fail("tint:ffi has no type " + name, start);
        imported.add(name);
        if (!eat(",")) break;
      }
      if (!expect("}") || !expect("from")) return false;
      const from = current();
      if (from.kind !== "string" || from.value !== "tint:ffi")
        return fail('bindings import only from "tint:ffi"', from.start);
      position++;
      return terminator();
    }
    eat("export");
    const offset = current().start;
    if (eat("type")) {
      const name = identifier();
      if (name === undefined || !declare(name, offset) || !expect("="))
        return false;
      const type = typeReference();
      if (type === undefined) return false;
      aliases.push({ name, type, offset });
      return terminator();
    }
    if (eat("interface")) {
      const name = identifier();
      if (name === undefined || !declare(name, offset)) return false;
      const bases: TypeReference[] = [];
      if (eat("extends"))
        for (;;) {
          const base = typeReference();
          if (base === undefined) return false;
          bases.push(base);
          if (!eat(",")) break;
        }
      if (!expect("{")) return false;
      const fields: FieldSyntax[] = [];
      while (!at("}")) {
        const fieldOffset = current().start;
        if (at("readonly"))
          return fail("record members are plain fields", fieldOffset);
        const field = identifier();
        if (field === undefined) return false;
        if (at("?") || at("("))
          return fail("record members are plain fields", current().start);
        if (!expect(":")) return false;
        const type = typeReference();
        if (type === undefined) return false;
        for (const other of fields) {
          if (other === undefined) throw "field invariant";
          if (other.name === field)
            return fail("duplicate member " + field, fieldOffset);
        }
        fields.push({ name: field, type, offset: fieldOffset });
        if (!terminator()) return false;
      }
      if (!expect("}")) return false;
      interfaces.push({ name, bases, fields, offset });
      return true;
    }
    if (eat("const")) {
      const name = identifier();
      if (name === undefined || !expect(":")) return false;
      const type = typeReference();
      if (type === undefined) return false;
      const record = type.arguments[0];
      if (
        type.name !== "Layout" ||
        type.arguments.length !== 1 ||
        record === undefined
      )
        return fail(
          "binding constants are Layout<Record> declarations",
          offset,
        );
      if (record.name !== name)
        return fail("a Layout constant shares its record's name", offset);
      layouts.push({ name, record, offset });
      return terminator();
    }
    if (eat("function")) {
      const name = identifier();
      if (name === undefined || !declare(name, offset) || !expect("("))
        return false;
      const parameters: FieldSyntax[] = [];
      while (!at(")")) {
        const parameterOffset = current().start;
        if (at("..."))
          return fail(
            "declare variadic arguments as Variadic<T> parameters",
            parameterOffset,
          );
        const parameter = identifier();
        if (parameter === undefined) return false;
        if (at("?"))
          return fail("C parameters are never optional", current().start);
        if (!expect(":")) return false;
        const type = typeReference();
        if (type === undefined) return false;
        parameters.push({ name: parameter, type, offset: parameterOffset });
        if (!eat(",")) break;
      }
      if (!expect(")") || !expect(":")) return false;
      const result = typeReference();
      if (result === undefined) return false;
      if (at("{"))
        return fail("binding functions have no body", current().start);
      functions.push({ name, parameters, result, offset });
      return terminator();
    }
    return fail(
      "expected an import, type, interface, const or function declaration",
      offset,
    );
  }
  if (!expect("{"))
    return {
      ok: false,
      error: failure ?? { message: "expected '{'", offset: 0 },
    };
  while (!at("}") && current().kind !== "eof") if (!member()) break;
  if (failure === undefined) expect("}");
  if (failure === undefined && current().kind !== "eof")
    fail("a binding file declares exactly one module", current().start);
  if (failure !== undefined) return { ok: false, error: failure };
  return resolveDeclarations(
    moduleName,
    imported,
    interfaces,
    aliases,
    layouts,
    functions,
  );
}
function resolveDeclarations(
  moduleName: string,
  imported: ReadonlySet<string>,
  interfaces: readonly InterfaceSyntax[],
  aliases: readonly AliasSyntax[],
  layouts: readonly LayoutSyntax[],
  functions: readonly FunctionSyntax[],
): ForeignDeclarationResult {
  let failure: ForeignDeclarationError | undefined;
  function fail(message: string, offset: number): undefined {
    if (failure === undefined) failure = { message, offset };
    return undefined;
  }
  const interfaceByName = new Map<string, InterfaceSyntax>(),
    aliasByName = new Map<string, AliasSyntax>();
  for (const item of interfaces) {
    if (item === undefined) throw "interface invariant";
    interfaceByName.set(item.name, item);
  }
  for (const item of aliases) {
    if (item === undefined) throw "alias invariant";
    aliasByName.set(item.name, item);
  }
  const records = new Map<string, CType>(),
    resolving = new Set<string>();
  function marker(name: string, offset: number): boolean {
    if (!imported.has(name)) {
      fail(name + " must be imported from tint:ffi", offset);
      return false;
    }
    return true;
  }
  function record(item: InterfaceSyntax): CType | undefined {
    const known = records.get(item.name);
    if (known !== undefined) return known;
    if (resolving.has(item.name))
      return fail("record " + item.name + " contains itself", item.offset);
    resolving.add(item.name);
    let packed = false,
      union = false,
      alignment = 0;
    for (const base of item.bases) {
      if (base === undefined) throw "base invariant";
      if (!marker(base.name, base.offset)) return undefined;
      const argument = base.arguments[0];
      if (base.name === "Packed" && base.arguments.length === 0) packed = true;
      else if (base.name === "Union" && base.arguments.length === 0)
        union = true;
      else if (
        base.name === "Aligned" &&
        base.arguments.length === 1 &&
        argument !== undefined &&
        argument.name === "" &&
        Number.isSafeInteger(argument.number)
      )
        alignment = argument.number;
      else
        return fail(
          "records extend only Packed, Union or Aligned<N>",
          base.offset,
        );
    }
    const fields: CField[] = [];
    for (const field of item.fields) {
      if (field === undefined) throw "field invariant";
      const type = memberType(field.type);
      if (type === undefined) return undefined;
      fields.push({ name: field.name, type });
    }
    const resolved: CType = {
      kind: "record",
      name: item.name,
      union,
      packed,
      alignment,
      fields,
    };
    resolving.delete(item.name);
    records.set(item.name, resolved);
    return resolved;
  }
  /** A named type usable as a record member or by-value operand. */
  function named(reference: TypeReference): CType | undefined {
    const scalar = scalarNamed(reference.name);
    if (scalar !== undefined) {
      if (!marker(reference.name, reference.offset)) return undefined;
      if (reference.arguments.length !== 0)
        return fail(
          reference.name + " takes no type arguments",
          reference.offset,
        );
      return cScalar(scalar);
    }
    const alias = aliasByName.get(reference.name);
    if (alias !== undefined) {
      if (reference.arguments.length !== 0)
        return fail("type aliases take no arguments", reference.offset);
      return memberType(alias.type);
    }
    const item = interfaceByName.get(reference.name);
    if (item !== undefined) {
      if (reference.arguments.length !== 0)
        return fail("records take no type arguments", reference.offset);
      return record(item);
    }
    return fail("unknown C type " + reference.name, reference.offset);
  }
  function pointee(reference: TypeReference): CType | undefined {
    if (reference.name === "void") return { kind: "void" };
    // A pointer to a record still being resolved (`next: Address<Node>`)
    // needs no layout of its pointee: it points to opaque memory.
    if (resolving.has(reference.name) && reference.arguments.length === 0)
      return { kind: "void" };
    return named(reference);
  }
  /** `Ptr<T>` (a borrowed view, arguments only) or `Address<T>` (a raw
   * address) as the C pointer type `T *`. */
  function pointerType(reference: TypeReference): CType | undefined {
    if (!marker(reference.name, reference.offset)) return undefined;
    const target = reference.arguments[0];
    if (reference.arguments.length !== 1 || target === undefined)
      return fail(
        reference.name + " takes one type argument",
        reference.offset,
      );
    const resolved = pointee(target);
    if (resolved === undefined) return undefined;
    return { kind: "pointer", pointee: resolved };
  }
  function memberType(reference: TypeReference): CType | undefined {
    if (reference.name === "Ptr")
      return fail(
        "record members and results hold raw addresses: use Address<T> (Ptr<T> is a borrowed argument view)",
        reference.offset,
      );
    if (reference.name === "Address") return pointerType(reference);
    if (reference.name === "FixedArray") {
      if (!marker("FixedArray", reference.offset)) return undefined;
      const element = reference.arguments[0],
        length = reference.arguments[1];
      if (
        reference.arguments.length !== 2 ||
        element === undefined ||
        length === undefined ||
        length.name !== "" ||
        !Number.isSafeInteger(length.number) ||
        length.number < 1
      )
        return fail(
          "FixedArray takes an element type and a positive length",
          reference.offset,
        );
      const resolved = memberType(element);
      if (resolved === undefined) return undefined;
      return { kind: "array", element: resolved, length: length.number };
    }
    if (reference.name === "void" || reference.name === "")
      return fail("expected a C member type", reference.offset);
    return named(reference);
  }
  function operand(
    reference: TypeReference,
    variadic: boolean,
  ): Operand | undefined {
    if (reference.name === "Variadic") {
      if (!marker("Variadic", reference.offset)) return undefined;
      const inner = reference.arguments[0];
      if (variadic || reference.arguments.length !== 1 || inner === undefined)
        return fail("Variadic takes one non-variadic type", reference.offset);
      const resolved = operand(inner, true);
      if (resolved === undefined) return undefined;
      return { type: resolved.type, form: resolved.form, variadic: true };
    }
    if (reference.name === "CString" || reference.name === "CStringBytes") {
      if (!marker(reference.name, reference.offset)) return undefined;
      return {
        type: { kind: "pointer", pointee: cScalar("char") },
        form: reference.name === "CString" ? "string" : "terminated-bytes",
        variadic,
      };
    }
    if (reference.name === "Ptr") {
      const type = pointerType(reference);
      if (type === undefined) return undefined;
      return { type, form: "bytes", variadic };
    }
    const type = memberType(reference);
    if (type === undefined) return undefined;
    if (type.kind === "array")
      return fail(
        "C never passes arrays by value; use Ptr<T>",
        reference.offset,
      );
    if (type.kind === "pointer") return { type, form: "number", variadic };
    if (type.kind === "scalar")
      return {
        type,
        form: type.scalar === "bool" ? "boolean" : "number",
        variadic,
      };
    if (type.kind === "record") {
      if (!plainRecord(type))
        return fail(
          "records passed by value may hold only numbers, addresses, arrays and records",
          reference.offset,
        );
      return { type, form: "record", variadic };
    }
    return fail("unsupported C operand", reference.offset);
  }
  /** `(): Available<"name">` with `name` a declared C function (not
   * another query): its symbol's availability. */
  function availabilityOf(
    fn: FunctionSyntax,
  ): CAvailabilityDeclaration | undefined {
    const result = fn.result;
    if (!marker("Available", result.offset)) return undefined;
    const argument = result.arguments[0];
    const name = argument === undefined ? undefined : argument.text;
    if (
      result.arguments.length !== 1 ||
      argument === undefined ||
      name === undefined
    )
      return fail(
        'Available takes a declared function name: Available<"name">',
        result.offset,
      );
    if (fn.parameters.length !== 0)
      return fail("availability queries take no parameters", fn.offset);
    for (const other of functions) {
      if (other === undefined) throw "availability function invariant";
      if (other.name !== name) continue;
      if (other.result.name === "Available")
        return fail(
          "Available names a C function declaration",
          argument.offset,
        );
      const separator = name.indexOf("$");
      return {
        name: fn.name,
        symbol: separator < 0 ? name : name.slice(0, separator),
      };
    }
    return fail(
      "Available names an undeclared function " + name,
      argument.offset,
    );
  }
  const declarations: CFunctionDeclaration[] = [],
    availability: CAvailabilityDeclaration[] = [];
  for (const fn of functions) {
    if (fn === undefined) throw "function invariant";
    if (fn.result.name === "Available") {
      const query = availabilityOf(fn);
      if (query === undefined) break;
      availability.push(query);
      continue;
    }
    for (const parameter of fn.parameters)
      if (parameter !== undefined && parameter.type.name === "Available")
        fail("Available types only query results", parameter.offset);
    if (failure !== undefined) break;
    let callClass: CCallClass = "leaf",
      errno: "none" | "negated-result" = "none",
      result = fn.result;
    if (result.name === "MayCallback" || result.name === "Async") {
      if (!marker(result.name, result.offset)) break;
      const inner = result.arguments[0];
      if (result.arguments.length !== 1 || inner === undefined) {
        fail(result.name + " takes one result type", result.offset);
        break;
      }
      callClass = result.name === "Async" ? "async" : "may-callback";
      result = inner;
    }
    if (result.name === "OrErrno") {
      if (!marker("OrErrno", result.offset)) break;
      const inner = result.arguments[0];
      if (result.arguments.length !== 1 || inner === undefined) {
        fail("OrErrno takes one result type", result.offset);
        break;
      }
      errno = "negated-result";
      result = inner;
    }
    let resultType: CType, resultForm: CValueForm;
    if (result.name === "void" && result.arguments.length === 0) {
      resultType = { kind: "void" };
      resultForm = "void";
    } else {
      const resolved = memberType(result);
      if (resolved === undefined) break;
      if (resolved.kind === "array") {
        fail("C never returns arrays", result.offset);
        break;
      }
      resultType = resolved;
      if (resolved.kind === "record") {
        if (!plainRecord(resolved)) {
          fail(
            "records returned by value may hold only numbers, arrays and records",
            result.offset,
          );
          break;
        }
        resultForm = "record";
      } else
        resultForm =
          resolved.kind === "scalar" && resolved.scalar === "bool"
            ? "boolean"
            : "number";
    }
    if (
      errno === "negated-result" &&
      !(
        resultType.kind === "scalar" &&
        (resultType.scalar === "i32" ||
          resultType.scalar === "i64" ||
          resultType.scalar === "isize")
      )
    ) {
      fail("OrErrno needs an i32, i64 or isize result", fn.result.offset);
      break;
    }
    const parameters: CType[] = [],
      names: string[] = [],
      forms: CValueForm[] = [];
    let fixed = -1;
    for (const parameter of fn.parameters) {
      if (parameter === undefined) throw "parameter invariant";
      const resolved = operand(parameter.type, false);
      if (resolved === undefined) break;
      if (resolved.variadic && fixed < 0) fixed = parameters.length;
      if (!resolved.variadic && fixed >= 0) {
        fail(
          "parameters after a Variadic parameter are variadic too",
          parameter.offset,
        );
        break;
      }
      parameters.push(resolved.type);
      names.push(parameter.name);
      forms.push(resolved.form);
    }
    if (failure !== undefined) break;
    const separator = fn.name.indexOf("$"),
      symbol = separator < 0 ? fn.name : fn.name.slice(0, separator);
    if (symbol.length === 0) {
      fail("a $variant needs a symbol before it", fn.offset);
      break;
    }
    const signature: CSignature = {
      parameters,
      result: resultType,
      fixedParameters: fixed < 0 ? parameters.length : fixed,
      callClass,
      errno,
    };
    declarations.push({
      name: fn.name,
      symbol,
      signature,
      parameterNames: names,
      parameterForms: forms,
      resultForm,
    });
  }
  const recordDeclarations: CRecordDeclaration[] = [];
  for (const item of interfaces) {
    if (item === undefined) throw "interface invariant";
    const resolved = record(item);
    if (resolved === undefined) break;
    recordDeclarations.push({ name: item.name, type: resolved });
  }
  const layoutNames: string[] = [];
  for (const layout of layouts) {
    if (layout === undefined) throw "layout invariant";
    if (!interfaceByName.has(layout.name)) {
      fail("Layout constants describe declared records", layout.offset);
      break;
    }
    layoutNames.push(layout.name);
  }
  if (failure !== undefined) return { ok: false, error: failure };
  return {
    ok: true,
    value: {
      module: moduleName,
      records: recordDeclarations,
      functions: declarations,
      availability,
      layouts: layoutNames,
    },
  };
}
/** Records whose members are numbers, addresses, fixed arrays and nested
 * such records: the shapes by-value conversions turn into plain objects. */
function plainRecord(type: CType): boolean {
  switch (type.kind) {
    case "scalar":
    case "pointer":
      return true;
    case "array":
      return plainRecord(type.element);
    case "record":
      for (const field of type.fields) {
        if (field === undefined) throw "plain record invariant";
        if (!plainRecord(field.type)) return false;
      }
      return true;
    default:
      return false;
  }
}
