import {
  type BlockStatement,
  type Expression,
  type Parameter,
  type Span,
  type Statement,
  type SwitchClause,
  type TypeNode,
  type VariableBinding,
} from "@tint/typescript/syntax";

const maxInlineParameters = 7;
const maxInlineStatements = 12;
const maxInlineNodes = 128;
const maxCandidatesPerSite = 4;
const maxTinyCandidatesPerSite = 8;
const maxTinyCandidateNodes = 24;
const maxInlineDepth = 4;

export interface InlineCandidate {
  readonly spanStart: number;
  readonly strict: boolean;
  readonly parameters: readonly string[];
  readonly body: BlockStatement;
  readonly usesThis: boolean;
  readonly freeIdentifiers: readonly string[];
  readonly hasMutation: boolean;
  readonly nodeCount: number;
  slotIndex: number;
}

export interface ConstructorFieldInit {
  readonly key: string;
  readonly value: Expression;
}

export interface ConstructorCandidate {
  readonly spanStart: number;
  readonly strict: boolean;
  readonly parameters: readonly string[];
  readonly setupStatements: readonly Statement[];
  readonly fields: readonly ConstructorFieldInit[];
  readonly freeIdentifiers: readonly string[];
  readonly nodeCount: number;
  readonly isForwardingInit: boolean;
  slotIndex: number;
}

export interface InlineCandidatePlan {
  readonly bySpan: ReadonlyMap<number, InlineCandidate>;
  readonly byIdentifier: ReadonlyMap<string, readonly InlineCandidate[]>;
  readonly byProperty: ReadonlyMap<string, readonly InlineCandidate[]>;
  readonly byPropertyArity: ReadonlyMap<string, readonly InlineCandidate[]>;
  readonly byQualifiedProperty: ReadonlyMap<string, readonly InlineCandidate[]>;
  readonly byLocalProperty: ReadonlyMap<string, readonly InlineCandidate[]>;
  readonly ctorBySpan: ReadonlyMap<number, ConstructorCandidate>;
  readonly ctorByIdentifier: ReadonlyMap<
    string,
    readonly ConstructorCandidate[]
  >;
  readonly forwardingInitsByName: ReadonlyMap<
    string,
    readonly ConstructorCandidate[]
  >;
  readonly hasForwardingConstructor: boolean;
  readonly slotCount: number;
}

export interface InlineEmitterContext {
  readonly htmlDDAObjects: boolean;
  readonly freshName: (prefix: string) => string;
  readonly slotField: (index: number, span: Span) => Expression;
  readonly sharedPropertyCache: (
    name: string,
    span: Span,
    method: boolean,
    isStore: boolean,
  ) => Expression;
  readonly sharedObjectLiteralSite: (
    keys: readonly string[],
    span: Span,
  ) => Expression;
  readonly sharedConstructSite: (
    keys: readonly string[],
    span: Span,
    candidateSlot: number,
  ) => Expression;
  readonly isFreeIdentifierShadowed: (name: string) => boolean;
  readonly emitFreeIdentifier: (
    out: Statement[],
    name: string,
    span: Span,
    bailLabel: string,
  ) => Expression | undefined;
  readonly markElementAccess: () => void;
  readonly markObjectLiterals: () => void;
  readonly markSmallArrays: () => void;
  readonly markIntrinsicField: (field: string) => void;
}

interface BodyAnalysis {
  readonly ok: boolean;
  readonly usesThis: boolean;
  readonly hasMutation: boolean;
  readonly nodeCount: number;
  readonly freeIdentifiers: readonly string[];
}

function atSpan(span: Span): Span {
  return { start: span.start, end: span.end };
}

function ident(name: string, span: Span): Expression {
  return { ...atSpan(span), kind: "identifier", name };
}

function str(value: string, span: Span): Expression {
  return { ...atSpan(span), kind: "string", value };
}

function num(value: number, span: Span): Expression {
  return { ...atSpan(span), kind: "number", value, raw: String(value) };
}

function bool(value: boolean, span: Span): Expression {
  return { ...atSpan(span), kind: "boolean", value };
}

function namedType(name: string, span: Span): TypeNode {
  return { ...atSpan(span), kind: "named", name, arguments: [] };
}

function propAccess(
  object: Expression,
  property: string,
  span: Span,
): Expression {
  return { ...atSpan(span), kind: "member", object, property };
}

function callHelper(
  name: string,
  args: readonly Expression[],
  span: Span,
): Expression {
  return {
    ...atSpan(span),
    kind: "call",
    callee: ident(name, span),
    arguments: args,
  };
}

function bin(
  operator: string,
  left: Expression,
  right: Expression,
  span: Span,
): Expression {
  return { ...atSpan(span), kind: "binary", operator, left, right };
}

function un(operator: string, operand: Expression, span: Span): Expression {
  return { ...atSpan(span), kind: "unary", operator, operand };
}

function typeofIs(operand: Expression, kind: string, span: Span): Expression {
  return bin(
    "===",
    {
      ...atSpan(span),
      kind: "unary",
      generalTag: true,
      operator: "typeof",
      operand,
    },
    str(kind, span),
    span,
  );
}

function breakTo(label: string, span: Span): Statement {
  return { ...atSpan(span), kind: "break", label };
}

function asNumber(expr: Expression, span: Span): Expression {
  return {
    ...atSpan(span),
    kind: "satisfies",
    assertion: "as",
    type: namedType("number", span),
    expression: expr,
  };
}

function asString(expr: Expression, span: Span): Expression {
  return {
    ...atSpan(span),
    kind: "satisfies",
    assertion: "as",
    type: namedType("string", span),
    expression: expr,
  };
}

function blockOf(stmts: readonly Statement[], span: Span): BlockStatement {
  return { ...atSpan(span), kind: "block", statements: stmts };
}

function ifStmt(
  test: Expression,
  consequent: Statement,
  alternate: Statement | undefined,
  span: Span,
): Statement {
  return {
    ...atSpan(span),
    kind: "if",
    test,
    consequent,
    alternate,
  };
}

function constVar(
  name: string,
  initializer: Expression,
  span: Span,
  type: TypeNode | undefined = undefined,
): Statement {
  return {
    ...atSpan(span),
    kind: "variable",
    mode: "const",
    exported: false,
    declarations: [{ ...atSpan(span), name, type, initializer }],
  };
}

function letVar(
  name: string,
  initializer: Expression,
  span: Span,
  type: TypeNode | undefined = undefined,
): Statement {
  return {
    ...atSpan(span),
    kind: "variable",
    mode: "let",
    exported: false,
    declarations: [{ ...atSpan(span), name, type, initializer }],
  };
}

function assignStmt(name: string, value: Expression, span: Span): Statement {
  return {
    ...atSpan(span),
    kind: "expression",
    expression: {
      ...atSpan(span),
      kind: "assignment",
      target: ident(name, span),
      value,
    },
  };
}

function unwrapGroup(expr: Expression): Expression {
  let current: Expression = expr;
  while (current.kind === "group") current = current.expression;
  return current;
}

function isArithmeticBinary(op: string): boolean {
  return (
    op === "+" ||
    op === "-" ||
    op === "*" ||
    op === "/" ||
    op === "%" ||
    op === "&" ||
    op === "|" ||
    op === "^" ||
    op === "<<" ||
    op === ">>" ||
    op === ">>>" ||
    op === "<" ||
    op === ">" ||
    op === "<=" ||
    op === ">="
  );
}

function collectBindingNames(
  binding: VariableBinding | undefined,
  target: Set<string>,
): void {
  if (binding === undefined) return;
  if (binding.kind !== "object-binding" && binding.kind !== "array-binding") {
    if (binding.name !== "") target.add(binding.name);
    return;
  }
  if (binding.kind === "object-binding") {
    for (const prop of binding.properties) {
      if (prop !== undefined) collectBindingNames(prop.binding, target);
    }
    if (binding.rest !== undefined && binding.rest.name !== "")
      target.add(binding.rest.name);
    return;
  }
  for (const elem of binding.elements) collectBindingNames(elem, target);
  if (binding.rest !== undefined) collectBindingNames(binding.rest, target);
}

function simpleParameterNames(
  parameters: readonly Parameter[],
): readonly string[] | undefined {
  if (parameters.length > maxInlineParameters) return undefined;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const param of parameters) {
    if (
      param === undefined ||
      param.kind === "pattern-parameter" ||
      param.rest ||
      param.initializer !== undefined ||
      param.type !== undefined ||
      param.name === "arguments" ||
      param.name === "eval" ||
      seen.has(param.name)
    )
      return undefined;
    seen.add(param.name);
    names.push(param.name);
  }
  return names;
}

function isCanonicalIndexKey(key: string): boolean {
  if (key === "" || key === "__proto__") return true;
  const first = key.charCodeAt(0);
  if (first < 48 || first > 57) return false;
  if (key.length > 1 && first === 48) return false;
  if (key.length > 10) return false;
  for (let i: number = 1; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  const parsed = Number(key);
  return parsed >= 0 && parsed < 4294967295 && String(parsed) === key;
}

/** True when a constructible function body is the exact Prototype.js / Class.create
 * forwarding constructor `function() { this.initialize.apply(this, arguments); }`. */
export function isForwardingInitializeConstructor(
  parameters: readonly Parameter[],
  body: BlockStatement,
): boolean {
  if (parameters.length !== 0 || body.statements.length !== 1) return false;
  const only = body.statements[0];
  if (only === undefined || only.kind !== "expression") return false;
  const callExpr = unwrapGroup(only.expression);
  if (
    callExpr.kind !== "call" ||
    callExpr.optional ||
    callExpr.arguments.length !== 2
  )
    return false;
  const arg0 = callExpr.arguments[0];
  const arg1 = callExpr.arguments[1];
  if (arg0 === undefined || arg1 === undefined) return false;
  if (unwrapGroup(arg0).kind !== "this") return false;
  const a1 = unwrapGroup(arg1);
  if (a1.kind !== "identifier" || a1.name !== "arguments") return false;
  const callee = unwrapGroup(callExpr.callee);
  if (
    callee.kind !== "member" ||
    callee.optional ||
    callee.private ||
    callee.property !== "apply"
  )
    return false;
  const initAccess = unwrapGroup(callee.object);
  if (
    initAccess.kind !== "member" ||
    initAccess.optional ||
    initAccess.private ||
    initAccess.property !== "initialize"
  )
    return false;
  return unwrapGroup(initAccess.object).kind === "this";
}

function isSimpleSwitchCase(clause: SwitchClause): boolean {
  if (clause.test !== undefined) {
    const t = unwrapGroup(clause.test);
    if (t.kind !== "number" && t.kind !== "string" && t.kind !== "boolean")
      return false;
  }
  if (clause.statements.length !== 1) return false;
  const only = clause.statements[0];
  return only !== undefined && only.kind === "return";
}

function analyzeBody(
  body: BlockStatement,
  paramNames: readonly string[],
  enclosingLocals: ReadonlySet<string>,
): BodyAnalysis {
  const localNames = new Set<string>();
  for (const p of paramNames) localNames.add(p);
  // Pre-scan var/let/const declarations in the body.
  function collectDecls(stmt: Statement): boolean {
    if (stmt.kind === "variable") {
      for (const decl of stmt.declarations) {
        if (
          decl === undefined ||
          decl.kind === "object-binding" ||
          decl.kind === "array-binding" ||
          decl.type !== undefined ||
          decl.name === "arguments" ||
          decl.name === "eval"
        )
          return false;
        localNames.add(decl.name);
      }
      return true;
    }
    if (stmt.kind === "block") {
      for (const child of stmt.statements) {
        if (child === undefined || !collectDecls(child)) return false;
      }
      return true;
    }
    if (stmt.kind === "if") {
      if (!collectDecls(stmt.consequent)) return false;
      if (stmt.alternate !== undefined && !collectDecls(stmt.alternate))
        return false;
      return true;
    }
    if (stmt.kind === "switch") {
      for (const clause of stmt.clauses) {
        if (clause === undefined) return false;
        for (const child of clause.statements) {
          if (child === undefined || !collectDecls(child)) return false;
        }
      }
      return true;
    }
    return true;
  }
  if (body.statements.length > maxInlineStatements || !collectDecls(body)) {
    return {
      ok: false,
      usesThis: false,
      hasMutation: false,
      nodeCount: 0,
      freeIdentifiers: [],
    };
  }

  let ok: boolean = true;
  let usesThis: boolean = false;
  let nodeCount: number = 0;
  let anyMutation: boolean = false;
  const freeSet = new Set<string>();
  const freshLocals = new Set<string>();
  const writtenProps = new Set<string>();
  const forwardedBase = new Map<string, string>();

  function escapeExpr(expr: Expression): void {
    const raw = unwrapGroup(expr);
    if (raw.kind === "identifier") freshLocals.delete(raw.name);
  }

  function baseKeyOf(expr: Expression): string | undefined {
    const raw = unwrapGroup(expr);
    if (raw.kind === "this") return "this";
    if (raw.kind === "identifier" && localNames.has(raw.name))
      return "local:" + raw.name;
    if (
      raw.kind === "member" &&
      !raw.optional &&
      !raw.private &&
      unwrapGroup(raw.object).kind === "this" &&
      !writtenProps.has(raw.property)
    ) {
      return "this." + raw.property;
    }
    return undefined;
  }

  function invalidateBasePrefix(prefix: string): void {
    for (const [prop, base] of forwardedBase) {
      if (base === prefix) forwardedBase.delete(prop);
    }
  }

  function recordStagedWrite(targetObj: Expression, prop: string): void {
    writtenProps.add(prop);
    invalidateBasePrefix("this." + prop);
    const key = baseKeyOf(targetObj);
    if (key !== undefined) forwardedBase.set(prop, key);
    else forwardedBase.delete(prop);
  }

  function cloneStringMap(
    source: ReadonlyMap<string, string>,
  ): Map<string, string> {
    const copy = new Map<string, string>();
    for (const [k, v] of source) copy.set(k, v);
    return copy;
  }

  // Returns whether this expression performed an irreversible mutation (push/pop).
  // `afterIrreversible` forbids any further bailout-capable operation!
  function scanExpr(expr: Expression, afterIrreversible: boolean): boolean {
    if (!ok) return false;
    nodeCount++;
    if (nodeCount > maxInlineNodes) {
      ok = false;
      return false;
    }
    switch (expr.kind) {
      case "number":
      case "boolean":
      case "string":
      case "null":
        return false;
      case "this":
        usesThis = true;
        return false;
      case "identifier": {
        const name = expr.name;
        if (name === "arguments" || name === "eval") {
          ok = false;
          return false;
        }
        if (name === "undefined") return false;
        if (localNames.has(name)) return false;
        if (afterIrreversible || enclosingLocals.has(name)) {
          ok = false;
          return false;
        }
        freeSet.add(name);
        return false;
      }
      case "group":
        return scanExpr(expr.expression, afterIrreversible);
      case "member": {
        if (afterIrreversible || expr.optional || expr.private) {
          ok = false;
          return false;
        }
        const m = scanExpr(expr.object, false);
        if (m) ok = false;
        if (writtenProps.has(expr.property)) {
          const bKey = baseKeyOf(expr.object);
          if (bKey === undefined || forwardedBase.get(expr.property) !== bKey) {
            ok = false;
            return false;
          }
        }
        return false;
      }
      case "index": {
        if (afterIrreversible || expr.optional) {
          ok = false;
          return false;
        }
        if (scanExpr(expr.object, false) || scanExpr(expr.index, false))
          ok = false;
        return false;
      }
      case "unary": {
        if (
          afterIrreversible ||
          (expr.operator !== "!" &&
            expr.operator !== "-" &&
            expr.operator !== "+" &&
            expr.operator !== "~" &&
            expr.operator !== "typeof")
        ) {
          ok = false;
          return false;
        }
        if (scanExpr(expr.operand, false)) ok = false;
        return false;
      }
      case "binary": {
        if (
          afterIrreversible ||
          (!isArithmeticBinary(expr.operator) &&
            expr.operator !== "===" &&
            expr.operator !== "!==" &&
            expr.operator !== "==" &&
            expr.operator !== "!=" &&
            expr.operator !== "&&" &&
            expr.operator !== "||")
        ) {
          ok = false;
          return false;
        }
        if (scanExpr(expr.left, false) || scanExpr(expr.right, false))
          ok = false;
        return false;
      }
      case "conditional": {
        if (afterIrreversible) {
          ok = false;
          return false;
        }
        if (scanExpr(expr.test, false)) ok = false;
        const savedWritten = cloneStringSet(writtenProps);
        const savedFwd = cloneStringMap(forwardedBase);
        const m1 = scanExpr(expr.consequent, false);
        const consWritten = cloneStringSet(writtenProps);
        writtenProps.clear();
        for (const p of savedWritten) writtenProps.add(p);
        forwardedBase.clear();
        for (const [k, v] of savedFwd) forwardedBase.set(k, v);
        const m2 = scanExpr(expr.alternate, false);
        for (const p of consWritten) writtenProps.add(p);
        // After conditional merge, drop forwarding for any property written in either branch.
        for (const p of writtenProps) {
          if (!savedWritten.has(p)) {
            forwardedBase.delete(p);
            invalidateBasePrefix("this." + p);
          }
        }
        if (m1 || m2) anyMutation = true;
        return m1 || m2;
      }
      case "object": {
        if (afterIrreversible || expr.properties.length > 4) {
          ok = false;
          return false;
        }
        const keys = new Set<string>();
        for (const prop of expr.properties) {
          if (
            prop === undefined ||
            prop.kind === "spread" ||
            prop.computed ||
            prop.accessor !== undefined ||
            prop.prototypeSetter ||
            prop.name === "__proto__" ||
            keys.has(prop.name)
          ) {
            ok = false;
            return false;
          }
          keys.add(prop.name);
          if (scanExpr(prop.value, false)) ok = false;
        }
        return false;
      }
      case "assignment": {
        if (afterIrreversible) {
          ok = false;
          return false;
        }
        const target = unwrapGroup(expr.target);
        if (target.kind === "identifier") {
          if (!localNames.has(target.name)) {
            ok = false;
            return false;
          }
          freshLocals.delete(target.name);
          escapeExpr(expr.value);
          const irrev = scanExpr(expr.value, false);
          invalidateBasePrefix("local:" + target.name);
          return irrev;
        }
        if (
          target.kind === "member" &&
          !target.optional &&
          !target.private &&
          !isCanonicalIndexKey(target.property)
        ) {
          escapeExpr(expr.value);
          if (scanExpr(target.object, false) || scanExpr(expr.value, false)) {
            ok = false;
            return false;
          }
          const targetObj = unwrapGroup(target.object);
          if (
            targetObj.kind === "identifier" &&
            freshLocals.has(targetObj.name)
          ) {
            return false;
          }
          anyMutation = true;
          recordStagedWrite(target.object, target.property);
          return false;
        }
        ok = false;
        return false;
      }
      case "new": {
        if (afterIrreversible) {
          ok = false;
          return false;
        }
        for (const arg of expr.arguments) {
          if (arg === undefined || arg.kind === "spread") {
            ok = false;
            return false;
          }
          escapeExpr(arg);
          if (scanExpr(arg, false)) {
            ok = false;
            return false;
          }
        }
        const callee = unwrapGroup(expr.callee);
        if (callee.kind === "identifier" || callee.kind === "member") {
          if (scanExpr(callee, false)) {
            ok = false;
            return false;
          }
          return false;
        }
        ok = false;
        return false;
      }
      case "update": {
        if (afterIrreversible) {
          ok = false;
          return false;
        }
        const target = unwrapGroup(expr.target);
        if (target.kind === "identifier") {
          if (!localNames.has(target.name)) {
            ok = false;
            return false;
          }
          invalidateBasePrefix("local:" + target.name);
          return false;
        }
        if (
          target.kind === "member" &&
          !target.optional &&
          !target.private &&
          !isCanonicalIndexKey(target.property)
        ) {
          if (scanExpr(target.object, false)) {
            ok = false;
            return false;
          }
          if (writtenProps.has(target.property)) {
            const bKey = baseKeyOf(target.object);
            if (
              bKey === undefined ||
              forwardedBase.get(target.property) !== bKey
            ) {
              ok = false;
              return false;
            }
          }
          anyMutation = true;
          recordStagedWrite(target.object, target.property);
          return false;
        }
        ok = false;
        return false;
      }
      case "call": {
        if (afterIrreversible || expr.optional) {
          ok = false;
          return false;
        }
        for (const arg of expr.arguments) {
          if (arg === undefined || arg.kind === "spread") {
            ok = false;
            return false;
          }
          escapeExpr(arg);
          if (scanExpr(arg, false)) {
            ok = false;
            return false;
          }
        }
        const callee = unwrapGroup(expr.callee);
        if (callee.kind === "member" && !callee.optional && !callee.private) {
          escapeExpr(callee.object);
          if (scanExpr(callee.object, false)) {
            ok = false;
            return false;
          }
          if (
            (callee.property === "push" && expr.arguments.length === 1) ||
            (callee.property === "pop" && expr.arguments.length === 0)
          ) {
            if (writtenProps.size > 0) {
              ok = false;
              return false;
            }
            anyMutation = true;
            return true;
          }
          // Known pure Math builtin or candidate method call (resolved at inline time).
          return false;
        }
        if (callee.kind === "identifier") {
          if (localNames.has(callee.name) || enclosingLocals.has(callee.name)) {
            ok = false;
            return false;
          }
          freeSet.add(callee.name);
          return false;
        }
        ok = false;
        return false;
      }
      default:
        ok = false;
        return false;
    }
  }

  // Returns whether control flow exiting this statement has already performed an irreversible mutation.
  function scanStmt(stmt: Statement, mutatedBefore: boolean): boolean {
    if (!ok) return mutatedBefore;
    nodeCount++;
    if (nodeCount > maxInlineNodes) {
      ok = false;
      return mutatedBefore;
    }
    switch (stmt.kind) {
      case "empty":
        return mutatedBefore;
      case "block": {
        let mutated: boolean = mutatedBefore;
        for (const child of stmt.statements) {
          if (child === undefined) continue;
          mutated = scanStmt(child, mutated);
          if (!ok) return mutated;
        }
        return mutated;
      }
      case "variable": {
        let mutated: boolean = mutatedBefore;
        for (const decl of stmt.declarations) {
          if (decl === undefined) continue;
          const init = decl.initializer;
          if (init !== undefined) {
            if (mutated) {
              ok = false;
              return true;
            }
            const rawInit = unwrapGroup(init);
            mutated = scanExpr(init, false);
            if (
              decl.kind !== "object-binding" &&
              decl.kind !== "array-binding"
            ) {
              invalidateBasePrefix("local:" + decl.name);
              if (rawInit.kind === "new" || rawInit.kind === "object") {
                freshLocals.add(decl.name);
              }
            }
          }
        }
        return mutated;
      }
      case "expression": {
        if (mutatedBefore) {
          ok = false;
          return true;
        }
        return scanExpr(stmt.expression, false);
      }
      case "return": {
        if (stmt.expression !== undefined) {
          const m = scanExpr(stmt.expression, mutatedBefore);
          return mutatedBefore || m;
        }
        return mutatedBefore;
      }
      case "throw":
        // Throw branches bail out to the real call before any irreversible mutation.
        if (mutatedBefore) ok = false;
        return mutatedBefore;
      case "if": {
        if (mutatedBefore) {
          ok = false;
          return true;
        }
        if (scanExpr(stmt.test, false)) {
          ok = false;
          return true;
        }
        const savedWritten = cloneStringSet(writtenProps);
        const savedFwd = cloneStringMap(forwardedBase);
        const m1 = scanStmt(stmt.consequent, false);
        const consWritten = cloneStringSet(writtenProps);
        writtenProps.clear();
        for (const p of savedWritten) writtenProps.add(p);
        forwardedBase.clear();
        for (const [k, v] of savedFwd) forwardedBase.set(k, v);
        const m2 =
          stmt.alternate === undefined
            ? false
            : scanStmt(stmt.alternate, false);
        const altWritten = cloneStringSet(writtenProps);
        for (const p of consWritten) writtenProps.add(p);
        for (const p of altWritten) {
          if (!savedWritten.has(p)) {
            forwardedBase.delete(p);
            invalidateBasePrefix("this." + p);
          }
        }
        for (const p of consWritten) {
          if (!savedWritten.has(p)) {
            forwardedBase.delete(p);
            invalidateBasePrefix("this." + p);
          }
        }
        return m1 || m2;
      }
      case "switch": {
        if (mutatedBefore || stmt.clauses.length > 10) {
          ok = false;
          return true;
        }
        if (scanExpr(stmt.expression, false)) {
          ok = false;
          return true;
        }
        for (const clause of stmt.clauses) {
          if (clause === undefined || !isSimpleSwitchCase(clause)) {
            ok = false;
            return true;
          }
          const ret = clause.statements[0];
          if (ret !== undefined) scanStmt(ret, false);
        }
        return false;
      }
      default:
        ok = false;
        return mutatedBefore;
    }
  }

  scanStmt(body, false);
  if (!ok) {
    return {
      ok: false,
      usesThis: false,
      hasMutation: false,
      nodeCount: 0,
      freeIdentifiers: [],
    };
  }
  const freeIdentifiers: string[] = [];
  for (const name of freeSet) freeIdentifiers.push(name);
  return {
    ok: true,
    usesThis,
    hasMutation: anyMutation,
    nodeCount,
    freeIdentifiers,
  };
}

function cloneStringSet(source: ReadonlySet<string>): Set<string> {
  const copy = new Set<string>();
  for (const item of source) copy.add(item);
  return copy;
}

interface ConstructorAnalysis {
  readonly ok: boolean;
  readonly setupStatements: readonly Statement[];
  readonly fields: readonly ConstructorFieldInit[];
  readonly nodeCount: number;
  readonly freeIdentifiers: readonly string[];
}

function analyzeConstructorBody(
  body: BlockStatement,
  paramNames: readonly string[],
  enclosingLocals: ReadonlySet<string>,
): ConstructorAnalysis {
  const fail: ConstructorAnalysis = {
    ok: false,
    setupStatements: [],
    fields: [],
    nodeCount: 0,
    freeIdentifiers: [],
  };
  if (
    body.statements.length === 0 ||
    body.statements.length > maxInlineStatements
  )
    return fail;
  const setupStatements: Statement[] = [];
  const fields: ConstructorFieldInit[] = [];
  const seenKeys = new Set<string>();
  let inFields: boolean = false;
  function singleThisAssign(
    stmt: Statement | undefined,
  ): ConstructorFieldInit | undefined {
    if (stmt === undefined) return undefined;
    let inner: Statement = stmt;
    if (inner.kind === "block") {
      if (inner.statements.length !== 1) return undefined;
      const only = inner.statements[0];
      if (only === undefined) return undefined;
      inner = only;
    }
    if (inner.kind !== "expression") return undefined;
    const expr = unwrapGroup(inner.expression);
    if (expr.kind !== "assignment") return undefined;
    const target = unwrapGroup(expr.target);
    if (
      target.kind === "member" &&
      !target.optional &&
      !target.private &&
      unwrapGroup(target.object).kind === "this"
    ) {
      return { key: target.property, value: expr.value };
    }
    return undefined;
  }

  for (const stmt of body.statements) {
    if (stmt === undefined) return fail;
    const direct = singleThisAssign(stmt);
    if (direct !== undefined) {
      if (isCanonicalIndexKey(direct.key) || seenKeys.has(direct.key))
        return fail;
      inFields = true;
      seenKeys.add(direct.key);
      fields.push(direct);
      continue;
    }
    if (stmt.kind === "if" && stmt.alternate !== undefined) {
      const cons = singleThisAssign(stmt.consequent);
      const alt = singleThisAssign(stmt.alternate);
      if (
        cons !== undefined &&
        alt !== undefined &&
        cons.key === alt.key &&
        !isCanonicalIndexKey(cons.key) &&
        !seenKeys.has(cons.key)
      ) {
        inFields = true;
        seenKeys.add(cons.key);
        fields.push({
          key: cons.key,
          value: {
            ...atSpan(stmt),
            kind: "conditional",
            test: stmt.test,
            consequent: cons.value,
            alternate: alt.value,
          },
        });
        continue;
      }
    }
    if (inFields) return fail;
    setupStatements.push(stmt);
  }
  if (fields.length === 0 || fields.length > 8) return fail;
  // Build a synthetic pure body containing the setup statements and field value
  // expressions (evaluated into dummy variable declarations) and reuse analyzeBody!
  const synthetic: Statement[] = [];
  for (const stmt of setupStatements) {
    if (stmt.kind === "return" || stmt.kind === "throw") return fail;
    synthetic.push(stmt);
  }
  for (let i: number = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field === undefined) return fail;
    synthetic.push({
      ...atSpan(field.value),
      kind: "expression",
      expression: field.value,
    });
  }
  const analysis = analyzeBody(
    blockOf(synthetic, body),
    paramNames,
    enclosingLocals,
  );
  if (!analysis.ok || analysis.usesThis || analysis.hasMutation) return fail;
  return {
    ok: true,
    setupStatements,
    fields,
    nodeCount: analysis.nodeCount,
    freeIdentifiers: analysis.freeIdentifiers,
  };
}

function prototypeOwnerName(expr: Expression): string | undefined {
  const obj = unwrapGroup(expr);
  if (
    obj.kind !== "member" ||
    obj.optional ||
    obj.private ||
    obj.property !== "prototype"
  )
    return undefined;
  const owner = unwrapGroup(obj.object);
  if (owner.kind === "identifier") return owner.name;
  if (owner.kind === "member" && !owner.optional && !owner.private)
    return owner.property;
  return undefined;
}

export function selectMethodCandidates(
  plan: InlineCandidatePlan,
  target: Expression,
  enclosingFunctionStart: number,
  argCount: number = -1,
): readonly InlineCandidate[] | undefined {
  const raw = unwrapGroup(target);
  if (raw.kind === "member" && !raw.optional && !raw.private) {
    const owner = prototypeOwnerName(raw.object);
    if (owner !== undefined) {
      const qualified = plan.byQualifiedProperty.get(
        owner + "." + raw.property,
      );
      if (qualified !== undefined && qualified.length > 0) return qualified;
    }
    const globalList = plan.byProperty.get(raw.property);
    if (globalList !== undefined && globalList.length > 0) return globalList;
    if (argCount >= 0) {
      const arityList = plan.byPropertyArity.get(
        raw.property + "#" + String(argCount),
      );
      if (arityList !== undefined && arityList.length > 0) return arityList;
    }
    if (enclosingFunctionStart >= 0) {
      const localList = plan.byLocalProperty.get(
        String(enclosingFunctionStart) + ":" + raw.property,
      );
      if (localList !== undefined && localList.length > 0) return localList;
    }
    return undefined;
  }
  if (raw.kind === "identifier") return plan.byIdentifier.get(raw.name);
  return undefined;
}

export function collectInlineCandidates(
  statements: readonly Statement[],
  moduleStrict: boolean,
): InlineCandidatePlan {
  const bySpan = new Map<number, InlineCandidate>();
  const byIdentifier = new Map<string, InlineCandidate[]>();
  const byProperty = new Map<string, InlineCandidate[]>();
  const byQualifiedProperty = new Map<string, InlineCandidate[]>();
  const byLocalProperty = new Map<string, InlineCandidate[]>();
  const ctorBySpan = new Map<number, ConstructorCandidate>();
  const ctorByIdentifier = new Map<string, ConstructorCandidate[]>();
  const forwardingInitsByName = new Map<string, ConstructorCandidate[]>();
  const calledIdentifiers = new Set<string>();
  const calledProperties = new Set<string>();
  const calledQualifiedProperties = new Set<string>();
  const calledLocalProperties = new Set<string>();
  const constructedIdentifiers = new Set<string>();
  const constructedProperties = new Set<string>();
  const topDeclByName = new Map<string, InlineCandidate>();
  let hasForwardingConstructor: boolean = false;

  function addUnique(
    map: Map<string, InlineCandidate[]>,
    key: string,
    candidate: InlineCandidate,
  ): void {
    let list = map.get(key);
    if (list === undefined) {
      list = [];
      map.set(key, list);
    }
    for (const existing of list) {
      if (existing.spanStart === candidate.spanStart) return;
    }
    list.push(candidate);
  }

  function addUniqueCtor(
    map: Map<string, ConstructorCandidate[]>,
    key: string,
    candidate: ConstructorCandidate,
  ): void {
    let list = map.get(key);
    if (list === undefined) {
      list = [];
      map.set(key, list);
    }
    for (const existing of list) {
      if (existing.spanStart === candidate.spanStart) return;
    }
    list.push(candidate);
  }

  function tryRegisterConstructor(
    spanStart: number,
    parameters: readonly Parameter[],
    body: BlockStatement,
    fnStrict: boolean,
    asyncFlag: boolean | undefined,
    generatorFlag: boolean | undefined,
    enclosingLocals: ReadonlySet<string>,
    isForwardingInit: boolean,
  ): ConstructorCandidate | undefined {
    const existing = ctorBySpan.get(spanStart);
    if (existing !== undefined) return existing;
    if (asyncFlag || generatorFlag) return undefined;
    const paramNames = simpleParameterNames(parameters);
    if (paramNames === undefined) return undefined;
    const analysis = analyzeConstructorBody(body, paramNames, enclosingLocals);
    if (!analysis.ok) return undefined;
    const candidate: ConstructorCandidate = {
      spanStart,
      strict: fnStrict,
      parameters: paramNames,
      setupStatements: analysis.setupStatements,
      fields: analysis.fields,
      freeIdentifiers: analysis.freeIdentifiers,
      nodeCount: analysis.nodeCount,
      isForwardingInit,
      slotIndex: -1,
    };
    ctorBySpan.set(spanStart, candidate);
    return candidate;
  }

  function tryRegisterFunction(
    spanStart: number,
    parameters: readonly Parameter[],
    body: BlockStatement,
    fnStrict: boolean,
    asyncFlag: boolean | undefined,
    generatorFlag: boolean | undefined,
    enclosingLocals: ReadonlySet<string>,
  ): InlineCandidate | undefined {
    const existing = bySpan.get(spanStart);
    if (existing !== undefined) return existing;
    if (asyncFlag || generatorFlag) return undefined;
    const paramNames = simpleParameterNames(parameters);
    if (paramNames === undefined) return undefined;
    const analysis = analyzeBody(body, paramNames, enclosingLocals);
    if (!analysis.ok) return undefined;
    const candidate: InlineCandidate = {
      spanStart,
      strict: fnStrict,
      parameters: paramNames,
      body,
      usesThis: analysis.usesThis,
      freeIdentifiers: analysis.freeIdentifiers,
      hasMutation: analysis.hasMutation,
      nodeCount: analysis.nodeCount,
      slotIndex: -1,
    };
    bySpan.set(spanStart, candidate);
    return candidate;
  }

  function collectLocalDeclsInto(
    stmts: readonly Statement[],
    target: Set<string>,
  ): void {
    function walk(stmt: Statement | undefined): void {
      if (stmt === undefined) return;
      if (stmt.kind === "variable") {
        for (const decl of stmt.declarations) collectBindingNames(decl, target);
      } else if (stmt.kind === "function") {
        if (stmt.name !== "") target.add(stmt.name);
      } else if (stmt.kind === "block") {
        for (const child of stmt.statements) walk(child);
      } else if (stmt.kind === "if") {
        walk(stmt.consequent);
        walk(stmt.alternate);
      } else if (stmt.kind === "while" || stmt.kind === "do-while") {
        walk(stmt.body);
      } else if (stmt.kind === "for") {
        walk(stmt.initializer);
        walk(stmt.body);
      } else if (stmt.kind === "for-in" || stmt.kind === "for-of") {
        collectBindingNames(stmt.binding, target);
        walk(stmt.body);
      } else if (stmt.kind === "switch") {
        for (const c of stmt.clauses)
          if (c !== undefined) for (const child of c.statements) walk(child);
      } else if (stmt.kind === "try") {
        walk(stmt.body);
        if (stmt.handler !== undefined) walk(stmt.handler.body);
        if (stmt.finalizer !== undefined) walk(stmt.finalizer);
      } else if (stmt.kind === "label") {
        walk(stmt.body);
      }
    }
    for (const stmt of stmts) walk(stmt);
  }

  function collectCallNamesAndMethods(
    stmts: readonly Statement[],
    strictMode: boolean,
    enclosingLocals: ReadonlySet<string>,
    atTopLevel: boolean,
    enclosingFunctionStart: number,
  ): void {
    function scanExpr(expr: Expression | undefined): void {
      if (expr === undefined) return;
      switch (expr.kind) {
        case "group":
          scanExpr(expr.expression);
          return;
        case "call": {
          const callee = unwrapGroup(expr.callee);
          if (callee.kind === "identifier") calledIdentifiers.add(callee.name);
          else if (
            callee.kind === "member" &&
            !callee.optional &&
            !callee.private
          ) {
            calledProperties.add(callee.property);
            const owner = prototypeOwnerName(callee.object);
            if (owner !== undefined)
              calledQualifiedProperties.add(owner + "." + callee.property);
            if (enclosingFunctionStart >= 0)
              calledLocalProperties.add(
                String(enclosingFunctionStart) + ":" + callee.property,
              );
          }
          scanExpr(expr.callee);
          for (const arg of expr.arguments) scanExpr(arg);
          return;
        }
        case "new": {
          const callee = unwrapGroup(expr.callee);
          if (callee.kind === "identifier")
            constructedIdentifiers.add(callee.name);
          else if (
            callee.kind === "member" &&
            !callee.optional &&
            !callee.private
          )
            constructedProperties.add(callee.property);
          scanExpr(expr.callee);
          for (const arg of expr.arguments) scanExpr(arg);
          return;
        }
        case "assignment": {
          const target = unwrapGroup(expr.target);
          const rhs = unwrapGroup(expr.value);
          if (
            atTopLevel &&
            target.kind === "member" &&
            !target.optional &&
            !target.private
          ) {
            const protoOwner = prototypeOwnerName(target.object);
            if (rhs.kind === "function-expression") {
              const cand = tryRegisterFunction(
                rhs.start,
                rhs.parameters,
                rhs.body,
                rhs.strict ?? strictMode,
                rhs.async,
                rhs.generator,
                enclosingLocals,
              );
              if (cand !== undefined) {
                addUnique(byProperty, target.property, cand);
                if (protoOwner !== undefined)
                  addUnique(
                    byQualifiedProperty,
                    protoOwner + "." + target.property,
                    cand,
                  );
              }
            } else if (rhs.kind === "identifier") {
              const decl = topDeclByName.get(rhs.name);
              if (decl !== undefined) {
                addUnique(byProperty, target.property, decl);
                if (protoOwner !== undefined)
                  addUnique(
                    byQualifiedProperty,
                    protoOwner + "." + target.property,
                    decl,
                  );
              }
            } else if (
              target.property === "prototype" &&
              rhs.kind === "object"
            ) {
              const ownerObj = unwrapGroup(target.object);
              const ownerName =
                ownerObj.kind === "identifier"
                  ? ownerObj.name
                  : ownerObj.kind === "member" &&
                      !ownerObj.optional &&
                      !ownerObj.private
                    ? ownerObj.property
                    : undefined;
              if (ownerName !== undefined) {
                for (const prop of rhs.properties) {
                  if (
                    prop !== undefined &&
                    prop.kind !== "spread" &&
                    !prop.computed &&
                    prop.accessor === undefined &&
                    !prop.prototypeSetter
                  ) {
                    const val = unwrapGroup(prop.value);
                    if (val.kind === "function-expression") {
                      if (prop.name === "initialize") {
                        const ctor = tryRegisterConstructor(
                          val.start,
                          val.parameters,
                          val.body,
                          val.strict ?? strictMode,
                          val.async,
                          val.generator,
                          enclosingLocals,
                          true,
                        );
                        if (ctor !== undefined)
                          addUniqueCtor(forwardingInitsByName, ownerName, ctor);
                      } else {
                        const cand = tryRegisterFunction(
                          val.start,
                          val.parameters,
                          val.body,
                          val.strict ?? strictMode,
                          val.async,
                          val.generator,
                          enclosingLocals,
                        );
                        if (cand !== undefined)
                          addUnique(
                            byQualifiedProperty,
                            ownerName + "." + prop.name,
                            cand,
                          );
                      }
                    }
                  }
                }
              }
            }
          }
          scanExpr(expr.target);
          scanExpr(expr.value);
          return;
        }
        case "object": {
          for (const prop of expr.properties) {
            if (prop === undefined) continue;
            if (prop.kind === "spread") {
              scanExpr(prop.value);
              continue;
            }
            if (
              !prop.computed &&
              prop.accessor === undefined &&
              !prop.prototypeSetter
            ) {
              const val = unwrapGroup(prop.value);
              if (val.kind === "function-expression") {
                const cand = tryRegisterFunction(
                  val.start,
                  val.parameters,
                  val.body,
                  val.strict ?? strictMode,
                  val.async,
                  val.generator,
                  enclosingLocals,
                );
                if (cand !== undefined) {
                  addUnique(byProperty, prop.name, cand);
                  if (enclosingFunctionStart >= 0)
                    addUnique(
                      byLocalProperty,
                      String(enclosingFunctionStart) + ":" + prop.name,
                      cand,
                    );
                }
              } else if (val.kind === "identifier") {
                const decl = topDeclByName.get(val.name);
                if (decl !== undefined && !enclosingLocals.has(val.name)) {
                  addUnique(byProperty, prop.name, decl);
                  if (enclosingFunctionStart >= 0)
                    addUnique(
                      byLocalProperty,
                      String(enclosingFunctionStart) + ":" + prop.name,
                      decl,
                    );
                }
              }
            }
            scanExpr(prop.keyExpression);
            scanExpr(prop.value);
          }
          return;
        }
        case "array":
          for (const item of expr.elements) scanExpr(item);
          return;
        case "spread":
          scanExpr(expr.value);
          return;
        case "member":
          scanExpr(expr.object);
          return;
        case "index":
          scanExpr(expr.object);
          scanExpr(expr.index);
          return;
        case "unary":
          scanExpr(expr.operand);
          return;
        case "binary":
          scanExpr(expr.left);
          scanExpr(expr.right);
          return;
        case "compound":
          scanExpr(expr.target);
          scanExpr(expr.value);
          return;
        case "update":
          scanExpr(expr.target);
          return;
        case "conditional":
          scanExpr(expr.test);
          scanExpr(expr.consequent);
          scanExpr(expr.alternate);
          return;
        case "function-expression": {
          if (
            !expr.async &&
            !expr.generator &&
            isForwardingInitializeConstructor(expr.parameters, expr.body)
          )
            hasForwardingConstructor = true;
          const nextLocals = cloneStringSet(enclosingLocals);
          if (expr.name !== undefined) nextLocals.add(expr.name);
          for (const p of expr.parameters) {
            if (p === undefined) continue;
            if (p.kind === "pattern-parameter")
              collectBindingNames(p.pattern, nextLocals);
            else nextLocals.add(p.name);
          }
          collectLocalDeclsInto(expr.body.statements, nextLocals);
          collectCallNamesAndMethods(
            expr.body.statements,
            expr.strict ?? strictMode,
            nextLocals,
            false,
            expr.start,
          );
          return;
        }
        case "arrow": {
          const nextLocals = cloneStringSet(enclosingLocals);
          for (const p of expr.parameters) {
            if (p === undefined) continue;
            if (p.kind === "pattern-parameter")
              collectBindingNames(p.pattern, nextLocals);
            else nextLocals.add(p.name);
          }
          const arrowBody = expr.body;
          if (arrowBody.kind === "block") {
            collectLocalDeclsInto(arrowBody.statements, nextLocals);
            collectCallNamesAndMethods(
              arrowBody.statements,
              expr.strict ?? strictMode,
              nextLocals,
              false,
              expr.start,
            );
          } else {
            scanExpr(arrowBody);
          }
          return;
        }
        case "await":
          scanExpr(expr.expression);
          return;
        case "yield":
          scanExpr(expr.expression);
          return;
        case "template-expression":
          for (const part of expr.substitutions) scanExpr(part);
          return;
        case "tagged-template":
          scanExpr(expr.tag);
          for (const part of expr.template.substitutions) scanExpr(part);
          return;
        case "satisfies":
          scanExpr(expr.expression);
          return;
        default:
          return;
      }
    }

    function scanStmt(stmt: Statement | undefined): void {
      if (stmt === undefined) return;
      switch (stmt.kind) {
        case "expression":
          scanExpr(stmt.expression);
          return;
        case "return":
          scanExpr(stmt.expression);
          return;
        case "throw":
          scanExpr(stmt.expression);
          return;
        case "block":
          for (const child of stmt.statements) scanStmt(child);
          return;
        case "variable":
          for (const decl of stmt.declarations)
            if (decl !== undefined) scanExpr(decl.initializer);
          return;
        case "if":
          scanExpr(stmt.test);
          scanStmt(stmt.consequent);
          scanStmt(stmt.alternate);
          return;
        case "while":
        case "do-while":
          scanExpr(stmt.test);
          scanStmt(stmt.body);
          return;
        case "for":
          scanStmt(stmt.initializer);
          scanExpr(stmt.test);
          scanExpr(stmt.update);
          scanStmt(stmt.body);
          return;
        case "for-in":
        case "for-of":
          scanExpr(stmt.iterable);
          scanStmt(stmt.body);
          return;
        case "for-in-assignment":
        case "for-of-assignment":
          scanExpr(stmt.target);
          scanExpr(stmt.iterable);
          scanStmt(stmt.body);
          return;
        case "switch":
          scanExpr(stmt.expression);
          for (const clause of stmt.clauses) {
            if (clause === undefined) continue;
            scanExpr(clause.test);
            for (const child of clause.statements) scanStmt(child);
          }
          return;
        case "try":
          scanStmt(stmt.body);
          if (stmt.handler !== undefined) scanStmt(stmt.handler.body);
          if (stmt.finalizer !== undefined) scanStmt(stmt.finalizer);
          return;
        case "label":
          scanStmt(stmt.body);
          return;
        case "with":
          scanExpr(stmt.object);
          scanStmt(stmt.body);
          return;
        case "function": {
          const fnBody = stmt.body;
          if (fnBody.kind !== "block") return;
          const nextLocals = cloneStringSet(enclosingLocals);
          for (const p of stmt.parameters) {
            if (p === undefined) continue;
            if (p.kind === "pattern-parameter")
              collectBindingNames(p.pattern, nextLocals);
            else nextLocals.add(p.name);
          }
          collectLocalDeclsInto(fnBody.statements, nextLocals);
          collectCallNamesAndMethods(
            fnBody.statements,
            stmt.strict ?? strictMode,
            nextLocals,
            false,
            stmt.start,
          );
          return;
        }
        case "export-default":
          scanExpr(stmt.value);
          return;
        default:
          return;
      }
    }

    for (const stmt of stmts) scanStmt(stmt);
  }

  // Pass 1: register top-level function declarations so property aliases can find them.
  const emptyLocals = new Set<string>();
  const topDeclCounts = new Map<string, number>();
  for (const stmt of statements) {
    if (stmt !== undefined && stmt.kind === "function") {
      topDeclCounts.set(stmt.name, (topDeclCounts.get(stmt.name) ?? 0) + 1);
    }
  }
  for (const stmt of statements) {
    if (
      stmt !== undefined &&
      stmt.kind === "function" &&
      topDeclCounts.get(stmt.name) === 1
    ) {
      const fnBody = stmt.body;
      if (fnBody.kind !== "block") continue;
      const cand = tryRegisterFunction(
        stmt.start,
        stmt.parameters,
        fnBody,
        stmt.strict ?? moduleStrict,
        stmt.async,
        stmt.generator,
        emptyLocals,
      );
      if (cand !== undefined) {
        topDeclByName.set(stmt.name, cand);
        addUnique(byIdentifier, stmt.name, cand);
      }
      const ctorCand = tryRegisterConstructor(
        stmt.start,
        stmt.parameters,
        fnBody,
        stmt.strict ?? moduleStrict,
        stmt.async,
        stmt.generator,
        emptyLocals,
        false,
      );
      if (ctorCand !== undefined) {
        addUniqueCtor(ctorByIdentifier, stmt.name, ctorCand);
      }
    }
  }

  // Pass 2: collect all called names and prototype/object-literal methods.
  collectCallNamesAndMethods(statements, moduleStrict, emptyLocals, true, -1);

  // Assign $fc slot indices ONLY to candidates that are actually selectable at a call/new site!
  const activeBySpan = new Map<number, InlineCandidate>();
  const activeByIdentifier = new Map<string, readonly InlineCandidate[]>();
  const activeByProperty = new Map<string, readonly InlineCandidate[]>();
  const activeByQualifiedProperty = new Map<
    string,
    readonly InlineCandidate[]
  >();
  const activeByPropertyArity = new Map<string, readonly InlineCandidate[]>();
  const activeByLocalProperty = new Map<string, readonly InlineCandidate[]>();
  const activeCtorBySpan = new Map<number, ConstructorCandidate>();
  const activeCtorByIdentifier = new Map<
    string,
    readonly ConstructorCandidate[]
  >();
  const activeForwardingInitsByName = new Map<
    string,
    readonly ConstructorCandidate[]
  >();
  let slotCount: number = 0;

  function activateList(
    source: Map<string, InlineCandidate[]>,
    called: Set<string>,
    dest: Map<string, readonly InlineCandidate[]>,
    maxPerSite: number = maxCandidatesPerSite,
    arityDest?: Map<string, readonly InlineCandidate[]>,
  ): void {
    for (const [name, list] of source) {
      if (!called.has(name)) continue;
      if (list.length === 0) continue;
      if (list.length > maxPerSite) {
        let allTiny: boolean = list.length <= maxTinyCandidatesPerSite;
        if (allTiny) {
          for (const cand of list) {
            if (cand.nodeCount > maxTinyCandidateNodes) {
              allTiny = false;
              break;
            }
          }
        }
        if (allTiny) {
          for (const cand of list) {
            if (cand.slotIndex < 0) {
              cand.slotIndex = slotCount;
              slotCount++;
              activeBySpan.set(cand.spanStart, cand);
            }
          }
          dest.set(name, list);
          continue;
        }
        if (arityDest === undefined) continue;
        const groups = new Map<number, InlineCandidate[]>();
        for (const cand of list) {
          const arity = cand.parameters.length;
          let group = groups.get(arity);
          if (group === undefined) {
            group = [];
            groups.set(arity, group);
          }
          group.push(cand);
        }
        for (const [arity, group] of groups) {
          if (group.length === 0 || group.length > maxPerSite) continue;
          for (const cand of group) {
            if (cand.slotIndex < 0) {
              cand.slotIndex = slotCount;
              slotCount++;
              activeBySpan.set(cand.spanStart, cand);
            }
          }
          arityDest.set(name + "#" + String(arity), group);
        }
        continue;
      }
      for (const cand of list) {
        if (cand.slotIndex < 0) {
          cand.slotIndex = slotCount;
          slotCount++;
          activeBySpan.set(cand.spanStart, cand);
        }
      }
      dest.set(name, list);
    }
  }

  function activateCtorList(
    source: Map<string, ConstructorCandidate[]>,
    constructedA: Set<string>,
    constructedB: Set<string> | undefined,
    dest: Map<string, readonly ConstructorCandidate[]>,
  ): void {
    for (const [name, list] of source) {
      if (
        !constructedA.has(name) &&
        (constructedB === undefined || !constructedB.has(name))
      )
        continue;
      if (list.length === 0 || list.length > 2) continue;
      for (const cand of list) {
        if (cand.slotIndex < 0) {
          const existingFn = activeBySpan.get(cand.spanStart);
          if (existingFn !== undefined && existingFn.slotIndex >= 0) {
            cand.slotIndex = existingFn.slotIndex;
          } else {
            cand.slotIndex = slotCount;
            slotCount++;
          }
          activeCtorBySpan.set(cand.spanStart, cand);
        }
      }
      dest.set(name, list);
    }
  }

  activateList(byIdentifier, calledIdentifiers, activeByIdentifier);
  activateList(
    byProperty,
    calledProperties,
    activeByProperty,
    maxCandidatesPerSite,
    activeByPropertyArity,
  );
  activateList(
    byQualifiedProperty,
    calledQualifiedProperties,
    activeByQualifiedProperty,
    2,
  );
  activateList(byLocalProperty, calledLocalProperties, activeByLocalProperty);
  activateCtorList(
    ctorByIdentifier,
    constructedIdentifiers,
    undefined,
    activeCtorByIdentifier,
  );
  if (hasForwardingConstructor) {
    activateCtorList(
      forwardingInitsByName,
      constructedProperties,
      constructedIdentifiers,
      activeForwardingInitsByName,
    );
  }

  return {
    bySpan: activeBySpan,
    byIdentifier: activeByIdentifier,
    byProperty: activeByProperty,
    byPropertyArity: activeByPropertyArity,
    byQualifiedProperty: activeByQualifiedProperty,
    byLocalProperty: activeByLocalProperty,
    ctorBySpan: activeCtorBySpan,
    ctorByIdentifier: activeCtorByIdentifier,
    forwardingInitsByName: activeForwardingInitsByName,
    hasForwardingConstructor,
    slotCount,
  };
}

interface ForwardedEntry {
  readonly baseKey: string;
  readonly value: Expression;
}

interface PendingStore {
  readonly guardVar: string | undefined;
  readonly objVar: string;
  readonly valVar: string;
  readonly cache: Expression;
  readonly span: Span;
}

interface TransactionState {
  readonly rootBailLabel: string;
  readonly hoistedDecls: Statement[];
  readonly pendingStores: PendingStore[];
  conditionalDepth: number;
}

function isPureOverrideExpr(expr: Expression, forbiddenIdent: string): boolean {
  const raw = unwrapGroup(expr);
  switch (raw.kind) {
    case "number":
    case "boolean":
    case "string":
    case "null":
    case "this":
      return true;
    case "identifier":
      return raw.name !== forbiddenIdent;
    case "member":
      return (
        !raw.optional &&
        !raw.private &&
        isPureOverrideExpr(raw.object, forbiddenIdent)
      );
    case "index":
      return (
        !raw.optional &&
        isPureOverrideExpr(raw.object, forbiddenIdent) &&
        isPureOverrideExpr(raw.index, forbiddenIdent)
      );
    case "unary":
      return isPureOverrideExpr(raw.operand, forbiddenIdent);
    case "binary":
      return (
        isPureOverrideExpr(raw.left, forbiddenIdent) &&
        isPureOverrideExpr(raw.right, forbiddenIdent)
      );
    case "conditional":
      return (
        isPureOverrideExpr(raw.test, forbiddenIdent) &&
        isPureOverrideExpr(raw.consequent, forbiddenIdent) &&
        isPureOverrideExpr(raw.alternate, forbiddenIdent)
      );
    default:
      return false;
  }
}

export function emitInlineCandidates(
  plan: InlineCandidatePlan,
  candidates: readonly InlineCandidate[],
  callee: Expression,
  receiver: Expression,
  actuals: readonly Expression[],
  resultName: string,
  doneName: string,
  span: Span,
  depth: number,
  activeSpans: Set<number>,
  ctx: InlineEmitterContext,
  requirePure: boolean = false,
  outerTx: TransactionState | undefined = undefined,
  outerWrittenProps: ReadonlySet<string> | undefined = undefined,
  mergedWrittenOut: Set<string> | undefined = undefined,
): Statement[] | undefined {
  if (depth > maxInlineDepth || candidates.length === 0) return undefined;

  // Filter to candidates that are not currently being expanded (no recursion)
  // and whose free identifiers are not shadowed by caller locals.
  const usable: InlineCandidate[] = [];
  for (const cand of candidates) {
    if (cand.slotIndex < 0 || activeSpans.has(cand.spanStart)) continue;
    if (requirePure && cand.hasMutation) continue;
    let shadowed: boolean = false;
    for (const free of cand.freeIdentifiers) {
      if (ctx.isFreeIdentifierShadowed(free)) {
        shadowed = true;
        break;
      }
    }
    if (!shadowed) usable.push(cand);
  }
  if (usable.length === 0) return undefined;

  if (outerTx !== undefined) outerTx.conditionalDepth++;
  let chain: Statement | undefined = undefined;
  for (let idx: number = usable.length - 1; idx >= 0; idx--) {
    const cand = usable[idx];
    if (cand === undefined) continue;
    const savedHoistedLen =
      outerTx !== undefined ? outerTx.hoistedDecls.length : 0;
    const savedPendingLen =
      outerTx !== undefined ? outerTx.pendingStores.length : 0;
    const candWritten =
      mergedWrittenOut !== undefined ? new Set<string>() : undefined;
    activeSpans.add(cand.spanStart);
    const bodyStmts = emitSingleCandidate(
      plan,
      cand,
      receiver,
      actuals,
      resultName,
      doneName,
      span,
      depth,
      activeSpans,
      ctx,
      undefined,
      outerTx,
      outerWrittenProps,
      candWritten,
    );
    activeSpans.delete(cand.spanStart);
    if (bodyStmts === undefined) {
      if (outerTx !== undefined) {
        while (outerTx.hoistedDecls.length > savedHoistedLen)
          outerTx.hoistedDecls.pop();
        while (outerTx.pendingStores.length > savedPendingLen)
          outerTx.pendingStores.pop();
      }
      continue;
    }
    if (mergedWrittenOut !== undefined && candWritten !== undefined) {
      for (const p of candWritten) mergedWrittenOut.add(p);
    }
    const slotRef = ctx.slotField(cand.slotIndex, span);
    const guard = bin(
      "&&",
      bin("!==", slotRef, ident("undefined", span), span),
      bin("===", callee, slotRef, span),
      span,
    );
    chain = {
      ...atSpan(span),
      kind: "if",
      test: guard,
      consequent: blockOf(bodyStmts, span),
      alternate: chain,
    };
  }
  if (outerTx !== undefined) outerTx.conditionalDepth--;
  return chain === undefined ? undefined : [chain];
}

interface ConstructEmitSpec {
  readonly siteExpr: Expression;
  readonly fields: readonly ConstructorFieldInit[];
}

export function emitInlineConstructCandidates(
  plan: InlineCandidatePlan,
  directCandidates: readonly ConstructorCandidate[] | undefined,
  forwardingCandidates: readonly ConstructorCandidate[] | undefined,
  target: Expression,
  actuals: readonly Expression[],
  resultName: string,
  doneName: string,
  span: Span,
  depth: number,
  activeSpans: Set<number>,
  ctx: InlineEmitterContext,
): Statement[] | undefined {
  if (depth > maxInlineDepth) return undefined;

  function filterUsable(
    list: readonly ConstructorCandidate[] | undefined,
  ): ConstructorCandidate[] {
    const out: ConstructorCandidate[] = [];
    if (list === undefined) return out;
    for (const cand of list) {
      if (cand.slotIndex < 0 || activeSpans.has(cand.spanStart)) continue;
      let shadowed: boolean = false;
      for (const free of cand.freeIdentifiers) {
        if (ctx.isFreeIdentifierShadowed(free)) {
          shadowed = true;
          break;
        }
      }
      if (!shadowed) out.push(cand);
    }
    return out;
  }

  const usableDirect = filterUsable(directCandidates);
  const usableForwarding = filterUsable(forwardingCandidates);
  if (usableDirect.length === 0 && usableForwarding.length === 0)
    return undefined;

  // Build an ultra-compact guard chain for direct and forwarding constructors:
  // each candidate gets its own ConstructSite whose hot check is just
  // `site.constructCtor !== undefined && target === site.constructCtor &&
  //  site.constructEpoch === site.constructEpochRef.value`, falling back once
  // to `warmConstructSite(target, $fc[slot], isForwarding, $errors, site)`.
  const allCandidates: {
    readonly ctor: ConstructorCandidate;
    readonly isForwarding: boolean;
  }[] = [];
  for (const ctor of usableDirect)
    allCandidates.push({ ctor, isForwarding: false });
  for (const ctor of usableForwarding)
    allCandidates.push({ ctor, isForwarding: true });

  let chain: Statement | undefined = undefined;
  for (let idx: number = allCandidates.length - 1; idx >= 0; idx--) {
    const entry = allCandidates[idx];
    if (entry === undefined) continue;
    const ctor = entry.ctor;
    const fieldKeys: string[] = [];
    for (const field of ctor.fields) fieldKeys.push(field.key);
    const siteExpr = ctx.sharedConstructSite(fieldKeys, span, ctor.slotIndex);
    activeSpans.add(ctor.spanStart);
    const synthetic: InlineCandidate = {
      spanStart: ctor.spanStart,
      strict: ctor.strict,
      parameters: ctor.parameters,
      body: blockOf(ctor.setupStatements, span),
      usesThis: false,
      freeIdentifiers: ctor.freeIdentifiers,
      hasMutation: false,
      nodeCount: ctor.nodeCount,
      slotIndex: ctor.slotIndex,
    };
    const bodyStmts = emitSingleCandidate(
      plan,
      synthetic,
      target,
      actuals,
      resultName,
      doneName,
      span,
      depth,
      activeSpans,
      ctx,
      {
        siteExpr,
        fields: ctor.fields,
      },
    );
    activeSpans.delete(ctor.spanStart);
    if (bodyStmts === undefined) continue;
    const slotRef = ctx.slotField(ctor.slotIndex, span);
    const cachedCtor = propAccess(siteExpr, "constructCtor", span);
    const fastHit = bin(
      "&&",
      bin("!==", cachedCtor, ident("undefined", span), span),
      bin(
        "&&",
        bin("===", target, cachedCtor, span),
        bin(
          "===",
          propAccess(siteExpr, "constructEpoch", span),
          propAccess(
            propAccess(siteExpr, "constructEpochRef", span),
            "value",
            span,
          ),
          span,
        ),
        span,
      ),
      span,
    );
    const warmHit = callHelper(
      "warmConstructSite",
      [
        target,
        slotRef,
        bool(entry.isForwarding, span),
        ident("$errors", span),
        siteExpr,
      ],
      span,
    );
    chain = ifStmt(
      bin("||", fastHit, warmHit, span),
      blockOf(bodyStmts, span),
      chain,
      span,
    );
  }
  return chain === undefined ? undefined : [chain];
}

function emitSingleCandidate(
  plan: InlineCandidatePlan,
  cand: InlineCandidate,
  receiver: Expression,
  actuals: readonly Expression[],
  resultName: string,
  doneName: string,
  callSpan: Span,
  depth: number,
  activeSpans: Set<number>,
  ctx: InlineEmitterContext,
  constructSpec: ConstructEmitSpec | undefined = undefined,
  outerTx: TransactionState | undefined = undefined,
  outerWrittenProps: ReadonlySet<string> | undefined = undefined,
  writtenPropsOut: Set<string> | undefined = undefined,
): Statement[] | undefined {
  const isRootTransaction = outerTx === undefined;
  const returnLabel = ctx.freshName("$inl");
  const tx: TransactionState =
    outerTx !== undefined
      ? outerTx
      : {
          rootBailLabel: returnLabel,
          hoistedDecls: [],
          pendingStores: [],
          conditionalDepth: 0,
        };
  const bailLabel = tx.rootBailLabel;
  const stmts: Statement[] = [];
  const locals = new Map<string, string>();
  const writtenProps =
    outerWrittenProps !== undefined
      ? cloneStringSet(outerWrittenProps)
      : new Set<string>();
  const forwarded = new Map<string, ForwardedEntry>();

  function exprBaseKey(expr: Expression): string | undefined {
    const raw = unwrapGroup(expr);
    if (raw.kind === "this") return "this";
    if (raw.kind === "identifier" && locals.has(raw.name))
      return "local:" + raw.name;
    if (
      raw.kind === "member" &&
      !raw.optional &&
      !raw.private &&
      unwrapGroup(raw.object).kind === "this" &&
      !writtenProps.has(raw.property)
    ) {
      return "this." + raw.property;
    }
    return undefined;
  }

  function invalidateForwardedBase(baseKey: string): void {
    for (const [prop, entry] of forwarded) {
      if (entry.baseKey === baseKey) forwarded.delete(prop);
    }
  }

  function cloneForwardedMap(
    source: ReadonlyMap<string, ForwardedEntry>,
  ): Map<string, ForwardedEntry> {
    const copy = new Map<string, ForwardedEntry>();
    for (const [k, v] of source) copy.set(k, v);
    return copy;
  }

  function recordTransactionWrite(
    targetObj: Expression,
    prop: string,
    valExpr: Expression,
  ): void {
    writtenProps.add(prop);
    if (writtenPropsOut !== undefined) writtenPropsOut.add(prop);
    invalidateForwardedBase("this." + prop);
    const bKey = exprBaseKey(targetObj);
    if (bKey !== undefined)
      forwarded.set(prop, { baseKey: bKey, value: valExpr });
    else forwarded.delete(prop);
  }

  function commitPendingStores(out: Statement[], span: Span): void {
    if (!isRootTransaction || tx.pendingStores.length === 0) return;
    for (const store of tx.pendingStores) {
      const storeCall: Statement = {
        ...atSpan(store.span),
        kind: "expression",
        expression: callHelper(
          "cachedPropertyStore",
          [
            ident(store.objVar, store.span),
            ident(store.valVar, store.span),
            store.cache,
          ],
          store.span,
        ),
      };
      if (store.guardVar === undefined) {
        out.push(storeCall);
      } else {
        out.push(
          ifStmt(ident(store.guardVar, span), storeCall, undefined, store.span),
        );
      }
    }
  }

  function emitStagedPropertyStore(
    out: Statement[],
    objTemp: Expression,
    rhsTemp: Expression,
    targetObjExpr: Expression,
    prop: string,
    targetSpan: Span,
    canDirectStore: boolean,
  ): void {
    const cache = ctx.sharedPropertyCache(prop, targetSpan, false, true);
    // When this store is the final action of the root transaction (no later
    // statement can bail) and no earlier staged stores are pending, commit
    // directly with `cachedPropertyStore` even inside a terminal `if`/`else`
    // arm, skipping the 50+ instruction staging guard and double store.
    if (canDirectStore && isRootTransaction && tx.pendingStores.length === 0) {
      out.push({
        ...atSpan(targetSpan),
        kind: "if",
        test: un(
          "!",
          callHelper(
            "cachedPropertyStore",
            [objTemp, rhsTemp, cache],
            targetSpan,
          ),
          targetSpan,
        ),
        consequent: breakTo(bailLabel, targetSpan),
        alternate: undefined,
      });
      recordTransactionWrite(targetObjExpr, prop, rhsTemp);
      return;
    }
    const voName = ctx.freshName("$svo");
    const cacheVar = ctx.freshName("$sc");
    out.push(
      constVar(
        voName,
        callHelper(
          "viewObjectValue",
          [
            objTemp,
            propAccess(
              ident("$errors", targetSpan),
              "objectPrototype",
              targetSpan,
            ),
          ],
          targetSpan,
        ),
        targetSpan,
      ),
    );
    out.push(constVar(cacheVar, cache, targetSpan));
    out.push(
      ifStmt(
        bin(
          "!==",
          ident(voName, targetSpan),
          ident("undefined", targetSpan),
          targetSpan,
        ),
        blockOf(
          [
            ifStmt(
              bin(
                "!==",
                propAccess(
                  ident(voName, targetSpan),
                  "internalShape",
                  targetSpan,
                ),
                propAccess(
                  ident(cacheVar, targetSpan),
                  "storeShape",
                  targetSpan,
                ),
                targetSpan,
              ),
              breakTo(bailLabel, targetSpan),
              undefined,
              targetSpan,
            ),
            ifStmt(
              bin(
                "!==",
                propAccess(
                  ident(cacheVar, targetSpan),
                  "storeTransition",
                  targetSpan,
                ),
                ident("undefined", targetSpan),
                targetSpan,
              ),
              breakTo(bailLabel, targetSpan),
              undefined,
              targetSpan,
            ),
          ],
          targetSpan,
        ),
        breakTo(bailLabel, targetSpan),
        targetSpan,
      ),
    );
    const objVar = ctx.freshName("$so");
    const valVar = ctx.freshName("$sv");
    tx.hoistedDecls.push(
      letVar(
        objVar,
        ident("undefined", targetSpan),
        targetSpan,
        namedType("unknown", targetSpan),
      ),
    );
    tx.hoistedDecls.push(
      letVar(
        valVar,
        ident("undefined", targetSpan),
        targetSpan,
        namedType("unknown", targetSpan),
      ),
    );
    let guardVar: string | undefined = undefined;
    if (tx.conditionalDepth > 0 || !isRootTransaction) {
      guardVar = ctx.freshName("$sg");
      tx.hoistedDecls.push(
        letVar(
          guardVar,
          bool(false, targetSpan),
          targetSpan,
          namedType("boolean", targetSpan),
        ),
      );
    }
    out.push(assignStmt(objVar, objTemp, targetSpan));
    out.push(assignStmt(valVar, rhsTemp, targetSpan));
    if (guardVar !== undefined)
      out.push(assignStmt(guardVar, bool(true, targetSpan), targetSpan));
    tx.pendingStores.push({
      guardVar,
      objVar,
      valVar,
      cache,
      span: targetSpan,
    });
    recordTransactionWrite(targetObjExpr, prop, rhsTemp);
  }

  // Bind parameters to local mutable variables so parameter reassignment stays local.
  for (let i: number = 0; i < cand.parameters.length; i++) {
    const pName = cand.parameters[i];
    if (pName === undefined) continue;
    const varName = ctx.freshName("$ip");
    locals.set(pName, varName);
    const actual = actuals[i];
    stmts.push(
      letVar(
        varName,
        actual === undefined ? ident("undefined", callSpan) : actual,
        callSpan,
        namedType("unknown", callSpan),
      ),
    );
  }

  // Sloppy functions using `this` require an OrdinaryObject receiver to skip boxing.
  if (constructSpec === undefined && !cand.strict && cand.usesThis) {
    stmts.push({
      ...atSpan(callSpan),
      kind: "if",
      test: un(
        "!",
        callHelper(
          "isOrdinaryObject",
          [
            receiver,
            propAccess(ident("$errors", callSpan), "objectPrototype", callSpan),
          ],
          callSpan,
        ),
        callSpan,
      ),
      consequent: breakTo(bailLabel, callSpan),
      alternate: undefined,
    });
  }

  // Declare body local variables up front (var hoisting & block locals).
  function declareBodyLocals(stmt: Statement): void {
    if (stmt.kind === "variable") {
      for (const decl of stmt.declarations) {
        if (
          decl !== undefined &&
          decl.kind !== "object-binding" &&
          decl.kind !== "array-binding" &&
          !locals.has(decl.name)
        ) {
          const varName = ctx.freshName("$iv");
          locals.set(decl.name, varName);
          stmts.push(
            letVar(
              varName,
              ident("undefined", decl),
              decl,
              namedType("unknown", decl),
            ),
          );
        }
      }
    } else if (stmt.kind === "block") {
      for (const child of stmt.statements)
        if (child !== undefined) declareBodyLocals(child);
    } else if (stmt.kind === "if") {
      declareBodyLocals(stmt.consequent);
      if (stmt.alternate !== undefined) declareBodyLocals(stmt.alternate);
    }
  }
  declareBodyLocals(cand.body);

  function emitIntoTemp(
    out: Statement[],
    expr: Expression,
    span: Span,
  ): Expression {
    const name = ctx.freshName("$it");
    out.push(constVar(name, expr, span, namedType("unknown", span)));
    return ident(name, span);
  }

  function isBooleanResultExpr(expr: Expression): boolean {
    const raw = unwrapGroup(expr);
    if (raw.kind === "boolean") return true;
    if (raw.kind === "unary" && raw.operator === "!") return true;
    if (
      raw.kind === "binary" &&
      (raw.operator === "===" ||
        raw.operator === "!==" ||
        raw.operator === "==" ||
        raw.operator === "!=" ||
        raw.operator === "<" ||
        raw.operator === "<=" ||
        raw.operator === ">" ||
        raw.operator === ">=")
    )
      return true;
    return false;
  }

  function isKnownNonBigIntExpr(expr: Expression): boolean {
    const raw = unwrapGroup(expr);
    switch (raw.kind) {
      case "number":
      case "string":
      case "boolean":
      case "null":
      case "object":
      case "array":
      case "new":
      case "function-expression":
      case "arrow":
      case "regexp":
        return true;
      case "identifier":
        return raw.name === "undefined";
      case "unary":
        return (
          raw.operator === "!" ||
          raw.operator === "typeof" ||
          raw.operator === "void" ||
          raw.operator === "delete" ||
          raw.operator === "+" ||
          raw.operator === "-" ||
          raw.operator === "~"
        );
      case "binary":
        return isBooleanResultExpr(raw) || isArithmeticBinary(raw.operator);
      default:
        return false;
    }
  }

  function emitStrictEqual(
    lt: Expression,
    rt: Expression,
    rawLeft: Expression,
    rawRight: Expression,
    span: Span,
  ): Expression {
    const fast = bin("===", lt, rt, span);
    if (isKnownNonBigIntExpr(rawLeft) || isKnownNonBigIntExpr(rawRight))
      return fast;
    // Pointer/primitive equality matches JS `===` for every value except two
    // distinct BigIntValue records with equal numeric value; skip the call for
    // primitives and ordinary objects (including arrays, functions, proxies).
    const nonBigIntLeft = bin(
      "||",
      bin(
        "||",
        bin(
          "||",
          typeofIs(lt, "number", span),
          typeofIs(lt, "string", span),
          span,
        ),
        bin(
          "||",
          typeofIs(lt, "boolean", span),
          bin("===", lt, { ...atSpan(span), kind: "null" }, span),
          span,
        ),
        span,
      ),
      bin(
        "||",
        bin("===", lt, ident("undefined", span), span),
        bin(
          "!==",
          callHelper(
            "viewObjectValue",
            [lt, propAccess(ident("$errors", span), "objectPrototype", span)],
            span,
          ),
          ident("undefined", span),
          span,
        ),
        span,
      ),
      span,
    );
    return {
      ...atSpan(span),
      kind: "conditional",
      test: fast,
      consequent: bool(true, span),
      alternate: {
        ...atSpan(span),
        kind: "conditional",
        test: nonBigIntLeft,
        consequent: bool(false, span),
        alternate: callHelper("scriptStrictEqual", [lt, rt], span),
      },
    };
  }

  function emitBooleanFromTemp(
    out: Statement[],
    val: Expression,
    span: Span,
  ): Expression {
    if (ctx.htmlDDAObjects) {
      // Bail if object when HTMLDDA is enabled.
      out.push({
        ...atSpan(span),
        kind: "if",
        test: callHelper(
          "isOrdinaryObject",
          [val, propAccess(ident("$errors", span), "objectPrototype", span)],
          span,
        ),
        consequent: breakTo(bailLabel, span),
        alternate: undefined,
      });
    }
    const bName = ctx.freshName("$ib");
    out.push(letVar(bName, bool(true, span), span, namedType("boolean", span)));
    // Fast inline ToBoolean for undefined, null, boolean, number, string, object.
    // Objects (when !htmlDDAObjects) are always truthy.
    out.push({
      ...atSpan(span),
      kind: "if",
      test: bin(
        "||",
        bin("===", val, ident("undefined", span), span),
        bin("===", val, { ...atSpan(span), kind: "null" }, span),
        span,
      ),
      consequent: assignStmt(bName, bool(false, span), span),
      alternate: {
        ...atSpan(span),
        kind: "if",
        test: typeofIs(val, "boolean", span),
        consequent: assignStmt(
          bName,
          bin("===", val, bool(true, span), span),
          span,
        ),
        alternate: {
          ...atSpan(span),
          kind: "if",
          test: typeofIs(val, "number", span),
          consequent: assignStmt(
            bName,
            bin(
              "&&",
              bin("!==", asNumber(val, span), num(0, span), span),
              bin("===", asNumber(val, span), asNumber(val, span), span),
              span,
            ),
            span,
          ),
          alternate: {
            ...atSpan(span),
            kind: "if",
            test: un(
              "!",
              callHelper(
                "isOrdinaryObject",
                [
                  val,
                  propAccess(ident("$errors", span), "objectPrototype", span),
                ],
                span,
              ),
              span,
            ),
            consequent: breakTo(bailLabel, span),
            alternate: undefined,
          },
        },
      },
    });
    return ident(bName, span);
  }

  function emitBoolean(
    out: Statement[],
    expr: Expression,
    span: Span,
  ): Expression {
    const rawVal = emitExpr(out, expr);
    if (rawVal === undefined) return bool(false, span);
    if (isBooleanResultExpr(expr)) return rawVal;
    const val = emitIntoTemp(out, rawVal, span);
    return emitBooleanFromTemp(out, val, span);
  }

  function emitPropertyRead(
    out: Statement[],
    obj: Expression,
    prop: string,
    span: Span,
    method: boolean,
  ): Expression {
    if (prop === "length" && !method) {
      ctx.markElementAccess();
      const lenName = ctx.freshName("$il");
      out.push(
        letVar(
          lenName,
          ident("undefined", span),
          span,
          namedType("unknown", span),
        ),
      );
      const cache = ctx.sharedPropertyCache("length", span, false, false);
      const fallback: Statement[] = [
        assignStmt(
          lenName,
          callHelper("packedArrayLength", [ident("$errors", span), obj], span),
          span,
        ),
        {
          ...atSpan(span),
          kind: "if",
          test: callHelper(
            "absentElementValue",
            [ident(lenName, span), ident("$errors", span)],
            span,
          ),
          consequent: blockOf(
            [
              assignStmt(
                lenName,
                callHelper("cachedOwnPropertyValue", [obj, cache], span),
                span,
              ),
              {
                ...atSpan(span),
                kind: "if",
                test: callHelper(
                  "absentPropertyValue",
                  [ident(lenName, span), cache],
                  span,
                ),
                consequent: breakTo(bailLabel, span),
                alternate: undefined,
              },
            ],
            span,
          ),
          alternate: undefined,
        },
      ];
      out.push({
        ...atSpan(span),
        kind: "if",
        test: typeofIs(obj, "string", span),
        consequent: assignStmt(
          lenName,
          propAccess(asString(obj, span), "length", span),
          span,
        ),
        alternate: blockOf(fallback, span),
      });
      return ident(lenName, span);
    }

    const cache = ctx.sharedPropertyCache(prop, span, method, false);
    const valName = ctx.freshName("$ipr");
    out.push(
      letVar(
        valName,
        callHelper(
          method ? "cachedInheritedPropertyValue" : "cachedOwnPropertyValue",
          [obj, cache],
          span,
        ),
        span,
        namedType("unknown", span),
      ),
    );
    out.push(
      ifStmt(
        callHelper("absentPropertyValue", [ident(valName, span), cache], span),
        breakTo(bailLabel, span),
        undefined,
        span,
      ),
    );
    return ident(valName, span);
  }

  function emitIndexRead(
    out: Statement[],
    obj: Expression,
    key: Expression,
    span: Span,
  ): Expression {
    ctx.markElementAccess();
    // Guard numeric key up front.
    out.push({
      ...atSpan(span),
      kind: "if",
      test: un("!", typeofIs(key, "number", span), span),
      consequent: breakTo(bailLabel, span),
      alternate: undefined,
    });
    const numKey = asNumber(key, span);
    const valName = ctx.freshName("$iel");
    const idxName = ctx.freshName("$iix");
    out.push(
      letVar(
        valName,
        ident("undefined", span),
        span,
        namedType("unknown", span),
      ),
    );
    out.push(constVar(idxName, bin(">>>", numKey, num(0, span), span), span));
    out.push(
      ifStmt(
        bin("!==", numKey, ident(idxName, span), span),
        breakTo(bailLabel, span),
        undefined,
        span,
      ),
    );
    out.push(
      assignStmt(
        valName,
        callHelper(
          "packedNumberElement",
          [ident("$errors", span), obj, ident(idxName, span)],
          span,
        ),
        span,
      ),
    );
    out.push(
      ifStmt(
        callHelper(
          "absentElementValue",
          [ident(valName, span), ident("$errors", span)],
          span,
        ),
        blockOf(
          [
            assignStmt(
              valName,
              callHelper(
                "packedGeneralElement",
                [ident("$errors", span), obj, ident(idxName, span)],
                span,
              ),
              span,
            ),
            ifStmt(
              callHelper(
                "absentElementValue",
                [ident(valName, span), ident("$errors", span)],
                span,
              ),
              breakTo(bailLabel, span),
              undefined,
              span,
            ),
          ],
          span,
        ),
        undefined,
        span,
      ),
    );
    return ident(valName, span);
  }

  let emitFailed: boolean = false;

  function emitExpr(
    out: Statement[],
    expr: Expression,
    allowNestedMutation: boolean = false,
  ): Expression | undefined {
    if (emitFailed) return undefined;
    switch (expr.kind) {
      case "number":
        return num(expr.value, expr);
      case "boolean":
        return bool(expr.value, expr);
      case "string":
        return str(expr.value, expr);
      case "null":
        return { ...atSpan(expr), kind: "null" };
      case "this":
        return receiver;
      case "group":
        return emitExpr(out, expr.expression);
      case "identifier": {
        if (expr.name === "undefined") return ident("undefined", expr);
        const local = locals.get(expr.name);
        if (local !== undefined) return ident(local, expr);
        const resolved = ctx.emitFreeIdentifier(
          out,
          expr.name,
          expr,
          bailLabel,
        );
        if (resolved === undefined) {
          emitFailed = true;
          return undefined;
        }
        return resolved;
      }
      case "member": {
        if (writtenProps.has(expr.property)) {
          const bKey = exprBaseKey(expr.object);
          const fwd = forwarded.get(expr.property);
          if (bKey !== undefined && fwd !== undefined && fwd.baseKey === bKey) {
            return fwd.value;
          }
          emitFailed = true;
          return undefined;
        }
        const obj = emitExpr(out, expr.object);
        if (obj === undefined) return undefined;
        const objTemp = emitIntoTemp(out, obj, expr.object);
        return emitPropertyRead(out, objTemp, expr.property, expr, false);
      }
      case "index": {
        const obj = emitExpr(out, expr.object);
        const key = emitExpr(out, expr.index);
        if (obj === undefined || key === undefined) return undefined;
        const objTemp = emitIntoTemp(out, obj, expr.object);
        const keyTemp = emitIntoTemp(out, key, expr.index);
        return emitIndexRead(out, objTemp, keyTemp, expr);
      }
      case "unary": {
        if (expr.operator === "!") {
          const b = emitBoolean(out, expr.operand, expr);
          return un("!", b, expr);
        }
        if (expr.operator === "typeof") {
          const operand = emitExpr(out, expr.operand);
          if (operand === undefined) return undefined;
          const t = emitIntoTemp(out, operand, expr.operand);
          const tyName = ctx.freshName("$ity");
          out.push(
            letVar(
              tyName,
              str("undefined", expr),
              expr,
              namedType("string", expr),
            ),
          );
          out.push(
            ifStmt(
              bin("===", t, ident("undefined", expr), expr),
              assignStmt(tyName, str("undefined", expr), expr),
              ifStmt(
                typeofIs(t, "number", expr),
                assignStmt(tyName, str("number", expr), expr),
                ifStmt(
                  typeofIs(t, "string", expr),
                  assignStmt(tyName, str("string", expr), expr),
                  ifStmt(
                    typeofIs(t, "boolean", expr),
                    assignStmt(tyName, str("boolean", expr), expr),
                    ifStmt(
                      bin("===", t, { ...atSpan(expr), kind: "null" }, expr),
                      assignStmt(tyName, str("object", expr), expr),
                      breakTo(bailLabel, expr),
                      expr,
                    ),
                    expr,
                  ),
                  expr,
                ),
                expr,
              ),
              expr,
            ),
          );
          return ident(tyName, expr);
        }
        const operand = emitExpr(out, expr.operand);
        if (operand === undefined) return undefined;
        const t = emitIntoTemp(out, operand, expr.operand);
        out.push({
          ...atSpan(expr),
          kind: "if",
          test: un("!", typeofIs(t, "number", expr), expr),
          consequent: breakTo(bailLabel, expr),
          alternate: undefined,
        });
        const n = asNumber(t, expr);
        if (expr.operator === "+") return n;
        return un(expr.operator, n, expr);
      }
      case "binary": {
        if (expr.operator === "&&" || expr.operator === "||") {
          const left = emitExpr(out, expr.left);
          if (left === undefined) return undefined;
          const resName = ctx.freshName("$ilg");
          out.push(letVar(resName, left, expr, namedType("unknown", expr)));
          const test = isBooleanResultExpr(expr.left)
            ? bin("===", ident(resName, expr), bool(true, expr), expr)
            : emitBooleanFromTemp(out, ident(resName, expr), expr);
          const savedWritten = cloneStringSet(writtenProps);
          const savedFwd = cloneForwardedMap(forwarded);
          tx.conditionalDepth++;
          const rhsStmts: Statement[] = [];
          const right = emitExpr(rhsStmts, expr.right);
          tx.conditionalDepth--;
          if (right === undefined) return undefined;
          rhsStmts.push(assignStmt(resName, right, expr));
          for (const p of writtenProps) {
            if (!savedWritten.has(p)) {
              forwarded.delete(p);
              invalidateForwardedBase("this." + p);
            }
          }
          for (const [k, v] of savedFwd) {
            if (!writtenProps.has(k) && !forwarded.has(k)) forwarded.set(k, v);
          }
          const branchTest: Expression =
            expr.operator === "&&" ? test : un("!", test, expr);
          out.push(
            ifStmt(branchTest, blockOf(rhsStmts, expr), undefined, expr),
          );
          return ident(resName, expr);
        }
        if (expr.operator === "===" || expr.operator === "!==") {
          const rawL = unwrapGroup(expr.left);
          const rawR = unwrapGroup(expr.right);
          if (
            rawL.kind === "unary" &&
            rawL.operator === "typeof" &&
            rawR.kind === "string" &&
            (rawR.value === "number" ||
              rawR.value === "string" ||
              rawR.value === "boolean")
          ) {
            const operand = emitExpr(out, rawL.operand);
            if (operand === undefined) return undefined;
            const t = emitIntoTemp(out, operand, rawL.operand);
            const match = typeofIs(t, rawR.value, expr);
            return expr.operator === "===" ? match : un("!", match, expr);
          }
          const left = emitExpr(out, expr.left);
          const right = emitExpr(out, expr.right);
          if (left === undefined || right === undefined) return undefined;
          const lt = emitIntoTemp(out, left, expr.left);
          const rt = emitIntoTemp(out, right, expr.right);
          const eq = emitStrictEqual(lt, rt, expr.left, expr.right, expr);
          return expr.operator === "===" ? eq : un("!", eq, expr);
        }
        const left = emitExpr(out, expr.left);
        const right = emitExpr(out, expr.right);
        if (left === undefined || right === undefined) return undefined;
        const lt = emitIntoTemp(out, left, expr.left);
        const rt = emitIntoTemp(out, right, expr.right);
        if (expr.operator === "==" || expr.operator === "!=") {
          const rawL = unwrapGroup(expr.left);
          const rawR = unwrapGroup(expr.right);
          const nullishL =
            rawL.kind === "null" ||
            (rawL.kind === "identifier" && rawL.name === "undefined");
          const nullishR =
            rawR.kind === "null" ||
            (rawR.kind === "identifier" && rawR.name === "undefined");
          if ((nullishL || nullishR) && !ctx.htmlDDAObjects) {
            const other = nullishL ? rt : lt;
            const isNullish = bin(
              "||",
              bin("===", other, { ...atSpan(expr), kind: "null" }, expr),
              bin("===", other, ident("undefined", expr), expr),
              expr,
            );
            return expr.operator === "=="
              ? isNullish
              : un("!", isNullish, expr);
          }
          const eqName = ctx.freshName("$ieq");
          out.push(
            letVar(eqName, bool(false, expr), expr, namedType("boolean", expr)),
          );
          const sameNum = bin(
            "&&",
            typeofIs(lt, "number", expr),
            typeofIs(rt, "number", expr),
            expr,
          );
          const sameBool = bin(
            "&&",
            typeofIs(lt, "boolean", expr),
            typeofIs(rt, "boolean", expr),
            expr,
          );
          const loName = ctx.freshName("$ilo");
          const roName = ctx.freshName("$iro");
          const objBranch = blockOf(
            [
              constVar(
                loName,
                callHelper("viewTypeofObject", [lt], expr),
                expr,
              ),
              constVar(
                roName,
                callHelper("viewTypeofObject", [rt], expr),
                expr,
              ),
              ifStmt(
                bin(
                  "&&",
                  bin(
                    "!==",
                    ident(loName, expr),
                    ident("undefined", expr),
                    expr,
                  ),
                  bin(
                    "!==",
                    ident(roName, expr),
                    ident("undefined", expr),
                    expr,
                  ),
                  expr,
                ),
                assignStmt(
                  eqName,
                  bin("===", ident(loName, expr), ident(roName, expr), expr),
                  expr,
                ),
                breakTo(bailLabel, expr),
                expr,
              ),
            ],
            expr,
          );
          out.push({
            ...atSpan(expr),
            kind: "if",
            test: sameNum,
            consequent: assignStmt(
              eqName,
              bin("===", asNumber(lt, expr), asNumber(rt, expr), expr),
              expr,
            ),
            alternate: {
              ...atSpan(expr),
              kind: "if",
              test: sameBool,
              consequent: assignStmt(
                eqName,
                bin(
                  "===",
                  {
                    ...atSpan(expr),
                    kind: "satisfies",
                    assertion: "as",
                    expression: lt,
                    type: namedType("boolean", expr),
                  },
                  {
                    ...atSpan(expr),
                    kind: "satisfies",
                    assertion: "as",
                    expression: rt,
                    type: namedType("boolean", expr),
                  },
                  expr,
                ),
                expr,
              ),
              alternate: objBranch,
            },
          });
          return expr.operator === "=="
            ? ident(eqName, expr)
            : un("!", ident(eqName, expr), expr);
        }
        if (isArithmeticBinary(expr.operator)) {
          out.push({
            ...atSpan(expr),
            kind: "if",
            test: un(
              "!",
              bin(
                "&&",
                typeofIs(lt, "number", expr),
                typeofIs(rt, "number", expr),
                expr,
              ),
              expr,
            ),
            consequent: breakTo(bailLabel, expr),
            alternate: undefined,
          });
          return bin(
            expr.operator,
            asNumber(lt, expr),
            asNumber(rt, expr),
            expr,
          );
        }
        emitFailed = true;
        return undefined;
      }
      case "conditional": {
        const test = emitBoolean(out, expr.test, expr);
        const resName = ctx.freshName("$icn");
        out.push(
          letVar(
            resName,
            ident("undefined", expr),
            expr,
            namedType("unknown", expr),
          ),
        );
        const savedWritten = cloneStringSet(writtenProps);
        const savedFwd = cloneForwardedMap(forwarded);
        tx.conditionalDepth++;
        const consStmts: Statement[] = [];
        const consVal = emitExpr(consStmts, expr.consequent);
        if (consVal === undefined) {
          tx.conditionalDepth--;
          return undefined;
        }
        consStmts.push(assignStmt(resName, consVal, expr.consequent));
        const consWritten = cloneStringSet(writtenProps);
        writtenProps.clear();
        for (const p of savedWritten) writtenProps.add(p);
        forwarded.clear();
        for (const [k, v] of savedFwd) forwarded.set(k, v);
        const altStmts: Statement[] = [];
        const altVal = emitExpr(altStmts, expr.alternate);
        tx.conditionalDepth--;
        if (altVal === undefined) return undefined;
        altStmts.push(assignStmt(resName, altVal, expr.alternate));
        for (const p of consWritten) writtenProps.add(p);
        for (const p of writtenProps) {
          if (!savedWritten.has(p)) {
            forwarded.delete(p);
            invalidateForwardedBase("this." + p);
          }
        }
        out.push({
          ...atSpan(expr),
          kind: "if",
          test,
          consequent: blockOf(consStmts, expr.consequent),
          alternate: blockOf(altStmts, expr.alternate),
        });
        return ident(resName, expr);
      }
      case "object": {
        ctx.markObjectLiterals();
        const keys: string[] = [];
        const vals: Expression[] = [];
        for (const prop of expr.properties) {
          if (prop === undefined || prop.kind === "spread") {
            emitFailed = true;
            return undefined;
          }
          keys.push(prop.name);
          const v = emitExpr(out, prop.value);
          if (v === undefined) return undefined;
          vals.push(emitIntoTemp(out, v, prop.value));
        }
        const args: Expression[] = [
          propAccess(ident("$errors", expr), "objectPrototype", expr),
          ctx.sharedObjectLiteralSite(keys, expr),
        ];
        for (const v of vals) args.push(v);
        args.push(propAccess(ident("$global", expr), "hooks", expr));
        return callHelper(`createLiteralObject${vals.length}`, args, expr);
      }
      case "assignment": {
        const target = unwrapGroup(expr.target);
        if (target.kind === "identifier") {
          const local = locals.get(target.name);
          if (local === undefined) {
            emitFailed = true;
            return undefined;
          }
          const rhs = emitExpr(out, expr.value);
          if (rhs === undefined) return undefined;
          const rhsTemp = emitIntoTemp(out, rhs, expr.value);
          out.push(assignStmt(local, rhsTemp, expr));
          invalidateForwardedBase("local:" + target.name);
          return rhsTemp;
        }
        if (
          target.kind === "member" &&
          !target.optional &&
          !target.private &&
          !isCanonicalIndexKey(target.property)
        ) {
          const obj = emitExpr(out, target.object);
          if (obj === undefined) return undefined;
          const objTemp = emitIntoTemp(out, obj, target.object);
          const rhs = emitExpr(out, expr.value);
          if (rhs === undefined) return undefined;
          const rhsTemp = emitIntoTemp(out, rhs, expr.value);
          emitStagedPropertyStore(
            out,
            objTemp,
            rhsTemp,
            target.object,
            target.property,
            target,
            allowNestedMutation,
          );
          return rhsTemp;
        }
        emitFailed = true;
        return undefined;
      }
      case "update": {
        const target = unwrapGroup(expr.target);
        const delta = expr.operator === "++" ? 1 : -1;
        if (target.kind === "identifier") {
          const local = locals.get(target.name);
          if (local === undefined) {
            emitFailed = true;
            return undefined;
          }
          const cur = emitIntoTemp(out, ident(local, target), target);
          out.push({
            ...atSpan(expr),
            kind: "if",
            test: un("!", typeofIs(cur, "number", expr), expr),
            consequent: breakTo(bailLabel, expr),
            alternate: undefined,
          });
          const nextVal = emitIntoTemp(
            out,
            bin("+", asNumber(cur, expr), num(delta, expr), expr),
            expr,
          );
          out.push(assignStmt(local, nextVal, expr));
          invalidateForwardedBase("local:" + target.name);
          return expr.prefix ? nextVal : cur;
        }
        if (
          target.kind === "member" &&
          !target.optional &&
          !target.private &&
          !isCanonicalIndexKey(target.property)
        ) {
          const obj = emitExpr(out, target.object);
          if (obj === undefined) return undefined;
          const objTemp = emitIntoTemp(out, obj, target.object);
          let cur: Expression;
          if (writtenProps.has(target.property)) {
            const bKey = exprBaseKey(target.object);
            const fwd = forwarded.get(target.property);
            if (
              bKey === undefined ||
              fwd === undefined ||
              fwd.baseKey !== bKey
            ) {
              emitFailed = true;
              return undefined;
            }
            cur = fwd.value;
          } else {
            cur = emitPropertyRead(
              out,
              objTemp,
              target.property,
              target,
              false,
            );
          }
          out.push({
            ...atSpan(expr),
            kind: "if",
            test: un("!", typeofIs(cur, "number", expr), expr),
            consequent: breakTo(bailLabel, expr),
            alternate: undefined,
          });
          const nextVal = emitIntoTemp(
            out,
            bin("+", asNumber(cur, expr), num(delta, expr), expr),
            expr,
          );
          emitStagedPropertyStore(
            out,
            objTemp,
            nextVal,
            target.object,
            target.property,
            target,
            allowNestedMutation,
          );
          return expr.prefix ? nextVal : cur;
        }
        emitFailed = true;
        return undefined;
      }
      case "new": {
        const callee = unwrapGroup(expr.callee);
        // Zero-arg `new Array()` leaf intrinsic (no recursion, safe at any depth).
        if (
          callee.kind === "identifier" &&
          callee.name === "Array" &&
          expr.arguments.length === 0
        ) {
          const targetExpr = emitExpr(out, expr.callee);
          if (targetExpr === undefined) return undefined;
          const targetTemp = emitIntoTemp(out, targetExpr, expr.callee);
          ctx.markSmallArrays();
          const arrCtorName = ctx.freshName("$iar");
          out.push(
            constVar(
              arrCtorName,
              propAccess(
                propAccess(ident("$errors", expr), "intrinsicFunctions", expr),
                "array",
                expr,
              ),
              expr,
            ),
          );
          out.push(
            ifStmt(
              bin(
                "||",
                bin(
                  "===",
                  ident(arrCtorName, expr),
                  ident("undefined", expr),
                  expr,
                ),
                bin("!==", targetTemp, ident(arrCtorName, expr), expr),
                expr,
              ),
              breakTo(bailLabel, expr),
              undefined,
              expr,
            ),
          );
          return callHelper("createArray0", [ident("$errors", expr)], expr);
        }
        if (depth >= maxInlineDepth) {
          emitFailed = true;
          return undefined;
        }
        const targetExpr = emitExpr(out, expr.callee);
        if (targetExpr === undefined) return undefined;
        const targetTemp = emitIntoTemp(out, targetExpr, expr.callee);
        const evalArgs: Expression[] = [];
        for (const arg of expr.arguments) {
          if (arg === undefined) {
            emitFailed = true;
            return undefined;
          }
          const v = emitExpr(out, arg);
          if (v === undefined) return undefined;
          evalArgs.push(emitIntoTemp(out, v, arg));
        }
        const directCands =
          callee.kind === "identifier"
            ? plan.ctorByIdentifier.get(callee.name)
            : undefined;
        const fwKey =
          callee.kind === "member" && !callee.optional && !callee.private
            ? callee.property
            : callee.kind === "identifier"
              ? callee.name
              : undefined;
        const fwCands =
          fwKey !== undefined
            ? plan.forwardingInitsByName.get(fwKey)
            : undefined;
        const subRes = ctx.freshName("$inr");
        const subDone = ctx.freshName("$ind");
        const subStmts = emitInlineConstructCandidates(
          plan,
          directCands,
          fwCands,
          targetTemp,
          evalArgs,
          subRes,
          subDone,
          expr,
          depth + 1,
          activeSpans,
          ctx,
        );
        if (subStmts === undefined) {
          emitFailed = true;
          return undefined;
        }
        out.push(
          letVar(
            subRes,
            ident("undefined", expr),
            expr,
            namedType("unknown", expr),
          ),
        );
        out.push(
          letVar(subDone, bool(false, expr), expr, namedType("boolean", expr)),
        );
        for (const s of subStmts) out.push(s);
        out.push(
          ifStmt(
            un("!", ident(subDone, expr), expr),
            breakTo(bailLabel, expr),
            undefined,
            expr,
          ),
        );
        return ident(subRes, expr);
      }
      case "call": {
        const callee = unwrapGroup(expr.callee);
        if (callee.kind === "member" && !callee.optional && !callee.private) {
          const obj = emitExpr(out, callee.object);
          if (obj === undefined) return undefined;
          const objTemp = emitIntoTemp(out, obj, callee.object);
          const fnVal = emitPropertyRead(
            out,
            objTemp,
            callee.property,
            callee,
            true,
          );
          const evalArgs: Expression[] = [];
          for (const arg of expr.arguments) {
            if (arg === undefined) {
              emitFailed = true;
              return undefined;
            }
            const v = emitExpr(out, arg);
            if (v === undefined) return undefined;
            evalArgs.push(emitIntoTemp(out, v, arg));
          }

          // Pure Math intrinsics (`Math.sqrt`, `Math.floor`, `Math.abs`).
          if (
            evalArgs.length === 1 &&
            (callee.property === "sqrt" ||
              callee.property === "floor" ||
              callee.property === "abs")
          ) {
            const field =
              callee.property === "sqrt"
                ? "mathSqrt"
                : callee.property === "floor"
                  ? "mathFloor"
                  : "mathAbs";
            ctx.markIntrinsicField(field);
            const arg0 = evalArgs[0];
            if (arg0 === undefined) return undefined;
            const targetName = ctx.freshName("$iin");
            out.push(
              constVar(
                targetName,
                propAccess(
                  propAccess(
                    ident("$errors", expr),
                    "intrinsicFunctions",
                    expr,
                  ),
                  field,
                  expr,
                ),
                expr,
              ),
            );
            out.push(
              ifStmt(
                un(
                  "!",
                  bin(
                    "&&",
                    bin(
                      "&&",
                      bin(
                        "!==",
                        ident(targetName, expr),
                        ident("undefined", expr),
                        expr,
                      ),
                      bin("===", fnVal, ident(targetName, expr), expr),
                      expr,
                    ),
                    typeofIs(arg0, "number", expr),
                    expr,
                  ),
                  expr,
                ),
                breakTo(bailLabel, expr),
                undefined,
                expr,
              ),
            );
            return {
              ...atSpan(expr),
              kind: "call",
              callee: propAccess(ident("Math", expr), callee.property, expr),
              arguments: [asNumber(arg0, expr)],
            };
          }

          // Packed Array.prototype.push(x) (zero-mutation on miss; irreversible on hit).
          if (callee.property === "push" && evalArgs.length === 1) {
            if (
              !isRootTransaction ||
              tx.pendingStores.length > 0 ||
              !allowNestedMutation
            ) {
              emitFailed = true;
              return undefined;
            }
            ctx.markIntrinsicField("arrayPush");
            const arg0 = evalArgs[0];
            if (arg0 === undefined) return undefined;
            const targetName = ctx.freshName("$iin");
            out.push(
              constVar(
                targetName,
                propAccess(
                  propAccess(
                    ident("$errors", expr),
                    "intrinsicFunctions",
                    expr,
                  ),
                  "arrayPush",
                  expr,
                ),
                expr,
              ),
            );
            out.push(
              ifStmt(
                bin(
                  "||",
                  bin(
                    "===",
                    ident(targetName, expr),
                    ident("undefined", expr),
                    expr,
                  ),
                  bin("!==", fnVal, ident(targetName, expr), expr),
                  expr,
                ),
                breakTo(bailLabel, expr),
                undefined,
                expr,
              ),
            );
            const lenName = ctx.freshName("$iph");
            out.push(
              letVar(
                lenName,
                callHelper(
                  "scriptArrayPushFast",
                  [
                    callHelper("viewTypeofObject", [objTemp], expr),
                    arg0,
                    ident("$errors", expr),
                  ],
                  expr,
                ),
                expr,
                namedType("number", expr),
              ),
            );
            out.push(
              ifStmt(
                bin("<", ident(lenName, expr), num(0, expr), expr),
                assignStmt(
                  lenName,
                  callHelper(
                    "scriptArrayPush",
                    [objTemp, arg0, ident("$errors", expr)],
                    expr,
                  ),
                  expr,
                ),
                undefined,
                expr,
              ),
            );
            out.push(
              ifStmt(
                bin("<", ident(lenName, expr), num(0, expr), expr),
                breakTo(bailLabel, expr),
                undefined,
                expr,
              ),
            );
            return ident(lenName, expr);
          }

          // Packed Array.prototype.pop() (zero-mutation on miss; irreversible on hit).
          if (callee.property === "pop" && evalArgs.length === 0) {
            if (
              !isRootTransaction ||
              tx.pendingStores.length > 0 ||
              !allowNestedMutation
            ) {
              emitFailed = true;
              return undefined;
            }
            ctx.markIntrinsicField("arrayPop");
            const targetName = ctx.freshName("$iin");
            out.push(
              constVar(
                targetName,
                propAccess(
                  propAccess(
                    ident("$errors", expr),
                    "intrinsicFunctions",
                    expr,
                  ),
                  "arrayPop",
                  expr,
                ),
                expr,
              ),
            );
            out.push(
              ifStmt(
                bin(
                  "||",
                  bin(
                    "===",
                    ident(targetName, expr),
                    ident("undefined", expr),
                    expr,
                  ),
                  bin("!==", fnVal, ident(targetName, expr), expr),
                  expr,
                ),
                breakTo(bailLabel, expr),
                undefined,
                expr,
              ),
            );
            const popName = ctx.freshName("$ipp");
            out.push(
              constVar(
                popName,
                callHelper(
                  "scriptArrayPop",
                  [objTemp, ident("$errors", expr)],
                  expr,
                ),
                expr,
                namedType("unknown", expr),
              ),
            );
            out.push(
              ifStmt(
                bin(
                  "===",
                  ident(popName, expr),
                  propAccess(ident("$errors", expr), "arrayPopMiss", expr),
                  expr,
                ),
                breakTo(bailLabel, expr),
                undefined,
                expr,
              ),
            );
            return ident(popName, expr);
          }

          // Recursive nested candidate method call (up to maxInlineDepth;
          // limit polymorphic nested expansion at deeper levels).
          const subCandidates = selectMethodCandidates(
            plan,
            callee,
            -1,
            evalArgs.length,
          );
          if (
            subCandidates !== undefined &&
            depth < maxInlineDepth &&
            (depth === 0 ||
              (depth === 1 && subCandidates.length <= 2) ||
              (depth === 2 && subCandidates.length === 1))
          ) {
            const subRes = ctx.freshName("$isr");
            const subDone = ctx.freshName("$isd");
            const subWritten = new Set<string>();
            const subStmts = emitInlineCandidates(
              plan,
              subCandidates,
              fnVal,
              objTemp,
              evalArgs,
              subRes,
              subDone,
              expr,
              depth + 1,
              activeSpans,
              ctx,
              false,
              tx,
              writtenProps,
              subWritten,
            );
            if (subStmts !== undefined) {
              for (const p of subWritten) {
                writtenProps.add(p);
                if (writtenPropsOut !== undefined) writtenPropsOut.add(p);
                forwarded.delete(p);
                invalidateForwardedBase("this." + p);
              }
              out.push(
                letVar(
                  subRes,
                  ident("undefined", expr),
                  expr,
                  namedType("unknown", expr),
                ),
              );
              out.push(
                letVar(
                  subDone,
                  bool(false, expr),
                  expr,
                  namedType("boolean", expr),
                ),
              );
              for (const s of subStmts) out.push(s);
              out.push({
                ...atSpan(expr),
                kind: "if",
                test: un("!", ident(subDone, expr), expr),
                consequent: breakTo(bailLabel, expr),
                alternate: undefined,
              });
              return ident(subRes, expr);
            }
          }
          emitFailed = true;
          return undefined;
        }

        if (callee.kind === "identifier") {
          const fnVal = ctx.emitFreeIdentifier(
            out,
            callee.name,
            callee,
            bailLabel,
          );
          if (fnVal === undefined) {
            emitFailed = true;
            return undefined;
          }
          const evalArgs: Expression[] = [];
          for (const arg of expr.arguments) {
            if (arg === undefined) {
              emitFailed = true;
              return undefined;
            }
            const v = emitExpr(out, arg);
            if (v === undefined) return undefined;
            evalArgs.push(emitIntoTemp(out, v, arg));
          }
          const subCandidates = plan.byIdentifier.get(callee.name);
          if (
            subCandidates !== undefined &&
            depth < maxInlineDepth &&
            (depth < 2 || subCandidates.length === 1)
          ) {
            const subRes = ctx.freshName("$isr");
            const subDone = ctx.freshName("$isd");
            const subWritten = new Set<string>();
            const subStmts = emitInlineCandidates(
              plan,
              subCandidates,
              fnVal,
              ident("undefined", expr),
              evalArgs,
              subRes,
              subDone,
              expr,
              depth + 1,
              activeSpans,
              ctx,
              false,
              tx,
              writtenProps,
              subWritten,
            );
            if (subStmts !== undefined) {
              for (const p of subWritten) {
                writtenProps.add(p);
                if (writtenPropsOut !== undefined) writtenPropsOut.add(p);
                forwarded.delete(p);
                invalidateForwardedBase("this." + p);
              }
              out.push(
                letVar(
                  subRes,
                  ident("undefined", expr),
                  expr,
                  namedType("unknown", expr),
                ),
              );
              out.push(
                letVar(
                  subDone,
                  bool(false, expr),
                  expr,
                  namedType("boolean", expr),
                ),
              );
              for (const s of subStmts) out.push(s);
              out.push({
                ...atSpan(expr),
                kind: "if",
                test: un("!", ident(subDone, expr), expr),
                consequent: breakTo(bailLabel, expr),
                alternate: undefined,
              });
              return ident(subRes, expr);
            }
          }
        }
        emitFailed = true;
        return undefined;
      }
      default:
        emitFailed = true;
        return undefined;
    }
  }

  /** Coalesce `var r = new Ctor(...); r.k0 = e0; r.k1 = e1; ...` into a single
   * `createConstructedObjectN` call with the final field values, avoiding redundant
   * initial writes and post-allocation `cachedPropertyStore` calls. Returns the
   * last consumed statement index, or -1 if the pattern does not apply. */
  function tryEmitCoalescedConstruct(
    out: Statement[],
    blockStmts: readonly (Statement | undefined)[],
    startIdx: number,
  ): number {
    if (depth >= maxInlineDepth) return -1;
    const first = blockStmts[startIdx];
    if (
      first === undefined ||
      first.kind !== "variable" ||
      first.declarations.length !== 1
    )
      return -1;
    const decl = first.declarations[0];
    if (
      decl === undefined ||
      decl.kind === "object-binding" ||
      decl.kind === "array-binding"
    )
      return -1;
    const declInit = decl.initializer;
    if (declInit === undefined) return -1;
    const localVar = locals.get(decl.name);
    if (localVar === undefined) return -1;
    const initExpr = unwrapGroup(declInit);
    if (initExpr.kind !== "new") return -1;
    const newCallee = unwrapGroup(initExpr.callee);
    const directList =
      newCallee.kind === "identifier"
        ? plan.ctorByIdentifier.get(newCallee.name)
        : undefined;
    const fwKey =
      newCallee.kind === "member" && !newCallee.optional && !newCallee.private
        ? newCallee.property
        : newCallee.kind === "identifier"
          ? newCallee.name
          : undefined;
    const fwList =
      fwKey !== undefined ? plan.forwardingInitsByName.get(fwKey) : undefined;
    const matched: {
      readonly ctor: ConstructorCandidate;
      readonly isForwarding: boolean;
    }[] = [];
    if (directList !== undefined) {
      for (const c of directList) {
        if (c.slotIndex >= 0 && !activeSpans.has(c.spanStart))
          matched.push({ ctor: c, isForwarding: false });
      }
    }
    if (fwList !== undefined) {
      for (const c of fwList) {
        if (c.slotIndex >= 0 && !activeSpans.has(c.spanStart))
          matched.push({ ctor: c, isForwarding: true });
      }
    }
    if (matched.length !== 1) return -1;
    const entry = matched[0];
    if (entry === undefined) return -1;
    const ctor = entry.ctor;
    if (ctor.setupStatements.length !== 0) return -1;
    for (const free of ctor.freeIdentifiers) {
      if (ctx.isFreeIdentifierShadowed(free)) return -1;
    }
    const fieldIndexByKey = new Map<string, number>();
    const fieldKeys: string[] = [];
    for (let k: number = 0; k < ctor.fields.length; k++) {
      const f = ctor.fields[k];
      if (f === undefined) return -1;
      fieldIndexByKey.set(f.key, k);
      fieldKeys.push(f.key);
    }
    const overrides: { readonly index: number; readonly expr: Expression }[] =
      [];
    let endIdx = startIdx;
    for (let j: number = startIdx + 1; j < blockStmts.length; j++) {
      const next = blockStmts[j];
      if (next === undefined || next.kind !== "expression") break;
      const e = unwrapGroup(next.expression);
      if (e.kind !== "assignment") break;
      const t = unwrapGroup(e.target);
      if (t.kind !== "member" || t.optional || t.private) break;
      const obj = unwrapGroup(t.object);
      if (obj.kind !== "identifier" || obj.name !== decl.name) break;
      const fi = fieldIndexByKey.get(t.property);
      if (fi === undefined) break;
      if (!isPureOverrideExpr(e.value, decl.name)) break;
      overrides.push({ index: fi, expr: e.value });
      endIdx = j;
    }
    if (overrides.length === 0) return -1;

    // Emit constructor callee, original arguments, and ConstructSite guard.
    const targetExpr = emitExpr(out, initExpr.callee);
    if (targetExpr === undefined) return -1;
    const targetTemp = emitIntoTemp(out, targetExpr, initExpr.callee);
    const evalArgs: Expression[] = [];
    for (const arg of initExpr.arguments) {
      if (arg === undefined) {
        emitFailed = true;
        return -1;
      }
      const v = emitExpr(out, arg);
      if (v === undefined) return -1;
      evalArgs.push(emitIntoTemp(out, v, arg));
    }
    const siteExpr = ctx.sharedConstructSite(
      fieldKeys,
      initExpr,
      ctor.slotIndex,
    );
    const slotRef = ctx.slotField(ctor.slotIndex, initExpr);
    const cachedCtor = propAccess(siteExpr, "constructCtor", initExpr);
    const fastHit = bin(
      "&&",
      bin("!==", cachedCtor, ident("undefined", initExpr), initExpr),
      bin(
        "&&",
        bin("===", targetTemp, cachedCtor, initExpr),
        bin(
          "===",
          propAccess(siteExpr, "constructEpoch", initExpr),
          propAccess(
            propAccess(siteExpr, "constructEpochRef", initExpr),
            "value",
            initExpr,
          ),
          initExpr,
        ),
        initExpr,
      ),
      initExpr,
    );
    const warmHit = callHelper(
      "warmConstructSite",
      [
        targetTemp,
        slotRef,
        bool(entry.isForwarding, initExpr),
        ident("$errors", initExpr),
        siteExpr,
      ],
      initExpr,
    );
    out.push(
      ifStmt(
        un("!", bin("||", fastHit, warmHit, initExpr), initExpr),
        breakTo(bailLabel, initExpr),
        undefined,
        initExpr,
      ),
    );

    // Evaluate original constructor field values (for any un-overridden fields
    // and to preserve constructor bailout semantics) using temporary parameter bindings.
    const fieldValues: Expression[] = [];
    const savedLocals = new Map<string, string>();
    for (const [k, v] of locals) savedLocals.set(k, v);
    locals.clear();
    for (let p: number = 0; p < ctor.parameters.length; p++) {
      const pName = ctor.parameters[p];
      if (pName === undefined) continue;
      const pVar = ctx.freshName("$cp");
      locals.set(pName, pVar);
      const actual = evalArgs[p];
      out.push(
        constVar(
          pVar,
          actual === undefined ? ident("undefined", initExpr) : actual,
          initExpr,
          namedType("unknown", initExpr),
        ),
      );
    }
    for (const f of ctor.fields) {
      const v = emitExpr(out, f.value, false);
      if (v === undefined) {
        locals.clear();
        for (const [k, lv] of savedLocals) locals.set(k, lv);
        return -1;
      }
      fieldValues.push(emitIntoTemp(out, v, f.value));
    }
    locals.clear();
    for (const [k, lv] of savedLocals) locals.set(k, lv);

    // Now evaluate overriding RHS expressions in program order in caller scope.
    for (const ov of overrides) {
      const v = emitExpr(out, ov.expr, false);
      if (v === undefined) return -1;
      fieldValues[ov.index] = emitIntoTemp(out, v, ov.expr);
    }

    const ctorHelper = "createConstructedObject" + String(ctor.fields.length);
    const ctorArgs: Expression[] = [siteExpr];
    for (const fv of fieldValues) ctorArgs.push(fv);
    const instName = ctx.freshName("$cin");
    out.push(
      constVar(instName, callHelper(ctorHelper, ctorArgs, initExpr), initExpr),
    );
    out.push(
      ifStmt(
        bin(
          "===",
          ident(instName, initExpr),
          ident("undefined", initExpr),
          initExpr,
        ),
        breakTo(bailLabel, initExpr),
        undefined,
        initExpr,
      ),
    );
    out.push(assignStmt(localVar, ident(instName, initExpr), decl));
    invalidateForwardedBase("local:" + decl.name);
    return endIdx;
  }

  function isBailFreeExpr(expr: Expression): boolean {
    const raw = unwrapGroup(expr);
    if (
      raw.kind === "number" ||
      raw.kind === "boolean" ||
      raw.kind === "string" ||
      raw.kind === "null" ||
      raw.kind === "this"
    )
      return true;
    if (raw.kind === "identifier")
      return raw.name === "undefined" || locals.has(raw.name);
    return false;
  }

  function isBailFreeStmt(stmt: Statement | undefined): boolean {
    if (stmt === undefined || stmt.kind === "empty") return true;
    if (stmt.kind === "return") {
      const retExpr = stmt.expression;
      return retExpr === undefined || isBailFreeExpr(retExpr);
    }
    if (stmt.kind === "block") {
      for (const child of stmt.statements) {
        if (!isBailFreeStmt(child)) return false;
      }
      return true;
    }
    return false;
  }

  function emitStmt(out: Statement[], stmt: Statement, isFinal: boolean): void {
    if (emitFailed) return;
    switch (stmt.kind) {
      case "empty":
        return;
      case "block": {
        const len = stmt.statements.length;
        const tailBailFree: boolean[] = [];
        for (let i: number = 0; i < len; i++) tailBailFree.push(false);
        let suffixFree: boolean = isFinal;
        for (let i: number = len - 1; i >= 0; i--) {
          tailBailFree[i] = suffixFree;
          if (suffixFree) suffixFree = isBailFreeStmt(stmt.statements[i]);
        }
        for (let i: number = 0; i < len; i++) {
          const coalescedEnd = tryEmitCoalescedConstruct(
            out,
            stmt.statements,
            i,
          );
          if (coalescedEnd >= i) {
            if (emitFailed) return;
            i = coalescedEnd;
            continue;
          }
          const child = stmt.statements[i];
          if (child !== undefined)
            emitStmt(out, child, tailBailFree[i] === true);
        }
        return;
      }
      case "variable":
        for (const decl of stmt.declarations) {
          if (
            decl === undefined ||
            decl.kind === "object-binding" ||
            decl.kind === "array-binding"
          )
            continue;
          const local = locals.get(decl.name);
          if (local === undefined) {
            emitFailed = true;
            return;
          }
          if (decl.initializer !== undefined) {
            const init = emitExpr(out, decl.initializer, false);
            if (init === undefined) return;
            out.push(assignStmt(local, init, decl));
            invalidateForwardedBase("local:" + decl.name);
          }
        }
        return;
      case "expression": {
        const val = emitExpr(out, stmt.expression, isFinal);
        if (val === undefined) return;
        // Assignment/update/call expressions already emitted their side effects.
        if (stmt.expression.kind === "call" && val.kind === "call") {
          out.push({ ...atSpan(stmt), kind: "expression", expression: val });
        }
        return;
      }
      case "return": {
        const retExpr = stmt.expression;
        if (retExpr !== undefined) {
          const val = emitExpr(out, retExpr, true);
          if (val === undefined) return;
          const valTemp = emitIntoTemp(out, val, retExpr);
          commitPendingStores(out, stmt);
          out.push(assignStmt(resultName, valTemp, stmt));
        } else {
          commitPendingStores(out, stmt);
          out.push(assignStmt(resultName, ident("undefined", stmt), stmt));
        }
        out.push(assignStmt(doneName, bool(true, stmt), stmt));
        out.push(breakTo(returnLabel, stmt));
        return;
      }
      case "throw":
        out.push(breakTo(bailLabel, stmt));
        return;
      case "if": {
        const test = emitBoolean(out, stmt.test, stmt);
        const savedWritten = cloneStringSet(writtenProps);
        const savedFwd = cloneForwardedMap(forwarded);
        tx.conditionalDepth++;
        const cons: Statement[] = [];
        emitStmt(cons, stmt.consequent, isFinal);
        const consWritten = cloneStringSet(writtenProps);
        writtenProps.clear();
        for (const p of savedWritten) writtenProps.add(p);
        forwarded.clear();
        for (const [k, v] of savedFwd) forwarded.set(k, v);
        let alt: Statement | undefined = undefined;
        const alternate = stmt.alternate;
        if (alternate !== undefined) {
          const altStmts: Statement[] = [];
          emitStmt(altStmts, alternate, isFinal);
          alt = blockOf(altStmts, alternate);
        }
        tx.conditionalDepth--;
        for (const p of consWritten) writtenProps.add(p);
        for (const p of writtenProps) {
          if (!savedWritten.has(p)) {
            forwarded.delete(p);
            invalidateForwardedBase("this." + p);
          }
        }
        out.push(ifStmt(test, blockOf(cons, stmt.consequent), alt, stmt));
        return;
      }
      case "switch": {
        const disc = emitExpr(out, stmt.expression, false);
        if (disc === undefined) return;
        const discTemp = emitIntoTemp(out, disc, stmt.expression);
        let defaultClause: SwitchClause | undefined = undefined;
        const valueClauses: SwitchClause[] = [];
        for (const clause of stmt.clauses) {
          if (clause === undefined) continue;
          if (clause.test === undefined) defaultClause = clause;
          else valueClauses.push(clause);
        }
        const savedWritten = cloneStringSet(writtenProps);
        const savedFwd = cloneForwardedMap(forwarded);
        const allWritten = cloneStringSet(savedWritten);
        tx.conditionalDepth++;
        let chain: Statement | undefined = undefined;
        if (defaultClause !== undefined) {
          writtenProps.clear();
          for (const p of savedWritten) writtenProps.add(p);
          forwarded.clear();
          for (const [k, v] of savedFwd) forwarded.set(k, v);
          const defStmts: Statement[] = [];
          const ret = defaultClause.statements[0];
          if (ret !== undefined) emitStmt(defStmts, ret, isFinal);
          for (const p of writtenProps) allWritten.add(p);
          chain = blockOf(defStmts, defaultClause);
        }
        for (let i: number = valueClauses.length - 1; i >= 0; i--) {
          const clause = valueClauses[i];
          if (clause === undefined) continue;
          const clauseTest = clause.test;
          if (clauseTest === undefined) continue;
          const testVal = emitExpr(out, clauseTest, false);
          if (testVal === undefined) {
            tx.conditionalDepth--;
            return;
          }
          const testTemp =
            isKnownNonBigIntExpr(stmt.expression) ||
            isKnownNonBigIntExpr(clauseTest)
              ? testVal
              : emitIntoTemp(out, testVal, clauseTest);
          writtenProps.clear();
          for (const p of savedWritten) writtenProps.add(p);
          forwarded.clear();
          for (const [k, v] of savedFwd) forwarded.set(k, v);
          const consStmts: Statement[] = [];
          const ret = clause.statements[0];
          if (ret !== undefined) emitStmt(consStmts, ret, isFinal);
          for (const p of writtenProps) allWritten.add(p);
          chain = ifStmt(
            emitStrictEqual(
              discTemp,
              testTemp,
              stmt.expression,
              clauseTest,
              clause,
            ),
            blockOf(consStmts, clause),
            chain,
            clause,
          );
        }
        tx.conditionalDepth--;
        writtenProps.clear();
        for (const p of allWritten) writtenProps.add(p);
        forwarded.clear();
        for (const [k, v] of savedFwd) {
          if (!allWritten.has(k) || savedWritten.has(k)) forwarded.set(k, v);
        }
        if (chain !== undefined) out.push(chain);
        return;
      }
      default:
        emitFailed = true;
        return;
    }
  }

  if (constructSpec !== undefined) {
    emitStmt(stmts, cand.body, false);
    if (emitFailed) return undefined;
    const fieldValues: Expression[] = [];
    for (const field of constructSpec.fields) {
      const v = emitExpr(stmts, field.value, false);
      if (v === undefined) return undefined;
      fieldValues.push(emitIntoTemp(stmts, v, field.value));
    }
    const ctorHelper =
      "createConstructedObject" + String(constructSpec.fields.length);
    const ctorArgs: Expression[] = [constructSpec.siteExpr];
    for (const fv of fieldValues) ctorArgs.push(fv);
    const instName = ctx.freshName("$iin");
    stmts.push(
      constVar(instName, callHelper(ctorHelper, ctorArgs, callSpan), callSpan),
    );
    stmts.push(
      ifStmt(
        bin(
          "===",
          ident(instName, callSpan),
          ident("undefined", callSpan),
          callSpan,
        ),
        breakTo(bailLabel, callSpan),
        undefined,
        callSpan,
      ),
    );
    stmts.push(assignStmt(resultName, ident(instName, callSpan), callSpan));
    stmts.push(assignStmt(doneName, bool(true, callSpan), callSpan));
    return [
      {
        ...atSpan(callSpan),
        kind: "label",
        name: returnLabel,
        body: blockOf(stmts, callSpan),
      },
    ];
  }

  emitStmt(stmts, cand.body, true);
  if (emitFailed) return undefined;

  // Implicit `return undefined;` if control falls off the end of the body.
  commitPendingStores(stmts, callSpan);
  stmts.push(assignStmt(resultName, ident("undefined", callSpan), callSpan));
  stmts.push(assignStmt(doneName, bool(true, callSpan), callSpan));

  let finalBody: Statement[] = stmts;
  if (isRootTransaction && tx.hoistedDecls.length > 0) {
    finalBody = [];
    for (const d of tx.hoistedDecls) finalBody.push(d);
    for (const s of stmts) finalBody.push(s);
  }

  return [
    {
      ...atSpan(callSpan),
      kind: "label",
      name: returnLabel,
      body: blockOf(finalBody, callSpan),
    },
  ];
}

function countEmittedExpr(expr: Expression | undefined): number {
  if (expr === undefined) return 0;
  switch (expr.kind) {
    case "identifier":
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "this":
    case "super":
      return 1;
    case "group":
      return 1 + countEmittedExpr(expr.expression);
    case "unary":
      return 1 + countEmittedExpr(expr.operand);
    case "satisfies":
      return 1 + countEmittedExpr(expr.expression);
    case "binary":
    case "assignment":
      return (
        1 +
        countEmittedExpr(expr.kind === "binary" ? expr.left : expr.target) +
        countEmittedExpr(expr.kind === "binary" ? expr.right : expr.value)
      );
    case "conditional":
      return (
        1 +
        countEmittedExpr(expr.test) +
        countEmittedExpr(expr.consequent) +
        countEmittedExpr(expr.alternate)
      );
    case "member":
      return 1 + countEmittedExpr(expr.object);
    case "index":
      return 1 + countEmittedExpr(expr.object) + countEmittedExpr(expr.index);
    case "call":
    case "new": {
      let total = 1 + countEmittedExpr(expr.callee);
      for (const arg of expr.arguments) total += countEmittedExpr(arg);
      return total;
    }
    case "array": {
      let total = 1;
      for (const el of expr.elements) total += countEmittedExpr(el);
      return total;
    }
    case "object": {
      let total = 1;
      for (const p of expr.properties) {
        if (p === undefined) continue;
        total +=
          p.kind === "spread"
            ? 1 + countEmittedExpr(p.value)
            : 1 + countEmittedExpr(p.value);
      }
      return total;
    }
    default:
      return 2;
  }
}

function countEmittedStmt(stmt: Statement | undefined): number {
  if (stmt === undefined) return 0;
  switch (stmt.kind) {
    case "block": {
      let total = 1;
      for (const s of stmt.statements) total += countEmittedStmt(s);
      return total;
    }
    case "label":
      return 1 + countEmittedStmt(stmt.body);
    case "if":
      return (
        1 +
        countEmittedExpr(stmt.test) +
        countEmittedStmt(stmt.consequent) +
        countEmittedStmt(stmt.alternate)
      );
    case "variable": {
      let total = 1;
      for (const d of stmt.declarations) {
        if (d !== undefined) total += 1 + countEmittedExpr(d.initializer);
      }
      return total;
    }
    case "expression":
      return 1 + countEmittedExpr(stmt.expression);
    case "return":
      return 1 + countEmittedExpr(stmt.expression);
    case "break":
    case "continue":
    case "empty":
      return 1;
    default:
      return 2;
  }
}

/** Count emitted AST nodes in an inlined candidate expansion so callers bound
 * actual post-expansion size rather than shallow source node counts. */
export function countInlineAstNodes(stmts: readonly Statement[]): number {
  let total = 0;
  for (const s of stmts) total += countEmittedStmt(s);
  return total;
}
