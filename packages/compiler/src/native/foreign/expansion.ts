import {
  cLayout,
  cScalarBytes,
  cScalarSigned,
  type CCallbackDeclaration,
  type CFunctionDeclaration,
  type CSignature,
  type CLibraryDeclaration,
  type CScalar,
  type CTarget,
  type CType,
  type CValueForm,
} from "@tint/abi/c";
import type {
  ForeignCall,
  ForeignMemoryAccess,
  ForeignOperand,
  ForeignResult,
} from "@tint/ir/scalar";
/** One generated function bound to a c-call (`call`) or to a C memory
 * access (`memory`: an availability query); exactly one is present. */
export interface ForeignStub {
  readonly name: string;
  readonly call?: ForeignCall | undefined;
  readonly memory?: ForeignMemoryAccess | undefined;
}
export interface ForeignExpansion {
  /** TypeScript source implementing the declarations. */
  readonly text: string;
  readonly stubs: readonly ForeignStub[];
}
export type ForeignExpansionResult =
  | { readonly ok: true; readonly value: ForeignExpansion }
  | { readonly ok: false; readonly error: string };
/** The ForeignCall that binds a declaration whose string and record
 * conversions happen in TypeScript (strings become NUL-terminated bytes,
 * records their C images). */
export function foreignCall(declaration: CFunctionDeclaration): ForeignCall {
  const operands: ForeignOperand[] = [];
  for (const form of declaration.parameterForms) {
    if (form === undefined) throw "foreign form invariant";
    operands.push(machineOperand(form));
  }
  return {
    symbol: declaration.symbol,
    signature: declaration.signature,
    operands,
    result: machineResult(declaration.resultForm),
  };
}
function machineOperand(form: CValueForm): ForeignOperand {
  switch (form) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "bytes":
      return "bytes";
    case "string":
    case "terminated-bytes":
      return "terminated-bytes";
    case "record":
      return "record";
    case "callback":
      // A function value; C gets a thunk's entry.
      return "callback";
    case "void":
      throw "void operand invariant";
  }
}
function machineResult(form: CValueForm): ForeignResult {
  switch (form) {
    case "void":
      return "void";
    case "boolean":
      return "boolean";
    case "record":
      return "record";
    default:
      return "number";
  }
}
/** Whether a declaration needs a TypeScript conversion wrapper. */
function converts(declaration: CFunctionDeclaration): boolean {
  if (declaration.resultForm === "record") return true;
  for (const form of declaration.parameterForms)
    if (form === "string" || form === "record") return true;
  return false;
}
function tsType(form: CValueForm, type: CType): string {
  switch (form) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string":
      return "string";
    case "bytes":
    case "terminated-bytes":
      return "Uint8Array";
    case "record":
      return type.kind === "record" ? type.name : "never";
    case "callback":
      return "never";
    case "void":
      return "void";
  }
}
/** The TypeScript function type of a callback. */
function callbackTsType(callback: CCallbackDeclaration): string {
  const parameters: string[] = [];
  for (let index = 0; index < callback.parameterNames.length; index++) {
    const name = callback.parameterNames[index],
      form = callback.parameterForms[index];
    if (name === undefined || form === undefined)
      throw "callback parameter invariant";
    const record = callback.parameterRecords[index] ?? "";
    parameters.push(
      name +
        ": " +
        (record !== ""
          ? "View$<" + record + ">"
          : form === "boolean"
            ? "boolean"
            : "number"),
    );
  }
  return (
    "(" +
    parameters.join(", ") +
    ") => " +
    (callback.resultForm === "void"
      ? "void"
      : callback.resultForm === "boolean"
        ? "boolean"
        : "number")
  );
}
/** The adapter a may-callback wrapper passes to C for callback parameter
 * `name` (docs/native-ffi.md, "Callbacks"): the function value a thunk
 * calls with numbers (C bools as 0 or 1). It calls the user's function,
 * converts its result (integers and addresses must be exact and in range)
 * and records what it raises in the wrapper's `failed$name`/`error$name`,
 * then returns 0 to C; once failed it returns 0 without calling. The
 * wrapper rethrows after C returns, so no exception unwinds through C.
 * `park` (statements for after the call) points its record views at the
 * guard: they hold C's last record while the call runs, and fault after. */
function callbackAdapter(
  name: string,
  callback: CCallbackDeclaration,
  target: CTarget,
): { readonly text: string; readonly park: string } {
  const parameters: string[] = [];
  for (const parameter of callback.parameterNames) {
    if (parameter === undefined) throw "callback parameter invariant";
    parameters.push(parameter + ": number");
  }
  const views = callbackViews(
    callback,
    name,
    callback.parameterNames,
    "      ",
  );
  const text =
    views.declarations +
    "  let failed$" +
    name +
    " = false;\n  let error$" +
    name +
    ": unknown = undefined;\n  const adapter$" +
    name +
    " = (" +
    parameters.join(", ") +
    "): number => {\n    if (failed$" +
    name +
    ") return 0;\n    try {\n" +
    views.enter +
    callbackResult(
      callback,
      name + "(" + views.arguments + ")",
      target,
      "      ",
      "",
    ) +
    "\n    } catch (error) {\n      failed$" +
    name +
    " = true;\n      error$" +
    name +
    " = error;\n      return 0;\n    }\n  };";
  return {
    text,
    park: callbackViews(callback, name, callback.parameterNames, "  ").leave,
  };
}
/** A callback's arguments from the adapter's numbers `names`: C bools as
 * booleans, and for each `Ptr<R>` parameter one foreign view of R made once
 * per adapter (`declarations`), pointed at C's record for each invocation
 * (`enter`) and at an inaccessible guard after it (`leave`), so an
 * invocation allocates nothing and a view kept past its invocation faults. */
function callbackViews(
  callback: CCallbackDeclaration,
  prefix: string,
  names: readonly string[],
  indent: string,
): {
  /** Statements made once per adapter (indented two spaces). */
  readonly declarations: string;
  readonly enter: string;
  readonly leave: string;
  readonly arguments: string;
} {
  const args: string[] = [],
    declared: string[] = [];
  let enter = "",
    leave = "";
  for (let index = 0; index < callback.parameterNames.length; index++) {
    const name = names[index],
      record = callback.parameterRecords[index] ?? "";
    if (name === undefined) throw "callback argument invariant";
    if (record !== "") {
      const view = "view$" + prefix + "$" + String(index);
      declared.push(
        "const " + view + " = viewAt$(" + record + ", guard$" + prefix + ");",
      );
      enter +=
        indent +
        "if (" +
        name +
        ' === 0) throw new TypeError("null C record pointer");\n' +
        indent +
        "retargetCallbackView$(" +
        view +
        ", " +
        name +
        ");\n";
      leave +=
        indent + "retargetCallbackView$(" + view + ", guard$" + prefix + ");\n";
      args.push(view);
    } else
      args.push(
        callback.parameterForms[index] === "boolean" ? name + " !== 0" : name,
      );
  }
  let declarations = "";
  if (declared.length > 0) {
    declarations = "  const guard$" + prefix + " = callbackGuard$();\n";
    for (let index = 0; index < declared.length; index++)
      declarations += "  " + (declared[index] ?? "") + "\n";
  }
  return {
    declarations,
    enter,
    leave,
    arguments: args.join(", "),
  };
}
/** Statements (each line indented by `indent`) returning `call`'s value
 * as the number the thunk converts for C: C bools as 0 or 1, integers and
 * addresses checked exact and in range for the C type (TypeError). `after`
 * (statements) runs once the call has returned. */
function callbackResult(
  callback: CCallbackDeclaration,
  call: string,
  target: CTarget,
  indent: string,
  after: string,
): string {
  const result = callback.signature.result;
  if (callback.resultForm === "void")
    return indent + call + ";\n" + after + indent + "return 0;";
  if (callback.resultForm === "boolean")
    return (
      indent +
      "const flag = " +
      call +
      ";\n" +
      after +
      indent +
      "return flag ? 1 : 0;"
    );
  if (
    result.kind === "scalar" &&
    (result.scalar === "f32" || result.scalar === "f64")
  )
    return (
      indent +
      "const value = " +
      call +
      ";\n" +
      after +
      indent +
      "return value;"
    );
  let min = 0,
    max = 18446744073709549568;
  if (result.kind === "scalar") {
    const range = integerRange(result.scalar, target);
    min = range.min;
    max = range.max;
  }
  return (
    indent +
    "const value = " +
    call +
    ";\n" +
    after +
    indent +
    "if (!Number.isInteger(value) || value < " +
    String(min) +
    " || value > " +
    String(max) +
    ")\n" +
    indent +
    '  throw new TypeError("callback result out of range for its C type");\n' +
    indent +
    "return value;"
  );
}
/** How many registered callbacks may exist at once: tint:ffi's
 * `registeredCallbacks` (one registered thunk per id and prototype). */
const registeredCallbackLimit = 16;
/** The record-view parameters of a scoped callback whose thunk calls the
 * TypeScript function itself (numbers and record views in, a number or
 * nothing out; docs/native-ffi.md, "Callbacks"), else undefined (it goes
 * through an adapter). */
function directViews(
  callback: CCallbackDeclaration,
): readonly number[] | undefined {
  if (callback.resultForm !== "number" && callback.resultForm !== "void")
    return undefined;
  const views: number[] = [];
  let numbers = 0;
  for (let index = 0; index < callback.parameterForms.length; index++) {
    if (callback.parameterForms[index] !== "number") return undefined;
    if ((callback.parameterRecords[index] ?? "") !== "") views.push(index);
    else numbers++;
  }
  return views.length <= 4 && numbers <= 8 ? views : undefined;
}
/** Whether a callback takes `Ptr<R>` parameters (foreign views). */
function viewsRecords(callback: CCallbackDeclaration): boolean {
  for (const record of callback.parameterRecords)
    if (record !== undefined && record !== "") return true;
  return false;
}
/** A placeholder for parameters that take no callback. */
const noCallback: CCallbackDeclaration = {
  signature: {
    parameters: [],
    result: { kind: "void" },
    fixedParameters: 0,
    callClass: "leaf",
    errno: "none",
  },
  parameterNames: [],
  parameterForms: [],
  parameterRecords: [],
  resultForm: "void",
};
/** Per parameter: the C prototype of each callback parameter. */
function callbackPrototypes(
  declaration: CFunctionDeclaration,
): (CSignature | undefined)[] {
  const prototypes: (CSignature | undefined)[] = [];
  for (let index = 0; index < declaration.parameterForms.length; index++)
    prototypes.push(declaration.callbacks?.[index]?.signature);
  return prototypes;
}
/** The function type of a callback adapter: numbers in, a number out. */
function adapterTsType(callback: CCallbackDeclaration): string {
  const parameters: string[] = [];
  for (const parameter of callback.parameterNames) {
    if (parameter === undefined) throw "callback parameter invariant";
    parameters.push(parameter + ": number");
  }
  return "(" + parameters.join(", ") + ") => number";
}
function memberTsType(type: CType): string {
  switch (type.kind) {
    case "scalar":
      return type.scalar === "bool" ? "boolean" : "number";
    case "pointer":
      return "number";
    case "array":
      return memberTsType(type.element) + "[]";
    case "record":
      return type.name;
    default:
      return "never";
  }
}
// KNOWN DEFECT (typed-pipeline gap, docs/native-ffi.md#known-defects): an interface
// instead of a `[min, max]` tuple: the parser rejects tuple types.
interface IntegerRange {
  readonly min: number;
  readonly max: number;
}
function integerRange(scalar: CScalar, target: CTarget): IntegerRange {
  const bytes = cScalarBytes(scalar),
    signed = cScalarSigned(scalar, target);
  if (bytes === 8)
    return signed
      ? { min: -9007199254740991, max: 9007199254740991 }
      : { min: 0, max: 9007199254740991 };
  // KNOWN DEFECT (typed-pipeline gap, docs/native-ffi.md#known-defects): Math.pow is
  // unavailable to compiler sources.
  const span = bytes === 1 ? 256 : bytes === 2 ? 65536 : 4294967296;
  return signed
    ? { min: -span / 2, max: span / 2 - 1 }
    : { min: 0, max: span - 1 };
}
/** Generate the implementation module of a binding: bodyless stubs bound
 * to c-calls, TypeScript wrappers for string and record conversions,
 * record interfaces and Layout constants. The text only uses ordinary
 * TypeScript, so the same module also runs where the stubs are replaced by
 * a dynamic adapter. */
export function expandForeignLibrary(
  library: CLibraryDeclaration,
  target: CTarget,
  lazyImage?: string,
): ForeignExpansionResult {
  // An optional library on a target without weak libraries (ELF) loads
  // lazily (docs/native-ffi.md, "Optional libraries"): each symbol is
  // resolved by dlopen/dlsym of `lazyImage` on first use, calls go through
  // the resolved address, and an absent library or symbol is unavailable.
  const lazy = lazyImage !== undefined;
  const lines: string[] = [];
  const stubs: ForeignStub[] = [];
  const helpers = new Set<string>();
  const recordCodecs = new Set<string>();
  lines.push(
    // KNOWN DEFECT (typed-pipeline gap, docs/native-ffi.md#known-defects): string
    // concatenation instead of JSON.stringify, unavailable to compiler sources.
    '// Generated from the "' +
      library.module +
      '" binding declaration (docs/native-ffi.md).',
  );
  if (lazy) {
    lines.push('import { optionalSymbol } from "tint:ffi/unsafe";');
    const symbols = new Set<string>();
    for (const declaration of library.functions) {
      if (declaration === undefined) throw "foreign function invariant";
      if (symbols.has(declaration.symbol)) continue;
      symbols.add(declaration.symbol);
      // 0: not resolved yet; -1: absent; else the function's address.
      lines.push(
        "let at$" +
          declaration.symbol +
          " = 0;\nfunction address$" +
          declaration.symbol +
          "(): number {\n  if (at$" +
          declaration.symbol +
          " === 0)\n    at$" +
          declaration.symbol +
          ' = optionalSymbol("' +
          (lazyImage ?? "") +
          '", "' +
          declaration.symbol +
          '");\n  return at$' +
          declaration.symbol +
          ";\n}",
      );
    }
  }
  for (const record of library.records) {
    if (record === undefined) throw "foreign record invariant";
    const type = record.type;
    if (type.kind !== "record") throw "foreign record kind invariant";
    lines.push("export interface " + record.name + " {");
    for (const field of type.fields) {
      if (field === undefined) throw "foreign field invariant";
      lines.push("  " + field.name + ": " + memberTsType(field.type) + ";");
    }
    lines.push("}");
  }
  for (const constant of library.constants) {
    if (constant === undefined) throw "foreign constant invariant";
    lines.push(
      "export const " + constant.name + " = " + String(constant.value) + ";",
    );
  }
  for (const name of library.layouts) {
    if (name === undefined) throw "foreign layout invariant";
    let declared: CType | undefined;
    for (const record of library.records) {
      if (record === undefined) throw "foreign record invariant";
      if (record.name === name) declared = record.type;
    }
    if (declared === undefined || declared.kind !== "record")
      return { ok: false, error: "Layout of an undeclared record " + name };
    const layout = cLayout(declared, target);
    if (!layout.ok) return { ok: false, error: name + ": " + layout.error };
    const offsets: string[] = [];
    for (let index = 0; index < declared.fields.length; index++) {
      const field = declared.fields[index],
        offset = layout.value.offsets[index];
      if (field === undefined || offset === undefined)
        throw "foreign layout field invariant";
      offsets.push(field.name + ": " + String(offset));
    }
    lines.push(
      "export const " +
        name +
        " = { size: " +
        String(layout.value.size) +
        ", alignment: " +
        String(layout.value.alignment) +
        ", offsets: { " +
        offsets.join(", ") +
        " } };",
    );
  }
  for (const query of library.availability) {
    if (query === undefined) throw "foreign availability invariant";
    if (lazy) {
      lines.push(
        "export function " +
          query.name +
          "(): boolean {\n  return address$" +
          query.symbol +
          "() > 0;\n}",
      );
      continue;
    }
    // The stub body is replaced by one load of the symbol's import slot.
    lines.push(
      "export function " +
        query.name +
        '(): boolean {\n  throw "FOREIGN_UNAVAILABLE";\n}',
    );
    stubs.push({
      name: query.name,
      memory: {
        operation: "available",
        type: { kind: "void" },
        offset: 0,
        minimum: 0,
        symbol: query.symbol,
      },
    });
  }
  let importsCallbacks = false,
    importsViews = false;
  for (const callbackType of library.callbackTypes ?? []) {
    if (callbackType === undefined) throw "foreign callback type invariant";
    importsCallbacks = true;
    if (viewsRecords(callbackType.callback)) importsViews = true;
  }
  for (const declaration of library.functions) {
    if (declaration === undefined) throw "foreign function invariant";
    if (declaration.signature.callClass !== "may-callback") continue;
    if (lazy)
      return {
        ok: false,
        error: declaration.name + ": optional libraries take no callbacks yet",
      };
    importsCallbacks = true;
    for (const callback of declaration.callbacks ?? [])
      if (callback !== undefined && viewsRecords(callback)) importsViews = true;
  }
  if (importsCallbacks)
    lines.push(
      'import { callbackState as callbackState$, stableBytes as stableBytes$, callbackDispatcher as callbackDispatcher$, rethrowCallbackFailure as rethrowCallbackFailure$, registerCallback as registerCallback$, noteCallback as noteCallback$, registeredCallbacks as registeredCallbacks$ } from "tint:ffi";',
    );
  // Ptr<R> callback parameters arrive as foreign views (C owns the memory).
  if (importsViews)
    lines.push(
      'import { type View as View$, callbackGuard as callbackGuard$, retargetCallbackView as retargetCallbackView$ } from "tint:ffi";\nimport { viewAt as viewAt$ } from "tint:ffi/unsafe";',
    );
  // Callback types: register a TypeScript function for C to keep (its C
  // function pointer is a registered thunk of the type's prototype).
  for (const callbackType of library.callbackTypes ?? []) {
    if (callbackType === undefined) throw "foreign callback type invariant";
    const name = callbackType.name,
      callback = callbackType.callback;
    const cases: string[] = [];
    for (let id = 0; id < registeredCallbackLimit; id++) {
      const stub = "thunk$" + name + "$" + String(id);
      lines.push(
        "export function " +
          stub +
          '(): number {\n  throw "FOREIGN_UNAVAILABLE";\n}',
      );
      stubs.push({
        name: stub,
        memory: {
          operation: "callback-address",
          type: { kind: "void" },
          offset: 0,
          minimum: 0,
          callback: callback.signature,
          slot: id,
        },
      });
      cases.push("  if (id === " + String(id) + ") return " + stub + "();");
    }
    const parameters: string[] = [],
      names: string[] = [];
    for (let index = 0; index < 7; index++) {
      parameters.push("a" + String(index) + ": number");
      names.push("a" + String(index));
    }
    const views = callbackViews(callback, name, names, "      ");
    lines.push(
      "export type " +
        name +
        " = " +
        callbackTsType(callback) +
        ";\nfunction address$" +
        name +
        "(id: number): number {\n" +
        cases.join("\n") +
        '\n  throw "callback id invariant";\n}\n/** Register `fn` for C to call during later may-callback calls; its C\n * function pointer (release it with tint:ffi\'s releaseCallback). */\nexport function ' +
        name +
        "(fn: " +
        name +
        "): number {\n" +
        views.declarations +
        "  const id = registerCallback$((" +
        parameters.join(", ") +
        "): number => {\n" +
        (views.leave === ""
          ? callbackResult(
              callback,
              "fn(" + views.arguments + ")",
              target,
              "    ",
              "",
            )
          : "    try {\n" +
            views.enter +
            callbackResult(
              callback,
              "fn(" + views.arguments + ")",
              target,
              "      ",
              views.leave,
            ) +
            "\n    } catch (error) {\n" +
            views.leave +
            "      throw error;\n    }") +
        "\n  });\n  const address = address$" +
        name +
        "(id);\n  noteCallback$(id, address);\n  return address;\n}",
    );
  }
  for (const declaration of library.functions) {
    if (declaration === undefined) throw "foreign function invariant";
    const direct = foreignCall(declaration);
    // A may-callback call (docs/native-ffi.md, "Callbacks") takes the
    // calling thread's callback state first.
    const mayCallback = declaration.signature.callClass === "may-callback";
    const stateFirst: ForeignOperand[] = ["bytes", "callback"];
    for (const operand of direct.operands) {
      if (operand === undefined) throw "foreign operand invariant";
      stateFirst.push(operand);
    }
    // Direct callbacks: their notes and views follow the prototype's
    // operands (not with a record result, whose buffer comes last).
    const directs: (readonly number[] | undefined)[] = [];
    let directCount = 0,
      directViewCount = 0;
    for (let index = 0; index < declaration.parameterForms.length; index++) {
      const callback = declaration.callbacks?.[index];
      const views =
        mayCallback &&
        declaration.resultForm !== "record" &&
        declaration.parameterForms[index] === "callback" &&
        callback !== undefined
          ? directViews(callback)
          : undefined;
      directs.push(views);
      if (views !== undefined) {
        directCount++;
        directViewCount += views.length;
      }
    }
    if (directCount > 0)
      for (let extra = 0; extra < 2 + directViewCount; extra++)
        stateFirst.push("callback");
    const call: ForeignCall = lazy
      ? { ...direct, indirect: true }
      : mayCallback
        ? {
            ...direct,
            operands: stateFirst,
            mayCallback: true,
            callbacks: callbackPrototypes(declaration),
            ...(directCount > 0 ? { directCallbacks: directs } : {}),
          }
        : direct;
    const wrapped = lazy || mayCallback || converts(declaration);
    const stubName = wrapped ? declaration.name + "$c" : declaration.name;
    const parameters = declaration.signature.parameters;
    const rawParameters: string[] = lazy
      ? ["target$: number"]
      : mayCallback
        ? [
            "state$: Uint8Array",
            "dispatcher$: (id: number, a0: number, a1: number, a2: number, a3: number, a4: number, a5: number, a6: number) => number",
          ]
        : [];
    for (let index = 0; index < parameters.length; index++) {
      const name = declaration.parameterNames[index],
        form = declaration.parameterForms[index],
        type = parameters[index];
      if (name === undefined || form === undefined || type === undefined)
        throw "foreign parameter invariant";
      rawParameters.push(
        name +
          ": " +
          (form === "number" || form === "boolean"
            ? tsType(form, type)
            : form === "callback"
              ? directs[index] !== undefined
                ? callbackTsType(declaration.callbacks?.[index] ?? noCallback)
                : adapterTsType(declaration.callbacks?.[index] ?? noCallback)
              : "Uint8Array"),
      );
    }
    if (directCount > 0) {
      rawParameters.push(
        "onThrow$: (error: unknown) => void",
        "onInvalid$: (code: number) => void",
      );
      for (let index = 0; index < parameters.length; index++) {
        const views = directs[index],
          callback = declaration.callbacks?.[index];
        if (views === undefined || callback === undefined) continue;
        for (let view = 0; view < views.length; view++) {
          const parameter = views[view] ?? 0;
          rawParameters.push(
            "view$" +
              (declaration.parameterNames[index] ?? "") +
              "$" +
              String(parameter) +
              ": View$<" +
              (callback.parameterRecords[parameter] ?? "") +
              ">",
          );
        }
      }
    }
    if (declaration.resultForm === "record")
      rawParameters.push("result$: Uint8Array");
    const rawResult =
      call.result === "record"
        ? "void"
        : tsType(declaration.resultForm, declaration.signature.result);
    // Stubs are exported runtime entries (the binding authority resolves
    // them by export); a wrapper's stub is its `$c` twin.
    lines.push(
      "export function " +
        stubName +
        "(" +
        rawParameters.join(", ") +
        "): " +
        rawResult +
        ' {\n  throw "FOREIGN_UNAVAILABLE";\n}',
    );
    stubs.push({ name: stubName, call });
    if (!wrapped) continue;
    const userParameters: string[] = [],
      prologue: string[] = [],
      args: string[] = [],
      rethrows: string[] = [];
    if (mayCallback) {
      prologue.push("  const state$ = callbackState$();");
      args.push("state$", "callbackDispatcher$()");
      // Registered callbacks' failures are rethrown after C returns.
      rethrows.push("  rethrowCallbackFailure$();");
    }
    if (lazy) {
      // Never call address 0: an absent library or symbol throws.
      prologue.push(
        "  const target$ = address$" +
          declaration.symbol +
          '();\n  if (target$ < 0)\n    throw new TypeError("optional C function ' +
          declaration.symbol +
          ' is not available");',
      );
      args.push("target$");
    }
    for (let index = 0; index < parameters.length; index++) {
      const name = declaration.parameterNames[index],
        form = declaration.parameterForms[index],
        type = parameters[index];
      if (name === undefined || form === undefined || type === undefined)
        throw "foreign parameter invariant";
      const callback = declaration.callbacks?.[index];
      if (form === "callback" && directs[index] !== undefined) {
        if (callback === undefined) throw "foreign callback invariant";
        // Called directly by its thunk: its record views are made once
        // and parked after the call; failures arrive through the notes.
        userParameters.push(name + ": " + callbackTsType(callback));
        const views = callbackViews(
          callback,
          name,
          callback.parameterNames,
          "  ",
        );
        prologue.push(views.declarations.trimEnd());
        if (views.leave !== "") rethrows.unshift(views.leave.trimEnd());
        args.push(name);
        continue;
      }
      if (form === "callback") {
        if (callback === undefined) throw "foreign callback invariant";
        userParameters.push(name + ": " + callbackTsType(callback));
        const adapter = callbackAdapter(name, callback, target);
        prologue.push(adapter.text);
        if (adapter.park !== "") rethrows.unshift(adapter.park.trimEnd());
        rethrows.push("  if (failed$" + name + ") throw error$" + name + ";");
        args.push("adapter$" + name);
        continue;
      }
      userParameters.push(name + ": " + tsType(form, type));
      if (mayCallback && (form === "bytes" || form === "terminated-bytes"))
        // A collection inside a callback may move movable arrays while C
        // holds their address: may-callback calls take non-moving storage.
        prologue.push(
          "  if (!stableBytes$(" +
            name +
            '))\n    throw new TypeError("may-callback calls take external storage or foreign memory for ' +
            name +
            '");',
        );
      if (form === "string") {
        helpers.add("cString");
        args.push("cString$(" + name + ")");
      } else if (form === "record" && type.kind === "record") {
        const layout = cLayout(type, target);
        if (!layout.ok) return { ok: false, error: layout.error };
        recordCodecs.add(type.name);
        prologue.push(
          "  const " +
            name +
            "$bytes = new Uint8Array(" +
            String(layout.value.size) +
            ");\n  write$" +
            type.name +
            "(" +
            name +
            "$bytes, 0, " +
            name +
            ");",
        );
        args.push(name + "$bytes");
      } else args.push(name);
    }
    if (directCount > 0) {
      // Direct callbacks share the call's failure: the first exception or
      // invalid value, rethrown once C has returned.
      prologue.push(
        '  let failed$ = false;\n  let error$: unknown = undefined;\n  const onThrow$ = (error: unknown): void => {\n    if (failed$) return;\n    failed$ = true;\n    error$ = error;\n  };\n  const onInvalid$ = (code: number): void => {\n    if (failed$) return;\n    failed$ = true;\n    error$ = new TypeError(code === 0 ? "null C record pointer" : "callback result out of range for its C type");\n  };',
      );
      args.push("onThrow$", "onInvalid$");
      for (let index = 0; index < parameters.length; index++) {
        const views = directs[index];
        if (views === undefined) continue;
        for (let view = 0; view < views.length; view++)
          args.push(
            "view$" +
              (declaration.parameterNames[index] ?? "") +
              "$" +
              String(views[view] ?? 0),
          );
      }
      rethrows.push("  if (failed$) throw error$;");
    }
    const result = declaration.signature.result;
    let body: string;
    if (declaration.resultForm === "record" && result.kind === "record") {
      const layout = cLayout(result, target);
      if (!layout.ok) return { ok: false, error: layout.error };
      recordCodecs.add(result.name);
      args.push("result$");
      body =
        "  const result$ = new Uint8Array(" +
        String(layout.value.size) +
        ");\n  " +
        stubName +
        "(" +
        args.join(", ") +
        ");\n  return read$" +
        result.name +
        "(result$, 0);";
    } else
      body =
        "  " +
        (declaration.resultForm === "void" ? "" : "return ") +
        stubName +
        "(" +
        args.join(", ") +
        ");";
    // What the callbacks raised is rethrown once C has returned.
    if (rethrows.length > 0) {
      const at = body.lastIndexOf("  return ");
      body =
        at < 0
          ? body + "\n" + rethrows.join("\n")
          : body.slice(0, at) +
            "  const value$ = " +
            body.slice(at + 9) +
            "\n" +
            rethrows.join("\n") +
            "\n  return value$;";
    }
    lines.push(
      "export function " +
        declaration.name +
        "(" +
        userParameters.join(", ") +
        "): " +
        tsType(declaration.resultForm, result) +
        " {\n" +
        (prologue.length === 0 ? "" : prologue.join("\n") + "\n") +
        body +
        "\n}",
    );
  }
  // Record codecs (and the codecs of nested records).
  const pending: string[] = [];
  for (const name of recordCodecs) {
    if (name === undefined) throw "codec invariant";
    pending.push(name);
  }
  const emitted = new Set<string>();
  for (let index = 0; index < pending.length; index++) {
    const name = pending[index];
    if (name === undefined) throw "codec queue invariant";
    if (emitted.has(name)) continue;
    emitted.add(name);
    let type: CType | undefined;
    for (const record of library.records) {
      if (record === undefined) throw "foreign record invariant";
      if (record.name === name) type = record.type;
    }
    if (type === undefined || type.kind !== "record")
      return { ok: false, error: "unknown record " + name };
    const codec = recordCodec(type, target, helpers, pending);
    if (!codec.ok) return codec;
    lines.push(codec.value);
  }
  if (helpers.has("cString")) lines.push(cStringHelper);
  if (helpers.has("integer") || helpers.has("f64")) lines.push(integerHelpers);
  if (helpers.has("f64") || helpers.has("f32")) lines.push(pow2Helpers);
  if (helpers.has("f64")) lines.push(f64Helpers);
  if (helpers.has("f32")) lines.push(f32Helpers);
  return {
    ok: true,
    value: { text: lines.join("\n") + "\n", stubs },
  };
}
function recordCodec(
  type: CType,
  target: CTarget,
  helpers: Set<string>,
  pending: string[],
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string } {
  if (type.kind !== "record") throw "codec record invariant";
  const layout = cLayout(type, target);
  if (!layout.ok) return layout;
  const writes: string[] = [],
    reads: string[] = [];
  for (let index = 0; index < type.fields.length; index++) {
    const field = type.fields[index],
      offset = layout.value.offsets[index];
    if (field === undefined || offset === undefined)
      throw "codec field invariant";
    const access = member(
      field.type,
      target,
      "value." + field.name,
      "offset + " + String(offset),
      helpers,
      pending,
      0,
    );
    if (!access.ok) return access;
    writes.push(access.write);
    reads.push(field.name + ": " + access.read);
  }
  return {
    ok: true,
    value:
      "function write$" +
      type.name +
      "(bytes: Uint8Array, offset: number, value: " +
      type.name +
      "): void {\n" +
      writes.join("\n") +
      "\n}\nfunction read$" +
      type.name +
      "(bytes: Uint8Array, offset: number): " +
      type.name +
      " {\n  return { " +
      reads.join(", ") +
      " };\n}",
  };
}
type MemberAccess =
  | { readonly ok: true; readonly write: string; readonly read: string }
  | { readonly ok: false; readonly error: string };
/** Statements writing `value` at byte `offset` and an expression reading
 * it back, for one record member. */
function member(
  type: CType,
  target: CTarget,
  value: string,
  offset: string,
  helpers: Set<string>,
  pending: string[],
  depth: number,
): MemberAccess {
  if (type.kind === "scalar") {
    const scalar = type.scalar;
    if (scalar === "f64") {
      helpers.add("f64");
      return {
        ok: true,
        write: "  writeF64$(bytes, " + offset + ", " + value + ");",
        read: "readF64$(bytes, " + offset + ")",
      };
    }
    if (scalar === "f32") {
      helpers.add("f32");
      helpers.add("integer");
      return {
        ok: true,
        write:
          "  writeInteger$(bytes, " +
          offset +
          ", 4, f32Bits$(" +
          value +
          "), 0, 4294967295);",
        read: "f32FromBits$(readInteger$(bytes, " + offset + ", 4, false))",
      };
    }
    helpers.add("integer");
    if (scalar === "bool")
      return {
        ok: true,
        write: "  bytes[" + offset + "] = " + value + " ? 1 : 0;",
        read: "(bytes[" + offset + "] ?? 0) !== 0",
      };
    const range = integerRange(scalar, target),
      bytes = cScalarBytes(scalar);
    return {
      ok: true,
      write:
        "  writeInteger$(bytes, " +
        offset +
        ", " +
        String(bytes) +
        ", " +
        value +
        ", " +
        String(range.min) +
        ", " +
        String(range.max) +
        ");",
      read:
        "readInteger$(bytes, " +
        offset +
        ", " +
        String(bytes) +
        ", " +
        (cScalarSigned(scalar, target) ? "true" : "false") +
        ")",
    };
  }
  if (type.kind === "pointer") {
    helpers.add("integer");
    return {
      ok: true,
      write:
        "  writeInteger$(bytes, " +
        offset +
        ", 8, " +
        value +
        ", 0, 9007199254740991);",
      read: "readInteger$(bytes, " + offset + ", 8, false)",
    };
  }
  if (type.kind === "record") {
    pending.push(type.name);
    return {
      ok: true,
      write: "  write$" + type.name + "(bytes, " + offset + ", " + value + ");",
      read: "read$" + type.name + "(bytes, " + offset + ")",
    };
  }
  if (type.kind === "array") {
    const element = cLayout(type.element, target);
    if (!element.ok) return element;
    const index = "i" + String(depth),
      local = "element" + String(depth);
    const inner = member(
      type.element,
      target,
      local,
      offset + " + " + index + " * " + String(element.value.size),
      helpers,
      pending,
      depth + 1,
    );
    if (!inner.ok) return inner;
    const list = "list" + String(depth);
    return {
      ok: true,
      write:
        "  if (" +
        value +
        ".length !== " +
        String(type.length) +
        ') throw new RangeError("C array member needs ' +
        String(type.length) +
        ' elements");\n  for (let ' +
        index +
        " = 0; " +
        index +
        " < " +
        String(type.length) +
        "; " +
        index +
        "++) {\n    const " +
        local +
        " = " +
        value +
        "[" +
        index +
        "];\n    if (" +
        local +
        ' === undefined) throw new RangeError("missing C array element");\n  ' +
        inner.write +
        "\n  }",
      read:
        "((): " +
        memberTsType(type) +
        " => { const " +
        list +
        ": " +
        memberTsType(type) +
        " = []; for (let " +
        index +
        " = 0; " +
        index +
        " < " +
        String(type.length) +
        "; " +
        index +
        "++) " +
        list +
        ".push(" +
        inner.read +
        "); return " +
        list +
        "; })()",
    };
  }
  return { ok: false, error: "unsupported record member" };
}
// KNOWN DEFECT (typed-pipeline gap, docs/native-ffi.md#known-defects): the helper
// texts carry explicit `: string` annotations because forward references to
// unannotated module constants fail in the native bootstrap.
const cStringHelper: string = `/** NUL-terminated UTF-8 for a C string argument; lone surrogates become
 * U+FFFD. */
function cString$(text: string): Uint8Array {
  let length = 1;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) length += 1;
    else if (unit < 0x800) length += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4;
        index++;
      } else length += 3;
    } else length += 3;
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (let index = 0; index < text.length; index++) {
    let point = text.charCodeAt(index);
    if (point >= 0xd800 && point <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        point = (point - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        index++;
      }
    }
    if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
    if (point < 0x80) bytes[at++] = point;
    else if (point < 0x800) {
      bytes[at++] = 0xc0 + Math.floor(point / 64);
      bytes[at++] = 0x80 + (point % 64);
    } else if (point < 0x10000) {
      bytes[at++] = 0xe0 + Math.floor(point / 4096);
      bytes[at++] = 0x80 + (Math.floor(point / 64) % 64);
      bytes[at++] = 0x80 + (point % 64);
    } else {
      bytes[at++] = 0xf0 + Math.floor(point / 262144);
      bytes[at++] = 0x80 + (Math.floor(point / 4096) % 64);
      bytes[at++] = 0x80 + (Math.floor(point / 64) % 64);
      bytes[at++] = 0x80 + (point % 64);
    }
  }
  bytes[at] = 0;
  return bytes;
}`;
const integerHelpers: string = `/** Little-endian C integer members; values must be integers in range. */
function writeInteger$(bytes: Uint8Array, offset: number, size: number, value: number, min: number, max: number): void {
  if (!(value >= min && value <= max) || Math.floor(value) !== value)
    throw new RangeError("value out of range for a C record member");
  let low = value, high = 0;
  if (size === 8) {
    high = Math.floor(value / 4294967296);
    low = value - high * 4294967296;
    if (high < 0) high += 4294967296;
  } else if (low < 0) low += size === 1 ? 256 : size === 2 ? 65536 : 4294967296;
  for (let index = 0; index < size && index < 4; index++) {
    bytes[offset + index] = low % 256;
    low = Math.floor(low / 256);
  }
  for (let index = 4; index < size; index++) {
    bytes[offset + index] = high % 256;
    high = Math.floor(high / 256);
  }
}
function readInteger$(bytes: Uint8Array, offset: number, size: number, signed: boolean): number {
  let low = 0, high = 0;
  for (let index = Math.min(size, 4) - 1; index >= 0; index--) low = low * 256 + (bytes[offset + index] ?? 0);
  for (let index = size - 1; index >= 4; index--) high = high * 256 + (bytes[offset + index] ?? 0);
  if (size < 8) {
    const span = size === 1 ? 256 : size === 2 ? 65536 : 4294967296;
    return signed && low >= span / 2 ? low - span : low;
  }
  if (signed && high >= 2147483648) high -= 4294967296;
  return high * 4294967296 + low;
}`;
// KNOWN DEFECT (typed-pipeline gap, docs/native-ffi.md#known-defects): the generated
// record codecs encode binary32/binary64 arithmetically because typed code
// lacks typed-array views over a shared buffer (`new Uint8Array(f.buffer)`)
// and Math.pow/log2/fround. Replace with views (or direct loads) once the
// pipelines converge.
const pow2Helpers: string = `/** 2^exponent, exactly (callers stay within binary64's range). */
function pow2$(exponent: number): number {
  let value = 1;
  for (let i = 0; i < exponent; i++) value *= 2;
  for (let i = 0; i > exponent; i--) value /= 2;
  return value;
}
/** Round half to even. */
function roundEven$(value: number): number {
  const floor = Math.floor(value), rest = value - floor;
  return rest > 0.5 || (rest === 0.5 && floor % 2 !== 0) ? floor + 1 : floor;
}
/** The binary exponent e of a finite nonzero magnitude: 2^e <= m < 2^(e+1). */
function exponentOf$(magnitude: number): number {
  let exponent = 0, scaled = magnitude;
  while (scaled >= 2) { scaled /= 2; exponent++; }
  while (scaled < 1) { scaled *= 2; exponent--; }
  return exponent;
}`;
const f64Helpers: string = `/** IEEE binary64 members as two little-endian words, computed exactly. */
function writeF64$(bytes: Uint8Array, offset: number, value: number): void {
  let high = 0, low = 0;
  if (value !== value) high = 0x7ff80000;
  else {
    const sign = value < 0 || 1 / value < 0 ? 0x80000000 : 0;
    const magnitude = Math.abs(value);
    if (magnitude === Infinity) high = sign + 0x7ff00000;
    else if (magnitude === 0) high = sign;
    else {
      const exponent = exponentOf$(magnitude);
      let biased = 0, mantissa = 0;
      if (exponent < -1022) mantissa = magnitude * pow2$(537) * pow2$(537);
      else {
        biased = exponent + 1023;
        mantissa = (magnitude / pow2$(exponent) - 1) * 4503599627370496;
      }
      const upper = Math.floor(mantissa / 4294967296);
      low = mantissa - upper * 4294967296;
      high = sign + biased * 1048576 + upper;
    }
  }
  writeInteger$(bytes, offset, 4, low, 0, 4294967295);
  writeInteger$(bytes, offset + 4, 4, high, 0, 4294967295);
}
function readF64$(bytes: Uint8Array, offset: number): number {
  const low = readInteger$(bytes, offset, 4, false),
    high = readInteger$(bytes, offset + 4, 4, false);
  const sign = high >= 0x80000000 ? -1 : 1;
  const biased = Math.floor(high / 1048576) % 2048,
    mantissa = (high % 1048576) * 4294967296 + low;
  if (biased === 2047) return mantissa === 0 ? sign * Infinity : NaN;
  if (biased === 0) return sign * mantissa * pow2$(-537) * pow2$(-537);
  return sign * (1 + mantissa / 4503599627370496) * pow2$(biased - 1023);
}`;
const f32Helpers: string = `/** IEEE binary32 bits of a number rounded to single precision. */
function f32Bits$(value: number): number {
  if (value !== value) return 0x7fc00000;
  const sign = value < 0 || 1 / value < 0 ? 0x80000000 : 0;
  const magnitude = Math.abs(value);
  if (magnitude === 0) return sign;
  let exponent = exponentOf$(magnitude);
  const scaled = magnitude / pow2$(exponent);
  if (exponent < -126) {
    const fraction = roundEven$(magnitude * pow2$(149));
    return sign + fraction;
  }
  let mantissa = roundEven$((scaled - 1) * 8388608);
  if (mantissa === 8388608) { mantissa = 0; exponent++; }
  if (exponent > 127) return sign + 0x7f800000;
  return sign + (exponent + 127) * 8388608 + mantissa;
}
function f32FromBits$(bits: number): number {
  const sign = bits >= 0x80000000 ? -1 : 1;
  const exponent = Math.floor(bits / 8388608) % 256, fraction = bits % 8388608;
  if (exponent === 255) return fraction === 0 ? sign * Infinity : NaN;
  if (exponent === 0) return sign * fraction * pow2$(-149);
  return sign * (1 + fraction / 8388608) * pow2$(exponent - 127);
}`;
