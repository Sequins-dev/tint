import type { Integer as BigInteger } from "@tint/foundation/numeric/big-integer";
import { typedArrayBigIntElements } from "@tint/ir/scalar";
import type {
  CheckedFunction,
  Expression,
  Statement,
} from "@tint/typescript/checker";

export interface Word64Parts {
  readonly low: number;
  readonly high: number;
}

/** Extract the exact two's-complement low 64 bits (unsigned 32-bit `low` and
 * `high` halves) of any compile-time BigInteger (base 2^26 limb representation). */
export function bigIntegerToWord64(integer: BigInteger): Word64Parts {
  if (integer.len === 0) return { low: 0, high: 0 };
  const digits = integer.digits;
  const d0 = digits === undefined ? integer.d0 : (digits[0] ?? 0);
  const d1 =
    integer.len > 1
      ? digits === undefined
        ? integer.d1
        : (digits[1] ?? 0)
      : 0;
  const d2 =
    integer.len > 2
      ? digits === undefined
        ? integer.d2
        : (digits[2] ?? 0)
      : 0;
  const magLo = (d0 | ((d1 & 0x3f) << 26)) >>> 0;
  const magHi = ((d1 >>> 6) | ((d2 & 0xfff) << 20)) >>> 0;
  if (!integer.negative || (magLo === 0 && magHi === 0))
    return { low: magLo, high: magHi };
  const low = -magLo >>> 0;
  const high = (~magHi + (low === 0 ? 1 : 0)) >>> 0;
  return { low, high };
}

/** Whether `integer` is a non-negative integer in [0, 2^64 - 1], so bitwise
 * `& integer` clears every bit at or above bit 64 and yields an exact unsigned
 * 64-bit BigInt depending strictly on the low 64 bits of the other operand. */
export function isUnsigned64Mask(integer: BigInteger): boolean {
  if (integer.negative) return false;
  if (integer.len <= 2) return true;
  if (integer.len === 3) {
    const d2 =
      integer.digits === undefined ? integer.d2 : (integer.digits[2] ?? 0);
    return d2 <= 0xfff;
  }
  return false;
}

/** Exact non-negative left-shift amount in [0, 63], or undefined. */
export function smallBigIntShift(integer: BigInteger): number | undefined {
  if (integer.negative || integer.len > 1) return undefined;
  if (integer.len === 0) return 0;
  const d0 =
    integer.digits === undefined ? integer.d0 : (integer.digits[0] ?? 0);
  return d0 <= 63 ? d0 : undefined;
}

function ungroupExpr(expr: Expression): Expression {
  let current = expr;
  while (current.kind === "group") current = current.expression;
  return current;
}

/** Whether `expr` is `lhs & rhs` where either operand is a compile-time
 * constant mask in [0, 2^64 - 1]. */
export function isBigIntMask64Expr(
  expr: Expression,
  evalConst: (e: Expression) => BigInteger | undefined,
): boolean {
  const node = ungroupExpr(expr);
  if (node.kind !== "binary" || node.operator !== "&") return false;
  const lc = evalConst(node.left);
  if (lc !== undefined && isUnsigned64Mask(lc)) return true;
  const rc = evalConst(node.right);
  return rc !== undefined && isUnsigned64Mask(rc);
}

/** Greatest-fixed-point consumer analysis: returns the set of local `bigint`
 * variable IDs in `fn` whose every read only observes the low 64 bits
 * (BigInt64Array/BigUint64Array stores, DataView 64-bit stores, `& mask` with
 * 0 <= mask < 2^64, and modular ring operations `+ - * & | ^ <<const ~ -`
 * feeding those sinks). Keeping these locals unboxed in `word64` slots is
 * observationally identical to arbitrary-precision ECMAScript BigInts. */
export function analyzeWord64BigIntLocals(
  fn: CheckedFunction,
  ownedCellLocals: ReadonlySet<number>,
  evalConst: (e: Expression) => BigInteger | undefined,
): ReadonlySet<number> {
  const candidates = new Set<number>();
  const declared = new Map<number, number>();
  const invalid = new Set<number>();

  function collectStmt(stmt: Statement): void {
    switch (stmt.kind) {
      case "block":
        for (const s of stmt.statements) if (s !== undefined) collectStmt(s);
        return;
      case "variable":
        for (const d of stmt.declarations) {
          if (d === undefined) continue;
          if (d.kind !== "object-binding" && d.kind !== "array-binding") {
            const local = fn.declarations.get(d);
            if (local === undefined) continue;
            const prev = declared.get(local.id) ?? 0;
            declared.set(local.id, prev + 1);
            if (
              prev === 0 &&
              !local.parameter &&
              local.hoisted !== true &&
              local.type === "reference" &&
              !ownedCellLocals.has(local.id) &&
              d.initializer !== undefined &&
              fn.expressions.get(d.initializer)?.bigint === true
            ) {
              candidates.add(local.id);
            } else {
              invalid.add(local.id);
            }
          }
        }
        return;
      case "if":
        collectStmt(stmt.consequent);
        if (stmt.alternate !== undefined) collectStmt(stmt.alternate);
        return;
      case "while":
      case "do-while":
        collectStmt(stmt.body);
        return;
      case "for":
        if (stmt.initializer !== undefined) collectStmt(stmt.initializer);
        collectStmt(stmt.body);
        return;
      case "for-of":
      case "for-in": {
        const binding = stmt.binding;
        if (
          binding.kind !== "object-binding" &&
          binding.kind !== "array-binding"
        ) {
          const local = fn.declarations.get(binding);
          if (local !== undefined) invalid.add(local.id);
        }
        collectStmt(stmt.body);
        return;
      }
      case "for-of-assignment":
      case "for-in-assignment":
        collectStmt(stmt.body);
        return;
      case "switch":
        for (const c of stmt.clauses) {
          if (c === undefined) continue;
          for (const s of c.statements) if (s !== undefined) collectStmt(s);
        }
        return;
      case "try": {
        collectStmt(stmt.body);
        const handler = stmt.handler;
        if (handler !== undefined) {
          const binding = handler.binding;
          if (
            binding !== undefined &&
            binding.kind !== "object-binding" &&
            binding.kind !== "array-binding"
          ) {
            const local = fn.declarations.get(binding);
            if (local !== undefined) invalid.add(local.id);
          }
          collectStmt(handler.body);
        }
        if (stmt.finalizer !== undefined) collectStmt(stmt.finalizer);
        return;
      }
      case "label":
        collectStmt(stmt.body);
        return;
      default:
        return;
    }
  }

  collectStmt(fn.node.body);
  for (const id of invalid) candidates.delete(id);
  if (candidates.size === 0) return candidates;

  let changed = true;
  function drop(local: number | undefined): void {
    if (local !== undefined && candidates.delete(local)) changed = true;
  }

  function isBigIntTypedArray(expr: Expression): boolean {
    const info = fn.expressions.get(expr);
    return info !== undefined && typedArrayBigIntElements(info.type);
  }

  function walkStmt(stmt: Statement): void {
    switch (stmt.kind) {
      case "block":
        for (const s of stmt.statements) if (s !== undefined) walkStmt(s);
        return;
      case "variable":
        for (const d of stmt.declarations) {
          if (d === undefined) continue;
          if (d.kind !== "object-binding" && d.kind !== "array-binding") {
            const init = d.initializer;
            if (init !== undefined) {
              const local = fn.declarations.get(d);
              const isCand = local !== undefined && candidates.has(local.id);
              walkExpr(init, isCand, false);
            }
          } else {
            const plan = fn.bindingInitializations?.get(d);
            if (plan !== undefined) {
              const input = plan.input;
              if (input !== undefined) walkExpr(input, false, false);
              for (const step of plan.steps) {
                if (step === undefined) continue;
                const targetLocal = fn.expressions.get(step.target)?.local;
                drop(targetLocal);
                const stepInit = step.initializer;
                if (stepInit !== undefined) walkExpr(stepInit, false, false);
              }
            }
          }
        }
        return;
      case "expression":
        walkExpr(stmt.expression, false, true);
        return;
      case "return":
        if (stmt.expression !== undefined)
          walkExpr(stmt.expression, false, false);
        return;
      case "throw":
        walkExpr(stmt.expression, false, false);
        return;
      case "if":
        walkExpr(stmt.test, false, false);
        walkStmt(stmt.consequent);
        if (stmt.alternate !== undefined) walkStmt(stmt.alternate);
        return;
      case "while":
      case "do-while":
        walkExpr(stmt.test, false, false);
        walkStmt(stmt.body);
        return;
      case "for":
        if (stmt.initializer !== undefined) walkStmt(stmt.initializer);
        if (stmt.test !== undefined) walkExpr(stmt.test, false, false);
        if (stmt.update !== undefined) walkExpr(stmt.update, false, true);
        walkStmt(stmt.body);
        return;
      case "for-of":
      case "for-in":
        walkExpr(stmt.iterable, false, false);
        walkStmt(stmt.body);
        return;
      case "for-of-assignment":
      case "for-in-assignment":
        walkExpr(stmt.target, false, false);
        walkExpr(stmt.iterable, false, false);
        walkStmt(stmt.body);
        return;
      case "switch":
        walkExpr(stmt.expression, false, false);
        for (const c of stmt.clauses) {
          if (c === undefined) continue;
          if (c.test !== undefined) walkExpr(c.test, false, false);
          for (const s of c.statements) if (s !== undefined) walkStmt(s);
        }
        return;
      case "try": {
        walkStmt(stmt.body);
        const handler = stmt.handler;
        if (handler !== undefined) walkStmt(handler.body);
        const finalizer = stmt.finalizer;
        if (finalizer !== undefined) walkStmt(finalizer);
        return;
      }
      case "label":
        walkStmt(stmt.body);
        return;
      case "class": {
        const heritage = stmt.definition.heritage;
        if (heritage !== undefined) walkExpr(heritage, false, false);
        return;
      }
      case "export-default":
        walkExpr(stmt.value, false, false);
        return;
      case "with":
        walkExpr(stmt.object, false, false);
        walkStmt(stmt.body);
        return;
      default:
        return;
    }
  }

  function walkExpr(
    expr: Expression,
    inLow64: boolean,
    discarded: boolean,
  ): void {
    switch (expr.kind) {
      case "group":
        walkExpr(expr.expression, inLow64, discarded);
        return;
      case "identifier": {
        const local = fn.expressions.get(expr)?.local;
        if (local !== undefined && candidates.has(local) && !inLow64)
          drop(local);
        return;
      }
      case "assignment": {
        const target = ungroupExpr(expr.target);
        const info = fn.expressions.get(expr);
        const local = info?.local;
        if (
          target.kind === "identifier" &&
          local !== undefined &&
          candidates.has(local)
        ) {
          if (!discarded && !inLow64) {
            drop(local);
            walkExpr(expr.value, false, false);
          } else {
            walkExpr(expr.value, true, false);
          }
          return;
        }
        if (
          target.kind === "index" &&
          isBigIntTypedArray(target.object) &&
          info?.builtin !== "list-write" &&
          (discarded || inLow64)
        ) {
          walkExpr(target.object, false, false);
          walkExpr(target.index, false, false);
          walkExpr(expr.value, true, false);
          return;
        }
        walkExpr(expr.target, false, false);
        walkExpr(expr.value, false, false);
        return;
      }
      case "compound": {
        const target = ungroupExpr(expr.target);
        const local = fn.expressions.get(expr)?.local;
        if (
          target.kind === "identifier" &&
          local !== undefined &&
          candidates.has(local)
        ) {
          const op = expr.operator;
          let allowed =
            op === "+" ||
            op === "-" ||
            op === "*" ||
            op === "&" ||
            op === "|" ||
            op === "^";
          if (op === "<<") {
            const c = evalConst(expr.value);
            allowed = c !== undefined && smallBigIntShift(c) !== undefined;
          }
          if ((discarded || inLow64) && allowed) {
            walkExpr(expr.value, true, false);
          } else {
            drop(local);
            walkExpr(expr.value, false, false);
          }
          return;
        }
        walkExpr(expr.target, false, false);
        walkExpr(expr.value, false, false);
        return;
      }
      case "update": {
        const target = ungroupExpr(expr.target);
        const local = fn.expressions.get(expr)?.local;
        if (target.kind === "identifier") drop(local);
        walkExpr(expr.target, false, false);
        return;
      }
      case "binary": {
        const op = expr.operator;
        if (op === ",") {
          walkExpr(expr.left, false, true);
          walkExpr(expr.right, inLow64, discarded);
          return;
        }
        const isBig = fn.expressions.get(expr)?.bigint === true;
        if (op === "&" && isBig && isBigIntMask64Expr(expr, evalConst)) {
          walkExpr(expr.left, true, false);
          walkExpr(expr.right, true, false);
          return;
        }
        if (inLow64 && isBig) {
          if (
            op === "+" ||
            op === "-" ||
            op === "*" ||
            op === "&" ||
            op === "|" ||
            op === "^"
          ) {
            walkExpr(expr.left, true, false);
            walkExpr(expr.right, true, false);
            return;
          }
          if (op === "<<") {
            const c = evalConst(expr.right);
            if (c !== undefined && smallBigIntShift(c) !== undefined) {
              walkExpr(expr.left, true, false);
              walkExpr(expr.right, true, false);
              return;
            }
          }
          if (op === "??") {
            const leftNode = ungroupExpr(expr.left);
            if (
              leftNode.kind === "index" &&
              isBigIntTypedArray(leftNode.object)
            ) {
              walkExpr(leftNode.object, false, false);
              walkExpr(leftNode.index, false, false);
              walkExpr(expr.right, true, false);
              return;
            }
          }
        }
        walkExpr(expr.left, false, false);
        walkExpr(expr.right, false, false);
        return;
      }
      case "unary":
        if (
          inLow64 &&
          fn.expressions.get(expr)?.bigint === true &&
          (expr.operator === "-" || expr.operator === "~")
        ) {
          walkExpr(expr.operand, true, false);
          return;
        }
        walkExpr(expr.operand, false, false);
        return;
      case "conditional":
        walkExpr(expr.test, false, false);
        walkExpr(expr.consequent, inLow64, discarded);
        walkExpr(expr.alternate, inLow64, discarded);
        return;
      case "call": {
        const builtin = fn.expressions.get(expr)?.builtin;
        if (builtin === "data-view-set-word64") {
          const callee = ungroupExpr(expr.callee);
          if (callee.kind === "member") walkExpr(callee.object, false, false);
          else walkExpr(expr.callee, false, false);
          for (let i = 0; i < expr.arguments.length; i++) {
            const arg = expr.arguments[i];
            if (arg !== undefined) walkExpr(arg, i === 1, false);
          }
          return;
        }
        if (builtin === "bigint-identity") {
          const arg0 = expr.arguments[0];
          if (arg0 !== undefined) walkExpr(arg0, inLow64, false);
          return;
        }
        walkExpr(expr.callee, false, false);
        for (const arg of expr.arguments)
          if (arg !== undefined) walkExpr(arg, false, false);
        return;
      }
      case "new":
        walkExpr(expr.callee, false, false);
        for (const arg of expr.arguments)
          if (arg !== undefined) walkExpr(arg, false, false);
        return;
      case "member":
        walkExpr(expr.object, false, false);
        return;
      case "index":
        walkExpr(expr.object, false, false);
        walkExpr(expr.index, false, false);
        return;
      case "array":
        for (const el of expr.elements)
          if (el !== undefined) walkExpr(el, false, false);
        return;
      case "object":
        for (const prop of expr.properties) {
          if (prop === undefined) continue;
          if (prop.kind === "spread") walkExpr(prop.value, false, false);
          else {
            const keyExpr = prop.keyExpression;
            if (keyExpr !== undefined) walkExpr(keyExpr, false, false);
            walkExpr(prop.value, false, false);
          }
        }
        return;
      case "template-expression":
        for (const sub of expr.substitutions)
          if (sub !== undefined) walkExpr(sub, false, false);
        return;
      case "tagged-template":
        walkExpr(expr.tag, false, false);
        for (const sub of expr.template.substitutions)
          if (sub !== undefined) walkExpr(sub, false, false);
        return;
      case "spread":
        walkExpr(expr.value, false, false);
        return;
      case "satisfies":
        walkExpr(expr.expression, false, false);
        return;
      case "private-in":
        walkExpr(expr.object, false, false);
        return;
      case "await":
        walkExpr(expr.expression, false, false);
        return;
      case "yield": {
        const sub = expr.expression;
        if (sub !== undefined) walkExpr(sub, false, false);
        return;
      }
      case "import-call":
        walkExpr(expr.specifier, false, false);
        return;
      case "class-expression": {
        const heritage = expr.definition.heritage;
        if (heritage !== undefined) walkExpr(heritage, false, false);
        return;
      }
      case "arrow":
      case "function-expression":
      case "number":
      case "bigint":
      case "string":
      case "boolean":
      case "null":
      case "this":
      case "super":
      case "new-target":
      case "import-meta":
      case "regexp":
      case "elision":
        return;
    }
  }

  while (changed && candidates.size > 0) {
    changed = false;
    walkStmt(fn.node.body);
  }
  return candidates;
}
