import { numericConstant } from "./numeric-constants.ts";
export { numericConstant } from "./numeric-constants.ts";
import type { CViewUse } from "./c-views.ts";
import { syntaxHash } from "../syntax/index.ts";
import {
  createKeyIndex,
  type ReadonlyKeyIndex,
} from "@tint/foundation/collections/key-index";
import type {
  Module,
  Statement,
  Expression,
  TypeNode,
  Span,
  Binding,
  Parameter,
} from "../syntax/index.ts";
export type { Expression, Statement, Span } from "../syntax/index.ts";
export type ScalarType =
  | "general"
  | "optional-boolean"
  | "primitive"
  | "string"
  | "reference"
  | "optional-reference"
  | "optional-string"
  | "number"
  | "boolean"
  | "Uint8Array"
  | "Uint16Array"
  | "Uint32Array"
  | "Float64Array"
  | "optional-number";
export type ReturnType = ScalarType | "void";
export type FunctionDeclaration = Statement & { readonly kind: "function" };
export interface Local {
  readonly hoisted?: boolean;
  readonly id: number;
  readonly name: string;
  readonly type: ScalarType;
  readonly mutable: boolean;
  readonly parameter: boolean;
  readonly span: Span;
}
/** A run-time category test of a general value (a checked downcast). */
export type DowncastTest =
  "undefined" | "number" | "boolean" | "string" | "null" | "Uint8Array";
export { withRealmTypedArrayGlobals } from "./interfaces.ts";
export type NativeTypedArray =
  "Uint8Array" | "Uint16Array" | "Uint32Array" | "Float64Array";
export interface ExpressionInfo {
  readonly realmGlobal?: number | undefined;
  readonly realmInstanceOf?: number | undefined;
  readonly arrayInstance?: NativeTypedArray | undefined;
  readonly arrayReceiver?: NativeTypedArray | "realm" | undefined;
  readonly arrayMethod?: number | undefined;
  readonly arraySetSource?: NativeTypedArray | undefined;
  readonly dynamicObject?:
    | "literal"
    | "read"
    | "write"
    | "has"
    | "delete"
    | "enroll"
    | "own-enumeration"
    | undefined;
  readonly dynamicContract?: string | undefined;
  readonly dynamicEnrollment?: string | undefined;
  /** A checked downcast (`x as T` from unknown): the categories it accepts
   * and the record layouts (descriptor indices) of accepted object types;
   * any other value throws a TypeError. */
  readonly downcast?:
    | {
        readonly tests: readonly DowncastTest[];
        readonly records: readonly number[];
        readonly errors?:
          readonly ("Error" | "TypeError" | "RangeError")[] | undefined;
      }
    | undefined;
  /** C views: the use of a creation call or member/element read, or the
   * write target of an assignment, compound assignment or update. */
  readonly cView?: CViewUse | undefined;
  readonly chainType?: ScalarType | "void" | undefined;
  readonly chainReceiverType?: ScalarType | undefined;
  readonly never?: boolean;
  readonly functionTarget?: number | undefined;
  readonly indirect?: boolean | undefined;
  readonly discardCallResult?: boolean | undefined;
  readonly typeofFunction?: boolean | undefined;
  /** The value is a BigInt (a reference to js-runtime's BigIntValue record),
   * possibly absent (`bigint | undefined`); operations on it call the
   * `bigint` runtime helpers. */
  readonly bigint?: boolean | undefined;
  /** `typeof` of a general value: the BigIntValue record layout, whose
   * descriptor marks a BigInt (general values carry BigInts as objects). */
  readonly bigIntRecord?: number | undefined;
  readonly realmTypeof?: number | undefined;
  /** A list iterated by for-of whose element type excludes undefined: a
   * hole throws a TypeError instead of binding undefined. */
  readonly holeCheck?: boolean | undefined;
  /** A fresh list packed after the leading arguments of a typed call. */
  readonly rest?:
    | {
        readonly start: number;
        readonly element: "number" | "string" | number;
        readonly admitsUndefined: boolean;
      }
    | undefined;
  readonly listElement?: "number" | "string" | number | undefined;
  readonly mapKey?: "number" | "string" | number | undefined;
  readonly mapValue?: "number" | "string" | number | undefined;
  readonly setElement?: "number" | "string" | number | undefined;
  readonly undefinedValue?: boolean;
  readonly nullValue?: boolean;
  readonly constant?: number | boolean | string | undefined;
  readonly builtin?:
    | "function-call"
    | "string-convert"
    | "number-from-bigint"
    | "bigint-identity"
    | "bigint-from-number"
    | "bigint-from-boolean"
    | "list-read"
    | "list-write"
    | "map-new"
    | "map-get"
    | "map-has"
    | "map-set"
    | "map-delete"
    | "map-clear"
    | "map-size"
    | "set-new"
    | "set-has"
    | "set-add"
    | "set-delete"
    | "set-clear"
    | "set-size"
    | "list-length"
    | "list-join"
    | "list-sort"
    | "list-filter"
    | "list-map"
    | "indexed-for-each"
    | "indexed-some"
    | "indexed-every"
    | "indexed-find-last-index"
    | "indexed-find-last"
    | "indexed-find-index"
    | "indexed-find"
    | "list-splice"
    | "list-slice"
    | "list-index-of"
    | "list-includes"
    | "list-pop"
    | "list-shift"
    | "list-unshift"
    | "list-push"
    | "is-integer"
    | "is-safe-integer"
    | "is-finite"
    | "is-nan"
    | "ceil"
    | "sqrt"
    | "round"
    | "clz32"
    | "trunc"
    | "abs"
    | "sign"
    | "floor"
    | "math-imul"
    | "math-min"
    | "math-max"
    | "array-set"
    | "array-subarray"
    | "array-slice"
    | "error-new"
    | "error-is"
    | "error-property"
    | "range-error-new"
    | "range-error-is"
    | "type-error-new"
    | "type-error-is"
    | "array-buffer"
    | "array-byte-offset"
    | "array-byte-length"
    | "array-new"
    | "array-join"
    | "array-at"
    | "array-reverse"
    | "list-reverse"
    | "list-resize"
    | "list-at"
    | "array-fill"
    | "list-fill"
    | "string-from-code-units"
    | "string-from-code-points"
    | "string-length"
    | "array-length"
    | "string-starts-with"
    | "string-ends-with"
    | "string-includes"
    | "string-index-of"
    | "string-last-index-of"
    | "string-split"
    | "string-repeat"
    | "string-pad-start"
    | "string-pad-end"
    | "string-concat"
    | "string-trim"
    | "string-trim-start"
    | "string-trim-end"
    | "string-substring"
    | "string-slice"
    | "string-read"
    | "string-code-point"
    | "string-char-at"
    | "string-at"
    | "string-code-unit"
    | undefined;
  readonly type: ReturnType;
  readonly local: number | undefined;
  readonly callee: number | undefined;
}
export interface CheckedFunction {
  /** This function reads its own incoming receiver, separately from parameters. */
  readonly receiver?: boolean;
  /** Typed local used to initialize an owned lexical receiver cell. */
  readonly receiverLocal?: number;
  readonly exhaustiveSwitches?: ReadonlySet<Statement>;
  readonly id: number;
  readonly node: FunctionDeclaration;
  readonly parameters: readonly ScalarType[];
  readonly returnType: ReturnType;
  readonly locals: readonly Local[];
  readonly expressions: ReadonlyKeyIndex<Expression, ExpressionInfo>;
  readonly declarations: ReadonlyKeyIndex<Binding | Parameter, Local>;
}
export interface CheckedModule {
  readonly functions: readonly CheckedFunction[];
}
export interface Diagnostic extends Span {
  readonly code:
    | "INVALID_BINDING"
    | "UNSUPPORTED"
    | "UNKNOWN_NAME"
    | "DUPLICATE_NAME"
    | "UNINITIALIZED"
    | "IMMUTABLE"
    | "TYPE_MISMATCH"
    | "ARITY"
    | "MISSING_RETURN"
    | "LIMIT";
  readonly message: string;
}
export type CheckResult =
  | { readonly ok: true; readonly value: CheckedModule }
  | { readonly ok: false; readonly error: Diagnostic };
interface Signature {
  readonly id: number;
  readonly node: FunctionDeclaration;
  readonly parameters: readonly ScalarType[];
  readonly minimumArguments: number;
  readonly returnType: ReturnType;
}
interface Entry {
  local: Local | undefined;
  initialized: boolean;
}
export function checkModule(module: Module): CheckResult {
  const abort = {},
    signatures = new Map<string, Signature>(),
    functions: CheckedFunction[] = [];
  let failure: Diagnostic | undefined;
  function fail(node: Span, code: Diagnostic["code"], message: string): never {
    failure = { start: node.start, end: node.end, code, message };
    throw abort;
  }
  function bindingName(name: string, node: Span): void {
    if (name === "eval" || name === "arguments")
      fail(
        node,
        "INVALID_BINDING",
        "binding name is forbidden in modules: " + name,
      );
  }
  function annotation(
    node: TypeNode | undefined,
    span: Span,
    allowVoid: boolean,
  ): ReturnType {
    if (
      node?.kind === "union" &&
      node.members.length === 2 &&
      node.members.every(
        (m) =>
          m.kind === "named" &&
          (m.arguments?.length ?? 0) === 0 &&
          (m.name === "number" || m.name === "undefined"),
      ) &&
      node.members.some((m) => m.kind === "named" && m.name === "number") &&
      node.members.some((m) => m.kind === "named" && m.name === "undefined")
    )
      return "optional-number";
    if (
      node === undefined ||
      node.kind !== "named" ||
      (node.arguments?.length ?? 0) !== 0
    )
      return fail(span, "UNSUPPORTED", "explicit scalar annotation required");
    if (
      node.name === "number" ||
      node.name === "boolean" ||
      node.name === "Uint32Array" ||
      node.name === "Float64Array" ||
      node.name === "Uint8Array" ||
      node.name === "Uint16Array"
    )
      return node.name;
    if (allowVoid && node.name === "void") return "void";
    return fail(
      node,
      "UNSUPPORTED",
      "type is outside the scalar checking slice",
    );
  }
  function scalar(node: TypeNode | undefined, span: Span): ScalarType {
    const t = annotation(node, span, false);
    if (t === "void") throw "scalar annotation invariant";
    return t;
  }
  function array(type: ReturnType, node: Span): ScalarType {
    if (
      type !== "Uint8Array" &&
      type !== "Uint16Array" &&
      type !== "Uint32Array" &&
      type !== "Float64Array"
    )
      fail(node, "TYPE_MISMATCH", "expected an supported numeric typed array");
    return type;
  }
  function same(actual: ReturnType, expected: ReturnType, node: Span): void {
    if (
      actual !== expected &&
      !(actual === "number" && expected === "optional-number")
    )
      fail(
        node,
        "TYPE_MISMATCH",
        "expected " + expected + ", received " + actual,
      );
  }
  try {
    for (const node of module.statements) {
      if (node === undefined) throw "missing module statement";
      if (node.kind === "empty" || node.kind === "debugger") continue;
      if (node.kind !== "function")
        fail(
          node,
          "UNSUPPORTED",
          "only top-level function declarations are implemented",
        );
      if (node.async)
        fail(
          node,
          "UNSUPPORTED",
          "typed async function lowering is not implemented",
        );
      if (node.generator)
        fail(
          node,
          "UNSUPPORTED",
          "generator suspension lowering is not implemented",
        );
      if (node.typeParameters?.length)
        fail(node, "UNSUPPORTED", "generic functions require specialization");
      bindingName(node.name, node);
      if (signatures.has(node.name))
        fail(node, "DUPLICATE_NAME", "duplicate function " + node.name);
      let minimumArguments = 0,
        seenOptional = false;
      const parameters = node.parameters.map((p, i): ScalarType => {
        if (p === undefined) throw "missing parameter";
        if (p.kind === "pattern-parameter")
          fail(
            p,
            "UNSUPPORTED",
            "scalar parameter destructuring is not supported yet",
          );
        if (p.rest)
          fail(p, "UNSUPPORTED", "scalar rest parameters are not implemented");
        const type = scalar(p.type, p);
        if (p.optional || p.initializer !== undefined) {
          if (p.optional) seenOptional = true;
          if (type !== "number" && type !== "optional-number")
            fail(
              p,
              "UNSUPPORTED",
              "optional and default parameters currently require numeric types",
            );
          return "optional-number";
        }
        if (seenOptional)
          fail(
            p,
            "ARITY",
            "required parameter cannot follow an optional parameter",
          );
        minimumArguments = i + 1;
        return type;
      });
      signatures.set(node.name, {
        id: signatures.size,
        node,
        parameters,
        minimumArguments,
        returnType: annotation(node.returnType, node, true),
      });
    }
    for (const [name, signature] of signatures) {
      const locals: Local[] = [],
        expressions = createKeyIndex<Expression, ExpressionInfo>(syntaxHash),
        declarations = createKeyIndex<Binding | Parameter, Local>(syntaxHash);
      const scopes: { readonly names: Map<string, Entry> }[] = [
        { names: new Map<string, Entry>() },
      ];
      let present = new Set<number>();
      let depth = 0,
        loops = 0;
      function scope(): Map<string, Entry> {
        const s = scopes[scopes.length - 1];
        if (s === undefined) throw "scope invariant";
        return s.names;
      }
      function reserve(name: string, node: Span): Entry {
        bindingName(name, node);
        if (scope().has(name))
          fail(node, "DUPLICATE_NAME", "duplicate binding " + name);
        const e: Entry = { local: undefined, initialized: false };
        scope().set(name, e);
        return e;
      }
      function lookup(name: string): Entry | undefined {
        const matched = scopes.findLast((candidate): boolean => {
          if (candidate === undefined) throw "missing scope";
          return candidate.names.has(name);
        });
        return matched === undefined ? undefined : matched.names.get(name);
      }
      function local(name: string, node: Span): Local {
        const e = lookup(name);
        if (e === undefined) {
          if (signatures.has(name))
            fail(node, "UNSUPPORTED", "function values are not implemented");
          return fail(node, "UNKNOWN_NAME", "unknown binding " + name);
        }
        const value = e.local;
        if (!e.initialized || value === undefined)
          return fail(
            node,
            "UNINITIALIZED",
            "binding is not initialized: " + name,
          );
        return value;
      }
      function declare(
        node: Binding | Parameter,
        type: ScalarType,
        mutable: boolean,
        parameter: boolean,
        entry: Entry,
      ): void {
        if (node.kind === "pattern-parameter")
          fail(node, "UNSUPPORTED", "unchecked parameter pattern");
        const l: Local = {
          id: locals.length,
          name: node.name,
          type,
          mutable,
          parameter,
          span: { start: node.start, end: node.end },
        };
        locals.push(l);
        entry.local = l;
        entry.initialized = true;
        declarations.set(node, l);
      }
      function intersect(
        a: ReadonlySet<number>,
        b: ReadonlySet<number>,
      ): Set<number> {
        const result = new Set<number>();
        for (const id of a) if (b.has(id)) result.add(id);
        return result;
      }
      function ungroup(node: Expression): Expression {
        while (node.kind === "group") node = node.expression;
        return node;
      }
      function pure(node: Expression): boolean {
        switch (node.kind) {
          case "number":
          case "boolean":
          case "identifier":
            return true;
          case "group":
            return pure(node.expression);
          case "unary":
            return pure(node.operand);
          case "binary":
            return pure(node.left) && pure(node.right);
          default:
            return false;
        }
      }
      function optionalLocal(node: Expression): number | undefined {
        node = ungroup(node);
        if (node.kind !== "identifier") return undefined;
        const id = expressions.get(node)?.local;
        return id !== undefined && locals[id]?.type === "optional-number"
          ? id
          : undefined;
      }
      function isUndefined(node: Expression): boolean {
        node = ungroup(node);
        return (
          node.kind === "identifier" &&
          node.name === "undefined" &&
          expressions.get(node)?.local === undefined &&
          lookup(node.name) === undefined &&
          !signatures.has(node.name)
        );
      }
      function refine(
        node: Expression,
        truth: boolean,
        base: ReadonlySet<number>,
      ): Set<number> {
        const result = new Set(base);
        if (!pure(node)) return result;
        node = ungroup(node);
        if (node.kind === "unary" && node.operator === "!")
          return refine(node.operand, !truth, base);
        if (node.kind === "binary") {
          if (node.operator === "&&")
            return truth
              ? refine(node.right, true, refine(node.left, true, base))
              : intersect(
                  refine(node.left, false, base),
                  refine(node.right, false, refine(node.left, true, base)),
                );
          if (node.operator === "||")
            return !truth
              ? refine(node.right, false, refine(node.left, false, base))
              : intersect(
                  refine(node.left, true, base),
                  refine(node.right, true, refine(node.left, false, base)),
                );
          if (["===", "==", "!==", "!="].includes(node.operator)) {
            const id = isUndefined(node.right)
              ? optionalLocal(node.left)
              : isUndefined(node.left)
                ? optionalLocal(node.right)
                : undefined;
            if (id !== undefined) {
              if (truth === (node.operator === "!==" || node.operator === "!="))
                result.add(id);
              else result.delete(id);
              return result;
            }
          }
        }
        const id = optionalLocal(node);
        if (truth && id !== undefined) result.add(id);
        return result;
      }
      function assigned(id: number, type: ReturnType): void {
        if (type === "number") present.add(id);
        else present.delete(id);
      }
      function enter(node: Span): void {
        if (++depth > 256)
          fail(node, "LIMIT", "checker nesting limit exceeded");
      }
      function expression(node: Expression): ReturnType {
        if (
          (node.kind === "member" ||
            node.kind === "index" ||
            node.kind === "call") &&
          node.optional === true
        )
          fail(
            node,
            "UNSUPPORTED",
            "optional chaining requires short-circuit checking and lowering",
          );
        enter(node);
        try {
          let type: ReturnType,
            constant: number | undefined,
            localId: number | undefined,
            callee: number | undefined,
            builtin: ExpressionInfo["builtin"];
          switch (node.kind) {
            case "number":
              type = "number";
              break;
            case "boolean":
              type = "boolean";
              break;
            case "identifier": {
              if (
                lookup(node.name) === undefined &&
                !signatures.has(node.name)
              ) {
                constant = numericConstant("", node.name);
                if (constant !== undefined) {
                  type = "number";
                  break;
                }
              }
              if (
                node.name === "undefined" &&
                lookup(node.name) === undefined &&
                !signatures.has(node.name)
              ) {
                type = "optional-number";
                break;
              }
              const l = local(node.name, node);
              type =
                l.type === "optional-number" && present.has(l.id)
                  ? "number"
                  : l.type;
              localId = l.id;
              break;
            }
            case "group":
              type = expression(node.expression);
              break;
            case "unary": {
              const operand = expression(node.operand);
              if (node.operator === "void") type = "optional-number";
              else if (node.operator === "!") {
                if (operand === "void")
                  fail(node, "TYPE_MISMATCH", "void has no truth value");
                type = "boolean";
              } else if (["+", "-", "~"].includes(node.operator)) {
                same(operand, "number", node.operand);
                type = "number";
              } else
                return fail(
                  node,
                  "UNSUPPORTED",
                  "unary operator not implemented",
                );
              break;
            }
            case "index":
              array(expression(node.object), node.object);
              same(expression(node.index), "number", node.index);
              type = "optional-number";
              break;
            case "member": {
              let receiver = node.object;
              while (receiver.kind === "group") receiver = receiver.expression;
              if (
                receiver.kind === "identifier" &&
                lookup(receiver.name) === undefined &&
                !signatures.has(receiver.name) &&
                numericConstant(receiver.name, node.property) !== undefined
              ) {
                type = "number";
                constant = numericConstant(receiver.name, node.property);
                break;
              }
              array(expression(node.object), node.object);
              if (node.property !== "length")
                return fail(
                  node,
                  "UNSUPPORTED",
                  "only Uint32Array.length is implemented",
                );
              type = "number";
              break;
            }
            case "binary": {
              if (node.operator === ",") {
                expression(node.left);
                type = expression(node.right);
                break;
              }
              if (node.operator === "??") {
                const left = expression(node.left),
                  before = new Set(present);
                const right = expression(node.right);
                present =
                  left === "number" ? before : intersect(before, present);
                if (
                  (left !== "number" && left !== "optional-number") ||
                  (right !== "number" && right !== "optional-number")
                )
                  fail(
                    node,
                    "UNSUPPORTED",
                    "nullish operands currently require numbers or optional numbers",
                  );
                type = left === "number" ? "number" : right;
                break;
              }
              const a = expression(node.left),
                before = new Set(present);
              if (node.operator === "&&" || node.operator === "||")
                present = refine(node.left, node.operator === "&&", before);
              const b = expression(node.right);
              if (node.operator === "&&" || node.operator === "||")
                present = intersect(
                  refine(node.left, node.operator !== "&&", before),
                  present,
                );
              if (["&&", "||"].includes(node.operator)) {
                if (a === "optional-number" || b === "optional-number") {
                  same(a, "optional-number", node);
                  same(b, "optional-number", node);
                } else same(a, b, node);
                if (a === "void") fail(node, "TYPE_MISMATCH", "void operands");
                type =
                  a === "optional-number" || b === "optional-number"
                    ? "optional-number"
                    : a;
              } else if (["===", "!==", "==", "!="].includes(node.operator)) {
                if (a === "optional-number" || b === "optional-number") {
                  same(a, "optional-number", node);
                  same(b, "optional-number", node);
                } else same(a, b, node);
                if (a === "void") fail(node, "TYPE_MISMATCH", "void operands");
                type = "boolean";
              } else if (
                [
                  "+",
                  "-",
                  "*",
                  "/",
                  "%",
                  "<<",
                  ">>",
                  ">>>",
                  "&",
                  "|",
                  "^",
                  "<",
                  ">",
                  "<=",
                  ">=",
                ].includes(node.operator)
              ) {
                same(a, "number", node.left);
                same(b, "number", node.right);
                type = ["<", ">", "<=", ">="].includes(node.operator)
                  ? "boolean"
                  : "number";
              } else
                return fail(
                  node,
                  "UNSUPPORTED",
                  "binary operator not implemented",
                );
              break;
            }
            case "update":
            case "compound": {
              let target = node.target;
              while (target.kind === "group") target = target.expression;
              if (target.kind !== "identifier")
                return fail(
                  target,
                  "UNSUPPORTED",
                  "updates currently require a numeric local",
                );
              const l = local(target.name, target);
              if (!l.mutable)
                fail(target, "IMMUTABLE", "cannot assign to const " + l.name);
              if (node.kind === "compound" && node.operator === "??") {
                if (l.type !== "number" && l.type !== "optional-number")
                  fail(
                    target,
                    "TYPE_MISMATCH",
                    "nullish assignment requires a numeric local",
                  );
                const before = new Set(present);
                const wasPresent = l.type === "number" || present.has(l.id);
                const right = expression(node.value);
                if (right !== "number" && right !== "optional-number")
                  fail(
                    node.value,
                    "TYPE_MISMATCH",
                    "nullish assignment requires a numeric value",
                  );
                if (l.type === "number") same(right, "number", node.value);
                assigned(l.id, right);
                if (wasPresent) present = before;
                else {
                  before.add(l.id);
                  present = intersect(before, present);
                }
                type =
                  wasPresent || right === "number"
                    ? "number"
                    : "optional-number";
                localId = l.id;
                expressions.set(target, {
                  type: l.type,
                  local: l.id,
                  callee: undefined,
                });
                break;
              }
              const logical =
                node.kind === "compound" &&
                (node.operator === "&&" || node.operator === "||");
              const required =
                logical && l.type === "boolean" ? "boolean" : "number";
              same(
                l.type === "optional-number" && present.has(l.id)
                  ? "number"
                  : l.type,
                required,
                target,
              );
              if (node.kind === "compound") {
                const conditional =
                  node.operator === "&&" || node.operator === "||";
                const before = conditional ? new Set(present) : undefined;
                same(expression(node.value), required, node.value);
                if (before !== undefined) present = intersect(before, present);
              }
              type = required;
              localId = l.id;
              assigned(l.id, type);
              expressions.set(target, {
                type: l.type,
                local: l.id,
                callee: undefined,
              });
              break;
            }
            case "assignment": {
              let target = node.target;
              while (target.kind === "group") target = target.expression;
              if (target.kind === "index") {
                array(expression(target.object), target.object);
                same(expression(target.index), "number", target.index);
                same(expression(node.value), "number", node.value);
                type = "number";
                break;
              }
              if (target.kind !== "identifier")
                return fail(
                  target,
                  "UNSUPPORTED",
                  "only locals and Uint32Array elements are assignable",
                );
              const l = local(target.name, target);
              if (!l.mutable)
                fail(target, "IMMUTABLE", "cannot assign to const " + l.name);
              type = expression(node.value);
              same(type, l.type, node.value);
              assigned(l.id, type);
              localId = l.id;
              expressions.set(target, {
                type: l.type,
                local: l.id,
                callee: undefined,
              });
              break;
            }
            case "conditional": {
              const condition = expression(node.test);
              if (condition === "void")
                fail(node.test, "TYPE_MISMATCH", "void condition");
              const before = new Set(present);
              present = refine(node.test, true, before);
              type = expression(node.consequent);
              const afterYes = new Set(present);
              present = refine(node.test, false, before);
              const alternate = expression(node.alternate);
              present = intersect(afterYes, present);
              if (
                type === "optional-number" ||
                alternate === "optional-number"
              ) {
                same(type, "optional-number", node.consequent);
                same(alternate, "optional-number", node.alternate);
                type = "optional-number";
              } else same(alternate, type, node.alternate);
              if (type === "void")
                fail(
                  node,
                  "UNSUPPORTED",
                  "void conditional values are not implemented",
                );
              break;
            }
            case "new": {
              const target = ungroup(node.callee);
              if (
                target.kind !== "identifier" ||
                lookup(target.name) !== undefined ||
                signatures.has(target.name) ||
                (target.name !== "Uint8Array" &&
                  target.name !== "Uint16Array" &&
                  target.name !== "Uint32Array" &&
                  target.name !== "Float64Array")
              )
                fail(
                  node,
                  "UNSUPPORTED",
                  "only unshadowed supported typed-array constructors are supported",
                );
              if (node.typeArguments.length !== 0 || node.arguments.length > 1)
                fail(
                  node,
                  "ARITY",
                  "typed-array construction accepts an optional numeric length or supported typed-array source",
                );
              for (const arg of node.arguments) {
                if (arg === undefined) throw "missing call argument";
                const t = expression(arg);
                if (
                  t !== "number" &&
                  t !== "optional-number" &&
                  t !== "Uint8Array" &&
                  t !== "Uint16Array" &&
                  t !== "Uint32Array" &&
                  t !== "Float64Array"
                )
                  fail(
                    arg,
                    "TYPE_MISMATCH",
                    "array input must be numeric, undefined or a supported typed array",
                  );
              }
              type =
                target.name === "Uint8Array"
                  ? "Uint8Array"
                  : target.name === "Uint16Array"
                    ? "Uint16Array"
                    : target.name === "Uint32Array"
                      ? "Uint32Array"
                      : "Float64Array";
              builtin = "array-new";
              break;
            }
            case "call": {
              if (node.typeArguments?.length)
                fail(
                  node,
                  "UNSUPPORTED",
                  "generic calls require specialization",
                );
              let target = node.callee;
              while (target.kind === "group") target = target.expression;
              if (target.kind === "member") {
                let object = target.object;
                while (object.kind === "group") object = object.expression;
                if (
                  object.kind === "identifier" &&
                  lookup(object.name) === undefined &&
                  !signatures.has(object.name) &&
                  ((object.name === "Number" &&
                    (target.property === "isInteger" ||
                      target.property === "isNaN" ||
                      target.property === "isFinite")) ||
                    (object.name === "Math" &&
                      [
                        "ceil",
                        "floor",
                        "trunc",
                        "abs",
                        "sign",
                        "clz32",
                        "round",
                        "sqrt",
                      ].includes(target.property)))
                ) {
                  if (node.arguments.length !== 1)
                    fail(
                      node,
                      "ARITY",
                      "built-in requires one argument in this slice",
                    );
                  const argument = node.arguments[0];
                  if (argument === undefined)
                    throw "builtin argument invariant";
                  const argType = expression(argument);
                  builtin =
                    object.name === "Number"
                      ? target.property === "isNaN"
                        ? "is-nan"
                        : target.property === "isFinite"
                          ? "is-finite"
                          : "is-integer"
                      : target.property === "sqrt"
                        ? "sqrt"
                        : target.property === "round"
                          ? "round"
                          : target.property === "clz32"
                            ? "clz32"
                            : target.property === "trunc"
                              ? "trunc"
                              : target.property === "abs"
                                ? "abs"
                                : target.property === "sign"
                                  ? "sign"
                                  : target.property === "floor"
                                    ? "floor"
                                    : "ceil";
                  if (
                    builtin !== "is-integer" &&
                    builtin !== "is-finite" &&
                    builtin !== "is-nan"
                  )
                    same(argType, "number", argument);
                  else if (argType === "void")
                    fail(
                      argument,
                      "UNSUPPORTED",
                      "void argument is not represented",
                    );
                  type =
                    builtin === "is-integer" ||
                    builtin === "is-finite" ||
                    builtin === "is-nan"
                      ? "boolean"
                      : "number";
                  break;
                }
                if (target.property === "set") {
                  array(expression(target.object), target.object);
                  if (node.arguments.length < 1 || node.arguments.length > 2)
                    fail(
                      node,
                      "ARITY",
                      "set requires a typed-array source and optional numeric offset",
                    );
                  const source = node.arguments[0],
                    offset = node.arguments[1];
                  if (source === undefined) throw "set source invariant";
                  array(expression(source), source);
                  if (offset !== undefined) {
                    const t = expression(offset);
                    if (t !== "number" && t !== "optional-number")
                      fail(
                        offset,
                        "TYPE_MISMATCH",
                        "set offset must be numeric or undefined",
                      );
                  }
                  builtin = "array-set";
                  type = "void";
                  break;
                }
                if (target.property === "subarray") {
                  const receiver = array(
                    expression(target.object),
                    target.object,
                  );
                  if (node.arguments.length > 2)
                    fail(
                      node,
                      "ARITY",
                      "subarray accepts zero to two optional numeric bounds",
                    );
                  for (const arg of node.arguments) {
                    if (arg === undefined) throw "missing call argument";
                    const t = expression(arg);
                    if (t !== "number" && t !== "optional-number")
                      fail(
                        arg,
                        "TYPE_MISMATCH",
                        "subarray bounds must be numeric or undefined",
                      );
                  }
                  builtin = "array-subarray";
                  type = receiver;
                  break;
                }
                if (target.property === "fill") {
                  const receiver = array(
                    expression(target.object),
                    target.object,
                  );
                  if (node.arguments.length < 1 || node.arguments.length > 3)
                    fail(
                      node,
                      "ARITY",
                      "fill requires one to three numeric arguments in this slice",
                    );
                  for (const argument of node.arguments) {
                    if (argument === undefined) throw "missing call argument";
                    same(expression(argument), "number", argument);
                  }
                  builtin = "array-fill";
                  type = receiver;
                  break;
                }
              }
              if (target.kind !== "identifier")
                return fail(target, "UNSUPPORTED", "unsupported method call");
              if (lookup(target.name) !== undefined)
                fail(
                  target,
                  "UNSUPPORTED",
                  "local callable values are not implemented",
                );
              const fn = signatures.get(target.name);
              if (fn === undefined)
                return fail(
                  target,
                  "UNKNOWN_NAME",
                  "unknown function " + target.name,
                );
              if (
                node.arguments.length < fn.minimumArguments ||
                node.arguments.length > fn.parameters.length
              )
                fail(
                  node,
                  "ARITY",
                  "call argument count is outside the signature range",
                );
              for (let i = 0; i < node.arguments.length; i++) {
                const arg = node.arguments[i],
                  expected = fn.parameters[i];
                if (arg === undefined || expected === undefined)
                  throw "call invariant";
                same(expression(arg), expected, arg);
              }
              type = fn.returnType;
              callee = fn.id;
              break;
            }
            default:
              return fail(
                node,
                "UNSUPPORTED",
                "expression is outside scalar checking coverage",
              );
          }
          expressions.set(node, {
            type,
            local: localId,
            callee,
            builtin,
            constant,
          });
          return type;
        } finally {
          depth--;
        }
      }
      // Completion bits: normal=1, return=2, break=4, continue=8.
      function statements(
        nodes: readonly Statement[],
        nested: boolean,
      ): number {
        if (nested) scopes.push({ names: new Map<string, Entry>() });
        try {
          for (const node of nodes) {
            if (node === undefined) throw "missing statement";
            if (node.kind === "variable")
              for (const d of node.declarations) {
                if (d === undefined) throw "missing declaration";
                if (d.kind === "object-binding" || d.kind === "array-binding")
                  fail(
                    d,
                    "UNSUPPORTED",
                    "typed binding patterns are not implemented",
                  );
                reserve(d.name, d);
              }
          }
          let flow = 1;
          for (const node of nodes) {
            if (node === undefined) throw "missing statement";
            const next = statement(node);
            if (flow & 1) flow = (flow & ~1) | next;
          }
          return flow;
        } finally {
          if (nested) scopes.pop();
        }
      }
      function statement(node: Statement): number {
        enter(node);
        try {
          switch (node.kind) {
            case "block":
              return statements(node.statements, true);
            case "debugger":
            case "empty":
              return 1;
            case "variable":
              if (node.mode === "var")
                fail(
                  node,
                  "UNSUPPORTED",
                  "var declarations require the closure checking pipeline",
                );
              for (const d of node.declarations) {
                if (d === undefined) throw "missing declaration";
                if (d.kind === "object-binding" || d.kind === "array-binding")
                  fail(
                    d,
                    "UNSUPPORTED",
                    "typed binding patterns are not implemented",
                  );
                if (d.initializer === undefined)
                  fail(
                    d,
                    "UNSUPPORTED",
                    "locals currently require an initializer",
                  );
                const value = expression(d.initializer);
                if (value === "void") fail(d, "TYPE_MISMATCH", "void local");
                const type = d.type === undefined ? value : scalar(d.type, d);
                same(value, type, d);
                const entry = scope().get(d.name);
                if (entry === undefined) throw "declaration invariant";
                declare(d, type, node.mode === "let", false, entry);
                const declaredLocal = entry.local;
                if (declaredLocal !== undefined)
                  assigned(declaredLocal.id, value);
              }
              return 1;
            case "expression":
              expression(node.expression);
              return 1;
            case "return":
              same(
                node.expression === undefined
                  ? "void"
                  : expression(node.expression),
                signature.returnType,
                node,
              );
              return 2;
            case "if": {
              if (expression(node.test) === "void")
                fail(node.test, "TYPE_MISMATCH", "void condition");
              const before = new Set(present);
              present = refine(node.test, true, before);
              const yes = statement(node.consequent),
                afterYes = new Set(present);
              present = refine(node.test, false, before);
              const no =
                  node.alternate === undefined ? 1 : statement(node.alternate),
                afterNo = new Set(present);
              present =
                yes & 1 && no & 1
                  ? intersect(afterYes, afterNo)
                  : yes & 1
                    ? afterYes
                    : no & 1
                      ? afterNo
                      : new Set<number>();
              return yes | no;
            }
            case "for-of": {
              if (node.await)
                fail(
                  node,
                  "UNSUPPORTED",
                  "typed for-await lowering is not implemented",
                );
              if (node.mode === "var")
                fail(
                  node,
                  "UNSUPPORTED",
                  "var declarations require the closure checking pipeline",
                );
              const loopBinding = node.binding;
              if (
                loopBinding.kind === "array-binding" ||
                loopBinding.kind === "object-binding"
              )
                fail(
                  loopBinding,
                  "UNSUPPORTED",
                  "destructured iteration requires iterable element contracts",
                );
              scopes.push({ names: new Map<string, Entry>() });
              try {
                reserve(loopBinding.name, loopBinding);
                const iterable = expression(node.iterable);
                if (
                  ![
                    "Uint8Array",
                    "Uint16Array",
                    "Uint32Array",
                    "Float64Array",
                  ].includes(iterable)
                )
                  fail(
                    node.iterable,
                    "UNSUPPORTED",
                    "native for-of currently requires a typed array",
                  );
                const entry = scope().get(loopBinding.name);
                if (entry === undefined)
                  throw "iteration declaration invariant";
                declare(
                  loopBinding,
                  "number",
                  node.mode === "let",
                  false,
                  entry,
                );
                const iterationLocal = entry.local;
                if (iterationLocal !== undefined)
                  assigned(iterationLocal.id, "number");
                present = new Set<number>();
                loops++;
                let body: number;
                try {
                  body = statement(node.body);
                } finally {
                  loops--;
                }
                present = new Set<number>();
                return 1 | (body & 2);
              } finally {
                scopes.pop();
              }
            }
            case "for": {
              const update = node.update;
              scopes.push({ names: new Map<string, Entry>() });
              try {
                const initializer = node.initializer;
                if (initializer !== undefined) {
                  if (initializer.kind === "variable")
                    for (const d of initializer.declarations) {
                      if (d === undefined) throw "missing declaration";
                      if (
                        d.kind === "object-binding" ||
                        d.kind === "array-binding"
                      )
                        fail(
                          d,
                          "UNSUPPORTED",
                          "typed binding patterns are not implemented",
                        );
                      reserve(d.name, d);
                    }
                  statement(initializer);
                }
                present = new Set<number>();
                const test = node.test;
                if (test !== undefined && expression(test) === "void")
                  fail(test, "TYPE_MISMATCH", "void condition");
                if (test !== undefined) present = refine(test, true, present);
                loops++;
                let body: number;
                try {
                  body = statement(node.body);
                } finally {
                  loops--;
                }
                present = new Set<number>();
                if (update !== undefined) expression(update);
                present = new Set<number>();
                return 1 | (body & 2);
              } finally {
                scopes.pop();
              }
            }
            case "label": {
              const completion = statement(node.body);
              present = new Set<number>();
              return completion | 1;
            }
            case "do-while": {
              const test = node.test;
              present = new Set<number>();
              loops++;
              let body: number;
              try {
                body = statement(node.body);
              } finally {
                loops--;
              }
              present = new Set<number>();
              if (expression(test) === "void")
                fail(test, "TYPE_MISMATCH", "void condition");
              present = new Set<number>();
              return (body & 2) | ((body & 13) !== 0 ? 1 : 0);
            }
            case "while": {
              present = new Set<number>();
              if (expression(node.test) === "void")
                fail(node.test, "TYPE_MISMATCH", "void condition");
              present = refine(node.test, true, present);
              loops++;
              let body: number;
              try {
                body = statement(node.body);
              } finally {
                loops--;
              }
              present = new Set<number>();
              return 1 | (body & 2);
            }
            case "break":
            case "continue":
              if (loops === 0 && node.label === undefined)
                fail(node, "UNSUPPORTED", "loop control outside loop");
              return node.kind === "break" ? 4 : 8;
            default:
              return fail(
                node,
                "UNSUPPORTED",
                "nested functions and module statements are not implemented",
              );
          }
        } finally {
          depth--;
        }
      }
      const parameterEntries = signature.node.parameters.map((p) => {
        if (p.kind === "pattern-parameter")
          fail(p, "UNSUPPORTED", "unchecked parameter pattern");
        return reserve(p.name, p);
      });
      for (let i = 0; i < signature.node.parameters.length; i++) {
        const p = signature.node.parameters[i],
          inputType = signature.parameters[i],
          entry = parameterEntries[i];
        if (p === undefined || inputType === undefined || entry === undefined)
          throw "parameter invariant";
        const type =
          p.initializer === undefined ? inputType : scalar(p.type, p);
        const initializer = p.initializer;
        if (initializer !== undefined)
          same(expression(initializer), type, initializer);
        declare(p, type, true, true, entry);
      }
      const body = signature.node.body;
      if (body.kind !== "block")
        fail(body, "UNSUPPORTED", "function body must be a block");
      const flow = statements(body.statements, false);
      if (signature.returnType !== "void" && flow & 1)
        fail(signature.node, "MISSING_RETURN", "not all paths return a value");
      functions.push({
        id: signature.id,
        node: signature.node,
        parameters: signature.parameters,
        returnType: signature.returnType,
        locals,
        expressions,
        declarations,
      });
    }
  } catch (error) {
    if (error !== abort) throw error;
  }
  if (failure !== undefined) return { ok: false, error: failure };
  return { ok: true, value: { functions } };
}

export {
  resolveInterfaceTypes,
  createInterfaceResolutionCache,
} from "./interfaces.ts";
export { checkClosureModule, checkedPropertyName } from "./closures.ts";
export type {
  ClosureBody,
  BindingOperation,
  ClosureIntrinsic,
  CheckedClosures,
  CheckedTypeSystem,
  ClosureDiagnostic,
  ClosureResult,
  ClosureCheckOptions,
} from "./closures.ts";
export type {
  InterfaceTypes,
  InterfaceError,
  InterfaceResult,
  InterfaceResolutionCache,
  ClassContract,
  ClassMemberContract,
} from "./interfaces.ts";

export { cViewMember } from "./c-views.ts";
export type {
  CViewMember,
  CViewShape,
  CViewRegistry,
  CViewUse,
} from "./c-views.ts";

export * from "./completion.ts";
