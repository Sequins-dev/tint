import type {
  BlockStatement,
  Expression,
  Parameter,
  Span,
  Statement,
  TypeNode,
} from "@tint/typescript/syntax";

export interface NumericLoopSlot {
  readonly binding: number;
  readonly slot: Expression;
}

export interface NumericLoopSpecContext {
  readonly freshName: (prefix: string) => string;
  readonly resolveLocalSlot: (
    span: Span,
    forWrite: boolean,
  ) => NumericLoopSlot | undefined;
  readonly resolveVarDeclarationSlot: (
    span: Span,
  ) => NumericLoopSlot | undefined;
  readonly resolveCapturedReadOnlyBinding: (span: Span) => number | undefined;
  readonly evaluateGeneralIdentifier: (
    ident: Expression & { readonly kind: "identifier" },
  ) => Expression;
  readonly viewObjectValueCall: (target: Expression, span: Span) => Expression;
  readonly lowerGeneralLoopTail: (
    innerFor: Statement & { readonly kind: "for" },
    outerUpdate: Expression | undefined,
  ) => Statement[];
  readonly readFloat64ElementCall: (
    array: Expression,
    index: Expression,
    span: Span,
  ) => Expression;
  readonly writeFloat64ElementCall: (
    array: Expression,
    index: Expression,
    value: Expression,
    span: Span,
  ) => Expression;
  readonly addHelperFunction: (fn: Statement) => void;
  readonly markElementAccess: () => void;
}

interface ArrayEntry {
  readonly key: string;
  readonly sample: Expression & { readonly kind: "identifier" };
  read: boolean;
  written: boolean;
  elName: string;
  rawName: string;
  countName: string;
}

interface ProvenAccessCheck {
  readonly arr: ArrayEntry;
  readonly slope: Expression;
  readonly intercept: Expression;
}

interface ProvenInnerPlan {
  readonly iv: ScalarEntry;
  readonly ivStep: number;
  readonly inclusive: boolean;
  readonly boundExpr: Expression;
  readonly auxList: readonly ScalarEntry[];
  readonly auxDeltas: ReadonlyMap<string, number>;
  readonly intConstList: readonly ScalarEntry[];
  readonly checks: readonly ProvenAccessCheck[];
}

interface AffineValue {
  readonly slope: Expression;
  readonly intercept: Expression;
  readonly hasMul: boolean;
}

interface ScalarEntry {
  readonly key: string;
  readonly sample: Expression & { readonly kind: "identifier" };
  slot: Expression | undefined;
  written: boolean;
  writtenOuter: boolean;
  writtenInner: boolean;
  liveIn: boolean;
  liveInInner: boolean;
  defBeforeUse: boolean;
  defBeforeUseInner: boolean;
  valName: string;
  okName: string;
  initName: string;
  varName: string;
  snapName: string;
  outerSnapName: string;
}

interface DeferredWrite {
  readonly array: ArrayEntry;
  readonly indexExpr: Expression;
  readonly valueExpr: Expression;
}

interface DistinctPair {
  readonly first: string;
  readonly second: string;
}

function spanOf(span: Span): Span {
  return { start: span.start, end: span.end };
}

function ident(name: string, span: Span): Expression {
  return { ...spanOf(span), kind: "identifier", name };
}

function numLiteral(value: number, span: Span): Expression {
  return { ...spanOf(span), kind: "number", value, raw: String(value) };
}

function boolLiteral(value: boolean, span: Span): Expression {
  return { ...spanOf(span), kind: "boolean", value };
}

function namedType(name: string, span: Span): TypeNode {
  return { ...spanOf(span), kind: "named", name };
}

function memberExpr(
  object: Expression,
  property: string,
  span: Span,
): Expression {
  return {
    ...spanOf(span),
    kind: "member",
    object,
    property,
    optional: false,
    private: false,
  };
}

function optionalMemberExpr(
  object: Expression,
  property: string,
  span: Span,
): Expression {
  return {
    ...spanOf(span),
    kind: "member",
    object,
    property,
    optional: true,
    private: false,
  };
}

function binaryExpr(
  operator: string,
  left: Expression,
  right: Expression,
  span: Span,
): Expression {
  return { ...spanOf(span), kind: "binary", operator, left, right };
}

function assignExpr(
  target: Expression,
  value: Expression,
  span: Span,
): Expression {
  return { ...spanOf(span), kind: "assignment", target, value };
}

function exprStmt(expression: Expression, span: Span): Statement {
  return { ...spanOf(span), kind: "expression", expression };
}

function varDecl(
  mode: "const" | "let",
  name: string,
  initializer: Expression,
  span: Span,
  type: TypeNode | undefined = undefined,
): Statement {
  return {
    ...spanOf(span),
    kind: "variable",
    mode,
    exported: false,
    declarations: [{ ...spanOf(span), name, type, initializer }],
  };
}

function blockStmt(statements: Statement[], span: Span): BlockStatement {
  return { ...spanOf(span), kind: "block", statements };
}

function ifStmt(
  test: Expression,
  consequent: Statement,
  alternate: Statement | undefined,
  span: Span,
): Statement {
  return { ...spanOf(span), kind: "if", test, consequent, alternate };
}

function unwrap(node: Expression): Expression {
  let current = node;
  while (current.kind === "group") current = current.expression;
  return current;
}

function isArithmeticBinary(operator: string): boolean {
  switch (operator) {
    case "+":
    case "-":
    case "*":
    case "/":
    case "%":
    case "&":
    case "|":
    case "^":
    case "<<":
    case ">>":
    case ">>>":
      return true;
    default:
      return false;
  }
}

function isComparisonBinary(operator: string): boolean {
  switch (operator) {
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "===":
    case "!==":
    case "==":
    case "!=":
      return true;
    default:
      return false;
  }
}

function isNumericCompound(operator: string): boolean {
  switch (operator) {
    case "+":
    case "-":
    case "*":
    case "/":
    case "%":
    case "&":
    case "|":
    case "^":
    case "<<":
    case ">>":
    case ">>>":
      return true;
    default:
      return false;
  }
}

function collectEmittedNames(expr: Expression, out: Set<string>): void {
  switch (expr.kind) {
    case "identifier":
      out.add(expr.name);
      return;
    case "unary":
      collectEmittedNames(expr.operand, out);
      return;
    case "binary":
      collectEmittedNames(expr.left, out);
      collectEmittedNames(expr.right, out);
      return;
    case "assignment":
      collectEmittedNames(expr.target, out);
      collectEmittedNames(expr.value, out);
      return;
    case "call":
      for (const arg of expr.arguments)
        if (arg !== undefined) collectEmittedNames(arg, out);
      return;
    case "conditional":
      collectEmittedNames(expr.test, out);
      collectEmittedNames(expr.consequent, out);
      collectEmittedNames(expr.alternate, out);
      return;
    case "group":
      collectEmittedNames(expr.expression, out);
      return;
    default:
      return;
  }
}

function collectEmittedStmtNames(stmt: Statement, out: Set<string>): void {
  switch (stmt.kind) {
    case "block":
      for (const child of stmt.statements)
        if (child !== undefined) collectEmittedStmtNames(child, out);
      return;
    case "expression":
      collectEmittedNames(stmt.expression, out);
      return;
    case "if":
      collectEmittedNames(stmt.test, out);
      collectEmittedStmtNames(stmt.consequent, out);
      if (stmt.alternate !== undefined)
        collectEmittedStmtNames(stmt.alternate, out);
      return;
    case "while":
      collectEmittedNames(stmt.test, out);
      collectEmittedStmtNames(stmt.body, out);
      return;
    case "variable":
      for (const decl of stmt.declarations) {
        if (
          decl !== undefined &&
          decl.kind !== "array-binding" &&
          decl.kind !== "object-binding" &&
          decl.initializer !== undefined
        )
          collectEmittedNames(decl.initializer, out);
      }
      return;
    default:
      return;
  }
}

function extractNestedFor(body: Statement):
  | {
      readonly prefix: readonly Statement[];
      readonly inner: Statement & { readonly kind: "for" };
    }
  | undefined {
  if (body.kind === "for") {
    return { prefix: [], inner: body };
  }
  if (body.kind === "block" && body.statements.length > 0) {
    const last = body.statements[body.statements.length - 1];
    if (last !== undefined && last.kind === "for") {
      const prefix: Statement[] = [];
      for (let i = 0; i < body.statements.length - 1; i++) {
        const stmt = body.statements[i];
        if (stmt === undefined) return undefined;
        prefix.push(stmt);
      }
      return { prefix, inner: last };
    }
  }
  return undefined;
}

/** Speculatively specialize a numeric `for` loop (or 2-level nested numeric
 * `for` loop) with packed number-array accesses into a guarded unboxed loop
 * over tight `Float64Array` views (`length === numberCount`) and typed
 * `number` locals. Returns `undefined` if the loop is not eligible.
 *
 * Correctness guarantees:
 * - Every read-only scalar (local or enclosing-function captured `var`/param)
 *   is read once before the loop and verified `typeof === "number"`. Because
 *   the fast loop makes zero calls and triggers zero accessors, no read-only
 *   binding can change during execution.
 * - Every array base is verified once before the loop to be an `OrdinaryObject`
 *   with `internalArrayElements` having `0 < numberCount <= 2147483647` and
 *   `numberCount <= numbers.length`. A zero-copy `subarray(0, numberCount)`
 *   view (when capacity exceeds `numberCount`) lets every array read rely on
 *   `Float64Array`'s own exact-integer bounds check (`elem === undefined`).
 * - Array writes are buffered to the end of each iteration (with pairwise
 *   distinctness guards whenever a later read accesses a different array than
 *   an earlier write in the same iteration; same-array read-after-write is
 *   rejected). On any bounds failure, modified live-in scalars are restored
 *   from iteration-start snapshots, synced back to their general slots, and
 *   execution falls into the exact original general loop. */
export function specializeNumericForLoop(
  node: Statement & { readonly kind: "for" },
  context: NumericLoopSpecContext,
):
  | {
      readonly doneFlag: Expression;
      readonly statements: Statement[];
      readonly nested: boolean;
    }
  | undefined {
  const test = node.test;
  if (test === undefined) return undefined;

  const nestedMatch = extractNestedFor(node.body);
  const innerFor =
    nestedMatch !== undefined && nestedMatch.inner.test !== undefined
      ? nestedMatch.inner
      : undefined;
  const outerPrefix: readonly Statement[] =
    nestedMatch !== undefined && innerFor !== undefined
      ? nestedMatch.prefix
      : [];

  const arrays = new Map<string, ArrayEntry>();
  const arrayList: ArrayEntry[] = [];
  const scalars = new Map<string, ScalarEntry>();
  const scalarList: ScalarEntry[] = [];
  const writtenArrays = new Set<string>();
  const distinctPairs: DistinctPair[] = [];
  const distinctSeen = new Set<string>();
  let hasSameArrayRAW = false;
  const assigned = new Set<string>();
  const assignedInner = new Set<string>();
  let phase: "outer" | "inner" = "outer";

  function keyForIdentifier(
    identNode: Expression & { readonly kind: "identifier" },
    forWrite: boolean,
  ):
    | { readonly key: string; readonly slot: Expression | undefined }
    | undefined {
    const local = context.resolveLocalSlot(identNode, forWrite);
    if (local !== undefined) {
      return { key: "local:" + String(local.binding), slot: local.slot };
    }
    if (forWrite) return undefined;
    // Only accept read-only bindings proven to be an enclosing function's var
    // or parameter (always initialized, non-global, never throws or invokes
    // getters when hoisted before the loop test).
    const captured = context.resolveCapturedReadOnlyBinding(identNode);
    if (captured === undefined) return undefined;
    return { key: "captured:" + String(captured), slot: undefined };
  }

  function recordArray(
    base: Expression,
    isWrite: boolean,
  ): ArrayEntry | undefined {
    const raw = unwrap(base);
    if (raw.kind !== "identifier") return undefined;
    const resolved = keyForIdentifier(raw, false);
    if (resolved === undefined) return undefined;
    if (scalars.has(resolved.key)) return undefined;
    let entry = arrays.get(resolved.key);
    if (entry === undefined) {
      entry = {
        key: resolved.key,
        sample: raw,
        read: false,
        written: false,
        elName: "",
        rawName: "",
        countName: "",
      };
      arrays.set(resolved.key, entry);
      arrayList.push(entry);
    }
    if (isWrite) {
      entry.written = true;
    } else {
      entry.read = true;
      for (const writtenKey of writtenArrays) {
        if (writtenKey === entry.key) {
          hasSameArrayRAW = true;
          continue;
        }
        const pairId =
          writtenKey < entry.key
            ? writtenKey + "|" + entry.key
            : entry.key + "|" + writtenKey;
        if (!distinctSeen.has(pairId)) {
          distinctSeen.add(pairId);
          distinctPairs.push({ first: writtenKey, second: entry.key });
        }
      }
    }
    return entry;
  }

  function recordScalarRead(
    identNode: Expression & { readonly kind: "identifier" },
  ): ScalarEntry | undefined {
    const resolved = keyForIdentifier(identNode, false);
    if (resolved === undefined) return undefined;
    if (arrays.has(resolved.key)) return undefined;
    let entry = scalars.get(resolved.key);
    if (entry === undefined) {
      entry = {
        key: resolved.key,
        sample: identNode,
        slot: resolved.slot,
        written: false,
        writtenOuter: false,
        writtenInner: false,
        liveIn: false,
        liveInInner: false,
        defBeforeUse: false,
        defBeforeUseInner: false,
        valName: "",
        okName: "",
        initName: "",
        varName: "",
        snapName: "",
        outerSnapName: "",
      };
      scalars.set(resolved.key, entry);
      scalarList.push(entry);
    }
    if (!assigned.has(resolved.key)) entry.liveIn = true;
    if (phase === "inner" && !assignedInner.has(resolved.key))
      entry.liveInInner = true;
    return entry;
  }

  function recordScalarWrite(
    identNode: Expression & { readonly kind: "identifier" },
    explicitSlot: NumericLoopSlot | undefined = undefined,
  ): ScalarEntry | undefined {
    let key: string;
    let slot: Expression;
    if (explicitSlot !== undefined) {
      key = "local:" + String(explicitSlot.binding);
      slot = explicitSlot.slot;
    } else {
      const resolved = keyForIdentifier(identNode, true);
      if (resolved === undefined || resolved.slot === undefined)
        return undefined;
      key = resolved.key;
      slot = resolved.slot;
    }
    if (arrays.has(key)) return undefined;
    let entry = scalars.get(key);
    if (entry === undefined) {
      entry = {
        key,
        sample: identNode,
        slot,
        written: true,
        writtenOuter: phase === "outer",
        writtenInner: phase === "inner",
        liveIn: false,
        liveInInner: false,
        defBeforeUse: false,
        defBeforeUseInner: false,
        valName: "",
        okName: "",
        initName: "",
        varName: "",
        snapName: "",
        outerSnapName: "",
      };
      scalars.set(key, entry);
      scalarList.push(entry);
    } else {
      entry.written = true;
      entry.slot = slot;
      if (phase === "outer") entry.writtenOuter = true;
      else entry.writtenInner = true;
    }
    return entry;
  }

  function markAssigned(key: string, inConditional: boolean): void {
    if (inConditional) return;
    assigned.add(key);
    if (phase === "inner") assignedInner.add(key);
  }

  function analyzeExpr(
    input: Expression,
    inConditional: boolean,
    allowArrayWrite: boolean,
  ): boolean {
    const expr = unwrap(input);
    switch (expr.kind) {
      case "number":
        return true;
      case "identifier":
        return recordScalarRead(expr) !== undefined;
      case "unary":
        if (
          expr.operator === "-" ||
          expr.operator === "+" ||
          expr.operator === "~"
        )
          return analyzeExpr(expr.operand, inConditional, false);
        return false;
      case "binary":
        if (isArithmeticBinary(expr.operator)) {
          return (
            analyzeExpr(expr.left, inConditional, false) &&
            analyzeExpr(expr.right, inConditional, false)
          );
        }
        return false;
      case "index":
        if (expr.optional) return false;
        if (recordArray(expr.object, false) === undefined) return false;
        return analyzeExpr(expr.index, inConditional, false);
      case "update": {
        const target = unwrap(expr.target);
        if (target.kind !== "identifier") return false;
        if (recordScalarRead(target) === undefined) return false;
        return recordScalarWrite(target) !== undefined;
      }
      case "assignment": {
        const target = unwrap(expr.target);
        if (target.kind === "identifier") {
          if (!analyzeExpr(expr.value, inConditional, allowArrayWrite))
            return false;
          const written = recordScalarWrite(target);
          if (written === undefined) return false;
          markAssigned(written.key, inConditional);
          return true;
        }
        if (target.kind === "index" && !target.optional && allowArrayWrite) {
          if (!analyzeExpr(target.index, inConditional, false)) return false;
          if (!analyzeExpr(expr.value, inConditional, allowArrayWrite))
            return false;
          const arr = recordArray(target.object, true);
          if (arr === undefined) return false;
          writtenArrays.add(arr.key);
          return true;
        }
        return false;
      }
      case "compound": {
        if (!isNumericCompound(expr.operator)) return false;
        const target = unwrap(expr.target);
        if (target.kind === "identifier") {
          if (recordScalarRead(target) === undefined) return false;
          if (!analyzeExpr(expr.value, inConditional, false)) return false;
          return recordScalarWrite(target) !== undefined;
        }
        if (target.kind === "index" && !target.optional && allowArrayWrite) {
          if (!analyzeExpr(target.index, inConditional, false)) return false;
          if (recordArray(target.object, false) === undefined) return false;
          if (!analyzeExpr(expr.value, inConditional, false)) return false;
          const arr = recordArray(target.object, true);
          if (arr === undefined) return false;
          writtenArrays.add(arr.key);
          return true;
        }
        return false;
      }
      case "conditional":
        return (
          analyzeCondition(expr.test, true) &&
          analyzeExpr(expr.consequent, true, false) &&
          analyzeExpr(expr.alternate, true, false)
        );
      default:
        return false;
    }
  }

  function analyzeCondition(
    input: Expression,
    inConditional: boolean,
  ): boolean {
    const expr = unwrap(input);
    if (expr.kind === "binary") {
      if (isComparisonBinary(expr.operator)) {
        return (
          analyzeExpr(expr.left, inConditional, false) &&
          analyzeExpr(expr.right, inConditional, false)
        );
      }
      if (expr.operator === "&&" || expr.operator === "||") {
        return (
          analyzeCondition(expr.left, inConditional) &&
          analyzeCondition(expr.right, true)
        );
      }
    }
    return false;
  }

  function analyzeStatement(
    stmt: Statement,
    inConditional: boolean,
    allowArrayWrite: boolean,
  ): boolean {
    switch (stmt.kind) {
      case "block":
        for (const child of stmt.statements) {
          if (
            child === undefined ||
            !analyzeStatement(child, inConditional, allowArrayWrite)
          )
            return false;
        }
        return true;
      case "expression":
        return analyzeExpr(
          stmt.expression,
          inConditional,
          allowArrayWrite && !inConditional,
        );
      case "if": {
        if (!analyzeCondition(stmt.test, inConditional)) return false;
        if (!analyzeStatement(stmt.consequent, true, false)) return false;
        const alt = stmt.alternate;
        if (alt !== undefined && !analyzeStatement(alt, true, false))
          return false;
        return true;
      }
      case "variable": {
        if (stmt.mode !== "var" || stmt.disposal !== undefined) return false;
        for (const decl of stmt.declarations) {
          if (
            decl === undefined ||
            decl.kind === "array-binding" ||
            decl.kind === "object-binding" ||
            decl.type !== undefined
          )
            return false;
          const init = decl.initializer;
          if (init === undefined) continue;
          const slot = context.resolveVarDeclarationSlot(decl);
          if (slot === undefined) return false;
          if (
            !analyzeExpr(init, inConditional, allowArrayWrite && !inConditional)
          )
            return false;
          const fakeIdent: Expression & { readonly kind: "identifier" } = {
            ...spanOf(decl),
            kind: "identifier",
            name: decl.name,
          };
          const written = recordScalarWrite(fakeIdent, slot);
          if (written === undefined) return false;
          markAssigned(written.key, inConditional);
        }
        return true;
      }
      case "empty":
        return true;
      default:
        return false;
    }
  }

  // Analyze loop structure (either 2-level nested or single-level).
  const isNested = innerFor !== undefined;
  if (innerFor !== undefined) {
    phase = "outer";
    if (!analyzeCondition(test, false)) return undefined;
    for (const stmt of outerPrefix) {
      if (stmt === undefined || !analyzeStatement(stmt, false, false))
        return undefined;
    }
    const innerInit = innerFor.initializer;
    if (innerInit !== undefined) {
      if (!analyzeStatement(innerInit, false, false)) return undefined;
    }
    const innerTest = innerFor.test;
    if (innerTest === undefined) return undefined;
    phase = "inner";
    if (!analyzeCondition(innerTest, false)) return undefined;
    if (!analyzeStatement(innerFor.body, false, true)) return undefined;
    const innerUpdate = innerFor.update;
    if (innerUpdate !== undefined && !analyzeExpr(innerUpdate, false, false))
      return undefined;
    phase = "outer";
    const outerUpdate = node.update;
    if (outerUpdate !== undefined && !analyzeExpr(outerUpdate, false, false))
      return undefined;
  } else {
    phase = "inner";
    if (!analyzeCondition(test, false)) return undefined;
    if (!analyzeStatement(node.body, false, true)) return undefined;
    const update = node.update;
    if (update !== undefined && !analyzeExpr(update, false, false))
      return undefined;
  }

  if (arrays.size === 0 || arrays.size > 6 || scalars.size > 24)
    return undefined;

  // Classify scalars and verify no non-local read-only name was shadowed by a
  // local binding with the same name.
  const localNames = new Set<string>();
  for (const scalar of scalarList) {
    if (scalar === undefined) throw "NUMERIC_LOOP_SCALAR_INVARIANT";
    if (scalar.slot !== undefined) localNames.add(scalar.sample.name);
  }
  for (const scalar of scalarList) {
    if (scalar === undefined) throw "NUMERIC_LOOP_SCALAR_INVARIANT";
    if (scalar.slot === undefined && localNames.has(scalar.sample.name))
      return undefined;
    if (scalar.written && !scalar.liveIn && assigned.has(scalar.key))
      scalar.defBeforeUse = true;
    else scalar.liveIn = true;
    if (
      scalar.writtenInner &&
      !scalar.liveInInner &&
      assignedInner.has(scalar.key)
    )
      scalar.defBeforeUseInner = true;
  }

  // Analyze whether the inner loop qualifies for pre-loop range-proven
  // unchecked integer indexing (`readFloat64Element` / `writeFloat64Element`).
  const safeIntLimit = 33554432; // 2^25: any product of two values <= 2^25 is <= 2^50 < 2^53 (exact).

  function scalarKeyOfIdent(
    identNode: Expression & { readonly kind: "identifier" },
  ): ScalarEntry | undefined {
    const local = context.resolveLocalSlot(identNode, false);
    let key: string;
    if (local !== undefined) key = "local:" + String(local.binding);
    else {
      const captured = context.resolveCapturedReadOnlyBinding(identNode);
      if (captured === undefined) return undefined;
      key = "captured:" + String(captured);
    }
    return scalars.get(key);
  }

  function arrayEntryOfIdent(
    identNode: Expression & { readonly kind: "identifier" },
  ): ArrayEntry | undefined {
    const local = context.resolveLocalSlot(identNode, false);
    let key: string;
    if (local !== undefined) key = "local:" + String(local.binding);
    else {
      const captured = context.resolveCapturedReadOnlyBinding(identNode);
      if (captured === undefined) return undefined;
      key = "captured:" + String(captured);
    }
    return arrays.get(key);
  }

  function isZeroNum(expr: Expression): boolean {
    return expr.kind === "number" && expr.value === 0;
  }
  function isOneNum(expr: Expression): boolean {
    return expr.kind === "number" && expr.value === 1;
  }
  function simplifyAdd(
    a: Expression,
    b: Expression,
    op: string,
    span: Span,
  ): Expression {
    if (a.kind === "number" && b.kind === "number") {
      const v = op === "+" ? a.value + b.value : a.value - b.value;
      if (Number.isSafeInteger(v)) return numLiteral(v, span);
    }
    if (op === "+" && isZeroNum(a)) return b;
    if (isZeroNum(b)) return a;
    if (op === "-" && isZeroNum(a))
      return { ...spanOf(span), kind: "unary", operator: "-", operand: b };
    return binaryExpr(op, a, b, span);
  }
  function simplifyMul(a: Expression, b: Expression, span: Span): Expression {
    if (a.kind === "number" && b.kind === "number") {
      const v = a.value * b.value;
      if (Number.isSafeInteger(v)) return numLiteral(v, span);
    }
    if (isZeroNum(a) || isZeroNum(b)) return numLiteral(0, span);
    if (isOneNum(a)) return b;
    if (isOneNum(b)) return a;
    return binaryExpr("*", a, b, span);
  }
  function simplifyNeg(a: Expression, span: Span): Expression {
    if (a.kind === "number") return numLiteral(-a.value, span);
    return { ...spanOf(span), kind: "unary", operator: "-", operand: a };
  }

  function stepDeltaOf(
    input: Expression,
  ): { readonly scalar: ScalarEntry; readonly delta: number } | undefined {
    const expr = unwrap(input);
    if (expr.kind === "update") {
      const target = unwrap(expr.target);
      if (target.kind !== "identifier") return undefined;
      const entry = scalarKeyOfIdent(target);
      if (entry === undefined) return undefined;
      return { scalar: entry, delta: expr.operator === "++" ? 1 : -1 };
    }
    if (
      expr.kind === "compound" &&
      (expr.operator === "+" || expr.operator === "-")
    ) {
      const target = unwrap(expr.target);
      const rhs = unwrap(expr.value);
      if (
        target.kind === "identifier" &&
        rhs.kind === "number" &&
        rhs.value === 1
      ) {
        const entry = scalarKeyOfIdent(target);
        if (entry === undefined) return undefined;
        return { scalar: entry, delta: expr.operator === "+" ? 1 : -1 };
      }
    }
    return undefined;
  }

  function analyzeProvenInnerLoop(
    targetFor: Statement & { readonly kind: "for" },
  ): ProvenInnerPlan | undefined {
    const upd = targetFor.update;
    const tst = targetFor.test;
    if (upd === undefined || tst === undefined) return undefined;
    const ivUpdate = stepDeltaOf(upd);
    if (ivUpdate === undefined) return undefined;
    const iv = ivUpdate.scalar;
    const ivStep = ivUpdate.delta;

    // Parse simple comparison test on `iv`.
    const testExpr = unwrap(tst);
    if (testExpr.kind !== "binary") return undefined;
    const leftTest = unwrap(testExpr.left);
    const rightTest = unwrap(testExpr.right);
    let inclusive = false;
    let boundSource: Expression | undefined = undefined;
    if (
      leftTest.kind === "identifier" &&
      scalarKeyOfIdent(leftTest)?.key === iv.key
    ) {
      if (ivStep === 1 && testExpr.operator === "<") {
        inclusive = false;
        boundSource = rightTest;
      } else if (ivStep === 1 && testExpr.operator === "<=") {
        inclusive = true;
        boundSource = rightTest;
      } else if (ivStep === -1 && testExpr.operator === ">") {
        inclusive = false;
        boundSource = rightTest;
      } else if (ivStep === -1 && testExpr.operator === ">=") {
        inclusive = true;
        boundSource = rightTest;
      }
    } else if (
      rightTest.kind === "identifier" &&
      scalarKeyOfIdent(rightTest)?.key === iv.key
    ) {
      if (ivStep === 1 && testExpr.operator === ">") {
        inclusive = false;
        boundSource = leftTest;
      } else if (ivStep === 1 && testExpr.operator === ">=") {
        inclusive = true;
        boundSource = leftTest;
      } else if (ivStep === -1 && testExpr.operator === "<") {
        inclusive = false;
        boundSource = leftTest;
      } else if (ivStep === -1 && testExpr.operator === "<=") {
        inclusive = true;
        boundSource = leftTest;
      }
    }
    if (boundSource === undefined) return undefined;

    // Pass 1: inspect all writes in targetFor.body to find step-constant aux
    // IVs and ensure `iv` is not mutated inside the body and no array access
    // lives inside a conditional branch.
    const auxDelta = new Map<string, number>();
    const nonAuxWritten = new Set<string>();
    let bodyValid = true;
    function scanBodyExpr(input: Expression, inCond: boolean): void {
      if (!bodyValid) return;
      const expr = unwrap(input);
      switch (expr.kind) {
        case "number":
        case "identifier":
          return;
        case "unary":
          scanBodyExpr(expr.operand, inCond);
          return;
        case "binary":
          scanBodyExpr(expr.left, inCond);
          scanBodyExpr(expr.right, inCond);
          return;
        case "index":
          if (inCond) {
            bodyValid = false;
            return;
          }
          scanBodyExpr(expr.index, inCond);
          return;
        case "update": {
          const step = stepDeltaOf(expr);
          if (step === undefined || step.scalar.key === iv.key) {
            bodyValid = false;
            return;
          }
          if (inCond) nonAuxWritten.add(step.scalar.key);
          else
            auxDelta.set(
              step.scalar.key,
              (auxDelta.get(step.scalar.key) ?? 0) + step.delta,
            );
          return;
        }
        case "assignment": {
          const target = unwrap(expr.target);
          if (target.kind === "identifier") {
            const entry = scalarKeyOfIdent(target);
            if (entry === undefined || entry.key === iv.key) {
              bodyValid = false;
              return;
            }
            nonAuxWritten.add(entry.key);
            scanBodyExpr(expr.value, inCond);
            return;
          }
          if (target.kind === "index") {
            if (inCond) {
              bodyValid = false;
              return;
            }
            scanBodyExpr(target.index, inCond);
            scanBodyExpr(expr.value, inCond);
            return;
          }
          bodyValid = false;
          return;
        }
        case "compound": {
          const step = stepDeltaOf(expr);
          if (step !== undefined) {
            if (step.scalar.key === iv.key) {
              bodyValid = false;
              return;
            }
            if (inCond) nonAuxWritten.add(step.scalar.key);
            else
              auxDelta.set(
                step.scalar.key,
                (auxDelta.get(step.scalar.key) ?? 0) + step.delta,
              );
            return;
          }
          const target = unwrap(expr.target);
          if (target.kind === "identifier") {
            const entry = scalarKeyOfIdent(target);
            if (entry === undefined || entry.key === iv.key) {
              bodyValid = false;
              return;
            }
            nonAuxWritten.add(entry.key);
            scanBodyExpr(expr.value, inCond);
            return;
          }
          if (target.kind === "index") {
            if (inCond) {
              bodyValid = false;
              return;
            }
            scanBodyExpr(target.index, inCond);
            scanBodyExpr(expr.value, inCond);
            return;
          }
          bodyValid = false;
          return;
        }
        case "conditional":
          scanBodyCond(expr.test, true);
          scanBodyExpr(expr.consequent, true);
          scanBodyExpr(expr.alternate, true);
          return;
        default:
          bodyValid = false;
          return;
      }
    }
    function scanBodyCond(input: Expression, inCond: boolean): void {
      if (!bodyValid) return;
      const expr = unwrap(input);
      if (expr.kind === "binary") {
        if (isComparisonBinary(expr.operator)) {
          scanBodyExpr(expr.left, inCond);
          scanBodyExpr(expr.right, inCond);
          return;
        }
        if (expr.operator === "&&" || expr.operator === "||") {
          scanBodyCond(expr.left, inCond);
          scanBodyCond(expr.right, true);
          return;
        }
      }
      bodyValid = false;
    }
    function scanBodyStmt(stmt: Statement, inCond: boolean): void {
      if (!bodyValid) return;
      switch (stmt.kind) {
        case "block":
          for (const child of stmt.statements)
            if (child !== undefined) scanBodyStmt(child, inCond);
          return;
        case "expression":
          scanBodyExpr(stmt.expression, inCond);
          return;
        case "if":
          scanBodyCond(stmt.test, inCond);
          scanBodyStmt(stmt.consequent, true);
          if (stmt.alternate !== undefined) scanBodyStmt(stmt.alternate, true);
          return;
        case "variable":
          for (const decl of stmt.declarations) {
            if (
              decl === undefined ||
              decl.kind === "array-binding" ||
              decl.kind === "object-binding"
            ) {
              bodyValid = false;
              return;
            }
            const init = decl.initializer;
            if (init === undefined) continue;
            const slot = context.resolveVarDeclarationSlot(decl);
            if (slot === undefined) {
              bodyValid = false;
              return;
            }
            const key = "local:" + String(slot.binding);
            if (key === iv.key) {
              bodyValid = false;
              return;
            }
            nonAuxWritten.add(key);
            scanBodyExpr(init, inCond);
          }
          return;
        case "empty":
          return;
        default:
          bodyValid = false;
          return;
      }
    }
    scanBodyStmt(targetFor.body, false);
    if (!bodyValid) return undefined;

    const auxList: ScalarEntry[] = [];
    const finalAuxDeltas = new Map<string, number>();
    for (const [key, delta] of auxDelta) {
      if (nonAuxWritten.has(key)) continue;
      if (delta === 0 || delta < -16 || delta > 16) continue;
      const entry = scalars.get(key);
      if (entry === undefined) continue;
      auxList.push(entry);
      finalAuxDeltas.set(key, delta);
    }

    // Build loop-invariant integer expression (in terms of outer $specNum vars,
    // using placeholder key references resolved after varNames are assigned).
    const intConstSeen = new Set<string>();
    const intConstList: ScalarEntry[] = [];
    function recordIntConst(entry: ScalarEntry): Expression {
      if (!intConstSeen.has(entry.key)) {
        intConstSeen.add(entry.key);
        intConstList.push(entry);
      }
      return ident(entry.key, entry.sample);
    }

    function evalInvariantInt(
      input: Expression,
      allowMul: boolean,
    ): { readonly expr: Expression; readonly hasMul: boolean } | undefined {
      const expr = unwrap(input);
      if (expr.kind === "number") {
        if (
          !Number.isSafeInteger(expr.value) ||
          (expr.value | 0) !== expr.value ||
          expr.value < -safeIntLimit ||
          expr.value > safeIntLimit
        )
          return undefined;
        return { expr: numLiteral(expr.value, expr), hasMul: false };
      }
      if (expr.kind === "identifier") {
        const entry = scalarKeyOfIdent(expr);
        if (entry === undefined || entry.writtenInner) return undefined;
        return { expr: recordIntConst(entry), hasMul: false };
      }
      if (expr.kind === "unary") {
        if (expr.operator === "+")
          return evalInvariantInt(expr.operand, allowMul);
        if (expr.operator === "-") {
          const innerVal = evalInvariantInt(expr.operand, allowMul);
          if (innerVal === undefined) return undefined;
          return {
            expr: simplifyNeg(innerVal.expr, expr),
            hasMul: innerVal.hasMul,
          };
        }
        return undefined;
      }
      if (expr.kind === "binary") {
        if (expr.operator === "+" || expr.operator === "-") {
          const l = evalInvariantInt(expr.left, allowMul);
          const r = evalInvariantInt(expr.right, allowMul);
          if (l === undefined || r === undefined) return undefined;
          return {
            expr: simplifyAdd(l.expr, r.expr, expr.operator, expr),
            hasMul: l.hasMul || r.hasMul,
          };
        }
        if (expr.operator === "*" && allowMul) {
          const l = evalInvariantInt(expr.left, false);
          const r = evalInvariantInt(expr.right, false);
          if (l === undefined || r === undefined) return undefined;
          return { expr: simplifyMul(l.expr, r.expr, expr), hasMul: true };
        }
      }
      return undefined;
    }

    const boundEval = evalInvariantInt(boundSource, true);
    if (boundEval === undefined) return undefined;

    // Pass 2: walk targetFor.body in exact JS evaluation order, tracking aux
    // offsets and requiring every array index to be affine in iteration t.
    const auxOff = new Map<string, number>();
    for (const aux of auxList) auxOff.set(aux.key, 0);
    const checks: ProvenAccessCheck[] = [];
    let affineValid = true;

    function evalAffine(input: Expression): AffineValue | undefined {
      const expr = unwrap(input);
      if (expr.kind === "number") {
        if (
          !Number.isSafeInteger(expr.value) ||
          (expr.value | 0) !== expr.value ||
          expr.value < -safeIntLimit ||
          expr.value > safeIntLimit
        )
          return undefined;
        return {
          slope: numLiteral(0, expr),
          intercept: numLiteral(expr.value, expr),
          hasMul: false,
        };
      }
      if (expr.kind === "identifier") {
        const entry = scalarKeyOfIdent(expr);
        if (entry === undefined) return undefined;
        if (entry.key === iv.key) {
          return {
            slope: numLiteral(ivStep, expr),
            intercept: ident(iv.key, expr),
            hasMul: false,
          };
        }
        const delta = finalAuxDeltas.get(entry.key);
        if (delta !== undefined) {
          const cur = auxOff.get(entry.key) ?? 0;
          return {
            slope: numLiteral(delta, expr),
            intercept: simplifyAdd(
              ident(entry.key, expr),
              numLiteral(cur, expr),
              "+",
              expr,
            ),
            hasMul: false,
          };
        }
        if (!entry.writtenInner) {
          return {
            slope: numLiteral(0, expr),
            intercept: recordIntConst(entry),
            hasMul: false,
          };
        }
        return undefined;
      }
      if (expr.kind === "update") {
        const step = stepDeltaOf(expr);
        if (step === undefined) return undefined;
        const delta = finalAuxDeltas.get(step.scalar.key);
        if (delta === undefined) return undefined;
        const before = auxOff.get(step.scalar.key) ?? 0;
        const after = before + step.delta;
        auxOff.set(step.scalar.key, after);
        const usedOff = expr.prefix ? after : before;
        return {
          slope: numLiteral(delta, expr),
          intercept: simplifyAdd(
            ident(step.scalar.key, expr),
            numLiteral(usedOff, expr),
            "+",
            expr,
          ),
          hasMul: false,
        };
      }
      if (expr.kind === "unary") {
        if (expr.operator === "+") return evalAffine(expr.operand);
        if (expr.operator === "-") {
          const innerVal = evalAffine(expr.operand);
          if (innerVal === undefined) return undefined;
          return {
            slope: simplifyNeg(innerVal.slope, expr),
            intercept: simplifyNeg(innerVal.intercept, expr),
            hasMul: innerVal.hasMul,
          };
        }
        return undefined;
      }
      if (expr.kind === "binary") {
        if (expr.operator === "+" || expr.operator === "-") {
          const l = evalAffine(expr.left);
          const r = evalAffine(expr.right);
          if (l === undefined || r === undefined) return undefined;
          return {
            slope: simplifyAdd(l.slope, r.slope, expr.operator, expr),
            intercept: simplifyAdd(
              l.intercept,
              r.intercept,
              expr.operator,
              expr,
            ),
            hasMul: l.hasMul || r.hasMul,
          };
        }
        if (expr.operator === "*") {
          const l = evalAffine(expr.left);
          const r = evalAffine(expr.right);
          if (l === undefined || r === undefined) return undefined;
          if (l.hasMul || r.hasMul) return undefined;
          if (isZeroNum(l.slope)) {
            return {
              slope: simplifyMul(l.intercept, r.slope, expr),
              intercept: simplifyMul(l.intercept, r.intercept, expr),
              hasMul: true,
            };
          }
          if (isZeroNum(r.slope)) {
            return {
              slope: simplifyMul(l.slope, r.intercept, expr),
              intercept: simplifyMul(l.intercept, r.intercept, expr),
              hasMul: true,
            };
          }
        }
      }
      return undefined;
    }

    function walkAffineExpr(input: Expression): void {
      if (!affineValid) return;
      const expr = unwrap(input);
      switch (expr.kind) {
        case "number":
        case "identifier":
          return;
        case "unary":
          walkAffineExpr(expr.operand);
          return;
        case "binary":
          walkAffineExpr(expr.left);
          walkAffineExpr(expr.right);
          return;
        case "index": {
          const base = unwrap(expr.object);
          if (base.kind !== "identifier") {
            affineValid = false;
            return;
          }
          const arr = arrayEntryOfIdent(base);
          const idxAff = evalAffine(expr.index);
          if (arr === undefined || idxAff === undefined) {
            affineValid = false;
            return;
          }
          checks.push({
            arr,
            slope: idxAff.slope,
            intercept: idxAff.intercept,
          });
          return;
        }
        case "update": {
          const step = stepDeltaOf(expr);
          if (step !== undefined && finalAuxDeltas.has(step.scalar.key)) {
            auxOff.set(
              step.scalar.key,
              (auxOff.get(step.scalar.key) ?? 0) + step.delta,
            );
          }
          return;
        }
        case "assignment": {
          const target = unwrap(expr.target);
          if (target.kind === "identifier") {
            walkAffineExpr(expr.value);
            return;
          }
          if (target.kind === "index") {
            const base = unwrap(target.object);
            if (base.kind !== "identifier") {
              affineValid = false;
              return;
            }
            const arr = arrayEntryOfIdent(base);
            const idxAff = evalAffine(target.index);
            if (arr === undefined || idxAff === undefined) {
              affineValid = false;
              return;
            }
            checks.push({
              arr,
              slope: idxAff.slope,
              intercept: idxAff.intercept,
            });
            walkAffineExpr(expr.value);
            return;
          }
          affineValid = false;
          return;
        }
        case "compound": {
          const step = stepDeltaOf(expr);
          if (step !== undefined && finalAuxDeltas.has(step.scalar.key)) {
            auxOff.set(
              step.scalar.key,
              (auxOff.get(step.scalar.key) ?? 0) + step.delta,
            );
            return;
          }
          const target = unwrap(expr.target);
          if (target.kind === "identifier") {
            walkAffineExpr(expr.value);
            return;
          }
          if (target.kind === "index") {
            const base = unwrap(target.object);
            if (base.kind !== "identifier") {
              affineValid = false;
              return;
            }
            const arr = arrayEntryOfIdent(base);
            const idxAff = evalAffine(target.index);
            if (arr === undefined || idxAff === undefined) {
              affineValid = false;
              return;
            }
            checks.push({
              arr,
              slope: idxAff.slope,
              intercept: idxAff.intercept,
            });
            walkAffineExpr(expr.value);
            return;
          }
          affineValid = false;
          return;
        }
        case "conditional":
          walkAffineCond(expr.test);
          walkAffineExpr(expr.consequent);
          walkAffineExpr(expr.alternate);
          return;
        default:
          affineValid = false;
          return;
      }
    }
    function walkAffineCond(input: Expression): void {
      if (!affineValid) return;
      const expr = unwrap(input);
      if (expr.kind === "binary") {
        if (isComparisonBinary(expr.operator)) {
          walkAffineExpr(expr.left);
          walkAffineExpr(expr.right);
          return;
        }
        if (expr.operator === "&&" || expr.operator === "||") {
          walkAffineCond(expr.left);
          walkAffineCond(expr.right);
          return;
        }
      }
      affineValid = false;
    }
    function walkAffineStmt(stmt: Statement): void {
      if (!affineValid) return;
      switch (stmt.kind) {
        case "block":
          for (const child of stmt.statements)
            if (child !== undefined) walkAffineStmt(child);
          return;
        case "expression":
          walkAffineExpr(stmt.expression);
          return;
        case "if":
          walkAffineCond(stmt.test);
          walkAffineStmt(stmt.consequent);
          if (stmt.alternate !== undefined) walkAffineStmt(stmt.alternate);
          return;
        case "variable":
          for (const decl of stmt.declarations) {
            if (
              decl === undefined ||
              decl.kind === "array-binding" ||
              decl.kind === "object-binding"
            ) {
              affineValid = false;
              return;
            }
            if (decl.initializer !== undefined)
              walkAffineExpr(decl.initializer);
          }
          return;
        case "empty":
          return;
        default:
          affineValid = false;
          return;
      }
    }
    walkAffineStmt(targetFor.body);
    if (!affineValid || checks.length === 0) return undefined;
    return {
      iv,
      ivStep,
      inclusive,
      boundExpr: boundEval.expr,
      auxList,
      auxDeltas: finalAuxDeltas,
      intConstList,
      checks,
    };
  }

  const provenTarget = innerFor !== undefined ? innerFor : node;
  const provenPlan = analyzeProvenInnerLoop(provenTarget);
  if (hasSameArrayRAW && provenPlan === undefined) return undefined;

  context.markElementAccess();

  // Assign fresh variable names.
  for (const arr of arrayList) {
    if (arr === undefined) throw "NUMERIC_LOOP_ARRAY_INVARIANT";
    arr.elName = context.freshName("$specEl");
    arr.rawName = context.freshName("$specRaw");
    arr.countName = context.freshName("$specCount");
  }
  const mutableVarNames = new Set<string>();
  for (const scalar of scalarList) {
    if (scalar === undefined) throw "NUMERIC_LOOP_SCALAR_INVARIANT";
    scalar.valName = context.freshName("$specVal");
    scalar.okName = context.freshName("$specOk");
    scalar.initName = context.freshName("$specInit");
    scalar.varName = context.freshName("$specNum");
    scalar.snapName = context.freshName("$specSnap");
    scalar.outerSnapName = context.freshName("$specOSnap");
    if (scalar.written) mutableVarNames.add(scalar.varName);
  }

  const doneName = context.freshName("$specDone");
  const ranName = context.freshName("$specRan");
  const deoptName = context.freshName("$specDeopt");
  const innerDeoptName = context.freshName("$specIDeopt");

  const liveWritten: ScalarEntry[] = [];
  const defBeforeUseWritten: ScalarEntry[] = [];
  const outerSnapScalars: ScalarEntry[] = [];
  const innerSnapScalars: ScalarEntry[] = [];
  const outerPrefixDefWritten: ScalarEntry[] = [];
  for (const scalar of scalarList) {
    if (scalar === undefined) throw "NUMERIC_LOOP_SCALAR_INVARIANT";
    if (!scalar.written) continue;
    if (scalar.defBeforeUse) defBeforeUseWritten.push(scalar);
    else liveWritten.push(scalar);
    if (scalar.writtenOuter) outerSnapScalars.push(scalar);
    if (scalar.writtenInner && !scalar.defBeforeUseInner)
      innerSnapScalars.push(scalar);
    if (scalar.defBeforeUse && scalar.writtenOuter)
      outerPrefixDefWritten.push(scalar);
  }

  function lookupScalar(
    identNode: Expression & { readonly kind: "identifier" },
  ): ScalarEntry {
    const local = context.resolveLocalSlot(identNode, false);
    let key: string;
    if (local !== undefined) key = "local:" + String(local.binding);
    else {
      const captured = context.resolveCapturedReadOnlyBinding(identNode);
      if (captured === undefined) throw "NUMERIC_LOOP_SCALAR_INVARIANT";
      key = "captured:" + String(captured);
    }
    const entry = scalars.get(key);
    if (entry === undefined) throw "NUMERIC_LOOP_SCALAR_INVARIANT";
    return entry;
  }

  function lookupArray(
    identNode: Expression & { readonly kind: "identifier" },
  ): ArrayEntry {
    const local = context.resolveLocalSlot(identNode, false);
    let key: string;
    if (local !== undefined) key = "local:" + String(local.binding);
    else {
      const captured = context.resolveCapturedReadOnlyBinding(identNode);
      if (captured === undefined) throw "NUMERIC_LOOP_ARRAY_INVARIANT";
      key = "captured:" + String(captured);
    }
    const entry = arrays.get(key);
    if (entry === undefined) throw "NUMERIC_LOOP_ARRAY_INVARIANT";
    return entry;
  }

  function exprMayMutateNames(
    input: Expression,
    names: ReadonlySet<string>,
  ): boolean {
    if (names.size === 0) return false;
    const expr = unwrap(input);
    switch (expr.kind) {
      case "number":
      case "identifier":
        return false;
      case "unary":
        return exprMayMutateNames(expr.operand, names);
      case "binary":
        return (
          exprMayMutateNames(expr.left, names) ||
          exprMayMutateNames(expr.right, names)
        );
      case "index":
        return exprMayMutateNames(expr.index, names);
      case "update": {
        const target = unwrap(expr.target);
        if (target.kind !== "identifier") return false;
        return names.has(lookupScalar(target).varName);
      }
      case "assignment": {
        const target = unwrap(expr.target);
        if (target.kind === "identifier") {
          if (names.has(lookupScalar(target).varName)) return true;
          return exprMayMutateNames(expr.value, names);
        }
        if (target.kind === "index") {
          return (
            exprMayMutateNames(target.index, names) ||
            exprMayMutateNames(expr.value, names)
          );
        }
        return false;
      }
      case "compound": {
        const target = unwrap(expr.target);
        if (target.kind === "identifier") {
          if (names.has(lookupScalar(target).varName)) return true;
          return exprMayMutateNames(expr.value, names);
        }
        if (target.kind === "index") {
          return (
            exprMayMutateNames(target.index, names) ||
            exprMayMutateNames(expr.value, names)
          );
        }
        return false;
      }
      case "conditional":
        return (
          exprMayMutateNames(expr.test, names) ||
          exprMayMutateNames(expr.consequent, names) ||
          exprMayMutateNames(expr.alternate, names)
        );
      default:
        return true;
    }
  }

  function needsLeftSave(
    emittedLeft: Expression,
    rightSource: Expression,
  ): boolean {
    if (emittedLeft.kind === "number") return false;
    const referenced = new Set<string>();
    collectEmittedNames(emittedLeft, referenced);
    const mutableReferenced = new Set<string>();
    for (const name of referenced) {
      if (name !== undefined && mutableVarNames.has(name))
        mutableReferenced.add(name);
    }
    if (mutableReferenced.size === 0) return false;
    return exprMayMutateNames(rightSource, mutableReferenced);
  }

  function isSimpleImmutableExpr(expr: Expression): boolean {
    if (expr.kind === "number") return true;
    if (expr.kind === "identifier") return !mutableVarNames.has(expr.name);
    return false;
  }

  function makeSingleDeoptBlock(span: Span): BlockStatement {
    const stmts: Statement[] = [];
    for (const scalar of innerSnapScalars) {
      stmts.push(
        exprStmt(
          assignExpr(
            ident(scalar.varName, span),
            ident(scalar.snapName, span),
            span,
          ),
          span,
        ),
      );
    }
    stmts.push(
      exprStmt(
        assignExpr(ident(deoptName, span), boolLiteral(true, span), span),
        span,
      ),
    );
    stmts.push({ ...spanOf(span), kind: "break", label: undefined });
    return blockStmt(stmts, span);
  }

  function makeOuterDeoptBlock(span: Span): BlockStatement {
    const stmts: Statement[] = [];
    for (const scalar of outerSnapScalars) {
      stmts.push(
        exprStmt(
          assignExpr(
            ident(scalar.varName, span),
            ident(scalar.outerSnapName, span),
            span,
          ),
          span,
        ),
      );
    }
    stmts.push(
      exprStmt(
        assignExpr(ident(deoptName, span), boolLiteral(true, span), span),
        span,
      ),
    );
    stmts.push({ ...spanOf(span), kind: "break", label: undefined });
    return blockStmt(stmts, span);
  }

  function makeNestedInnerDeoptBlock(span: Span): BlockStatement {
    const stmts: Statement[] = [];
    for (const scalar of innerSnapScalars) {
      stmts.push(
        exprStmt(
          assignExpr(
            ident(scalar.varName, span),
            ident(scalar.snapName, span),
            span,
          ),
          span,
        ),
      );
    }
    stmts.push(
      exprStmt(
        assignExpr(ident(innerDeoptName, span), boolLiteral(true, span), span),
        span,
      ),
    );
    stmts.push({ ...spanOf(span), kind: "break", label: undefined });
    return blockStmt(stmts, span);
  }

  function emitWriteBoundsCheck(
    arr: ArrayEntry,
    indexExpr: Expression,
    out: Statement[],
    makeDeopt: (span: Span) => BlockStatement,
    span: Span,
  ): Expression {
    let idxRef: Expression;
    if (isSimpleImmutableExpr(indexExpr)) {
      idxRef = indexExpr;
    } else {
      const idxName = context.freshName("$specIdx");
      out.push(
        varDecl("const", idxName, indexExpr, span, namedType("number", span)),
      );
      idxRef = ident(idxName, span);
    }
    // `$specCount <= 2147483647` is verified in the preamble, so
    // `idx < 0 || idx >= count || (idx >>> 0) !== idx` is exact for every
    // unsigned integer index in `[0, count)` (and rejects negative, NaN,
    // Infinity, and fractional indices) while keeping deopt paths out of line.
    const outOfRange = binaryExpr(
      "||",
      binaryExpr("<", idxRef, numLiteral(0, span), span),
      binaryExpr(">=", idxRef, ident(arr.countName, span), span),
      span,
    );
    const notExactInt = binaryExpr(
      "!==",
      binaryExpr(">>>", idxRef, numLiteral(0, span), span),
      idxRef,
      span,
    );
    out.push(
      ifStmt(
        binaryExpr("||", outOfRange, notExactInt, span),
        makeDeopt(span),
        undefined,
        span,
      ),
    );
    return idxRef;
  }

  function emitArrayRead(
    arr: ArrayEntry,
    indexExpr: Expression,
    out: Statement[],
    makeDeopt: (span: Span) => BlockStatement,
    span: Span,
  ): Expression {
    const idxRef = emitWriteBoundsCheck(arr, indexExpr, out, makeDeopt, span);
    return context.readFloat64ElementCall(
      ident(arr.rawName, span),
      idxRef,
      span,
    );
  }

  function emitExpr(
    input: Expression,
    out: Statement[],
    deferred: DeferredWrite[],
    makeDeopt: (span: Span) => BlockStatement,
  ): Expression {
    const expr = unwrap(input);
    switch (expr.kind) {
      case "number":
        return numLiteral(expr.value, expr);
      case "identifier": {
        const entry = lookupScalar(expr);
        return ident(entry.varName, expr);
      }
      case "unary": {
        const operand = emitExpr(expr.operand, out, deferred, makeDeopt);
        return {
          ...spanOf(expr),
          kind: "unary",
          operator: expr.operator,
          operand,
        };
      }
      case "binary": {
        let left = emitExpr(expr.left, out, deferred, makeDeopt);
        if (needsLeftSave(left, expr.right)) {
          const leftName = context.freshName("$specL");
          out.push(
            varDecl("const", leftName, left, expr, namedType("number", expr)),
          );
          left = ident(leftName, expr);
        }
        const right = emitExpr(expr.right, out, deferred, makeDeopt);
        return binaryExpr(expr.operator, left, right, expr);
      }
      case "index": {
        const base = unwrap(expr.object);
        if (base.kind !== "identifier") throw "NUMERIC_LOOP_ARRAY_INVARIANT";
        const arr = lookupArray(base);
        const idx = emitExpr(expr.index, out, deferred, makeDeopt);
        return emitArrayRead(arr, idx, out, makeDeopt, expr);
      }
      case "update": {
        const target = unwrap(expr.target);
        if (target.kind !== "identifier") throw "NUMERIC_LOOP_UPDATE_INVARIANT";
        const entry = lookupScalar(target);
        const delta = expr.operator === "++" ? 1 : -1;
        if (expr.prefix) {
          out.push(
            exprStmt(
              assignExpr(
                ident(entry.varName, expr),
                binaryExpr(
                  "+",
                  ident(entry.varName, expr),
                  numLiteral(delta, expr),
                  expr,
                ),
                expr,
              ),
              expr,
            ),
          );
          return ident(entry.varName, expr);
        }
        const prevName = context.freshName("$specPrev");
        out.push(
          varDecl(
            "const",
            prevName,
            ident(entry.varName, expr),
            expr,
            namedType("number", expr),
          ),
        );
        out.push(
          exprStmt(
            assignExpr(
              ident(entry.varName, expr),
              binaryExpr(
                "+",
                ident(entry.varName, expr),
                numLiteral(delta, expr),
                expr,
              ),
              expr,
            ),
            expr,
          ),
        );
        return ident(prevName, expr);
      }
      case "assignment": {
        const target = unwrap(expr.target);
        if (target.kind === "identifier") {
          const entry = lookupScalar(target);
          const rhs = emitExpr(expr.value, out, deferred, makeDeopt);
          out.push(
            exprStmt(assignExpr(ident(entry.varName, expr), rhs, expr), expr),
          );
          return ident(entry.varName, expr);
        }
        if (target.kind === "index") {
          const base = unwrap(target.object);
          if (base.kind !== "identifier") throw "NUMERIC_LOOP_ARRAY_INVARIANT";
          const arr = lookupArray(base);
          // JS evaluates index before RHS!
          const idx = emitExpr(target.index, out, deferred, makeDeopt);
          const idxRef = emitWriteBoundsCheck(arr, idx, out, makeDeopt, expr);
          const rhs = emitExpr(expr.value, out, deferred, makeDeopt);
          let valRef: Expression;
          if (isSimpleImmutableExpr(rhs)) {
            valRef = rhs;
          } else {
            const valName = context.freshName("$specWVal");
            out.push(
              varDecl("const", valName, rhs, expr, namedType("number", expr)),
            );
            valRef = ident(valName, expr);
          }
          deferred.push({ array: arr, indexExpr: idxRef, valueExpr: valRef });
          return valRef;
        }
        throw "NUMERIC_LOOP_ASSIGN_INVARIANT";
      }
      case "compound": {
        const target = unwrap(expr.target);
        if (target.kind === "identifier") {
          const entry = lookupScalar(target);
          let oldRef: Expression = ident(entry.varName, expr);
          if (needsLeftSave(oldRef, expr.value)) {
            const oldName = context.freshName("$specOld");
            out.push(
              varDecl(
                "const",
                oldName,
                oldRef,
                expr,
                namedType("number", expr),
              ),
            );
            oldRef = ident(oldName, expr);
          }
          const rhs = emitExpr(expr.value, out, deferred, makeDeopt);
          out.push(
            exprStmt(
              assignExpr(
                ident(entry.varName, expr),
                binaryExpr(expr.operator, oldRef, rhs, expr),
                expr,
              ),
              expr,
            ),
          );
          return ident(entry.varName, expr);
        }
        if (target.kind === "index") {
          const base = unwrap(target.object);
          if (base.kind !== "identifier") throw "NUMERIC_LOOP_ARRAY_INVARIANT";
          const arr = lookupArray(base);
          const idx = emitExpr(target.index, out, deferred, makeDeopt);
          let idxRef: Expression;
          if (isSimpleImmutableExpr(idx)) {
            idxRef = idx;
          } else {
            const idxName = context.freshName("$specIdx");
            out.push(
              varDecl("const", idxName, idx, expr, namedType("number", expr)),
            );
            idxRef = ident(idxName, expr);
          }
          // Reading from the tight `Float64Array` view already proves `idxRef`
          // is an exact unsigned integer `< numberCount`.
          const oldElem = emitArrayRead(arr, idxRef, out, makeDeopt, expr);
          const rhs = emitExpr(expr.value, out, deferred, makeDeopt);
          const valName = context.freshName("$specWVal");
          out.push(
            varDecl(
              "const",
              valName,
              binaryExpr(expr.operator, oldElem, rhs, expr),
              expr,
              namedType("number", expr),
            ),
          );
          const valRef = ident(valName, expr);
          deferred.push({ array: arr, indexExpr: idxRef, valueExpr: valRef });
          return valRef;
        }
        throw "NUMERIC_LOOP_COMPOUND_INVARIANT";
      }
      case "conditional": {
        const cond = emitCondition(expr.test, out, deferred, makeDeopt);
        const resName = context.freshName("$specCond");
        out.push(
          varDecl(
            "let",
            resName,
            numLiteral(0, expr),
            expr,
            namedType("number", expr),
          ),
        );
        const thenStmts: Statement[] = [];
        const thenVal = emitExpr(
          expr.consequent,
          thenStmts,
          deferred,
          makeDeopt,
        );
        thenStmts.push(
          exprStmt(assignExpr(ident(resName, expr), thenVal, expr), expr),
        );
        const elseStmts: Statement[] = [];
        const elseVal = emitExpr(
          expr.alternate,
          elseStmts,
          deferred,
          makeDeopt,
        );
        elseStmts.push(
          exprStmt(assignExpr(ident(resName, expr), elseVal, expr), expr),
        );
        out.push(
          ifStmt(
            cond,
            blockStmt(thenStmts, expr),
            blockStmt(elseStmts, expr),
            expr,
          ),
        );
        return ident(resName, expr);
      }
      default:
        throw "NUMERIC_LOOP_EXPR_INVARIANT";
    }
  }

  function emitCondition(
    input: Expression,
    out: Statement[],
    deferred: DeferredWrite[],
    makeDeopt: (span: Span) => BlockStatement,
  ): Expression {
    const expr = unwrap(input);
    if (expr.kind === "binary") {
      if (isComparisonBinary(expr.operator)) {
        let left = emitExpr(expr.left, out, deferred, makeDeopt);
        if (needsLeftSave(left, expr.right)) {
          const leftName = context.freshName("$specCL");
          out.push(
            varDecl("const", leftName, left, expr, namedType("number", expr)),
          );
          left = ident(leftName, expr);
        }
        const right = emitExpr(expr.right, out, deferred, makeDeopt);
        const op =
          expr.operator === "=="
            ? "==="
            : expr.operator === "!="
              ? "!=="
              : expr.operator;
        return binaryExpr(op, left, right, expr);
      }
      if (expr.operator === "&&" || expr.operator === "||") {
        const left = emitCondition(expr.left, out, deferred, makeDeopt);
        const resName = context.freshName("$specBool");
        out.push(
          varDecl("let", resName, left, expr, namedType("boolean", expr)),
        );
        const rightStmts: Statement[] = [];
        const right = emitCondition(
          expr.right,
          rightStmts,
          deferred,
          makeDeopt,
        );
        rightStmts.push(
          exprStmt(assignExpr(ident(resName, expr), right, expr), expr),
        );
        let testExpr: Expression = ident(resName, expr);
        if (expr.operator !== "&&") {
          testExpr = {
            ...spanOf(expr),
            kind: "unary",
            operator: "!",
            operand: testExpr,
          };
        }
        out.push(
          ifStmt(testExpr, blockStmt(rightStmts, expr), undefined, expr),
        );
        return ident(resName, expr);
      }
    }
    throw "NUMERIC_LOOP_COND_INVARIANT";
  }

  function emitStatement(
    stmt: Statement,
    out: Statement[],
    deferred: DeferredWrite[],
    makeDeopt: (span: Span) => BlockStatement,
  ): void {
    switch (stmt.kind) {
      case "block":
        for (const child of stmt.statements) {
          if (child === undefined) throw "NUMERIC_LOOP_BLOCK_INVARIANT";
          emitStatement(child, out, deferred, makeDeopt);
        }
        return;
      case "expression": {
        const value = emitExpr(stmt.expression, out, deferred, makeDeopt);
        if (value.kind !== "identifier") out.push(exprStmt(value, stmt));
        return;
      }
      case "if": {
        const cond = emitCondition(stmt.test, out, deferred, makeDeopt);
        const thenStmts: Statement[] = [];
        emitStatement(stmt.consequent, thenStmts, deferred, makeDeopt);
        const alt = stmt.alternate;
        let altBlock: BlockStatement | undefined = undefined;
        if (alt !== undefined) {
          const elseStmts: Statement[] = [];
          emitStatement(alt, elseStmts, deferred, makeDeopt);
          altBlock = blockStmt(elseStmts, alt);
        }
        out.push(
          ifStmt(cond, blockStmt(thenStmts, stmt.consequent), altBlock, stmt),
        );
        return;
      }
      case "variable": {
        for (const decl of stmt.declarations) {
          if (
            decl === undefined ||
            decl.kind === "array-binding" ||
            decl.kind === "object-binding"
          )
            throw "NUMERIC_LOOP_VAR_INVARIANT";
          const init = decl.initializer;
          if (init === undefined) continue;
          const slot = context.resolveVarDeclarationSlot(decl);
          if (slot === undefined) throw "NUMERIC_LOOP_VAR_INVARIANT";
          const entry = scalars.get("local:" + String(slot.binding));
          if (entry === undefined) throw "NUMERIC_LOOP_VAR_INVARIANT";
          const rhs = emitExpr(init, out, deferred, makeDeopt);
          out.push(
            exprStmt(assignExpr(ident(entry.varName, decl), rhs, decl), decl),
          );
        }
        return;
      }
      case "empty":
        return;
      default:
        throw "NUMERIC_LOOP_STMT_INVARIANT";
    }
  }

  function emitInnerLoop(
    targetFor: Statement & { readonly kind: "for" },
    makeDeopt: (span: Span) => BlockStatement,
    markRan: boolean,
  ): Statement {
    const innerTest = targetFor.test;
    if (innerTest === undefined) throw "NUMERIC_LOOP_TEST_INVARIANT";
    const loopBody: Statement[] = [];
    for (const scalar of innerSnapScalars) {
      loopBody.push(
        varDecl(
          "const",
          scalar.snapName,
          ident(scalar.varName, targetFor),
          targetFor,
          namedType("number", targetFor),
        ),
      );
    }
    const testStmts: Statement[] = [];
    const testDeferred: DeferredWrite[] = [];
    const testCond = emitCondition(
      innerTest,
      testStmts,
      testDeferred,
      makeDeopt,
    );
    for (const s of testStmts) loopBody.push(s);
    loopBody.push(
      ifStmt(
        {
          ...spanOf(innerTest),
          kind: "unary",
          operator: "!",
          operand: testCond,
        },
        { ...spanOf(innerTest), kind: "break", label: undefined },
        undefined,
        innerTest,
      ),
    );
    const deferredWrites: DeferredWrite[] = [];
    emitStatement(targetFor.body, loopBody, deferredWrites, makeDeopt);
    for (const write of deferredWrites) {
      loopBody.push(
        exprStmt(
          context.writeFloat64ElementCall(
            ident(write.array.rawName, targetFor),
            write.indexExpr,
            write.valueExpr,
            targetFor,
          ),
          targetFor,
        ),
      );
    }
    if (markRan && defBeforeUseWritten.length > 0) {
      loopBody.push(
        exprStmt(
          assignExpr(
            ident(ranName, targetFor),
            boolLiteral(true, targetFor),
            targetFor,
          ),
          targetFor,
        ),
      );
    }
    const innerUpdate = targetFor.update;
    if (innerUpdate !== undefined) {
      const updateDeferred: DeferredWrite[] = [];
      const updateExpr = emitExpr(
        innerUpdate,
        loopBody,
        updateDeferred,
        makeDeopt,
      );
      if (updateExpr.kind !== "identifier")
        loopBody.push(exprStmt(updateExpr, innerUpdate));
    }
    return {
      ...spanOf(targetFor),
      kind: "while",
      test: boolLiteral(true, targetFor),
      body: blockStmt(loopBody, targetFor),
    };
  }

  function emitProvenInnerLoop(
    targetFor: Statement & { readonly kind: "for" },
    plan: ProvenInnerPlan,
    deoptFlagName: string,
    markRan: boolean,
    allowOutline: boolean = true,
  ): Statement {
    const span = spanOf(targetFor);
    function resolveKeyExpr(input: Expression): Expression {
      switch (input.kind) {
        case "number":
          return numLiteral(input.value, input);
        case "identifier": {
          const entry = scalars.get(input.name);
          if (entry === undefined) throw "NUMERIC_LOOP_PROVEN_KEY_INVARIANT";
          return ident(entry.varName, input);
        }
        case "unary":
          return {
            ...spanOf(input),
            kind: "unary",
            operator: input.operator,
            operand: resolveKeyExpr(input.operand),
          };
        case "binary":
          return binaryExpr(
            input.operator,
            resolveKeyExpr(input.left),
            resolveKeyExpr(input.right),
            input,
          );
        default:
          throw "NUMERIC_LOOP_PROVEN_EXPR_INVARIANT";
      }
    }

    function safeIntCheck(expr: Expression): Expression {
      return binaryExpr(
        "&&",
        binaryExpr(
          "===",
          binaryExpr("|", expr, numLiteral(0, span), span),
          expr,
          span,
        ),
        binaryExpr(
          "&&",
          binaryExpr(">=", expr, numLiteral(-safeIntLimit, span), span),
          binaryExpr("<=", expr, numLiteral(safeIntLimit, span), span),
          span,
        ),
        span,
      );
    }

    const stmts: Statement[] = [];
    const okName = context.freshName("$specPOk");
    stmts.push(
      varDecl(
        "let",
        okName,
        boolLiteral(true, span),
        span,
        namedType("boolean", span),
      ),
    );
    const boundName = context.freshName("$specPBound");
    stmts.push(
      varDecl(
        "const",
        boundName,
        resolveKeyExpr(plan.boundExpr),
        span,
        namedType("number", span),
      ),
    );
    // Verify iv, bound, checked invariant scalars, and aux IVs are exact safe
    // integers before computing trip count and endpoint bounds.
    let baseOk: Expression = binaryExpr(
      "&&",
      safeIntCheck(ident(plan.iv.varName, span)),
      safeIntCheck(ident(boundName, span)),
      span,
    );
    for (const s of plan.intConstList) {
      baseOk = binaryExpr(
        "&&",
        baseOk,
        safeIntCheck(ident(s.varName, span)),
        span,
      );
    }
    for (const aux of plan.auxList) {
      baseOk = binaryExpr(
        "&&",
        baseOk,
        safeIntCheck(ident(aux.varName, span)),
        span,
      );
    }
    stmts.push(
      ifStmt(
        { ...spanOf(span), kind: "unary", operator: "!", operand: baseOk },
        exprStmt(
          assignExpr(ident(okName, span), boolLiteral(false, span), span),
          span,
        ),
        undefined,
        span,
      ),
    );

    const tripsName = context.freshName("$specPTrips");
    const rawDiff =
      plan.ivStep === 1
        ? binaryExpr(
            "-",
            ident(boundName, span),
            ident(plan.iv.varName, span),
            span,
          )
        : binaryExpr(
            "-",
            ident(plan.iv.varName, span),
            ident(boundName, span),
            span,
          );
    const tripsInit = plan.inclusive
      ? binaryExpr("+", rawDiff, numLiteral(1, span), span)
      : rawDiff;
    stmts.push(
      varDecl(
        "const",
        tripsName,
        {
          ...spanOf(span),
          kind: "conditional",
          test: ident(okName, span),
          consequent: tripsInit,
          alternate: numLiteral(0, span),
        },
        span,
        namedType("number", span),
      ),
    );

    // When ok && trips > 0, check trips <= safeIntLimit and verify every affine
    // array access endpoint [first, last] lies within [0, arr.count).
    const positiveBody: Statement[] = [];
    const lastStepName = context.freshName("$specPLast");
    positiveBody.push(
      varDecl(
        "const",
        lastStepName,
        binaryExpr("-", ident(tripsName, span), numLiteral(1, span), span),
        span,
        namedType("number", span),
      ),
    );
    positiveBody.push(
      ifStmt(
        binaryExpr(
          ">",
          ident(tripsName, span),
          numLiteral(safeIntLimit, span),
          span,
        ),
        exprStmt(
          assignExpr(ident(okName, span), boolLiteral(false, span), span),
          span,
        ),
        undefined,
        span,
      ),
    );
    for (const chk of plan.checks) {
      const slName = context.freshName("$specPSl");
      const icName = context.freshName("$specPIc");
      const endName = context.freshName("$specPEnd");
      positiveBody.push(
        varDecl(
          "const",
          slName,
          resolveKeyExpr(chk.slope),
          span,
          namedType("number", span),
        ),
      );
      positiveBody.push(
        varDecl(
          "const",
          icName,
          resolveKeyExpr(chk.intercept),
          span,
          namedType("number", span),
        ),
      );
      positiveBody.push(
        varDecl(
          "const",
          endName,
          binaryExpr(
            "+",
            ident(icName, span),
            binaryExpr(
              "*",
              ident(slName, span),
              ident(lastStepName, span),
              span,
            ),
            span,
          ),
          span,
          namedType("number", span),
        ),
      );
      const chkOk = binaryExpr(
        "&&",
        safeIntCheck(ident(slName, span)),
        binaryExpr(
          "&&",
          safeIntCheck(ident(icName, span)),
          binaryExpr(
            "&&",
            binaryExpr(">=", ident(icName, span), numLiteral(0, span), span),
            binaryExpr(
              "&&",
              binaryExpr(
                "<",
                ident(icName, span),
                ident(chk.arr.countName, span),
                span,
              ),
              binaryExpr(
                "&&",
                binaryExpr(
                  ">=",
                  ident(endName, span),
                  numLiteral(0, span),
                  span,
                ),
                binaryExpr(
                  "<",
                  ident(endName, span),
                  ident(chk.arr.countName, span),
                  span,
                ),
                span,
              ),
              span,
            ),
            span,
          ),
          span,
        ),
        span,
      );
      positiveBody.push(
        ifStmt(
          { ...spanOf(span), kind: "unary", operator: "!", operand: chkOk },
          exprStmt(
            assignExpr(ident(okName, span), boolLiteral(false, span), span),
            span,
          ),
          undefined,
          span,
        ),
      );
    }

    // Build integer-typed inner loop body (zero bounds checks, zero snapshots,
    // zero deopts, in-place Float64Array element reads and writes).
    const intNameMap = new Map<string, string>();
    const nonNegIntKeys = new Set<string>();
    const provenMutable = new Set<string>(mutableVarNames);

    const ivIntName = context.freshName("$specPIv");
    intNameMap.set(plan.iv.key, ivIntName);
    provenMutable.add(ivIntName);
    // An ascending IV starting at a non-negative constant stays within
    // [0, safeIntLimit + 1] (< 2^31) on every increment, so `(iv + 1) >>> 0`
    // matches `(iv + 1) | 0` while compiling to one 32-bit ADD (zero sxtw).
    if (plan.ivStep === 1 && targetFor.initializer !== undefined) {
      const forInit = targetFor.initializer;
      let ivInitExpr: Expression | undefined = undefined;
      if (forInit.kind === "variable") {
        for (const d of forInit.declarations) {
          if (
            d !== undefined &&
            d.kind !== "array-binding" &&
            d.kind !== "object-binding"
          ) {
            const dInit = d.initializer;
            if (dInit !== undefined) {
              const slot = context.resolveVarDeclarationSlot(d);
              if (
                slot !== undefined &&
                "local:" + String(slot.binding) === plan.iv.key
              )
                ivInitExpr = unwrap(dInit);
            }
          }
        }
      } else if (forInit.kind === "expression") {
        const initExpr = unwrap(forInit.expression);
        if (initExpr.kind === "assignment") {
          const initTarget = initExpr.target;
          if (initTarget.kind === "identifier") {
            const entry = scalars.get(lookupScalar(initTarget).key);
            if (entry !== undefined && entry.key === plan.iv.key)
              ivInitExpr = unwrap(initExpr.value);
          }
        }
      }
      if (
        ivInitExpr !== undefined &&
        ivInitExpr.kind === "number" &&
        Number.isInteger(ivInitExpr.value) &&
        ivInitExpr.value >= 0
      )
        nonNegIntKeys.add(plan.iv.key);
    }
    const boundIntName = context.freshName("$specPBndI");
    const auxIntNames: {
      readonly entry: ScalarEntry;
      readonly intName: string;
    }[] = [];
    for (const aux of plan.auxList) {
      const auxInt = context.freshName("$specPAux");
      intNameMap.set(aux.key, auxInt);
      provenMutable.add(auxInt);
      auxIntNames.push({ entry: aux, intName: auxInt });
      // An ascending unit-step aux IV whose checked access intercept proves
      // `aux_0 >= 0` (or `aux_0 + 1 >= 0` for `++aux`) stays non-negative on
      // every increment and below `2^31`, so `(aux + 1) >>> 0` is exact.
      if ((plan.auxDeltas.get(aux.key) ?? 0) === 1) {
        for (const chk of plan.checks) {
          const ic = chk.intercept;
          if (ic.kind === "identifier" && ic.name === aux.key) {
            nonNegIntKeys.add(aux.key);
            break;
          }
          if (ic.kind === "binary" && ic.operator === "+") {
            const icLeft = ic.left,
              icRight = ic.right;
            const leftIsAux =
              icLeft.kind === "identifier" &&
              icLeft.name === aux.key &&
              icRight.kind === "number" &&
              icRight.value <= 1;
            const rightIsAux =
              icRight.kind === "identifier" &&
              icRight.name === aux.key &&
              icLeft.kind === "number" &&
              icLeft.value <= 1;
            if (leftIsAux || rightIsAux) {
              nonNegIntKeys.add(aux.key);
              break;
            }
          }
        }
      }
    }
    const constIntNames: {
      readonly entry: ScalarEntry;
      readonly intName: string;
    }[] = [];
    for (const s of plan.intConstList) {
      if (intNameMap.has(s.key)) continue;
      const constInt = context.freshName("$specPCst");
      intNameMap.set(s.key, constInt);
      constIntNames.push({ entry: s, intName: constInt });
    }

    function provenNameOf(entry: ScalarEntry): string {
      return intNameMap.get(entry.key) ?? entry.varName;
    }
    function isProvenImmutable(expr: Expression): boolean {
      if (expr.kind === "number") return true;
      if (expr.kind === "identifier") return !provenMutable.has(expr.name);
      return false;
    }
    function provenExprMayMutate(
      input: Expression,
      names: ReadonlySet<string>,
    ): boolean {
      if (names.size === 0) return false;
      const expr = unwrap(input);
      switch (expr.kind) {
        case "number":
        case "identifier":
          return false;
        case "unary":
          return provenExprMayMutate(expr.operand, names);
        case "binary":
          return (
            provenExprMayMutate(expr.left, names) ||
            provenExprMayMutate(expr.right, names)
          );
        case "index":
          return provenExprMayMutate(expr.index, names);
        case "update": {
          const target = unwrap(expr.target);
          if (target.kind !== "identifier") return false;
          return names.has(provenNameOf(lookupScalar(target)));
        }
        case "assignment": {
          const target = unwrap(expr.target);
          if (target.kind === "identifier") {
            if (names.has(provenNameOf(lookupScalar(target)))) return true;
            return provenExprMayMutate(expr.value, names);
          }
          if (target.kind === "index") {
            return (
              provenExprMayMutate(target.index, names) ||
              provenExprMayMutate(expr.value, names)
            );
          }
          return false;
        }
        case "compound": {
          const target = unwrap(expr.target);
          if (target.kind === "identifier") {
            if (names.has(provenNameOf(lookupScalar(target)))) return true;
            return provenExprMayMutate(expr.value, names);
          }
          if (target.kind === "index") {
            return (
              provenExprMayMutate(target.index, names) ||
              provenExprMayMutate(expr.value, names)
            );
          }
          return false;
        }
        case "conditional":
          return (
            provenExprMayMutate(expr.test, names) ||
            provenExprMayMutate(expr.consequent, names) ||
            provenExprMayMutate(expr.alternate, names)
          );
        default:
          return true;
      }
    }
    function provenNeedsLeftSave(
      emittedLeft: Expression,
      rightSource: Expression,
    ): boolean {
      if (emittedLeft.kind === "number") return false;
      const referenced = new Set<string>();
      collectEmittedNames(emittedLeft, referenced);
      const mutableReferenced = new Set<string>();
      for (const name of referenced) {
        if (name !== undefined && provenMutable.has(name))
          mutableReferenced.add(name);
      }
      if (mutableReferenced.size === 0) return false;
      return provenExprMayMutate(rightSource, mutableReferenced);
    }

    function emitProvenExpr(input: Expression, out: Statement[]): Expression {
      const expr = unwrap(input);
      switch (expr.kind) {
        case "number":
          return numLiteral(expr.value, expr);
        case "identifier":
          return ident(provenNameOf(lookupScalar(expr)), expr);
        case "unary": {
          const operand = emitProvenExpr(expr.operand, out);
          return {
            ...spanOf(expr),
            kind: "unary",
            operator: expr.operator,
            operand,
          };
        }
        case "binary": {
          let left = emitProvenExpr(expr.left, out);
          if (provenNeedsLeftSave(left, expr.right)) {
            const leftName = context.freshName("$specPL");
            out.push(
              varDecl("const", leftName, left, expr, namedType("number", expr)),
            );
            left = ident(leftName, expr);
          }
          const right = emitProvenExpr(expr.right, out);
          return binaryExpr(expr.operator, left, right, expr);
        }
        case "index": {
          const base = unwrap(expr.object);
          if (base.kind !== "identifier") throw "NUMERIC_LOOP_ARRAY_INVARIANT";
          const arr = lookupArray(base);
          const idx = emitProvenExpr(expr.index, out);
          const elemName = context.freshName("$specPEl");
          out.push(
            varDecl(
              "const",
              elemName,
              context.readFloat64ElementCall(
                ident(arr.rawName, expr),
                idx,
                expr,
              ),
              expr,
              namedType("number", expr),
            ),
          );
          return ident(elemName, expr);
        }
        case "update": {
          const target = unwrap(expr.target);
          if (target.kind !== "identifier")
            throw "NUMERIC_LOOP_UPDATE_INVARIANT";
          const entry = lookupScalar(target);
          const name = provenNameOf(entry);
          const delta = expr.operator === "++" ? 1 : -1;
          const isInt = intNameMap.has(entry.key);
          const sum = binaryExpr(
            "+",
            ident(name, expr),
            numLiteral(delta, expr),
            expr,
          );
          const nextVal = isInt
            ? binaryExpr(
                delta > 0 && nonNegIntKeys.has(entry.key) ? ">>>" : "|",
                sum,
                numLiteral(0, expr),
                expr,
              )
            : sum;
          if (expr.prefix) {
            out.push(
              exprStmt(assignExpr(ident(name, expr), nextVal, expr), expr),
            );
            return ident(name, expr);
          }
          const prevName = context.freshName("$specPPrev");
          out.push(
            varDecl(
              "const",
              prevName,
              ident(name, expr),
              expr,
              namedType("number", expr),
            ),
          );
          out.push(
            exprStmt(assignExpr(ident(name, expr), nextVal, expr), expr),
          );
          return ident(prevName, expr);
        }
        case "assignment": {
          const target = unwrap(expr.target);
          if (target.kind === "identifier") {
            const entry = lookupScalar(target);
            const name = provenNameOf(entry);
            const rhs = emitProvenExpr(expr.value, out);
            out.push(exprStmt(assignExpr(ident(name, expr), rhs, expr), expr));
            return ident(name, expr);
          }
          if (target.kind === "index") {
            const base = unwrap(target.object);
            if (base.kind !== "identifier")
              throw "NUMERIC_LOOP_ARRAY_INVARIANT";
            const arr = lookupArray(base);
            // Evaluate index before RHS (exact JS order).
            const idx = emitProvenExpr(target.index, out);
            let idxRef: Expression;
            if (isProvenImmutable(idx)) idxRef = idx;
            else {
              const idxName = context.freshName("$specPWIdx");
              out.push(
                varDecl("const", idxName, idx, expr, namedType("number", expr)),
              );
              idxRef = ident(idxName, expr);
            }
            const rhs = emitProvenExpr(expr.value, out);
            let valRef: Expression;
            if (isProvenImmutable(rhs)) valRef = rhs;
            else {
              const valName = context.freshName("$specPWVal");
              out.push(
                varDecl("const", valName, rhs, expr, namedType("number", expr)),
              );
              valRef = ident(valName, expr);
            }
            out.push(
              exprStmt(
                context.writeFloat64ElementCall(
                  ident(arr.rawName, expr),
                  idxRef,
                  valRef,
                  expr,
                ),
                expr,
              ),
            );
            return valRef;
          }
          throw "NUMERIC_LOOP_ASSIGN_INVARIANT";
        }
        case "compound": {
          const target = unwrap(expr.target);
          if (target.kind === "identifier") {
            const entry = lookupScalar(target);
            const name = provenNameOf(entry);
            const isInt = intNameMap.has(entry.key);
            let oldRef: Expression = ident(name, expr);
            if (provenNeedsLeftSave(oldRef, expr.value)) {
              const oldName = context.freshName("$specPOld");
              out.push(
                varDecl(
                  "const",
                  oldName,
                  oldRef,
                  expr,
                  namedType("number", expr),
                ),
              );
              oldRef = ident(oldName, expr);
            }
            const rhs = emitProvenExpr(expr.value, out);
            const res = binaryExpr(expr.operator, oldRef, rhs, expr);
            const finalVal = isInt
              ? binaryExpr("|", res, numLiteral(0, expr), expr)
              : res;
            out.push(
              exprStmt(assignExpr(ident(name, expr), finalVal, expr), expr),
            );
            return ident(name, expr);
          }
          if (target.kind === "index") {
            const base = unwrap(target.object);
            if (base.kind !== "identifier")
              throw "NUMERIC_LOOP_ARRAY_INVARIANT";
            const arr = lookupArray(base);
            const idx = emitProvenExpr(target.index, out);
            let idxRef: Expression;
            if (isProvenImmutable(idx)) idxRef = idx;
            else {
              const idxName = context.freshName("$specPWIdx");
              out.push(
                varDecl("const", idxName, idx, expr, namedType("number", expr)),
              );
              idxRef = ident(idxName, expr);
            }
            const oldName = context.freshName("$specPOldE");
            out.push(
              varDecl(
                "const",
                oldName,
                context.readFloat64ElementCall(
                  ident(arr.rawName, expr),
                  idxRef,
                  expr,
                ),
                expr,
                namedType("number", expr),
              ),
            );
            const rhs = emitProvenExpr(expr.value, out);
            const valName = context.freshName("$specPWVal");
            out.push(
              varDecl(
                "const",
                valName,
                binaryExpr(expr.operator, ident(oldName, expr), rhs, expr),
                expr,
                namedType("number", expr),
              ),
            );
            const valRef = ident(valName, expr);
            out.push(
              exprStmt(
                context.writeFloat64ElementCall(
                  ident(arr.rawName, expr),
                  idxRef,
                  valRef,
                  expr,
                ),
                expr,
              ),
            );
            return valRef;
          }
          throw "NUMERIC_LOOP_COMPOUND_INVARIANT";
        }
        case "conditional": {
          const cond = emitProvenCond(expr.test, out);
          const resName = context.freshName("$specPCond");
          out.push(
            varDecl(
              "let",
              resName,
              numLiteral(0, expr),
              expr,
              namedType("number", expr),
            ),
          );
          const thenStmts: Statement[] = [];
          const thenVal = emitProvenExpr(expr.consequent, thenStmts);
          thenStmts.push(
            exprStmt(assignExpr(ident(resName, expr), thenVal, expr), expr),
          );
          const elseStmts: Statement[] = [];
          const elseVal = emitProvenExpr(expr.alternate, elseStmts);
          elseStmts.push(
            exprStmt(assignExpr(ident(resName, expr), elseVal, expr), expr),
          );
          out.push(
            ifStmt(
              cond,
              blockStmt(thenStmts, expr),
              blockStmt(elseStmts, expr),
              expr,
            ),
          );
          return ident(resName, expr);
        }
        default:
          throw "NUMERIC_LOOP_EXPR_INVARIANT";
      }
    }
    function emitProvenCond(input: Expression, out: Statement[]): Expression {
      const expr = unwrap(input);
      if (expr.kind === "binary") {
        if (isComparisonBinary(expr.operator)) {
          let left = emitProvenExpr(expr.left, out);
          if (provenNeedsLeftSave(left, expr.right)) {
            const leftName = context.freshName("$specPCL");
            out.push(
              varDecl("const", leftName, left, expr, namedType("number", expr)),
            );
            left = ident(leftName, expr);
          }
          const right = emitProvenExpr(expr.right, out);
          const op =
            expr.operator === "=="
              ? "==="
              : expr.operator === "!="
                ? "!=="
                : expr.operator;
          return binaryExpr(op, left, right, expr);
        }
        if (expr.operator === "&&" || expr.operator === "||") {
          const left = emitProvenCond(expr.left, out);
          const resName = context.freshName("$specPBool");
          out.push(
            varDecl("let", resName, left, expr, namedType("boolean", expr)),
          );
          const rightStmts: Statement[] = [];
          const right = emitProvenCond(expr.right, rightStmts);
          rightStmts.push(
            exprStmt(assignExpr(ident(resName, expr), right, expr), expr),
          );
          let testExpr: Expression = ident(resName, expr);
          if (expr.operator !== "&&") {
            testExpr = {
              ...spanOf(expr),
              kind: "unary",
              operator: "!",
              operand: testExpr,
            };
          }
          out.push(
            ifStmt(testExpr, blockStmt(rightStmts, expr), undefined, expr),
          );
          return ident(resName, expr);
        }
      }
      throw "NUMERIC_LOOP_COND_INVARIANT";
    }
    function emitProvenStmt(stmt: Statement, out: Statement[]): void {
      switch (stmt.kind) {
        case "block":
          for (const child of stmt.statements) {
            if (child === undefined) throw "NUMERIC_LOOP_BLOCK_INVARIANT";
            emitProvenStmt(child, out);
          }
          return;
        case "expression": {
          const value = emitProvenExpr(stmt.expression, out);
          if (value.kind !== "identifier") out.push(exprStmt(value, stmt));
          return;
        }
        case "if": {
          const cond = emitProvenCond(stmt.test, out);
          const thenStmts: Statement[] = [];
          emitProvenStmt(stmt.consequent, thenStmts);
          const alt = stmt.alternate;
          let altBlock: BlockStatement | undefined = undefined;
          if (alt !== undefined) {
            const elseStmts: Statement[] = [];
            emitProvenStmt(alt, elseStmts);
            altBlock = blockStmt(elseStmts, alt);
          }
          out.push(
            ifStmt(cond, blockStmt(thenStmts, stmt.consequent), altBlock, stmt),
          );
          return;
        }
        case "variable": {
          for (const decl of stmt.declarations) {
            if (
              decl === undefined ||
              decl.kind === "array-binding" ||
              decl.kind === "object-binding"
            )
              throw "NUMERIC_LOOP_VAR_INVARIANT";
            const init = decl.initializer;
            if (init === undefined) continue;
            const slot = context.resolveVarDeclarationSlot(decl);
            if (slot === undefined) throw "NUMERIC_LOOP_VAR_INVARIANT";
            const entry = scalars.get("local:" + String(slot.binding));
            if (entry === undefined) throw "NUMERIC_LOOP_VAR_INVARIANT";
            const rhs = emitProvenExpr(init, out);
            out.push(
              exprStmt(
                assignExpr(ident(provenNameOf(entry), decl), rhs, decl),
                decl,
              ),
            );
          }
          return;
        }
        case "empty":
          return;
        default:
          throw "NUMERIC_LOOP_STMT_INVARIANT";
      }
    }

    const whileBody: Statement[] = [];
    emitProvenStmt(targetFor.body, whileBody);
    whileBody.push(
      exprStmt(
        assignExpr(
          ident(ivIntName, span),
          binaryExpr(
            plan.ivStep > 0 && nonNegIntKeys.has(plan.iv.key) ? ">>>" : "|",
            binaryExpr(
              "+",
              ident(ivIntName, span),
              numLiteral(plan.ivStep, span),
              span,
            ),
            numLiteral(0, span),
            span,
          ),
          span,
        ),
        span,
      ),
    );
    const loopOp =
      plan.ivStep === 1
        ? plan.inclusive
          ? "<="
          : "<"
        : plan.inclusive
          ? ">="
          : ">";
    const whileLoop: Statement = {
      ...spanOf(targetFor),
      kind: "while",
      test: binaryExpr(
        loopOp,
        ident(ivIntName, span),
        ident(boundIntName, span),
        span,
      ),
      body: blockStmt(whileBody, targetFor),
    };

    // Determine exact live inputs/outputs of the proven inner loop so we can
    // outline it into a tiny top-level leaf function (`__tint_spec_loop_*`)
    // free from the enclosing function's fallback-loop slot/register pressure.
    const usedBodyNames = new Set<string>();
    for (const stmt of whileBody)
      if (stmt !== undefined) collectEmittedStmtNames(stmt, usedBodyNames);
    const usedArrays: ArrayEntry[] = [];
    for (const arr of arrayList) {
      if (arr !== undefined && usedBodyNames.has(arr.rawName))
        usedArrays.push(arr);
    }
    const usedConstInts: {
      readonly entry: ScalarEntry;
      readonly intName: string;
    }[] = [];
    for (const ci of constIntNames) {
      if (ci !== undefined && usedBodyNames.has(ci.intName))
        usedConstInts.push(ci);
    }
    const readOnlyNonIv: ScalarEntry[] = [];
    const writtenNonIv: ScalarEntry[] = [];
    for (const s of scalarList) {
      if (s === undefined || intNameMap.has(s.key)) continue;
      if (!usedBodyNames.has(s.varName)) continue;
      if (isNested ? s.writtenInner : s.written) writtenNonIv.push(s);
      else readOnlyNonIv.push(s);
    }

    const totalKernelParams =
      usedArrays.length +
      2 +
      auxIntNames.length +
      usedConstInts.length +
      readOnlyNonIv.length +
      writtenNonIv.length;
    const intLoopSetup: Statement[] = [];
    if (allowOutline && writtenNonIv.length <= 1 && totalKernelParams <= 16) {
      const kernelName = context.freshName("__tint_spec_loop_");
      const params: Parameter[] = [];
      const callArgs: Expression[] = [];
      const kernelBody: Statement[] = [];
      const addParam = (
        name: string,
        typeName: string,
        argExpr: Expression,
      ): void => {
        params.push({
          ...spanOf(span),
          name,
          type: namedType(typeName, span),
          rest: false,
          optional: false,
        });
        callArgs.push(argExpr);
      };
      for (const arr of usedArrays) {
        addParam(arr.rawName, "Float64Array", ident(arr.rawName, span));
      }
      const pIv = context.freshName("$kIv");
      const pBnd = context.freshName("$kBnd");
      addParam(pIv, "number", ident(plan.iv.varName, span));
      addParam(pBnd, "number", ident(boundName, span));
      kernelBody.push(
        varDecl(
          "let",
          ivIntName,
          binaryExpr("|", ident(pIv, span), numLiteral(0, span), span),
          span,
          namedType("number", span),
        ),
      );
      kernelBody.push(
        varDecl(
          "const",
          boundIntName,
          binaryExpr("|", ident(pBnd, span), numLiteral(0, span), span),
          span,
          namedType("number", span),
        ),
      );
      for (const aux of auxIntNames) {
        const pAux = context.freshName("$kAux");
        addParam(pAux, "number", ident(aux.entry.varName, span));
        kernelBody.push(
          varDecl(
            "let",
            aux.intName,
            binaryExpr("|", ident(pAux, span), numLiteral(0, span), span),
            span,
            namedType("number", span),
          ),
        );
      }
      for (const ci of usedConstInts) {
        const pCst = context.freshName("$kCst");
        addParam(pCst, "number", ident(ci.entry.varName, span));
        kernelBody.push(
          varDecl(
            "const",
            ci.intName,
            binaryExpr("|", ident(pCst, span), numLiteral(0, span), span),
            span,
            namedType("number", span),
          ),
        );
      }
      for (const ro of readOnlyNonIv) {
        addParam(ro.varName, "number", ident(ro.varName, span));
      }
      const carriedOut = writtenNonIv[0];
      if (carriedOut !== undefined) {
        const pOut = context.freshName("$kOut");
        addParam(pOut, "number", ident(carriedOut.varName, span));
        kernelBody.push(
          varDecl(
            "let",
            carriedOut.varName,
            ident(pOut, span),
            span,
            namedType("number", span),
          ),
        );
      }
      kernelBody.push(whileLoop);
      if (carriedOut !== undefined) {
        kernelBody.push({
          ...spanOf(span),
          kind: "return",
          expression: ident(carriedOut.varName, span),
        });
      }
      context.addHelperFunction({
        ...spanOf(span),
        kind: "function",
        name: kernelName,
        exported: false,
        parameters: params,
        returnType: namedType(
          carriedOut !== undefined ? "number" : "void",
          span,
        ),
        body: blockStmt(kernelBody, span),
      });
      const callExpr: Expression = {
        ...spanOf(span),
        kind: "call",
        callee: ident(kernelName, span),
        arguments: callArgs,
      };
      if (carriedOut !== undefined) {
        intLoopSetup.push(
          exprStmt(
            assignExpr(ident(carriedOut.varName, span), callExpr, span),
            span,
          ),
        );
      } else {
        intLoopSetup.push(exprStmt(callExpr, span));
      }
      // Analytically advance primary IV and auxiliary IVs by exact trip count.
      intLoopSetup.push(
        exprStmt(
          assignExpr(
            ident(plan.iv.varName, span),
            binaryExpr(
              plan.ivStep === 1 ? "+" : "-",
              ident(plan.iv.varName, span),
              ident(tripsName, span),
              span,
            ),
            span,
          ),
          span,
        ),
      );
      for (const aux of auxIntNames) {
        const delta = plan.auxDeltas.get(aux.entry.key) ?? 0;
        if (delta === 0) continue;
        const advance: Expression =
          delta === 1
            ? binaryExpr(
                "+",
                ident(aux.entry.varName, span),
                ident(tripsName, span),
                span,
              )
            : delta === -1
              ? binaryExpr(
                  "-",
                  ident(aux.entry.varName, span),
                  ident(tripsName, span),
                  span,
                )
              : binaryExpr(
                  "+",
                  ident(aux.entry.varName, span),
                  binaryExpr(
                    "*",
                    ident(tripsName, span),
                    numLiteral(delta, span),
                    span,
                  ),
                  span,
                );
        intLoopSetup.push(
          exprStmt(
            assignExpr(ident(aux.entry.varName, span), advance, span),
            span,
          ),
        );
      }
    } else {
      intLoopSetup.push(
        varDecl(
          "let",
          ivIntName,
          binaryExpr(
            "|",
            ident(plan.iv.varName, span),
            numLiteral(0, span),
            span,
          ),
          span,
          namedType("number", span),
        ),
      );
      intLoopSetup.push(
        varDecl(
          "const",
          boundIntName,
          binaryExpr("|", ident(boundName, span), numLiteral(0, span), span),
          span,
          namedType("number", span),
        ),
      );
      for (const aux of auxIntNames) {
        intLoopSetup.push(
          varDecl(
            "let",
            aux.intName,
            binaryExpr(
              "|",
              ident(aux.entry.varName, span),
              numLiteral(0, span),
              span,
            ),
            span,
            namedType("number", span),
          ),
        );
      }
      for (const ci of usedConstInts) {
        intLoopSetup.push(
          varDecl(
            "const",
            ci.intName,
            binaryExpr(
              "|",
              ident(ci.entry.varName, span),
              numLiteral(0, span),
              span,
            ),
            span,
            namedType("number", span),
          ),
        );
      }
      intLoopSetup.push(whileLoop);
      // Sync integer IVs back to their outer scalar slots once after the loop.
      intLoopSetup.push(
        exprStmt(
          assignExpr(
            ident(plan.iv.varName, span),
            ident(ivIntName, span),
            span,
          ),
          span,
        ),
      );
      for (const aux of auxIntNames) {
        intLoopSetup.push(
          exprStmt(
            assignExpr(
              ident(aux.entry.varName, span),
              ident(aux.intName, span),
              span,
            ),
            span,
          ),
        );
      }
    }
    if (markRan && defBeforeUseWritten.length > 0) {
      intLoopSetup.push(
        exprStmt(
          assignExpr(ident(ranName, span), boolLiteral(true, span), span),
          span,
        ),
      );
    }

    positiveBody.push(
      ifStmt(
        ident(okName, span),
        blockStmt(intLoopSetup, span),
        undefined,
        span,
      ),
    );

    stmts.push(
      ifStmt(
        binaryExpr(
          "&&",
          ident(okName, span),
          binaryExpr(">", ident(tripsName, span), numLiteral(0, span), span),
          span,
        ),
        blockStmt(positiveBody, span),
        undefined,
        span,
      ),
    );
    stmts.push(
      ifStmt(
        {
          ...spanOf(span),
          kind: "unary",
          operator: "!",
          operand: ident(okName, span),
        },
        exprStmt(
          assignExpr(ident(deoptFlagName, span), boolLiteral(true, span), span),
          span,
        ),
        undefined,
        span,
      ),
    );
    return blockStmt(stmts, span);
  }

  // Build fast-path inner block (inside all array-elements & scalar-number
  // guards).
  const inner: Statement[] = [];
  for (const arr of arrayList) {
    if (arr === undefined) throw "NUMERIC_LOOP_ARRAY_INVARIANT";
    inner.push(
      varDecl(
        "const",
        arr.rawName,
        memberExpr(ident(arr.elName, node), "numbers", node),
        node,
      ),
    );
    inner.push(
      varDecl(
        "const",
        arr.countName,
        memberExpr(ident(arr.elName, node), "numberCount", node),
        node,
        namedType("number", node),
      ),
    );
  }
  for (const scalar of scalarList) {
    if (scalar === undefined) throw "NUMERIC_LOOP_SCALAR_INVARIANT";
    if (scalar.defBeforeUse) {
      inner.push(
        varDecl(
          "let",
          scalar.varName,
          numLiteral(0, node),
          node,
          namedType("number", node),
        ),
      );
    } else {
      inner.push(
        varDecl(
          scalar.written ? "let" : "const",
          scalar.varName,
          ident(scalar.initName, node),
          node,
          namedType("number", node),
        ),
      );
    }
  }
  if (defBeforeUseWritten.length > 0) {
    inner.push(
      varDecl(
        "let",
        ranName,
        boolLiteral(false, node),
        node,
        namedType("boolean", node),
      ),
    );
  }
  inner.push(
    varDecl(
      "let",
      deoptName,
      boolLiteral(false, node),
      node,
      namedType("boolean", node),
    ),
  );
  if (innerFor !== undefined) {
    inner.push(
      varDecl(
        "let",
        innerDeoptName,
        boolLiteral(false, node),
        node,
        namedType("boolean", node),
      ),
    );
    const outerBody: Statement[] = [];
    for (const scalar of outerSnapScalars) {
      outerBody.push(
        varDecl(
          "const",
          scalar.outerSnapName,
          ident(scalar.varName, node),
          node,
          namedType("number", node),
        ),
      );
    }
    const outerTestStmts: Statement[] = [];
    const outerTestDeferred: DeferredWrite[] = [];
    const outerCond = emitCondition(
      test,
      outerTestStmts,
      outerTestDeferred,
      makeOuterDeoptBlock,
    );
    for (const s of outerTestStmts) outerBody.push(s);
    outerBody.push(
      ifStmt(
        { ...spanOf(test), kind: "unary", operator: "!", operand: outerCond },
        { ...spanOf(test), kind: "break", label: undefined },
        undefined,
        test,
      ),
    );
    const prefixDeferred: DeferredWrite[] = [];
    for (const stmt of outerPrefix) {
      if (stmt === undefined) throw "NUMERIC_LOOP_PREFIX_INVARIANT";
      emitStatement(stmt, outerBody, prefixDeferred, makeOuterDeoptBlock);
    }
    const innerInit = innerFor.initializer;
    if (innerInit !== undefined) {
      emitStatement(innerInit, outerBody, prefixDeferred, makeOuterDeoptBlock);
    }
    if (provenPlan !== undefined) {
      outerBody.push(
        emitProvenInnerLoop(innerFor, provenPlan, innerDeoptName, false, true),
      );
    } else {
      outerBody.push(emitInnerLoop(innerFor, makeNestedInnerDeoptBlock, false));
    }
    // If the inner loop deopted, sync live + outer-prefix scalars back to
    // general slots, run the general inner loop (without init) + general outer
    // update, then break out of the outer fast loop so the general outer loop
    // resumes at the next outer iteration.
    const handleInnerDeopt: Statement[] = [];
    for (const scalar of liveWritten) {
      const target = scalar.slot;
      if (target === undefined) throw "NUMERIC_LOOP_SYNC_INVARIANT";
      handleInnerDeopt.push(
        exprStmt(
          assignExpr({ ...target }, ident(scalar.varName, node), node),
          node,
        ),
      );
    }
    for (const scalar of outerPrefixDefWritten) {
      const target = scalar.slot;
      if (target === undefined) throw "NUMERIC_LOOP_SYNC_INVARIANT";
      handleInnerDeopt.push(
        exprStmt(
          assignExpr({ ...target }, ident(scalar.varName, node), node),
          node,
        ),
      );
    }
    const generalTail = context.lowerGeneralLoopTail(innerFor, node.update);
    for (const tailStmt of generalTail) {
      if (tailStmt !== undefined) handleInnerDeopt.push(tailStmt);
    }
    handleInnerDeopt.push(
      exprStmt(
        assignExpr(ident(deoptName, node), boolLiteral(true, node), node),
        node,
      ),
    );
    if (provenPlan !== undefined) {
      handleInnerDeopt.push({
        ...spanOf(node),
        kind: "break",
        label: undefined,
      });
      outerBody.push(
        ifStmt(
          ident(innerDeoptName, node),
          blockStmt(handleInnerDeopt, node),
          undefined,
          node,
        ),
      );
      if (defBeforeUseWritten.length > 0) {
        outerBody.push(
          exprStmt(
            assignExpr(ident(ranName, node), boolLiteral(true, node), node),
            node,
          ),
        );
      }
      const outerUpdate = node.update;
      if (outerUpdate !== undefined) {
        const outerUpdateDeferred: DeferredWrite[] = [];
        const outerUpdateExpr = emitExpr(
          outerUpdate,
          outerBody,
          outerUpdateDeferred,
          makeOuterDeoptBlock,
        );
        if (outerUpdateExpr.kind !== "identifier")
          outerBody.push(exprStmt(outerUpdateExpr, outerUpdate));
      }
      inner.push({
        ...spanOf(node),
        kind: "while",
        test: boolLiteral(true, node),
        body: blockStmt(outerBody, node),
      });
    } else {
      const helperOuterBody = outerBody.slice();
      helperOuterBody.push(
        ifStmt(
          ident(innerDeoptName, node),
          { ...spanOf(node), kind: "break", label: undefined },
          undefined,
          node,
        ),
      );
      if (defBeforeUseWritten.length > 0) {
        helperOuterBody.push(
          exprStmt(
            assignExpr(ident(ranName, node), boolLiteral(true, node), node),
            node,
          ),
        );
      }
      const outerUpdate = node.update;
      if (outerUpdate !== undefined) {
        const outerUpdateDeferred: DeferredWrite[] = [];
        const outerUpdateExpr = emitExpr(
          outerUpdate,
          helperOuterBody,
          outerUpdateDeferred,
          makeOuterDeoptBlock,
        );
        if (outerUpdateExpr.kind !== "identifier")
          helperOuterBody.push(exprStmt(outerUpdateExpr, outerUpdate));
      }
      // For non-proven 2-level loops (e.g. advect with indirect d0 reads),
      // outline the 2D loop into a pure-leaf `__tint_spec_loop_*` helper so it
      // runs with intraprocedural integer slots/word facts and hoisted
      // Float64Array data pointers instead of staying inside the outer closure.
      const outScalars: ScalarEntry[] = [];
      const outSeen = new Set<string>();
      for (const s of liveWritten) {
        if (s !== undefined && !outSeen.has(s.key)) {
          outSeen.add(s.key);
          outScalars.push(s);
        }
      }
      for (const s of defBeforeUseWritten) {
        if (s !== undefined && !outSeen.has(s.key)) {
          outSeen.add(s.key);
          outScalars.push(s);
        }
      }
      const kernelName = context.freshName("__tint_spec_loop_");
      const params: Parameter[] = [];
      const callArgs: Expression[] = [];
      const kernelBody: Statement[] = [];
      const addParam = (
        name: string,
        typeName: string,
        argExpr: Expression,
      ): void => {
        params.push({
          ...spanOf(node),
          name,
          type: namedType(typeName, node),
          rest: false,
          optional: false,
        });
        callArgs.push(argExpr);
      };
      const usedOuterNames = new Set<string>();
      for (const stmt of helperOuterBody)
        if (stmt !== undefined) collectEmittedStmtNames(stmt, usedOuterNames);
      for (const arr of arrayList) {
        if (arr === undefined) throw "NUMERIC_LOOP_ARRAY_INVARIANT";
        const needCount = usedOuterNames.has(arr.countName);
        if (usedOuterNames.has(arr.rawName) || needCount)
          addParam(arr.rawName, "Float64Array", ident(arr.rawName, node));
        if (needCount) {
          // Bind array length inside the outlined kernel so bounds.ts sees
          // `array-length` (relational Len facts + uint32 interval) instead of
          // an opaque number parameter.
          kernelBody.push(
            varDecl(
              "const",
              arr.countName,
              {
                ...spanOf(node),
                kind: "member",
                object: ident(arr.rawName, node),
                property: "length",
                optional: false,
              },
              node,
              namedType("number", node),
            ),
          );
        }
      }
      // Identify read-only scalar parameters used as loop bounds or array-index
      // terms (e.g. `width`, `height`, `rowSize` in 2D stencils like `advect`)
      // so we can guard them in `[0, 0x1fffff]` at kernel entry (returning 2
      // to fall back cleanly if out of range) and let bounds.ts prove all
      // derived loop counters and index expressions as exact integers.
      const indexScalarKeys = new Set<string>();
      function addSourceScalarKey(expr: Expression | undefined): void {
        if (expr === undefined) return;
        const u = unwrap(expr);
        if (u.kind === "identifier") {
          const s = lookupScalar(u);
          if (!s.written && !s.defBeforeUse) indexScalarKeys.add(s.key);
        } else if (u.kind === "binary") {
          addSourceScalarKey(u.left);
          addSourceScalarKey(u.right);
        } else if (u.kind === "unary") {
          addSourceScalarKey(u.operand);
        }
      }
      function collectIds(e: Expression, indexVars: Set<string>): void {
        const x = unwrap(e);
        if (x.kind === "identifier") indexVars.add(lookupScalar(x).key);
        else if (x.kind === "binary") {
          collectIds(x.left, indexVars);
          collectIds(x.right, indexVars);
        } else if (x.kind === "unary") collectIds(x.operand, indexVars);
        else if (x.kind === "update") collectIds(x.target, indexVars);
      }
      function collectIndexVarsFromExpr(
        expr: Expression | undefined,
        indexVars: Set<string>,
      ): void {
        if (expr === undefined) return;
        const u = unwrap(expr);
        switch (u.kind) {
          case "index": {
            collectIds(u.index, indexVars);
            collectIndexVarsFromExpr(u.index, indexVars);
            return;
          }
          case "binary":
            collectIndexVarsFromExpr(u.left, indexVars);
            collectIndexVarsFromExpr(u.right, indexVars);
            return;
          case "unary":
            collectIndexVarsFromExpr(u.operand, indexVars);
            return;
          case "assignment":
          case "compound":
            collectIndexVarsFromExpr(u.target, indexVars);
            collectIndexVarsFromExpr(u.value, indexVars);
            return;
          case "conditional":
            collectIndexVarsFromExpr(u.test, indexVars);
            collectIndexVarsFromExpr(u.consequent, indexVars);
            collectIndexVarsFromExpr(u.alternate, indexVars);
            return;
          default:
            return;
        }
      }
      function collectIndexVarsFromStmt(
        stmt: Statement | undefined,
        indexVars: Set<string>,
      ): void {
        if (stmt === undefined) return;
        switch (stmt.kind) {
          case "block":
            for (const c of stmt.statements)
              collectIndexVarsFromStmt(c, indexVars);
            return;
          case "expression":
            collectIndexVarsFromExpr(stmt.expression, indexVars);
            return;
          case "if":
            collectIndexVarsFromExpr(stmt.test, indexVars);
            collectIndexVarsFromStmt(stmt.consequent, indexVars);
            collectIndexVarsFromStmt(stmt.alternate, indexVars);
            return;
          case "variable":
            for (const d of stmt.declarations)
              if (
                d !== undefined &&
                d.kind !== "array-binding" &&
                d.kind !== "object-binding"
              )
                collectIndexVarsFromExpr(d.initializer, indexVars);
            return;
          case "for":
            collectIndexVarsFromExpr(stmt.test, indexVars);
            collectIndexVarsFromExpr(stmt.update, indexVars);
            collectIndexVarsFromStmt(stmt.body, indexVars);
            return;
          default:
            return;
        }
      }
      const indexVars = new Set<string>();
      collectIndexVarsFromStmt(node.body, indexVars);
      function collectRhsIntoIndexVars(stmt: Statement | undefined): void {
        if (stmt === undefined) return;
        switch (stmt.kind) {
          case "block":
            for (const c of stmt.statements) collectRhsIntoIndexVars(c);
            return;
          case "variable":
            for (const d of stmt.declarations) {
              if (
                d !== undefined &&
                d.kind !== "array-binding" &&
                d.kind !== "object-binding"
              ) {
                const dInit = d.initializer;
                if (dInit !== undefined) {
                  const slot = context.resolveVarDeclarationSlot(d);
                  if (
                    slot !== undefined &&
                    indexVars.has("local:" + String(slot.binding))
                  )
                    addSourceScalarKey(dInit);
                }
              }
            }
            return;
          case "expression": {
            const expr = stmt.expression;
            if (expr.kind === "assignment") {
              const target = expr.target;
              if (
                target.kind === "identifier" &&
                indexVars.has(lookupScalar(target).key)
              )
                addSourceScalarKey(expr.value);
            }
            return;
          }
          case "if":
            collectRhsIntoIndexVars(stmt.consequent);
            collectRhsIntoIndexVars(stmt.alternate);
            return;
          case "for":
            collectRhsIntoIndexVars(stmt.body);
            return;
          default:
            return;
        }
      }
      addSourceScalarKey(node.test);
      addSourceScalarKey(innerFor.test);
      for (const k of indexVars) {
        const s = scalars.get(k);
        if (s !== undefined && !s.written && !s.defBeforeUse)
          indexScalarKeys.add(k);
      }
      collectRhsIntoIndexVars(node.body);
      for (const s of scalarList) {
        if (s === undefined) throw "NUMERIC_LOOP_SCALAR_INVARIANT";
        if (s.defBeforeUse) {
          if (usedOuterNames.has(s.varName) || outSeen.has(s.key)) {
            kernelBody.push(
              varDecl(
                "let",
                s.varName,
                numLiteral(0, node),
                node,
                namedType("number", node),
              ),
            );
          }
        } else if (usedOuterNames.has(s.varName) || outSeen.has(s.key)) {
          if (s.written) {
            const pName = context.freshName("$kIn");
            addParam(pName, "number", ident(s.varName, node));
            kernelBody.push(
              varDecl(
                "let",
                s.varName,
                ident(pName, node),
                node,
                namedType("number", node),
              ),
            );
          } else if (indexScalarKeys.has(s.key)) {
            const pName = context.freshName("$kInt");
            addParam(pName, "number", ident(s.varName, node));
            kernelBody.push(
              varDecl(
                "const",
                s.varName,
                binaryExpr(
                  "&",
                  ident(pName, node),
                  numLiteral(0x3fff, node),
                  node,
                ),
                node,
                namedType("number", node),
              ),
            );
            kernelBody.push(
              ifStmt(
                binaryExpr(
                  "!==",
                  ident(pName, node),
                  ident(s.varName, node),
                  node,
                ),
                {
                  ...spanOf(node),
                  kind: "return",
                  expression: numLiteral(2, node),
                },
                undefined,
                node,
              ),
            );
            kernelBody.push(
              ifStmt(
                binaryExpr(
                  "<=",
                  ident(s.varName, node),
                  numLiteral(0, node),
                  node,
                ),
                {
                  ...spanOf(node),
                  kind: "return",
                  expression: numLiteral(2, node),
                },
                undefined,
                node,
              ),
            );
          } else {
            addParam(s.varName, "number", ident(s.varName, node));
          }
        }
      }
      const outBufParam =
        outScalars.length > 0 ? context.freshName("$kOutBuf") : undefined;
      if (outBufParam !== undefined) {
        const callerBufName = context.freshName("$specOutBuf");
        inner.push(
          varDecl(
            "const",
            callerBufName,
            {
              ...spanOf(node),
              kind: "new",
              callee: ident("Float64Array", node),
              typeArguments: [],
              arguments: [numLiteral(outScalars.length, node)],
            },
            node,
            namedType("Float64Array", node),
          ),
        );
        addParam(outBufParam, "Float64Array", ident(callerBufName, node));
      }
      if (defBeforeUseWritten.length > 0) {
        kernelBody.push(
          varDecl(
            "let",
            ranName,
            boolLiteral(false, node),
            node,
            namedType("boolean", node),
          ),
        );
      }
      kernelBody.push(
        varDecl(
          "let",
          deoptName,
          boolLiteral(false, node),
          node,
          namedType("boolean", node),
        ),
      );
      kernelBody.push(
        varDecl(
          "let",
          innerDeoptName,
          boolLiteral(false, node),
          node,
          namedType("boolean", node),
        ),
      );
      kernelBody.push({
        ...spanOf(node),
        kind: "while",
        test: boolLiteral(true, node),
        body: blockStmt(helperOuterBody, node),
      });
      if (outBufParam !== undefined) {
        for (let idx = 0; idx < outScalars.length; idx++) {
          const s = outScalars[idx];
          if (s === undefined) continue;
          kernelBody.push(
            exprStmt(
              context.writeFloat64ElementCall(
                ident(outBufParam, node),
                numLiteral(idx, node),
                ident(s.varName, node),
                node,
              ),
              node,
            ),
          );
        }
      }
      kernelBody.push(
        ifStmt(
          ident(innerDeoptName, node),
          {
            ...spanOf(node),
            kind: "return",
            expression: numLiteral(3, node),
          },
          undefined,
          node,
        ),
      );
      if (defBeforeUseWritten.length > 0) {
        kernelBody.push(
          ifStmt(
            ident(deoptName, node),
            {
              ...spanOf(node),
              kind: "return",
              expression: {
                ...spanOf(node),
                kind: "conditional",
                test: ident(ranName, node),
                consequent: numLiteral(4, node),
                alternate: numLiteral(2, node),
              },
            },
            undefined,
            node,
          ),
        );
        kernelBody.push({
          ...spanOf(node),
          kind: "return",
          expression: {
            ...spanOf(node),
            kind: "conditional",
            test: ident(ranName, node),
            consequent: numLiteral(1, node),
            alternate: numLiteral(0, node),
          },
        });
      } else {
        kernelBody.push({
          ...spanOf(node),
          kind: "return",
          expression: {
            ...spanOf(node),
            kind: "conditional",
            test: ident(deoptName, node),
            consequent: numLiteral(2, node),
            alternate: numLiteral(0, node),
          },
        });
      }
      context.addHelperFunction({
        ...spanOf(node),
        kind: "function",
        name: kernelName,
        exported: false,
        parameters: params,
        returnType: namedType("number", node),
        body: blockStmt(kernelBody, node),
      });
      const statusName = context.freshName("$spec2dSt");
      inner.push(
        varDecl(
          "const",
          statusName,
          {
            ...spanOf(node),
            kind: "call",
            callee: ident(kernelName, node),
            arguments: callArgs,
          },
          node,
          namedType("number", node),
        ),
      );
      if (outBufParam !== undefined) {
        const callerBufArg = callArgs[callArgs.length - 1];
        if (callerBufArg === undefined || callerBufArg.kind !== "identifier")
          throw "NUMERIC_LOOP_OUTBUF_INVARIANT";
        for (let idx = 0; idx < outScalars.length; idx++) {
          const s = outScalars[idx];
          if (s === undefined) continue;
          inner.push(
            exprStmt(
              assignExpr(
                ident(s.varName, node),
                context.readFloat64ElementCall(
                  ident(callerBufArg.name, node),
                  numLiteral(idx, node),
                  node,
                ),
                node,
              ),
              node,
            ),
          );
        }
      }
      if (defBeforeUseWritten.length > 0) {
        inner.push(
          exprStmt(
            assignExpr(
              ident(ranName, node),
              binaryExpr(
                "||",
                binaryExpr(
                  "===",
                  ident(statusName, node),
                  numLiteral(1, node),
                  node,
                ),
                binaryExpr(
                  "===",
                  ident(statusName, node),
                  numLiteral(4, node),
                  node,
                ),
                node,
              ),
              node,
            ),
            node,
          ),
        );
      }
      inner.push(
        exprStmt(
          assignExpr(
            ident(deoptName, node),
            binaryExpr(
              "||",
              binaryExpr(
                "===",
                ident(statusName, node),
                numLiteral(2, node),
                node,
              ),
              binaryExpr(
                "===",
                ident(statusName, node),
                numLiteral(4, node),
                node,
              ),
              node,
            ),
            node,
          ),
          node,
        ),
      );
      inner.push(
        exprStmt(
          assignExpr(
            ident(innerDeoptName, node),
            binaryExpr(
              "===",
              ident(statusName, node),
              numLiteral(3, node),
              node,
            ),
            node,
          ),
          node,
        ),
      );
      inner.push(
        ifStmt(
          ident(innerDeoptName, node),
          blockStmt(handleInnerDeopt, node),
          undefined,
          node,
        ),
      );
    }
  } else {
    if (provenPlan !== undefined) {
      inner.push(emitProvenInnerLoop(node, provenPlan, deoptName, true));
    } else {
      inner.push(emitInnerLoop(node, makeSingleDeoptBlock, true));
    }
  }

  // Sync written scalars back to their general slots (skipped when nested
  // inner deopt already synced and executed the general tail).
  const syncStmts: Statement[] = [];
  for (const scalar of liveWritten) {
    const target = scalar.slot;
    if (target === undefined) throw "NUMERIC_LOOP_SYNC_INVARIANT";
    syncStmts.push(
      exprStmt(
        assignExpr({ ...target }, ident(scalar.varName, node), node),
        node,
      ),
    );
  }
  if (defBeforeUseWritten.length > 0) {
    const syncDef: Statement[] = [];
    for (const scalar of defBeforeUseWritten) {
      const target = scalar.slot;
      if (target === undefined) throw "NUMERIC_LOOP_SYNC_INVARIANT";
      syncDef.push(
        exprStmt(
          assignExpr({ ...target }, ident(scalar.varName, node), node),
          node,
        ),
      );
    }
    syncStmts.push(
      ifStmt(ident(ranName, node), blockStmt(syncDef, node), undefined, node),
    );
  }
  if (isNested) {
    if (syncStmts.length > 0) {
      inner.push(
        ifStmt(
          {
            ...spanOf(node),
            kind: "unary",
            operator: "!",
            operand: ident(innerDeoptName, node),
          },
          blockStmt(syncStmts, node),
          undefined,
          node,
        ),
      );
    }
  } else {
    for (const stmt of syncStmts) inner.push(stmt);
  }
  inner.push(
    ifStmt(
      {
        ...spanOf(node),
        kind: "unary",
        operator: "!",
        operand: ident(deoptName, node),
      },
      exprStmt(
        assignExpr(ident(doneName, node), boolLiteral(true, node), node),
        node,
      ),
      undefined,
      node,
    ),
  );

  // Build combined scalar & count & distinctness condition inside nested
  // `if (arrEl !== undefined)` guards (narrowing each ArrayElements cleanly).
  let guardCond: Expression | undefined = undefined;
  function addGuard(expr: Expression): void {
    guardCond =
      guardCond === undefined ? expr : binaryExpr("&&", guardCond, expr, node);
  }
  for (const arr of arrayList) {
    if (arr === undefined) throw "NUMERIC_LOOP_ARRAY_INVARIANT";
    addGuard(
      binaryExpr(
        ">",
        memberExpr(ident(arr.elName, node), "numberCount", node),
        numLiteral(0, node),
        node,
      ),
    );
    addGuard(
      binaryExpr(
        "<=",
        memberExpr(ident(arr.elName, node), "numberCount", node),
        numLiteral(2147483647, node),
        node,
      ),
    );
    addGuard(
      binaryExpr(
        "<=",
        memberExpr(ident(arr.elName, node), "numberCount", node),
        memberExpr(
          memberExpr(ident(arr.elName, node), "numbers", node),
          "length",
          node,
        ),
        node,
      ),
    );
  }
  if (provenPlan === undefined) {
    for (const pair of distinctPairs) {
      if (pair === undefined) throw "NUMERIC_LOOP_DISTINCT_INVARIANT";
      const aArr = arrays.get(pair.first),
        bArr = arrays.get(pair.second);
      if (aArr === undefined || bArr === undefined)
        throw "NUMERIC_LOOP_DISTINCT_INVARIANT";
      addGuard(
        binaryExpr(
          "!==",
          ident(aArr.elName, node),
          ident(bArr.elName, node),
          node,
        ),
      );
    }
  }
  for (const scalar of scalarList) {
    if (scalar === undefined) throw "NUMERIC_LOOP_SCALAR_INVARIANT";
    if (!scalar.defBeforeUse) addGuard(ident(scalar.okName, node));
  }

  let guarded: Statement = blockStmt(inner, node);
  if (guardCond !== undefined) {
    guarded = ifStmt(guardCond, guarded, undefined, node);
  }

  for (let i = arrayList.length - 1; i >= 0; i--) {
    const arr = arrayList[i];
    if (arr === undefined) throw "NUMERIC_LOOP_ARRAY_INVARIANT";
    guarded = ifStmt(
      binaryExpr(
        "!==",
        ident(arr.elName, node),
        ident("undefined", node),
        node,
      ),
      guarded,
      undefined,
      node,
    );
  }

  // Emit preamble: `$specDone = false`, array element views, scalar checks.
  const result: Statement[] = [
    varDecl(
      "let",
      doneName,
      boolLiteral(false, node),
      node,
      namedType("boolean", node),
    ),
  ];
  for (const arr of arrayList) {
    const generalVal = context.evaluateGeneralIdentifier(arr.sample);
    result.push(
      varDecl(
        "const",
        arr.elName,
        optionalMemberExpr(
          context.viewObjectValueCall(generalVal, arr.sample),
          "internalArrayElements",
          arr.sample,
        ),
        arr.sample,
      ),
    );
  }
  for (const scalar of scalarList) {
    if (scalar === undefined) throw "NUMERIC_LOOP_SCALAR_INVARIANT";
    if (scalar.defBeforeUse) continue;
    const generalVal = context.evaluateGeneralIdentifier(scalar.sample);
    result.push(varDecl("const", scalar.valName, generalVal, scalar.sample));
    const isNum = binaryExpr(
      "===",
      {
        ...spanOf(scalar.sample),
        kind: "unary",
        operator: "typeof",
        operand: ident(scalar.valName, scalar.sample),
      },
      { ...spanOf(scalar.sample), kind: "string", value: "number" },
      scalar.sample,
    );
    result.push(
      varDecl(
        "const",
        scalar.okName,
        isNum,
        scalar.sample,
        namedType("boolean", scalar.sample),
      ),
    );
    result.push(
      varDecl(
        "const",
        scalar.initName,
        {
          ...spanOf(scalar.sample),
          kind: "conditional",
          test: binaryExpr(
            "===",
            {
              ...spanOf(scalar.sample),
              kind: "unary",
              operator: "typeof",
              operand: ident(scalar.valName, scalar.sample),
            },
            { ...spanOf(scalar.sample), kind: "string", value: "number" },
            scalar.sample,
          ),
          consequent: ident(scalar.valName, scalar.sample),
          alternate: numLiteral(0, scalar.sample),
        },
        scalar.sample,
        namedType("number", scalar.sample),
      ),
    );
  }
  result.push(guarded);

  return {
    doneFlag: ident(doneName, node),
    statements: result,
    nested: isNested,
  };
}
