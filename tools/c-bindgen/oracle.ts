// The binding oracle (docs/native-ffi.md, "Binding generator"): checks a
// parsed declaration module against the C headers with clang on the host,
// independently of extraction. Records: clang's sizeof, _Alignof and
// offsetof of every declared member against `cLayout`. Functions: clang's
// own types of every parameter and result (C++ type traits over the
// header's prototype) against the declared signature. Clang is a test
// oracle here, never part of a Tint build.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cLayout,
  cScalarBytes,
  type CFunctionDeclaration,
  type CLibraryDeclaration,
  type CTarget,
  type CType,
} from "@tint/abi/c";
import { clangArguments, clangCommand, headerText } from "./extract.ts";
import type { BindingSpec, TargetName } from "./spec.ts";

/** Compiles and runs `source` (C or C++) after the spec's headers and
 * prelude; its standard output. */
function runProbe(
  spec: BindingSpec,
  target: TargetName,
  language: "c" | "c++",
  body: string,
): string {
  const directory = mkdtempSync(join(tmpdir(), "tint-c-oracle-"));
  try {
    const source = join(directory, language === "c" ? "probe.c" : "probe.cpp");
    const binary = join(directory, "probe");
    writeFileSync(
      source,
      headerText(spec, target, language) +
        "#include <stdio.h>\n#include <stddef.h>\n" +
        body,
    );
    const compiled = spawnSync(
      clangCommand(),
      [
        ...clangArguments(spec),
        "-x",
        language,
        ...(language === "c++"
          ? ["-std=c++17", "-fno-exceptions", "-fno-rtti"]
          : []),
        "-w",
        "-o",
        binary,
        source,
      ],
      { encoding: "utf8" },
    );
    if (compiled.status !== 0)
      throw new Error(
        `the ${language} oracle did not compile:\n${compiled.stderr}`,
      );
    const run = spawnSync(binary, [], { encoding: "utf8" });
    if (run.status !== 0)
      throw new Error(`the ${language} oracle failed:\n${run.stderr}`);
    return run.stdout;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Every declared record with a C spelling (`spellings`: record name to
 * a C type) against clang's layout; the disagreements. */
export function layoutOracle(
  spec: BindingSpec,
  target: TargetName,
  cTarget: CTarget,
  declaration: CLibraryDeclaration,
  spellings: ReadonlyMap<string, string>,
): string[] {
  const lines: string[] = [],
    expected: string[] = [];
  for (const record of declaration.records) {
    const c = spellings.get(record.name);
    if (c === undefined || record.type.kind !== "record") continue;
    const layout = cLayout(record.type, cTarget);
    if (!layout.ok) {
      expected.push(`${record.name}: ${layout.error}`);
      continue;
    }
    expected.push(
      [
        record.name,
        layout.value.size,
        layout.value.alignment,
        ...layout.value.offsets,
      ].join(" "),
    );
    lines.push(
      `  printf("%s %zu %zu", ${JSON.stringify(record.name)}, sizeof(${c}), _Alignof(${c}));`,
      ...record.type.fields.map(
        (field) => `  printf(" %zu", offsetof(${c}, ${field.name}));`,
      ),
      `  printf("\\n");`,
    );
  }
  if (lines.length === 0) return [];
  const actual = runProbe(
    spec,
    target,
    "c",
    `int main(void) {\n${lines.join("\n")}\n  return 0;\n}\n`,
  )
    .split("\n")
    .filter((line) => line !== "");
  const mismatches: string[] = [];
  for (const [position, line] of expected.entries())
    if (actual[position] !== line)
      mismatches.push(
        `record ${line.split(" ")[0]}: declared ${line}, clang ${actual[position] ?? "nothing"}`,
      );
  return mismatches;
}

// Type codes: v void, b1 bool, c1 char, i/u<bytes> integers, f<bytes>
// floats, r<bytes> records; pointers p:<pointee> with pointee v void, f
// function, p pointer, o opaque record, r<bytes>, or a scalar code.
const traits = `
template <class T, class = decltype(sizeof(T))> constexpr bool complete(int) { return true; }
template <class T> constexpr bool complete(...) { return false; }
template <class T> void scalar(const char *prefix) {
  using U = __remove_cv(T);
  if constexpr (__is_enum(U)) scalar<__underlying_type(U)>(prefix);
  else if constexpr (__is_same(U, bool)) printf("%sb1", prefix);
  else if constexpr (__is_same(U, char)) printf("%sc1", prefix);
  else if constexpr (__is_integral(U)) printf("%s%c%zu", prefix, __is_signed(U) ? 'i' : 'u', sizeof(U));
  else if constexpr (__is_floating_point(U)) printf("%sf%zu", prefix, sizeof(U));
  else printf("%s?", prefix);
}
template <class T> void pointee() {
  using U = __remove_cv(T);
  if constexpr (__is_same(U, void)) printf(":v");
  else if constexpr (__is_function(U)) printf(":f");
  else if constexpr (__is_pointer(U)) printf(":p");
  else if constexpr (__is_class(U) || __is_union(U)) {
    if constexpr (complete<U>(0)) printf(":r%zu", sizeof(U)); else printf(":o");
  } else scalar<U>(":");
}
template <class T> void code() {
  using U = __remove_cv(T);
  if constexpr (__is_same(U, void)) printf(" v");
  else if constexpr (__is_pointer(U)) { printf(" p"); pointee<__remove_pointer(U)>(); }
  else if constexpr (__is_class(U) || __is_union(U)) printf(" r%zu", sizeof(U));
  else scalar<U>(" ");
}
template <class F> struct Signature;
template <class R, class... A> struct Signature<R(A...)> {
  static void print() { code<R>(); printf(" |"); (code<A>(), ...); printf(" | fixed\\n"); }
};
template <class R, class... A> struct Signature<R(A...) noexcept> : Signature<R(A...)> {};
template <class R, class... A> struct Signature<R(A..., ...)> {
  static void print() { code<R>(); printf(" |"); (code<A>(), ...); printf(" | variadic\\n"); }
};
template <class R, class... A> struct Signature<R(A..., ...) noexcept> : Signature<R(A..., ...)> {};
`;

interface CPrototype {
  readonly result: string;
  readonly parameters: readonly string[];
  readonly variadic: boolean;
}
function scalarCode(type: CType): string | undefined {
  if (type.kind !== "scalar") return undefined;
  const scalar = type.scalar;
  if (scalar === "bool") return "b1";
  if (scalar === "char") return "c1";
  if (scalar === "f32" || scalar === "f64") return "f" + cScalarBytes(scalar);
  return (scalar.startsWith("i") ? "i" : "u") + cScalarBytes(scalar);
}
/** The codes a C pointee may have for a declared pointee. */
function pointeeAccepts(
  declared: CType,
  actual: string,
  target: CTarget,
): boolean {
  if (declared.kind === "void") return true;
  if (actual === ":v") return true;
  if (declared.kind === "scalar") {
    const code = ":" + scalarCode(declared);
    if (code === actual) return true;
    // char, signed char and unsigned char buffers are interchangeable bytes.
    return /^:[ciu]1$/.test(code) && /^:[ciu]1$/.test(actual);
  }
  if (declared.kind === "record") {
    const layout = cLayout(declared, target);
    if (layout.ok && actual === `:r${layout.value.size}`) return true;
    // A record standing for an array of the C pointee (out-parameters).
    const elements = new Set<string>();
    const visit = (type: CType): void => {
      if (type.kind === "array") visit(type.element);
      else if (type.kind === "pointer") elements.add(":p");
      else if (type.kind === "scalar") elements.add(":" + scalarCode(type));
      else if (type.kind === "record") {
        const inner = cLayout(type, target);
        elements.add(inner.ok ? `:r${inner.value.size}` : "?");
      }
    };
    for (const field of declared.fields) visit(field.type);
    return elements.size === 1 && elements.has(actual);
  }
  return false;
}
function valueAccepts(
  declared: CType,
  actual: string,
  target: CTarget,
  errno: boolean,
): boolean {
  switch (declared.kind) {
    case "void":
      return actual === "v";
    case "scalar": {
      const code = scalarCode(declared)!;
      if (code === actual) return true;
      // An errno-negated pointer result is read as isize.
      return errno && code === "i8" && actual.startsWith("p");
    }
    case "pointer":
      return (
        actual.startsWith("p:") &&
        pointeeAccepts(declared.pointee, actual.slice(1), target)
      );
    case "record": {
      const layout = cLayout(declared, target);
      if (!layout.ok) return false;
      if (actual === `r${layout.value.size}`) return true;
      // A word record standing for a pointer or 64-bit integer: 8 bytes
      // without floats take one general register like the C value.
      return (
        layout.value.size === 8 &&
        !holdsFloat(declared) &&
        (actual.startsWith("p") || actual === "i8" || actual === "u8")
      );
    }
    default:
      return false;
  }
}

function holdsFloat(type: CType): boolean {
  if (type.kind === "scalar")
    return type.scalar === "f32" || type.scalar === "f64";
  if (type.kind === "array") return holdsFloat(type.element);
  if (type.kind === "record")
    return type.fields.some((field) => holdsFloat(field.type));
  return false;
}

/** Every declared function against its C prototype; the disagreements. */
export function prototypeOracle(
  spec: BindingSpec,
  target: TargetName,
  cTarget: CTarget,
  declaration: CLibraryDeclaration,
): string[] {
  const functions = declaration.functions;
  if (functions.length === 0) return [];
  const symbols = [...new Set(functions.map((fn) => fn.symbol))];
  const body =
    traits +
    "int main() {\n" +
    symbols
      .map(
        (symbol) =>
          `  printf("%s", ${JSON.stringify(symbol)}); Signature<__typeof__(${symbol})>::print();`,
      )
      .join("\n") +
    "\n  return 0;\n}\n";
  const prototypes = new Map<string, CPrototype>();
  for (const line of runProbe(spec, target, "c++", body).split("\n")) {
    if (line === "") continue;
    const [head, parameters, kind] = line.split(" |");
    const [symbol, result] = (head ?? "").split(" ");
    prototypes.set(symbol!, {
      result: result!,
      parameters:
        (parameters ?? "").trim() === "" ? [] : parameters!.trim().split(" "),
      variadic: (kind ?? "").trim() === "variadic",
    });
  }
  const mismatches: string[] = [];
  for (const fn of functions) {
    const prototype = prototypes.get(fn.symbol);
    if (prototype === undefined) {
      mismatches.push(
        `function ${fn.name}: clang has no prototype for ${fn.symbol}`,
      );
      continue;
    }
    mismatches.push(...compareFunction(fn, prototype, cTarget));
  }
  return mismatches;
}
function compareFunction(
  fn: CFunctionDeclaration,
  prototype: CPrototype,
  target: CTarget,
): string[] {
  const mismatches: string[] = [];
  const signature = fn.signature;
  const fixed = signature.fixedParameters;
  const declaredVariadic = fixed < signature.parameters.length;
  if (fixed !== prototype.parameters.length)
    mismatches.push(
      `function ${fn.name}: ${fixed} fixed parameters declared, C has ${prototype.parameters.length}`,
    );
  if (declaredVariadic && !prototype.variadic)
    mismatches.push(
      `function ${fn.name}: variadic arguments declared, C is not variadic`,
    );
  for (
    let position = 0;
    position < Math.min(fixed, prototype.parameters.length);
    position++
  ) {
    const declared = signature.parameters[position]!,
      actual = prototype.parameters[position]!;
    if (!valueAccepts(declared, actual, target, false))
      mismatches.push(
        `function ${fn.name} parameter ${fn.parameterNames[position]}: declared ${JSON.stringify(declared)}, C ${actual}`,
      );
  }
  // A declared void result ignores whatever C returns.
  if (
    signature.result.kind !== "void" &&
    !valueAccepts(
      signature.result,
      prototype.result,
      target,
      signature.errno === "negated-result",
    )
  )
    mismatches.push(
      `function ${fn.name} result: declared ${JSON.stringify(signature.result)}, C ${prototype.result}`,
    );
  if (signature.errno === "negated-result" && prototype.result.startsWith("u"))
    mismatches.push(`function ${fn.name}: OrErrno on an unsigned C result`);
  return mismatches;
}
