import type {
  BlockStatement,
  Expression,
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
  readonly markElementAccess: () => void;
}

interface ArrayEntry {
  readonly key: string;
  readonly sample: Expression & { readonly kind: "identifier" };
  read: boolean;
  written: boolean;
  elName: string;
  rawName: string;
  dataName: string;
  countName: string;
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
        dataName: "",
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
        if (writtenKey === entry.key) return undefined;
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

  context.markElementAccess();

  // Assign fresh variable names.
  for (const arr of arrayList) {
    if (arr === undefined) throw "NUMERIC_LOOP_ARRAY_INVARIANT";
    arr.elName = context.freshName("$specEl");
    arr.rawName = context.freshName("$specRaw");
    arr.dataName = context.freshName("$specData");
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
    // `idx >= 0 && idx < count && (idx | 0) === idx` is exact for every
    // unsigned integer index in `[0, count)` (and rejects negative, NaN,
    // Infinity, and fractional indices).
    const inRange = binaryExpr(
      "&&",
      binaryExpr(">=", idxRef, numLiteral(0, span), span),
      binaryExpr("<", idxRef, ident(arr.countName, span), span),
      span,
    );
    const notExactInt = binaryExpr(
      "!==",
      binaryExpr("|", idxRef, numLiteral(0, span), span),
      idxRef,
      span,
    );
    out.push(
      ifStmt(
        binaryExpr(
          "||",
          { ...spanOf(span), kind: "unary", operator: "!", operand: inRange },
          notExactInt,
          span,
        ),
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
    const rawName = context.freshName("$specElem");
    out.push(
      varDecl(
        "const",
        rawName,
        {
          ...spanOf(span),
          kind: "index",
          object: ident(arr.dataName, span),
          index: indexExpr,
          optional: false,
        },
        span,
      ),
    );
    out.push(
      ifStmt(
        binaryExpr("===", ident(rawName, span), ident("undefined", span), span),
        makeDeopt(span),
        undefined,
        span,
      ),
    );
    return ident(rawName, span);
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
          assignExpr(
            {
              ...spanOf(targetFor),
              kind: "index",
              object: ident(write.array.dataName, targetFor),
              index: write.indexExpr,
              optional: false,
            },
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
    inner.push(
      varDecl(
        "const",
        arr.dataName,
        {
          ...spanOf(node),
          kind: "conditional",
          test: binaryExpr(
            "===",
            ident(arr.countName, node),
            memberExpr(ident(arr.rawName, node), "length", node),
            node,
          ),
          consequent: ident(arr.rawName, node),
          alternate: {
            ...spanOf(node),
            kind: "call",
            callee: memberExpr(ident(arr.rawName, node), "subarray", node),
            arguments: [numLiteral(0, node), ident(arr.countName, node)],
          },
        },
        node,
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
    outerBody.push(emitInnerLoop(innerFor, makeNestedInnerDeoptBlock, false));
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
    handleInnerDeopt.push({ ...spanOf(node), kind: "break", label: undefined });
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
    inner.push(emitInnerLoop(node, makeSingleDeoptBlock, true));
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
