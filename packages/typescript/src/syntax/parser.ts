import { parseRegExp } from "@tint/foundation/regexp/syntax";
import { isOptionalChain } from "./chains.ts";
import { bindingIdentifiers, isSimpleParameter } from "./bindings.ts";
import type { SourceTextView } from "@tint/source/text";
import { createTokenScanner } from "./lexer.ts";
import { literalPropertyName, bigintLiteralValue } from "./literals.ts";
import type {
  Result,
  Span,
  Module,
  Token,
  Diagnostic,
  Expression,
  Statement,
  TypeNode,
  TypeMembers,
  IndexSignature,
  Parameter,
  Binding,
  VariableBinding,
  ObjectBindingProperty,
  ImportDeclaration,
  ImportBinding,
  ExportBinding,
  ObjectProperty,
  PropertySignature,
  SwitchClause,
  BlockStatement,
  CatchClause,
  ClassDefinition,
  ClassElement,
  TemplateExpression,
} from "./model.ts";
function reserved(word: string): boolean {
  switch (word) {
    case "break":
    case "case":
    case "catch":
    case "class":
    case "const":
    case "continue":
    case "debugger":
    case "default":
    case "delete":
    case "do":
    case "else":
    case "enum":
    case "export":
    case "extends":
    case "false":
    case "finally":
    case "for":
    case "function":
    case "if":
    case "import":
    case "in":
    case "instanceof":
    case "new":
    case "null":
    case "return":
    case "super":
    case "switch":
    case "this":
    case "throw":
    case "true":
    case "try":
    case "typeof":
    case "var":
    case "void":
    case "while":
    case "with":
    case "yield":
    case "await":
    case "implements":
    case "interface":
    case "package":
    case "private":
    case "protected":
    case "public":
    case "static":
    case "let":
      return true;
    default:
      return false;
  }
}
function assignmentOperator(value: string): boolean {
  return [
    "=",
    "+=",
    "-=",
    "*=",
    "**=",
    "/=",
    "%=",
    "<<=",
    ">>=",
    ">>>=",
    "&=",
    "|=",
    "^=",
    "&&=",
    "||=",
    "??=",
  ].includes(value);
}
function precedence(op: string): number {
  if (op === "||" || op === "??") return 3;
  if (op === "&&") return 4;
  if (op === "|") return 5;
  if (op === "^") return 6;
  if (op === "&") return 7;
  if (op === "==" || op === "!=" || op === "===" || op === "!==") return 8;
  if (
    op === "<" ||
    op === ">" ||
    op === "<=" ||
    op === ">=" ||
    op === "instanceof" ||
    op === "in"
  )
    return 9;
  if (op === "<<" || op === ">>" || op === ">>>") return 10;
  if (op === "+" || op === "-") return 11;
  if (op === "*" || op === "/" || op === "%") return 12;
  if (op === "**") return 13;
  return 0;
}
export function parseModule(
  source: SourceTextView,
  language: "typescript" | "javascript" = "typescript",
): Result<Module> {
  return parseSource(source, language, "module");
}
/** Explicit strict Script goal, used by callers that already established strictness. */
export function parseStrictScript(source: SourceTextView): Result<Module> {
  return parseSource(source, "javascript", "strict-script");
}
/** Script grammar with strictness determined by directive prologues. */
export function parseScript(source: SourceTextView): Result<Module> {
  return parseSource(source, "javascript", "script");
}
/** PerformEval caller capabilities. Eval always retains Script grammar;
 * these facts never admit return, caller labels, await or yield. */
export interface EvalScriptContext {
  readonly strict: boolean;
  readonly newTarget: boolean;
  readonly superProperty: boolean;
  readonly superCall: boolean;
}
export function parseEvalScript(
  source: SourceTextView,
  context: EvalScriptContext,
): Result<Module> {
  return parseSource(
    source,
    "javascript",
    context.strict ? "strict-script" : "script",
    context,
  );
}
/** A backtracking point: tokens from its position stay in the window until it
 * is restored or released. */
interface ParserCheckpoint {
  /** Restore the saved state and release the mark. */
  readonly restore: () => void;
  /** Keep the current state and release the mark. */
  readonly release: () => void;
}
function parseSource(
  source: SourceTextView,
  language: "typescript" | "javascript",
  goal: "module" | "strict-script" | "script",
  context: EvalScriptContext | undefined = undefined,
): Result<Module> {
  function reservedName(word: string): boolean {
    if (word === "yield" && yieldContext) return true;
    if (
      word === "await" &&
      goal !== "module" &&
      !staticAwait &&
      awaitContext === 0
    )
      return false;
    if (
      !strict &&
      [
        "implements",
        "interface",
        "package",
        "private",
        "protected",
        "public",
        "static",
        "let",
        "yield",
      ].includes(word)
    )
      return false;
    return reserved(word);
  }
  // Tokens are pulled on demand and kept only in a window: from the lowest
  // live backtracking mark (or the current position) minus a short history.
  // Memory then scales with the syntax tree, not the token count, so the
  // scanner needs no token budget beyond its uint32 counter.
  const scanner = createTokenScanner(source, 0xffffffff, goal !== "module");
  const tokens: Token[] = [];
  let tokenBase = 0;
  const marks: number[] = [];
  const slashCheckpoints = new Map<number, { readonly restore: () => void }>();
  // Slash token starts in scan order, so the window can release old entries.
  const slashStarts: number[] = [];
  // A directive must be a complete string-literal expression statement. A line
  // break alone does not end it when the next token continues the expression.
  function directiveStrict(begin: number): boolean {
    let cursor = begin;
    for (;;) {
      const literal = tokenAt(cursor);
      if (literal.kind !== "string") return false;
      const next = tokenAt(cursor + 1);
      const explicit = next.value === ";";
      const continuation =
        next.kind === "template" ||
        next.kind === "template-head" ||
        [
          "(",
          "[",
          ".",
          "?.",
          "+",
          "-",
          "*",
          "/",
          "%",
          "**",
          "<",
          ">",
          "<=",
          ">=",
          "==",
          "!=",
          "===",
          "!==",
          "<<",
          ">>",
          ">>>",
          "&",
          "|",
          "^",
          "&&",
          "||",
          "??",
          "?",
          ",",
          "=",
          "+=",
          "-=",
          "*=",
          "/=",
          "%=",
          "**=",
          "&=",
          "|=",
          "^=",
          "<<=",
          ">>=",
          ">>>=",
          "&&=",
          "||=",
          "??=",
          "in",
          "instanceof",
        ].includes(next.value);
      if (
        !explicit &&
        next.kind !== "eof" &&
        next.value !== "}" &&
        !(next.lineBreakBefore && !continuation)
      )
        return false;
      const raw = source.text.slice(literal.start, literal.end);
      if (raw === '"use strict"' || raw === "'use strict'") return true;
      cursor += explicit ? 2 : 1;
    }
  }
  let strict: boolean = goal !== "script";
  let superProperty: boolean = context !== undefined && context.superProperty;
  let superCall: boolean = context !== undefined && context.superCall;
  let newTargetAllowed: boolean = context !== undefined && context.newTarget;
  let staticAwait: boolean = false;
  // 0: ordinary grammar, 1: async parameters, 2: async or module body.
  let awaitContext: number = goal === "module" ? 2 : 0;
  let yieldContext: boolean = false,
    yieldAllowed: boolean = false;
  let labels: { name: string; iteration: boolean }[] = [];
  const splits: { index: number; token: Token }[] = [];
  let index = 0,
    depth = 0,
    functions = 0,
    loops = 0,
    switches = 0;
  const abort = {},
    imports: ImportDeclaration[] = [];
  let failure: Diagnostic | undefined;
  const coverErrors: { node: Expression; token: Token; message: string }[] = [];
  const assignmentPatterns = new Set<Expression>();
  const restTrailingComma = new Set<Expression>();

  function tokenAt(position: number): Token {
    while (position - tokenBase >= tokens.length) {
      const last = tokens[tokens.length - 1];
      if (last !== undefined && last.kind === "eof") return last;
      const result = scanner.next();
      if (!result.ok) {
        failure = result.error;
        throw abort;
      }
      tokens.push(result.value);
      if (
        result.value.kind === "punctuation" &&
        (result.value.value === "/" || result.value.value === "/=")
      ) {
        const start = result.value.start;
        if (!slashCheckpoints.has(start)) slashStarts.push(start);
        slashCheckpoints.set(start, { restore: scanner.checkpoint() });
      }
    }
    const token = tokens[position - tokenBase];
    if (token === undefined) throw "parser token invariant";
    return token;
  }
  const tokenWindow = 4096,
    tokenHistory = 16;
  /** Drop tokens no backtracking can reach again. Splits can only be undone by
   * a live mark, so without marks they are released too. */
  function trimTokens(): void {
    if (index - tokenBase < 2 * tokenWindow) return;
    const floor = marks.length === 0 ? index : (marks[0] ?? index);
    const drop = floor - tokenHistory - tokenBase;
    if (drop < tokenWindow) return;
    const first = tokens[drop];
    if (first === undefined) throw "parser token window invariant";
    tokens.splice(0, drop);
    tokenBase += drop;
    if (marks.length === 0) splits.length = 0;
    let stale = 0;
    for (; stale < slashStarts.length; stale++) {
      const start = slashStarts[stale];
      if (start === undefined || start >= first.start) break;
      slashCheckpoints.delete(start);
    }
    if (stale !== 0) slashStarts.splice(0, stale);
  }
  /** An empty block in a statement list binds nothing, evaluates to an empty
   * completion and has no early errors, so the list omits it (millions of
   * them must not cost a node each). Directives are recognized from tokens. */
  function listStatement(list: Statement[], node: Statement): void {
    if (node.kind !== "block" || node.statements.length !== 0) list.push(node);
  }
  function pushMark(position: number): void {
    marks.push(position);
  }
  function popMark(position: number): void {
    if (marks.pop() !== position) throw "parser mark invariant";
  }
  function regexpToken(): void {
    const slash = current();
    if (
      slash.kind !== "punctuation" ||
      (slash.value !== "/" && slash.value !== "/=")
    )
      return;
    const restore = slashCheckpoints.get(slash.start);
    if (restore === undefined) throw "REGEXP_CHECKPOINT_INVARIANT";
    restore.restore();
    const result = scanner.rescanRegExp(slash);
    if (!result.ok) {
      failure = result.error;
      throw abort;
    }
    tokens.length = index - tokenBase;
    tokens.push(result.value);
  }
  function regexpLiteral(token: Token): Expression {
    const delimiter = token.value.lastIndexOf("/");
    const pattern = token.value.slice(1, delimiter),
      flags = token.value.slice(delimiter + 1);
    const parsed = parseRegExp(pattern, flags);
    if (!parsed.ok) {
      const diagnostic = parsed.error;
      const start =
        token.start +
        (diagnostic.source === "flags" ? delimiter + 1 : 1) +
        diagnostic.offset;
      fail(
        diagnostic.message,
        diagnostic.kind === "syntax"
          ? "SYNTAX_ERROR"
          : diagnostic.kind === "limit"
            ? "LIMIT"
            : "UNSUPPORTED_SYNTAX",
        { start, end: Math.min(token.end, start + 1) },
        "regexp-literals",
      );
    }
    return {
      kind: "regexp",
      pattern,
      flags,
      start: token.start,
      end: token.end,
    };
  }
  function current(ahead: number = 0): Token {
    return tokenAt(index + ahead);
  }
  function at(value: string, ahead: number = 0): boolean {
    const token = current(ahead);
    return (
      ((token.kind === "identifier" && token.escaped !== true) ||
        token.kind === "punctuation") &&
      token.value === value
    );
  }
  function take(): Token {
    const token = current();
    if (strict && token.legacyEscape === true)
      fail(
        "legacy numeric escape is forbidden in strict code",
        "SYNTAX_ERROR",
        token,
      );
    if (strict && token.legacyNumeric === true)
      fail(
        "legacy numeric literal is forbidden in strict code",
        "SYNTAX_ERROR",
        token,
      );
    if (token.kind !== "eof") {
      index++;
      trimTokens();
    }
    return token;
  }
  function end(): number {
    const token = tokens[index - 1 - tokenBase];
    return token === undefined ? 0 : token.end;
  }
  function previousValue(): string {
    const token = tokens[index - 1 - tokenBase];
    return token === undefined ? "" : token.value;
  }
  function fail(
    message: string,
    code: Diagnostic["code"] = "SYNTAX_ERROR",
    token: Span = current(),
    feature?: Diagnostic["feature"],
  ): never {
    const p = source.positionAt(token.start);
    if (!p.ok) throw "parser position invariant";
    failure = {
      ...(feature === undefined ? {} : { feature }),
      code,
      message,
      start: token.start,
      end: token.end,
      position: p.value,
    };
    throw abort;
  }
  function typescriptSyntax(): void {
    if (language === "javascript")
      fail(
        "TypeScript syntax is not valid in JavaScript source",
        "SYNTAX_ERROR",
      );
  }
  function enter(): void {
    if (++depth > 128) fail("syntax nesting limit exceeded", "LIMIT");
  }
  function eat(value: string): boolean {
    if (!at(value)) return false;
    take();
    return true;
  }
  function expect(value: string): Token {
    // A generic close can split >= into > and =, leaving the following >
    // as a separate token. Consume the adjacent remainder as an arrow without
    // mutating tokens, so speculative type parsing can still restore its splits.
    if (
      value === "=>" &&
      at("=") &&
      at(">", 1) &&
      current().end === current(1).start
    ) {
      const first = take();
      const last = take();
      return { ...first, value: "=>", end: last.end };
    }
    if (!at(value)) fail("expected " + value);
    return take();
  }
  function name(binding: boolean = true): Token {
    const token = current();
    if (token.kind !== "identifier" || (binding && reservedName(token.value)))
      fail("expected identifier");
    return take();
  }
  function restrictedIdentifier(value: string): boolean {
    return strict && (value === "eval" || value === "arguments");
  }
  function bindingName(): Token {
    const token = name();
    if (restrictedIdentifier(token.value))
      fail("invalid strict binding identifier", "SYNTAX_ERROR", token);
    return token;
  }
  function lexicalLet(): boolean {
    return (
      at("let") &&
      (strict ||
        at("[", 1) ||
        at("{", 1) ||
        (current(1).kind === "identifier" &&
          (!reservedName(current(1).value) ||
            current(1).value === "yield" ||
            current(1).value === "await")))
    );
  }
  function variableName(mode: "const" | "let" | "var"): Token {
    const token = bindingName();
    checkVariableName(token, mode);
    return token;
  }
  function checkVariableName(
    token: Token,
    mode: "const" | "let" | "var",
  ): void {
    if (
      token.kind !== "identifier" ||
      reservedName(token.value) ||
      restrictedIdentifier(token.value)
    )
      fail("invalid binding identifier", "SYNTAX_ERROR", token);
    if (mode !== "var" && token.value === "let")
      fail("lexical binding cannot be named let", "SYNTAX_ERROR", token);
  }
  function semi(): void {
    if (at("=>")) fail("invalid arrow parameter list");
    if (
      eat(";") ||
      at("}") ||
      current().kind === "eof" ||
      current().lineBreakBefore
    )
      return;
    fail(
      "expected semicolon or statement boundary",
      language === "javascript" ? "SYNTAX_ERROR" : "UNSUPPORTED_SYNTAX",
    );
  }
  // Successful probes cache only a source boundary, never semantic validity.
  // Real parameter parsing still checks the current function's grammar context.
  const parameterEnds = new Map<number, number>();
  function parserCheckpoint(): ParserCheckpoint {
    const savedIndex = index,
      savedFailure = failure,
      savedSplits = splits.length,
      savedCoverErrors = coverErrors.length,
      savedStrict = strict,
      savedAwait = awaitContext,
      savedYield = yieldContext,
      savedYieldAllowed = yieldAllowed,
      savedSuper = superProperty,
      savedSuperCall = superCall,
      savedNewTarget = newTargetAllowed,
      savedStaticAwait = staticAwait,
      savedFunctions = functions,
      savedLoops = loops,
      savedSwitches = switches,
      savedDepth = depth,
      savedLabels = labels.slice(),
      savedImports = imports.length;
    pushMark(savedIndex);
    const release = (): void => popMark(savedIndex);
    const restore = (): void => {
      popMark(savedIndex);
      index = savedIndex;
      restoreSplits(savedSplits);
      coverErrors.length = savedCoverErrors;
      failure = savedFailure;
      strict = savedStrict;
      awaitContext = savedAwait;
      yieldContext = savedYield;
      yieldAllowed = savedYieldAllowed;
      superProperty = savedSuper;
      superCall = savedSuperCall;
      newTargetAllowed = savedNewTarget;
      staticAwait = savedStaticAwait;
      functions = savedFunctions;
      loops = savedLoops;
      switches = savedSwitches;
      depth = savedDepth;
      labels = savedLabels;
      imports.length = savedImports;
    };
    return { restore, release };
  }
  function afterParameters(offset: number = 0): number {
    const begin = current(offset).start;
    let boundary = parameterEnds.get(begin);
    if (boundary === undefined) {
      const checkpoint = parserCheckpoint();
      let limit: Diagnostic | undefined;
      try {
        index += offset;
        strict = false;
        parameters(false, true, false);
        boundary = end();
      } catch (error) {
        if (error !== abort) throw error;
        if (failure?.code === "LIMIT") limit = failure;
      } finally {
        checkpoint.restore();
      }
      if (limit !== undefined) {
        failure = limit;
        throw abort;
      }
      if (boundary === undefined) return 0;
      parameterEnds.set(begin, boundary);
    }
    const endOffset = boundary;
    if (endOffset === undefined) throw "PARAMETER_BOUNDARY_INVARIANT";
    let ahead = offset;
    while (current(ahead).kind !== "eof" && current(ahead).end <= endOffset)
      ahead++;
    return ahead;
  }
  function functionStrict(arrow: boolean = false): boolean {
    if (strict) return true;
    const after = at("(") ? afterParameters() : 1;
    const body = index + after + (arrow ? 1 : 0);
    return tokenAt(body).value === "{" && directiveStrict(body + 1);
  }
  function rejectTupleRest(annotation: TypeNode | undefined): void {
    let target = annotation;
    while (target?.kind === "group") target = target.type;
    if (target?.kind === "tuple")
      fail("tuple types are not supported", "SYNTAX_ERROR", target);
  }
  function parameters(
    requireTypes: boolean = false,
    allowReceiver: boolean = true,
    unique: boolean = true,
    properties: Token[] | undefined = undefined,
  ): Parameter[] {
    expect("(");
    const result: Parameter[] = [],
      names = new Set<string>();
    let duplicate: Token | undefined;
    while (!at(")")) {
      // Constructor parameter properties: `private readonly x: T`.
      let property = false;
      while (
        properties !== undefined &&
        (at("public") ||
          at("private") ||
          at("protected") ||
          at("readonly") ||
          at("override")) &&
        current(1).kind === "identifier" &&
        !at(",", 1) &&
        !at(")", 1)
      ) {
        typescriptSyntax();
        take();
        property = true;
      }
      const rest = eat("...");
      if (at("{") || at("[")) {
        const token = current();
        const pattern = variableBinding("var", true);
        if (
          pattern.kind !== "object-binding" &&
          pattern.kind !== "array-binding"
        )
          throw "parameter pattern invariant";
        if (requireTypes && pattern.type === undefined)
          fail("function type parameter requires annotation");
        if (rest) rejectTupleRest(pattern.type);
        if (rest && pattern.initializer !== undefined)
          fail("rest parameter cannot have an initializer");
        for (const identifier of bindingIdentifiers(pattern)) {
          if (identifier === undefined) throw "parameter identifier invariant";
          if (names.has(identifier.name)) fail("duplicate parameter");
          names.add(identifier.name);
        }
        result.push({
          kind: "pattern-parameter",
          pattern: { ...pattern, type: undefined, initializer: undefined },
          rest,
          type: pattern.type,
          initializer: pattern.initializer,
          start: token.start,
          end: end(),
        });
        if (rest && !at(")"))
          fail("rest parameter must be last without a trailing comma");
        if (!eat(",")) break;
        continue;
      }
      const receiver = !rest && allowReceiver && at("this");
      if (receiver) typescriptSyntax();
      const p = receiver ? name(false) : requireTypes ? name() : bindingName();
      if (property && properties !== undefined) properties.push(p);
      if (receiver && (result.length !== 0 || p.escaped === true))
        fail(
          "receiver annotation must be the first parameter",
          "SYNTAX_ERROR",
          p,
        );
      if (names.has(p.value)) {
        if (strict || unique) fail("duplicate parameter", "SYNTAX_ERROR", p);
        duplicate = p;
      }
      names.add(p.value);
      const optional = eat("?"),
        annotation = eat(":") ? type() : undefined;
      if (rest) rejectTupleRest(annotation);
      if (rest && (optional || at("=")))
        fail(
          "rest parameter cannot be optional or have an initializer",
          "SYNTAX_ERROR",
          p,
        );
      if (receiver && optional)
        fail("receiver annotation cannot be optional", "SYNTAX_ERROR", p);
      if (optional) typescriptSyntax();
      if (at("=") && (requireTypes || optional || receiver))
        fail("parameter initializer is not allowed here");
      const initializer = eat("=") ? expression(1) : undefined;
      if ((requireTypes || receiver) && annotation === undefined)
        fail("function type parameter requires annotation");
      result.push({
        name: p.value,
        rest,
        type: annotation,
        optional,
        initializer,
        start: p.start,
        end: end(),
      });
      if (rest && !at(")"))
        fail(
          "rest parameter must be last without a trailing comma",
          "SYNTAX_ERROR",
        );
      if (!eat(",")) break;
    }
    expect(")");
    if (duplicate !== undefined && result.some((p) => !isSimpleParameter(p)))
      fail("duplicate parameter", "SYNTAX_ERROR", duplicate);
    return result;
  }
  function functionParameters(params: readonly Parameter[]): {
    parameters: readonly Parameter[];
    receiver?: TypeNode;
  } {
    const first = params[0];
    const receiver =
      first !== undefined &&
      first.kind !== "pattern-parameter" &&
      first.name === "this"
        ? first.type
        : undefined;
    return {
      parameters: receiver === undefined ? params : params.slice(1),
      ...(receiver === undefined ? {} : { receiver }),
    };
  }
  function functionType(
    params: readonly Parameter[],
    result: TypeNode,
    start: number,
  ): TypeNode {
    return {
      kind: "function",
      ...functionParameters(params),
      returnType: result,
      start,
      end: end(),
    };
  }
  function typeClose(): void {
    const token = current();
    if (
      token.kind === "punctuation" &&
      token.value.startsWith(">") &&
      token.value.length > 1
    ) {
      splits.push({ index, token });
      tokens.splice(
        index - tokenBase,
        1,
        { ...token, value: ">", end: token.start + 1 },
        {
          ...token,
          value: token.value.slice(1),
          start: token.start + 1,
          lineBreakBefore: false,
        },
      );
    }
    expect(">");
  }
  function typeParameters(): string[] {
    const parameters: string[] = [];
    if (!eat("<")) return parameters;
    typescriptSyntax();
    do {
      parameters.push(name().value);
    } while (eat(",") && !at(">"));
    typeClose();
    return parameters;
  }
  function typeReference(): TypeNode {
    const token = name(false);
    if (
      reservedName(token.value) &&
      token.value !== "null" &&
      token.value !== "void"
    )
      fail("unsupported type syntax", "UNSUPPORTED_SYNTAX", token);
    const args: TypeNode[] = [];
    if (eat("<")) {
      do {
        args.push(type());
      } while (eat(",") && !at(">"));
      typeClose();
    }
    return {
      kind: "named",
      name: token.value,
      arguments: args,
      start: token.start,
      end: end(),
    };
  }
  const propertyName = function (dynamic: boolean = false): Token & {
    readonly computed?: boolean;
    readonly keyExpression?: Expression;
  } {
    const token = current();
    if (eat("[")) {
      const key = expression(1);
      expect("]");
      const value = literalPropertyName(key);
      if (value === undefined && !dynamic)
        fail(
          "dynamic computed property names are not implemented",
          "UNSUPPORTED_SYNTAX",
          key,
          "computed-property-names",
        );
      return {
        kind: "string",
        value: value ?? "",
        ...(value === undefined ? { keyExpression: key } : {}),
        computed: true,
        start: token.start,
        end: end(),
        lineBreakBefore: token.lineBreakBefore,
      };
    }
    if (token.kind === "bigint") {
      take();
      return {
        ...token,
        kind: "string",
        value: bigintLiteralValue(token.value),
      };
    }
    if (token.kind === "number") {
      take();
      return {
        ...token,
        value: String(Number(token.value.split("_").join(""))),
      };
    }
    const named = token.kind === "string" ? take() : name(false);
    return { ...named, computed: false };
  };
  function variableBinding(
    mode: "const" | "let" | "var",
    annotation: boolean = true,
    allowIn: boolean = true,
  ): VariableBinding {
    if (++depth > 128) fail("binding nesting limit exceeded", "LIMIT");
    try {
      const begin = current().start;
      if (eat("[")) {
        const elements: (VariableBinding | undefined)[] = [];
        let rest: VariableBinding | undefined;
        while (!at("]")) {
          if (eat(",")) {
            elements.push(undefined);
            continue;
          }
          if (eat("...")) {
            rest = variableBinding(mode, false);
            if (rest.initializer !== undefined || !at("]"))
              fail("invalid array rest binding");
            break;
          }
          elements.push(variableBinding(mode, false));
          if (!eat(",")) break;
        }
        expect("]");
        const declared = annotation && eat(":") ? type() : undefined;
        const initializer = eat("=")
          ? expression(1, false, true, allowIn)
          : undefined;
        return {
          kind: "array-binding",
          elements,
          ...(rest === undefined ? {} : { rest }),
          type: declared,
          initializer,
          start: begin,
          end: end(),
        };
      }
      if (!eat("{")) {
        const id = variableName(mode);
        const declared = annotation && eat(":") ? type() : undefined;
        const initializer = eat("=")
          ? expression(1, false, true, allowIn)
          : undefined;
        return {
          name: id.value,
          type: declared,
          initializer,
          start: begin,
          end: end(),
        };
      }
      const properties: ObjectBindingProperty[] = [];
      let rest: Binding | undefined;
      while (!at("}")) {
        if (eat("...")) {
          const id = variableName(mode);
          rest = {
            name: id.value,
            type: undefined,
            initializer: undefined,
            start: id.start,
            end: id.end,
          };
          if (!at("}"))
            fail("object binding rest must be last without a trailing comma");
          break;
        }
        const key = propertyName(true);
        let binding: VariableBinding;
        if (eat(":")) binding = variableBinding(mode, false);
        else {
          if (key.computed)
            fail(
              "computed binding property requires a target",
              "SYNTAX_ERROR",
              key,
            );
          checkVariableName(key, mode);
          const initializer = eat("=") ? expression(1) : undefined;
          binding = {
            name: key.value,
            type: undefined,
            initializer,
            start: key.start,
            end: end(),
          };
        }
        properties.push({
          name: key.value,
          ...(key.keyExpression === undefined
            ? {}
            : { keyExpression: key.keyExpression }),
          ...(key.computed ? { computed: true } : {}),
          binding,
          start: key.start,
          end: binding.end,
        });
        if (!eat(",")) break;
      }
      expect("}");
      const declared = annotation && eat(":") ? type() : undefined;
      const initializer = eat("=")
        ? expression(1, false, true, allowIn)
        : undefined;
      return {
        kind: "object-binding",
        properties,
        rest,
        type: declared,
        initializer,
        start: begin,
        end: end(),
      };
    } finally {
      depth--;
    }
  }
  function propertiesBody(): TypeMembers {
    const properties: PropertySignature[] = [];
    let indexSignature: IndexSignature | undefined,
      callSignature: TypeNode | undefined,
      constructSignature: TypeNode | undefined;
    while (!at("}")) {
      const start = current().start;
      if (at("(") || (at("new") && at("(", 1))) {
        const construct = eat("new");
        const params = parameters(true);
        if (
          construct &&
          params.some(
            (p) => p.kind !== "pattern-parameter" && p.name === "this",
          )
        )
          fail("construct signatures cannot declare a this parameter");
        expect(":");
        const signature = functionType(params, type(), start);
        if (
          construct
            ? constructSignature !== undefined
            : callSignature !== undefined
        )
          fail(
            "overloaded signatures are not implemented",
            "UNSUPPORTED_SYNTAX",
          );
        if (construct) constructSignature = signature;
        else callSignature = signature;
        if (!eat(";") && !eat(",") && !at("}") && !current().lineBreakBefore)
          fail("expected signature separator");
        continue;
      }
      const readonly =
        at("readonly") && !at(":", 1) && !at("?", 1) && !at("(", 1)
          ? (take(), true)
          : false;
      if (at("[") && current(1).kind === "identifier" && at(":", 2)) {
        if (indexSignature !== undefined)
          fail(
            "multiple index signatures are not implemented",
            "UNSUPPORTED_SYNTAX",
          );
        expect("[");
        const parameter = name();
        expect(":");
        const keyType = type();
        expect("]");
        expect(":");
        const valueType = type();
        indexSignature = {
          name: parameter.value,
          keyType,
          valueType,
          readonly,
          start,
          end: end(),
        };
        if (!eat(";") && !eat(",") && !at("}") && !current().lineBreakBefore)
          fail("expected property separator");
        continue;
      }
      const key = propertyName();
      const optional = eat("?");
      const method = at("(");
      let annotation: TypeNode;
      if (method) {
        if (readonly)
          fail("readonly modifiers apply to properties, not methods");
        const params = parameters(true);
        expect(":");
        const returnType = type();
        annotation = functionType(params, returnType, key.start);
      } else {
        expect(":");
        annotation = type();
      }
      properties.push({
        name: key.value,
        ...(key.computed ? { computed: true } : {}),
        ...(method ? { method: true } : {}),
        readonly,
        ...(optional ? { optional: true } : {}),
        type: annotation,
        start,
        end: end(),
      });
      if (!eat(";") && !eat(",") && !at("}") && !current().lineBreakBefore)
        fail("expected property separator");
    }
    expect("}");
    return {
      properties,
      ...(indexSignature === undefined ? {} : { indexSignature }),
      ...(callSignature === undefined ? {} : { call: callSignature }),
      ...(constructSignature === undefined
        ? {}
        : { construct: constructSignature }),
    };
  }
  function type(): TypeNode {
    typescriptSyntax();
    enter();
    try {
      const begin = current().start,
        leading = eat("|");
      const members: TypeNode[] = [];
      do {
        const intersectionStart = current().start,
          leadingIntersection = eat("&"),
          parts: TypeNode[] = [];
        do {
          const readonlyStart = current().start,
            readonly = eat("readonly");
          const token = current();
          let node: TypeNode;
          if (
            token.kind === "string" ||
            token.kind === "number" ||
            at("true") ||
            at("false") ||
            at("-")
          ) {
            take();
            let value: string | number | boolean;
            if (token.value === "-") {
              const numeric = current();
              if (numeric.kind !== "number")
                fail("negative literal type requires a number");
              take();
              value = -Number(numeric.value.split("_").join(""));
            } else
              value =
                token.kind === "string"
                  ? token.value
                  : token.kind === "number"
                    ? Number(token.value.split("_").join(""))
                    : token.value === "true";
            node = { kind: "literal", value, start: token.start, end: end() };
          } else if (eat("[")) {
            const elements: TypeNode[] = [];
            while (!at("]")) {
              elements.push(type());
              if (!eat(",")) break;
            }
            expect("]");
            node = { kind: "tuple", elements, start: token.start, end: end() };
          } else if (eat("{"))
            node = {
              kind: "object",
              ...propertiesBody(),
              start: token.start,
              end: end(),
            };
          else if (eat("new")) {
            if (
              members.length !== 0 ||
              leading ||
              parts.length !== 0 ||
              leadingIntersection
            )
              fail("constructor type in a union requires parentheses");
            const params = parameters(true);
            if (
              params.some(
                (p) => p.kind !== "pattern-parameter" && p.name === "this",
              )
            )
              fail("construct signatures cannot declare a this parameter");
            expect("=>");
            node = {
              kind: "object",
              properties: [],
              construct: functionType(params, type(), token.start),
              start: token.start,
              end: end(),
            };
          } else if (at("(")) {
            if (at("=>", afterParameters())) {
              if (
                members.length !== 0 ||
                leading ||
                parts.length !== 0 ||
                leadingIntersection
              )
                fail("function type in a union requires parentheses");
              const params = parameters(true);
              expect("=>");
              node = functionType(params, type(), token.start);
            } else {
              take();
              const inner = type();
              expect(")");
              node = {
                kind: "group",
                type: inner,
                start: token.start,
                end: end(),
              };
            }
          } else node = typeReference();
          while (eat("[")) {
            if (eat("]"))
              node = {
                kind: "array",
                element: node,
                start: node.start,
                end: end(),
              };
            else {
              const index = type();
              expect("]");
              node = {
                kind: "indexed-access",
                object: node,
                index,
                start: node.start,
                end: end(),
              };
            }
          }
          if (readonly) {
            if (node.kind !== "array" && node.kind !== "tuple")
              fail("readonly type modifier requires an array or tuple");
            node = { ...node, readonly: true, start: readonlyStart };
          }
          parts.push(node);
        } while (eat("&"));
        const part = parts[0];
        if (part === undefined) throw "intersection invariant";
        members.push(
          parts.length === 1 && !leadingIntersection
            ? part
            : {
                kind: "intersection",
                members: parts,
                start: intersectionStart,
                end: end(),
              },
        );
      } while (eat("|"));
      const first = members[0];
      if (first === undefined) throw "type invariant";
      return members.length === 1 && !leading
        ? first
        : { kind: "union", members, start: begin, end: end() };
    } finally {
      depth--;
    }
  }
  function functionDirectives(
    params: readonly Parameter[],
    body: BlockStatement,
  ): void {
    if (!params.some((parameter) => !isSimpleParameter(parameter))) return;
    for (const statement of body.statements) {
      if (statement === undefined) throw "function statement invariant";
      if (statement.kind !== "expression") break;
      const expression = statement.expression;
      if (expression.kind !== "string" || expression.template === true) break;
      const raw = source.text.slice(expression.start, expression.end);
      if (raw === '\"use strict\"' || raw === "'use strict'")
        fail(
          "use strict directive requires simple parameters",
          "SYNTAX_ERROR",
          expression,
        );
    }
  }
  function decorators(firstConsumed: boolean = false): Expression[] {
    const result: Expression[] = [];
    while (firstConsumed || eat("@")) {
      firstConsumed = false;
      let value: Expression;
      if (eat("(")) {
        value = expression();
        expect(")");
      } else {
        const token = name();
        if (reservedName(token.value))
          fail("invalid decorator identifier", "SYNTAX_ERROR", token);
        value = {
          kind: "identifier",
          name: token.value,
          start: token.start,
          end: token.end,
        };
        while (eat(".")) {
          const privateName = current().kind === "private-identifier";
          const property = privateName ? take() : name(false);
          value = {
            kind: "member",
            object: value,
            property: property.value,
            ...(privateName ? { private: true } : {}),
            start: value.start,
            end: end(),
          };
        }
        if (at("(")) {
          const args = argumentsList();
          value = {
            kind: "call",
            callee: value,
            arguments: args,
            typeArguments: [],
            start: value.start,
            end: end(),
          };
        }
      }
      result.push(value);
    }
    return result;
  }
  function classDefinition(
    begin: number,
    declaration: boolean,
    classDecorators: readonly Expression[] = [],
    sourceStart?: number,
  ): ClassDefinition {
    const previousStrict = strict;
    strict = true;
    try {
      const className =
        !at("{") && !at("extends") ? bindingName().value : undefined;
      if (declaration && className === undefined)
        fail("class declaration requires a name", "SYNTAX_ERROR");
      const generics = typeParameters();
      if (new Set(generics).size !== generics.length)
        fail("duplicate type parameter");
      const heritage = eat("extends") ? expression(15) : undefined;
      expect("{");
      const elements: ClassElement[] = [];
      let constructorSeen = false;
      while (!at("}")) {
        if (eat(";")) continue;
        const start = current().start;
        const elementDecorators = decorators();
        // TypeScript member modifiers have no runtime meaning, except that
        // `declare` and `abstract` members do not exist at runtime.
        let ambient = false;
        const memberModifiers = (): void => {
          while (
            language !== "javascript" &&
            (at("public") ||
              at("private") ||
              at("protected") ||
              at("readonly") ||
              at("override") ||
              at("declare") ||
              at("abstract")) &&
            !["(", "=", ";", "}", ":", "?", "!", "<"].includes(
              current(1).value,
            ) &&
            !current(1).lineBreakBefore
          ) {
            if (at("declare") || at("abstract")) ambient = true;
            take();
          }
        };
        memberModifiers();
        let isStatic = false;
        if (
          at("static") &&
          !["(", "=", ";", "}", ":"].includes(current(1).value)
        ) {
          take();
          isStatic = true;
        }
        memberModifiers();
        if (at("{") && isStatic) {
          if (elementDecorators.length !== 0)
            fail("static blocks cannot be decorated");
          const previousFunctions = functions,
            previousLoops = loops,
            previousLabels = labels,
            previousSwitches = switches,
            previousSuper = superProperty,
            previousSuperCall = superCall,
            previousNewTarget = newTargetAllowed,
            previousStaticAwait = staticAwait,
            previousAwaitContext = awaitContext,
            previousYieldContext = yieldContext,
            previousYieldAllowed = yieldAllowed;
          staticAwait = true;
          awaitContext = 0;
          yieldContext = false;
          yieldAllowed = false;
          functions = 0;
          loops = 0;
          switches = 0;
          labels = [];
          superProperty = true;
          superCall = false;
          newTargetAllowed = true;
          try {
            const body = requiredBlock();
            elements.push({ kind: "static-block", body, start, end: end() });
          } finally {
            awaitContext = previousAwaitContext;
            yieldContext = previousYieldContext;
            yieldAllowed = previousYieldAllowed;
            functions = previousFunctions;
            loops = previousLoops;
            switches = previousSwitches;
            labels = previousLabels;
            superProperty = previousSuper;
            superCall = previousSuperCall;
            newTargetAllowed = previousNewTarget;
            staticAwait = previousStaticAwait;
          }
          continue;
        }
        const sourceStart = current().start;
        const accessor =
          at("accessor") &&
          !current(1).lineBreakBefore &&
          !["(", "=", ";", "}", ":"].includes(current(1).value);
        if (accessor) take();
        let methodKind: "method" | "get" | "set" = "method";
        if (
          (at("get") || at("set")) &&
          !["(", "=", ";", "}", ":", "*"].includes(current(1).value)
        ) {
          methodKind = at("get") ? "get" : "set";
          take();
        }
        const async = asyncMethodPrefix();
        const generator = eat("*");
        if (async && methodKind !== "method")
          fail("async method cannot be an accessor");
        if (generator && methodKind !== "method")
          fail("generator cannot be an accessor");
        let key: Expression;
        const privateName = current().kind === "private-identifier";
        const computed = eat("[");
        if (computed) {
          key = expression(1);
          expect("]");
        } else {
          const token = current();
          if (
            token.kind === "string" ||
            token.kind === "number" ||
            token.kind === "bigint" ||
            token.kind === "private-identifier"
          ) {
            take();
            key = {
              kind: "string",
              value:
                token.kind === "number"
                  ? String(Number(token.value.split("_").join("")))
                  : token.kind === "bigint"
                    ? bigintLiteralValue(token.value)
                    : token.value,
              start: token.start,
              end: token.end,
            };
          } else {
            const token = name(false);
            key = {
              kind: "string",
              value: token.value,
              start: token.start,
              end: token.end,
            };
          }
        }
        const property =
          !computed && key.kind === "string" ? key.value : undefined;
        if (privateName && property === "#constructor")
          fail(
            "private class element cannot be named #constructor",
            "SYNTAX_ERROR",
            key,
          );
        if (isStatic && property === "prototype")
          fail(
            "static class element cannot be named prototype",
            "SYNTAX_ERROR",
            key,
          );
        if (at("(")) {
          if (!isStatic && property === "constructor") {
            if (elementDecorators.length !== 0)
              fail("constructors cannot be decorated");
            if (async || generator || methodKind !== "method")
              fail(
                "class constructor cannot be async, a generator or an accessor",
                "SYNTAX_ERROR",
                key,
              );
            if (constructorSeen)
              fail("duplicate class constructor", "SYNTAX_ERROR", key);
            constructorSeen = true;
          }
          if (accessor) fail("auto-accessors cannot be methods");
          const previousSuper = superProperty;
          const previousSuperCall = superCall;
          const previousNewTarget = newTargetAllowed;
          const previousStaticAwait = staticAwait;
          const previousAwaitContext = awaitContext,
            previousYieldContext = yieldContext,
            previousYieldAllowed = yieldAllowed;
          staticAwait = false;
          newTargetAllowed = true;
          superProperty = true;
          superCall =
            !isStatic && property === "constructor" && heritage !== undefined;
          awaitContext = async ? 1 : 0;
          yieldContext = generator;
          yieldAllowed = false;
          const parameterProperties: Token[] = [];
          const params = parameters(
            false,
            true,
            true,
            !isStatic && property === "constructor"
              ? parameterProperties
              : undefined,
          );
          if (ambient) {
            if (eat(":")) type();
            semi();
            awaitContext = previousAwaitContext;
            yieldContext = previousYieldContext;
            yieldAllowed = previousYieldAllowed;
            superProperty = previousSuper;
            superCall = previousSuperCall;
            newTargetAllowed = previousNewTarget;
            staticAwait = previousStaticAwait;
            continue;
          }
          if (
            (methodKind === "get" && params.length !== 0) ||
            (methodKind === "set" &&
              (params.length !== 1 || params.some((p) => p.rest)))
          )
            fail("invalid class accessor parameter count", "SYNTAX_ERROR", key);
          if (
            params.some(
              (p) => p.kind !== "pattern-parameter" && p.name === "this",
            )
          )
            fail(
              "class method receiver annotations are not implemented",
              "UNSUPPORTED_SYNTAX",
            );
          const returnType = eat(":") ? type() : undefined;
          const previousLoops = loops,
            previousLabels = labels,
            previousSwitches = switches;
          loops = 0;
          switches = 0;
          labels = [];
          functions++;
          let body: BlockStatement;
          yieldAllowed = generator;
          awaitContext = async ? 2 : 0;
          try {
            body = requiredBlock();
            functionDirectives(params, body);
            if (parameterProperties.length !== 0)
              body = withParameterProperties(
                body,
                parameterProperties,
                heritage !== undefined,
              );
          } finally {
            awaitContext = previousAwaitContext;
            yieldContext = previousYieldContext;
            yieldAllowed = previousYieldAllowed;
            functions--;
            superProperty = previousSuper;
            superCall = previousSuperCall;
            newTargetAllowed = previousNewTarget;
            staticAwait = previousStaticAwait;
            loops = previousLoops;
            switches = previousSwitches;
            labels = previousLabels;
          }
          elements.push({
            kind: methodKind,
            sourceStart,
            decorators: elementDecorators,
            generator,
            async,
            key,
            ...(privateName ? { private: true } : {}),
            computed,
            static: isStatic,
            parameters: params,
            returnType,
            body,
            start,
            end: end(),
          });
        } else {
          if (async || generator || methodKind !== "method")
            fail(
              "class accessor requires a parameter list",
              "SYNTAX_ERROR",
              key,
            );
          if (property === "constructor")
            fail(
              "class field cannot be named constructor",
              "SYNTAX_ERROR",
              key,
            );
          if (language !== "javascript" && (at("?") || at("!"))) take();
          const annotation = eat(":") ? type() : undefined;
          const previousSuper = superProperty;
          const previousSuperCall = superCall;
          const previousNewTarget = newTargetAllowed;
          const previousStaticAwait = staticAwait;
          const previousAwaitContext = awaitContext,
            previousYieldContext = yieldContext,
            previousYieldAllowed = yieldAllowed;
          staticAwait = false;
          newTargetAllowed = true;
          superProperty = true;
          superCall = false;
          awaitContext = 0;
          yieldContext = false;
          yieldAllowed = false;
          const initializer = eat("=") ? expression(1) : undefined;
          awaitContext = previousAwaitContext;
          yieldContext = previousYieldContext;
          yieldAllowed = previousYieldAllowed;
          superProperty = previousSuper;
          superCall = previousSuperCall;
          newTargetAllowed = previousNewTarget;
          staticAwait = previousStaticAwait;
          semi();
          if (ambient) continue;
          elements.push({
            kind: "field",
            decorators: elementDecorators,
            accessor,
            key,
            ...(privateName ? { private: true } : {}),
            computed,
            static: isStatic,
            type: annotation,
            initializer,
            start,
            end: end(),
          });
        }
      }
      expect("}");
      return {
        name: className,
        sourceStart,
        decorators: classDecorators,
        typeParameters: generics,
        heritage,
        elements,
        start: begin,
        end: end(),
      };
    } finally {
      strict = previousStrict;
    }
  }
  /** A constructor body with parameter properties assigned at its start
   * (after the top-level `super(...)` call in derived classes), as
   * TypeScript emits them. */
  function withParameterProperties(
    body: BlockStatement,
    properties: readonly Token[],
    derived: boolean,
  ): BlockStatement {
    const assignments: Statement[] = properties.map((token): Statement => ({
      kind: "expression",
      expression: {
        kind: "assignment",
        target: {
          kind: "member",
          object: { kind: "this", start: token.start, end: token.end },
          property: token.value,
          start: token.start,
          end: token.end,
        },
        value: {
          kind: "identifier",
          name: token.value,
          start: token.start,
          end: token.end,
        },
        start: token.start,
        end: token.end,
      },
      start: token.start,
      end: token.end,
    }));
    let insertion = 0;
    if (derived)
      for (let i = 0; i < body.statements.length; i++) {
        const statement = body.statements[i];
        if (statement === undefined || statement.kind !== "expression")
          continue;
        const call = statement.expression;
        if (call.kind === "call" && call.callee.kind === "super") {
          insertion = i + 1;
          break;
        }
      }
    const statements: Statement[] = [];
    for (let i = 0; i <= body.statements.length; i++) {
      if (i === insertion)
        for (const assignment of assignments)
          if (assignment !== undefined) statements.push(assignment);
      const statement = body.statements[i];
      if (statement !== undefined) statements.push(statement);
    }
    return { ...body, statements };
  }
  /** ASCII identifier names (enum members bindable as constants). */
  function identifierName(text: string): boolean {
    if (text.length === 0) return false;
    for (let i = 0; i < text.length; i++) {
      const unit = text.charCodeAt(i);
      const letter =
        (unit >= 65 && unit <= 90) ||
        (unit >= 97 && unit <= 122) ||
        unit === 36 ||
        unit === 95;
      if (!letter && !(i > 0 && unit >= 48 && unit <= 57)) return false;
    }
    return true;
  }
  /** Ambient (`declare`) declarations describe types only: skip them,
   * including their bodies, leaving no runtime statement. */
  function ambientDeclaration(begin: number): Statement {
    typescriptSyntax();
    let depth = 0;
    for (;;) {
      const token = current();
      if (token.kind === "eof") fail("unterminated ambient declaration");
      if (depth === 0 && token.value === ";") {
        take();
        break;
      }
      if (
        depth === 0 &&
        token.lineBreakBefore &&
        token.start > begin &&
        token.value !== "{" &&
        previousValue() !== "," &&
        previousValue() !== ":" &&
        previousValue() !== "=>" &&
        previousValue() !== "|" &&
        previousValue() !== "&" &&
        previousValue() !== "("
      )
        break;
      take();
      if (token.value === "{" || token.value === "(" || token.value === "[")
        depth++;
      else if (
        token.value === "}" ||
        token.value === ")" ||
        token.value === "]"
      ) {
        depth--;
        if (depth === 0 && token.value === "}") {
          eat(";");
          break;
        }
      }
    }
    return { kind: "empty", start: begin, end: end() };
  }
  /** `enum E { A, B = 2, C = "c" }` (and `const enum`) as the object
   * TypeScript emits: `const E = (() => { const E = {}; const A = (E["A"] =
   * 0); E[A] = "A"; ...; return E; })()`. Members may refer to earlier
   * members by name; numeric members get reverse mappings. */
  function enumDeclaration(begin: number, exported: boolean): Statement {
    typescriptSyntax();
    eat("const");
    expect("enum");
    const id = bindingName();
    const span = { start: id.start, end: id.end };
    const enumName = id.value;
    const objectRef = (): Expression => ({
      kind: "identifier",
      name: enumName,
      ...span,
    });
    const body: Statement[] = [
      {
        kind: "variable",
        mode: "const",
        exported: false,
        declarations: [
          {
            name: enumName,
            type: undefined,
            initializer: { kind: "object", properties: [], ...span },
            ...span,
          },
        ],
        ...span,
      },
    ];
    expect("{");
    let previous: Expression | undefined;
    while (!at("}")) {
      const token = current();
      let memberName: string;
      if (token.kind === "string") {
        take();
        memberName = token.value;
      } else memberName = name(false).value;
      const memberSpan = { start: token.start, end: end() };
      const key: Expression = {
        kind: "string",
        value: memberName,
        ...memberSpan,
      };
      let value: Expression;
      if (eat("=")) value = expression(1);
      else if (previous === undefined)
        value = { kind: "number", value: 0, raw: "0", ...memberSpan };
      else
        value = {
          kind: "binary",
          operator: "+",
          left: previous,
          right: { kind: "number", value: 1, raw: "1", ...memberSpan },
          ...memberSpan,
        };
      const textual =
        value.kind === "string" || value.kind === "template-expression";
      const assignment: Expression = {
        kind: "assignment",
        target: {
          kind: "index",
          object: objectRef(),
          index: key,
          ...memberSpan,
        },
        value,
        ...memberSpan,
      };
      const bindable =
        identifierName(memberName) &&
        memberName !== enumName &&
        !reservedName(memberName);
      let reference: Expression;
      if (bindable) {
        body.push({
          kind: "variable",
          mode: "const",
          exported: false,
          declarations: [
            {
              name: memberName,
              type: undefined,
              initializer: assignment,
              ...memberSpan,
            },
          ],
          ...memberSpan,
        });
        reference = { kind: "identifier", name: memberName, ...memberSpan };
      } else {
        body.push({
          kind: "expression",
          expression: assignment,
          ...memberSpan,
        });
        reference = {
          kind: "index",
          object: objectRef(),
          index: key,
          ...memberSpan,
        };
      }
      if (!textual)
        body.push({
          kind: "expression",
          expression: {
            kind: "assignment",
            target: {
              kind: "index",
              object: objectRef(),
              index: reference,
              ...memberSpan,
            },
            value: { kind: "string", value: memberName, ...memberSpan },
            ...memberSpan,
          },
          ...memberSpan,
        });
      previous = reference;
      if (!eat(",")) break;
    }
    expect("}");
    body.push({ kind: "return", expression: objectRef(), ...span });
    const statements: BlockStatement = {
      kind: "block",
      statements: body,
      start: begin,
      end: end(),
    };
    return {
      kind: "variable",
      mode: "const",
      exported,
      declarations: [
        {
          name: enumName,
          type: undefined,
          initializer: {
            kind: "call",
            callee: {
              kind: "group",
              expression: {
                kind: "arrow",
                parameters: [],
                returnType: undefined,
                body: statements,
                start: begin,
                end: end(),
              },
              start: begin,
              end: end(),
            },
            arguments: [],
            start: begin,
            end: end(),
          },
          ...span,
        },
      ],
      start: begin,
      end: end(),
    };
  }
  function asyncMethodPrefix(): boolean {
    if (!at("async") || current(1).lineBreakBefore) return false;
    const next = current(1);
    if (
      next.kind !== "identifier" &&
      next.kind !== "private-identifier" &&
      next.kind !== "string" &&
      next.kind !== "number" &&
      next.kind !== "bigint" &&
      !at("[", 1) &&
      !at("*", 1)
    )
      return false;
    take();
    return true;
  }
  function functionExpression(
    begin: number,
    method: boolean = false,
    generatorMethod: boolean = false,
    async: boolean = false,
  ): Expression {
    const generator = generatorMethod || eat("*");
    const previousAwaitContext = awaitContext,
      previousYieldContext = yieldContext,
      previousYieldAllowed = yieldAllowed;
    awaitContext = async ? 1 : 0;
    yieldContext = generator;
    yieldAllowed = false;
    const previousStaticAwait = staticAwait;
    staticAwait = false;
    const functionName =
      current().kind === "identifier" ? bindingName() : undefined;
    const previousStrict = strict;
    const previousSuper = superProperty;
    const previousSuperCall = superCall;
    const previousNewTarget = newTargetAllowed;
    newTargetAllowed = true;
    superProperty = method;
    superCall = false;
    strict = functionStrict();
    if (
      functionName !== undefined &&
      (reservedName(functionName.value) ||
        restrictedIdentifier(functionName.value))
    )
      fail("invalid strict function name", "SYNTAX_ERROR", functionName);
    const params = parameters(false, true, method);
    const returnType = eat(":") ? type() : undefined;
    const previousLoops = loops,
      previousLabels = labels,
      previousSwitches = switches;
    loops = 0;
    switches = 0;
    labels = [];
    functions++;
    yieldAllowed = generator;
    awaitContext = async ? 2 : 0;
    try {
      const body = requiredBlock();
      functionDirectives(params, body);
      return {
        kind: "function-expression",
        generator,
        async,
        ...(functionName === undefined ? {} : { name: functionName.value }),
        strict,
        ...functionParameters(params),
        returnType,
        body,
        start: begin,
        end: end(),
      };
    } finally {
      awaitContext = previousAwaitContext;
      yieldContext = previousYieldContext;
      yieldAllowed = previousYieldAllowed;
      strict = previousStrict;
      superProperty = previousSuper;
      superCall = previousSuperCall;
      newTargetAllowed = previousNewTarget;
      staticAwait = previousStaticAwait;
      functions--;
      loops = previousLoops;
      switches = previousSwitches;
      labels = previousLabels;
    }
  }
  function arrow(
    conditionalConsequent: boolean,
    allowIn: boolean,
    async: boolean = false,
  ): Expression {
    const begin = current().start;
    if (async) expect("async");
    const previousStrict = strict;
    strict = functionStrict(true);
    const previousAwaitContext = awaitContext,
      previousYieldContext = yieldContext,
      previousYieldAllowed = yieldAllowed;
    yieldAllowed = false;
    if (async || awaitContext !== 0) awaitContext = 1;
    let params: Parameter[];
    try {
      if (at("(")) params = parameters(false, false);
      else {
        const p = bindingName();
        params = [
          { name: p.value, type: undefined, start: p.start, end: p.end },
        ];
      }
    } finally {
      yieldAllowed = previousYieldAllowed;
      awaitContext = previousAwaitContext;
    }
    const returnType = eat(":") ? type() : undefined;
    if (current().lineBreakBefore) fail("line break before arrow");
    expect("=>");
    const previousStaticAwait = staticAwait;
    staticAwait = false;
    const previousLoops = loops,
      previousLabels = labels,
      previousSwitches = switches;
    loops = 0;
    switches = 0;
    labels = [];
    functions++;
    awaitContext = async ? 2 : 0;
    yieldContext = false;
    yieldAllowed = false;
    try {
      if (at("{")) {
        const body = statement(false);
        if (body.kind !== "block") throw "arrow block invariant";
        functionDirectives(params, body);
        return {
          kind: "arrow",
          async,
          strict,
          parameters: params,
          returnType,
          body,
          start: begin,
          end: end(),
        };
      }
      const body = expression(1, conditionalConsequent, true, allowIn);
      return {
        kind: "arrow",
        async,
        strict,
        parameters: params,
        returnType,
        body,
        start: begin,
        end: end(),
      };
    } finally {
      awaitContext = previousAwaitContext;
      yieldContext = previousYieldContext;
      yieldAllowed = previousYieldAllowed;
      strict = previousStrict;
      staticAwait = previousStaticAwait;
      functions--;
      loops = previousLoops;
      switches = previousSwitches;
      labels = previousLabels;
    }
  }
  function annotatedArrow(
    conditionalConsequent: boolean,
    allowIn: boolean,
    async: boolean,
  ): Expression | undefined {
    const checkpoint = parserCheckpoint();
    let parsed: Expression | undefined;
    try {
      parsed = arrow(conditionalConsequent, allowIn, async);
      if (conditionalConsequent && !at(":")) parsed = undefined;
    } catch (error) {
      if (error !== abort || failure?.code === "LIMIT") throw error;
    }
    if (parsed !== undefined) {
      checkpoint.release();
      return parsed;
    }
    checkpoint.restore();
    return undefined;
  }
  function assignable(node: Expression, allowCall: boolean = true): boolean {
    while (node.kind === "group") node = node.expression;
    if (isOptionalChain(node)) return false;
    return (
      (node.kind === "identifier" && !restrictedIdentifier(node.name)) ||
      (allowCall && !strict && node.kind === "call") ||
      node.kind === "member" ||
      node.kind === "index"
    );
  }
  /** Destructuring leaves need AssignmentTargetType simple (13.15.5.1); only a
   * top-level plain assignment admits Annex B web-compat call targets. */
  function assignmentTarget(
    node: Expression,
    nested: boolean = false,
  ): boolean {
    if (node.kind === "array") {
      enter();
      try {
        for (let i = 0; i < node.elements.length; i++) {
          const element = node.elements[i];
          if (element === undefined) throw "assignment element invariant";
          if (element.kind === "elision") continue;
          if (element.kind === "spread") {
            if (
              i !== node.elements.length - 1 ||
              restTrailingComma.has(node) ||
              !assignmentTarget(element.value, true)
            )
              return false;
          } else if (
            !assignmentTarget(
              element.kind === "assignment" ? element.target : element,
              true,
            )
          )
            return false;
        }
        assignmentPatterns.add(node);
        return true;
      } finally {
        depth--;
      }
    }
    if (node.kind !== "object") return assignable(node, !nested);
    enter();
    try {
      for (let i = 0; i < node.properties.length; i++) {
        const property = node.properties[i];
        if (property === undefined) throw "assignment property invariant";
        if (property.kind === "spread") {
          if (
            i !== node.properties.length - 1 ||
            restTrailingComma.has(node) ||
            !assignable(property.value, false)
          )
            return false;
        } else {
          if (property.method || property.accessor !== undefined) return false;
          const value = property.value;
          if (
            !assignmentTarget(
              value.kind === "assignment" ? value.target : value,
              true,
            )
          )
            return false;
        }
      }
      assignmentPatterns.add(node);
      return true;
    } finally {
      depth--;
    }
  }
  function restoreSplits(count: number): void {
    while (splits.length > count) {
      const split = splits.pop();
      if (split === undefined) throw "parser split invariant";
      tokens.splice(split.index - tokenBase, 2, split.token);
    }
  }
  // Recognize actual types, not merely a later closing angle in an expression.
  // Type parsing may split shift tokens; speculative reads must undo those edits.
  function typeArgumentCall(): boolean {
    if (language === "javascript" || !at("<")) return false;
    const savedIndex = index,
      savedFailure = failure,
      savedSplits = splits.length,
      savedCoverErrors = coverErrors.length;
    pushMark(savedIndex);
    try {
      take();
      do {
        type();
      } while (eat(",") && !at(">"));
      typeClose();
      return (
        at("(") ||
        (current().lineBreakBefore &&
          !["<", ">", "+", "-"].includes(current().value))
      );
    } catch (error) {
      if (error !== abort || failure?.code === "LIMIT") throw error;
      return false;
    } finally {
      popMark(savedIndex);
      index = savedIndex;
      restoreSplits(savedSplits);
      coverErrors.length = savedCoverErrors;
      if (failure?.code !== "LIMIT") failure = savedFailure;
    }
  }
  function argumentsList(): Expression[] {
    expect("(");
    const args: Expression[] = [];
    while (!at(")")) {
      const start = current().start;
      if (eat("...")) {
        const value = expression(1);
        args.push({ kind: "spread", value, start, end: value.end });
      } else args.push(expression(1));
      if (!eat(",")) break;
    }
    expect(")");
    return args;
  }
  function templateLiteral(
    first: Token,
    tagged: boolean = false,
  ): TemplateExpression {
    function cooked(token: Token): string | undefined {
      if (token.invalidEscape !== true) return token.value;
      if (!tagged) fail("invalid template escape", "SYNTAX_ERROR", token);
      return undefined;
    }
    function raw(token: Token): string {
      const suffix =
        token.kind === "template-head" || token.kind === "template-middle"
          ? 2
          : 1;
      return source.text
        .slice(token.start + 1, token.end - suffix)
        .split("\r\n")
        .join("\n")
        .split("\r")
        .join("\n");
    }
    const parts = [cooked(first)],
      rawParts = [raw(first)];
    const substitutions: Expression[] = [];
    if (first.kind === "template-head") {
      for (;;) {
        substitutions.push(expression());
        const segment = take();
        if (
          segment.kind !== "template-middle" &&
          segment.kind !== "template-tail"
        )
          fail("expected template continuation", "SYNTAX_ERROR", segment);
        parts.push(cooked(segment));
        rawParts.push(raw(segment));
        if (segment.kind === "template-tail") break;
      }
    }
    return {
      kind: "template-expression",
      parts,
      raw: rawParts,
      substitutions,
      start: first.start,
      end: end(),
    };
  }
  function expression(
    min: number = 0,
    conditionalConsequent: boolean = false,
    allowCalls: boolean = true,
    allowIn: boolean = true,
  ): Expression {
    if (min === 0) {
      let left = expression(1, conditionalConsequent, allowCalls, allowIn);
      while (eat(",")) {
        const right = expression(1, conditionalConsequent, allowCalls, allowIn);
        left = {
          kind: "binary",
          operator: ",",
          left,
          right,
          start: left.start,
          end: right.end,
        };
      }
      return left;
    }
    enter();
    try {
      if (
        current().kind === "identifier" &&
        current().value === "await" &&
        awaitContext !== 0
      ) {
        if (current().escaped === true || awaitContext === 1)
          fail(
            "await is not allowed in async parameters or escaped identifiers",
            "SYNTAX_ERROR",
          );
      }
      if (at("yield") && yieldContext) {
        const token = take();
        if (!yieldAllowed)
          fail(
            "yield expression is not allowed in parameters",
            "SYNTAX_ERROR",
            token,
          );
        if (min > 1)
          fail(
            "yield expression requires assignment precedence",
            "SYNTAX_ERROR",
            token,
          );
        let delegate = false;
        let operand: Expression | undefined;
        if (!current().lineBreakBefore) {
          delegate = eat("*");
          if (
            current().kind === "punctuation" &&
            assignmentOperator(current().value)
          )
            fail(
              "yield requires an assignment-expression operand",
              "SYNTAX_ERROR",
            );
          if (
            delegate ||
            (current().kind !== "eof" &&
              current().kind !== "template-middle" &&
              current().kind !== "template-tail" &&
              ![";", "}", ")", "]", ",", ":"].some((punctuation) =>
                at(punctuation),
              ))
          )
            operand = expression(1, conditionalConsequent, true, allowIn);
        }
        return {
          kind: "yield",
          expression: operand,
          delegate,
          start: token.start,
          end: end(),
        };
      }
      if (min <= 2) {
        if (at("async") && !current(1).lineBreakBefore) {
          if (current(1).kind === "identifier" && at("=>", 2))
            return arrow(conditionalConsequent, allowIn, true);
          if (at("(", 1)) {
            const after = afterParameters(1);
            if (at("=>", after))
              return arrow(conditionalConsequent, allowIn, true);
            if (after > 0 && at(":", after)) {
              const parsed = annotatedArrow(
                conditionalConsequent,
                allowIn,
                true,
              );
              if (parsed !== undefined) return parsed;
            }
          }
        }
        if (current().kind === "identifier" && at("=>", 1))
          return arrow(conditionalConsequent, allowIn);
        if (at("(")) {
          const after = afterParameters();
          if (at("=>", after)) return arrow(conditionalConsequent, allowIn);
          if (after > 0 && at(":", after)) {
            // A colon can start an arrow return annotation or end a conditional arm.
            // Commit only a complete arrow, retaining the conditional's own colon.
            const parsed = annotatedArrow(
              conditionalConsequent,
              allowIn,
              false,
            );
            if (parsed !== undefined) return parsed;
          }
        }
      }
      regexpToken();
      const token = take();
      if (token.kind === "template" && token.invalidEscape === true)
        fail("invalid template escape", "SYNTAX_ERROR", token);
      if (staticAwait && token.kind === "identifier" && token.value === "await")
        fail("await is reserved in class static blocks", "SYNTAX_ERROR", token);
      if (
        token.kind === "identifier" &&
        token.escaped === true &&
        reservedName(token.value)
      )
        fail(
          "escaped keyword is not an identifier reference",
          "SYNTAX_ERROR",
          token,
        );
      let left: Expression;
      if (
        token.kind === "identifier" &&
        token.value === "await" &&
        awaitContext === 2
      ) {
        if (
          min > 14 ||
          current().kind === "eof" ||
          [";", "}", ")", "]", ",", ":"].some((punctuation) => at(punctuation))
        )
          fail(
            "await requires a unary-expression operand",
            "SYNTAX_ERROR",
            token,
          );
        const operand = expression(14);
        left = {
          kind: "await",
          expression: operand,
          start: token.start,
          end: operand.end,
        };
      } else if (token.kind === "identifier" && token.value === "import") {
        const qualifier = eat(".") ? take() : undefined;
        if (qualifier !== undefined && qualifier.value === "meta") {
          const meta = qualifier;
          if (goal !== "module" || meta.escaped === true)
            fail(
              "import.meta requires module source and literal meta spelling",
              "SYNTAX_ERROR",
              token,
            );
          left = { kind: "import-meta", start: token.start, end: meta.end };
        } else {
          if (
            qualifier !== undefined &&
            (qualifier.escaped === true ||
              (qualifier.value !== "defer" && qualifier.value !== "source"))
          )
            fail("invalid import phase", "SYNTAX_ERROR", qualifier);
          const phase =
            qualifier === undefined
              ? "evaluation"
              : qualifier.value === "defer"
                ? "defer"
                : "source";
          if (!allowCalls)
            fail(
              "import call cannot be a direct constructor target",
              "SYNTAX_ERROR",
              token,
            );
          expect("(");
          if (at(")") || at("..."))
            fail("import requires a non-spread specifier", "SYNTAX_ERROR");
          const specifier = expression(1);
          let options: Expression | undefined = undefined;
          if (eat(",") && !at(")")) {
            if (at("..."))
              fail("import options cannot be spread", "SYNTAX_ERROR");
            options = expression(1);
            eat(",");
          }
          expect(")");
          left = {
            kind: "import-call",
            phase,
            specifier,
            options,
            start: token.start,
            end: end(),
          };
        }
      } else if (token.kind === "template-head") {
        left = templateLiteral(token);
      } else if (token.kind === "private-identifier") {
        if (min > 9 || !allowIn || !eat("in"))
          fail(
            "private name requires a brand-check expression",
            "SYNTAX_ERROR",
            token,
          );
        const object = expression(10, false, true, allowIn);
        left = {
          kind: "private-in",
          name: token.value,
          object,
          start: token.start,
          end: object.end,
        };
      } else if (token.kind === "regexp") left = regexpLiteral(token);
      else if (token.kind === "bigint")
        left = {
          kind: "bigint",
          raw: token.value,
          value: bigintLiteralValue(token.value),
          start: token.start,
          end: token.end,
        };
      else if (token.kind === "number")
        left = {
          kind: "number",
          raw: token.value,
          value: Number(token.value.split("_").join("")),
          start: token.start,
          end: token.end,
        };
      else if (token.kind === "string" || token.kind === "template")
        left = {
          kind: "string",
          ...(token.kind === "template" ? { template: true } : {}),
          value: token.value,
          start: token.start,
          end: token.end,
        };
      else if (token.value === "true" || token.value === "false")
        left = {
          kind: "boolean",
          value: token.value === "true",
          start: token.start,
          end: token.end,
        };
      else if (token.value === "null")
        left = { kind: "null", start: token.start, end: token.end };
      else if (token.value === "this")
        left = { kind: "this", start: token.start, end: token.end };
      else if (token.value === "super") {
        if (at("(")) {
          if (!superCall || !allowCalls)
            fail(
              "super call requires a derived constructor context",
              "SYNTAX_ERROR",
              token,
            );
        } else if (!superProperty || (!at(".") && !at("[")))
          fail(
            "super property requires a method context and property access",
            "SYNTAX_ERROR",
            token,
          );
        left = { kind: "super", start: token.start, end: token.end };
      } else if (token.value === "@") {
        const annotations = decorators(true);
        expect("class");
        const definition = classDefinition(token.start, false, annotations);
        left = {
          kind: "class-expression",
          definition,
          start: token.start,
          end: end(),
        };
      } else if (token.value === "class") {
        const definition = classDefinition(token.start, false);
        left = {
          kind: "class-expression",
          definition,
          start: token.start,
          end: end(),
        };
      } else if (
        token.value === "async" &&
        token.escaped !== true &&
        at("function") &&
        !current().lineBreakBefore
      ) {
        take();
        left = functionExpression(token.start, false, false, true);
      } else if (token.value === "function")
        left = functionExpression(token.start);
      else if (token.value === "new" && at(".")) {
        take();
        const target = take();
        if (
          !newTargetAllowed ||
          target.value !== "target" ||
          target.escaped === true
        )
          fail(
            "new.target requires a function context and literal target spelling",
            "SYNTAX_ERROR",
            token,
          );
        left = { kind: "new-target", start: token.start, end: target.end };
      } else if (token.value === "new") {
        const callee = expression(15, false, false),
          typeArguments: TypeNode[] = [];
        if (callee.kind === "unary" || callee.kind === "update")
          fail("invalid constructor expression");
        if (language === "typescript" && eat("<")) {
          do {
            typeArguments.push(type());
          } while (eat(",") && !at(">"));
          typeClose();
        }
        const args = at("(") ? argumentsList() : [];
        left = {
          kind: "new",
          callee,
          typeArguments,
          arguments: args,
          start: token.start,
          end: end(),
        };
      } else if (token.value === "++" || token.value === "--") {
        const operator = token.value;
        const target = expression(14);
        if (!assignable(target)) fail("invalid update target");
        left = {
          kind: "update",
          target,
          operator,
          prefix: true,
          start: token.start,
          end: target.end,
        };
      } else if (
        ["+", "-", "!", "~", "typeof", "void", "delete"].includes(token.value)
      ) {
        const operand = expression(14);
        if (token.value === "delete") {
          let target = operand;
          while (target.kind === "group") target = target.expression;
          if (target.kind === "member" && target.private)
            fail("cannot delete a private element", "SYNTAX_ERROR", token);
          if (strict && target.kind === "identifier")
            fail(
              "cannot delete a binding in strict code",
              "SYNTAX_ERROR",
              token,
            );
        }
        left = {
          kind: "unary",
          operator: token.value,
          operand,
          start: token.start,
          end: operand.end,
        };
      } else if (token.value === "[") {
        const elements: Expression[] = [];
        let trailingRest = false;
        while (!at("]")) {
          const start = current().start;
          if (eat(",")) {
            elements.push({ kind: "elision", start, end: end() });
            continue;
          }
          if (eat("...")) {
            const value = expression(1);
            elements.push({ kind: "spread", value, start, end: value.end });
          } else elements.push(expression(1));
          if (!eat(",")) break;
          if (at("]") && elements[elements.length - 1]?.kind === "spread")
            trailingRest = true;
        }
        expect("]");
        left = { kind: "array", elements, start: token.start, end: end() };
        if (trailingRest) restTrailingComma.add(left);
      } else if (token.value === "{") {
        const properties: ObjectProperty[] = [];
        let prototypeSeen = false;
        let coverToken: Token | undefined;
        let coverMessage = "invalid initialized shorthand property";
        let trailingRest = false;
        while (!at("}")) {
          if (at("...")) {
            const start = take().start,
              value = expression(1);
            properties.push({ kind: "spread", value, start, end: value.end });
            if (!eat(",")) break;
            if (at("}")) trailingRest = true;
            continue;
          }
          const methodStart = current().start;
          const async = asyncMethodPrefix();
          const generator = eat("*");
          let accessor: "get" | "set" | undefined;
          if (
            !async &&
            !generator &&
            (at("get") || at("set")) &&
            !["(", ":", ",", "}", "="].includes(current(1).value)
          ) {
            accessor = at("get") ? "get" : "set";
            take();
          }
          const key = propertyName(true);
          const method = at("(");
          if ((async || generator || accessor !== undefined) && !method)
            fail(
              "object accessor requires a parameter list",
              "SYNTAX_ERROR",
              key,
            );
          const shorthand = !method && !eat(":");
          const prototypeSetter =
            !method &&
            !shorthand &&
            key.computed !== true &&
            key.value === "__proto__";
          if (prototypeSetter) {
            if (prototypeSeen) {
              coverToken = key;
              coverMessage = "duplicate prototype setter";
            }
            prototypeSeen = true;
          }
          if (
            shorthand &&
            (key.kind !== "identifier" || reservedName(key.value))
          )
            fail("invalid shorthand property", "SYNTAX_ERROR", key);
          let value: Expression = method
            ? functionExpression(methodStart, true, generator, async)
            : shorthand
              ? {
                  kind: "identifier",
                  name: key.value,
                  start: key.start,
                  end: key.end,
                }
              : expression(1);
          if (shorthand && eat("=")) {
            coverToken = key;
            const initializer = expression(1);
            value = {
              kind: "assignment",
              target: value,
              value: initializer,
              start: value.start,
              end: initializer.end,
            };
          }
          if (
            accessor !== undefined &&
            value.kind === "function-expression" &&
            ((accessor === "get" && value.parameters.length !== 0) ||
              (accessor === "set" &&
                (value.parameters.length !== 1 ||
                  value.parameters.some((p) => p.rest))))
          )
            fail(
              "invalid object accessor parameter count",
              "SYNTAX_ERROR",
              key,
            );
          properties.push({
            name: key.value,
            ...(prototypeSetter ? { prototypeSetter: true } : {}),
            ...(key.keyExpression === undefined
              ? {}
              : { keyExpression: key.keyExpression }),
            ...(accessor === undefined ? {} : { accessor }),
            ...(key.computed ? { computed: true } : {}),
            ...(method ? { method: true } : {}),
            shorthand,
            value,
            start: key.start,
            end: value.end,
          });
          if (!eat(",")) break;
        }
        expect("}");
        left = { kind: "object", properties, start: token.start, end: end() };
        if (coverToken !== undefined)
          coverErrors.push({
            node: left,
            token: coverToken,
            message: coverMessage,
          });
        if (trailingRest) restTrailingComma.add(left);
      } else if (token.value === "(") {
        const inner = expression();
        expect(")");
        left = {
          kind: "group",
          expression: inner,
          start: token.start,
          end: end(),
        };
      } else if (token.kind === "identifier" && !reservedName(token.value))
        left = {
          kind: "identifier",
          name: token.value,
          start: token.start,
          end: token.end,
        };
      else if (
        token.kind === "punctuation" &&
        (token.value === "..." || token.value === "=>")
      )
        fail("invalid arrow or spread expression", "SYNTAX_ERROR", token);
      else
        fail(
          "expected expression",
          language === "javascript" ? "SYNTAX_ERROR" : "UNSUPPORTED_SYNTAX",
          token,
        );
      for (;;) {
        if (
          current().kind === "template" ||
          current().kind === "template-head"
        ) {
          if (isOptionalChain(left))
            fail("optional chains cannot be template tags", "SYNTAX_ERROR");
          const template = templateLiteral(take(), true);
          left = {
            kind: "tagged-template",
            tag: left,
            template,
            start: left.start,
            end: template.end,
          };
          continue;
        }
        if (!allowCalls && typeArgumentCall()) break;
        if (at("satisfies")) {
          if (current().lineBreakBefore) fail("line break before satisfies");
          if (min > 9) break;
          typescriptSyntax();
          take();
          const constraint = type();
          left = {
            kind: "satisfies",
            expression: left,
            type: constraint,
            start: left.start,
            end: constraint.end,
          };
          continue;
        }
        if (at("as") && current().lineBreakBefore && language !== "javascript")
          fail("line break before a type assertion", "UNSUPPORTED_SYNTAX");
        if (at("as") && !current().lineBreakBefore) {
          if (min > 9) break;
          typescriptSyntax();
          take();
          let assertion: TypeNode;
          if (at("const")) {
            const token = take();
            assertion = {
              kind: "named",
              name: "unknown",
              start: token.start,
              end: token.end,
            };
          } else assertion = type();
          left = {
            kind: "satisfies",
            assertion: "as",
            expression: left,
            type: assertion,
            start: left.start,
            end: assertion.end,
          };
          continue;
        }
        if (
          at("!") &&
          !current().lineBreakBefore &&
          language !== "javascript"
        ) {
          const token = take();
          left = {
            kind: "satisfies",
            assertion: "non-null",
            expression: left,
            type: {
              kind: "named",
              name: "unknown",
              start: token.start,
              end: token.end,
            },
            start: left.start,
            end: token.end,
          };
          continue;
        }
        const optional = eat("?.");
        if (optional && !allowCalls)
          fail("optional chain cannot be a constructor target");
        if (at("(") || typeArgumentCall()) {
          if (!allowCalls) break;
          const typeArguments: TypeNode[] = [];
          if (eat("<")) {
            do {
              typeArguments.push(type());
            } while (eat(",") && !at(">"));
            typeClose();
          }
          const args = argumentsList();
          left = {
            kind: "call",
            ...(optional ? { optional: true } : {}),
            typeArguments,
            callee: left,
            arguments: args,
            start: left.start,
            end: end(),
          };
          continue;
        }
        if ((optional && !at("[")) || eat(".")) {
          const privateName = current().kind === "private-identifier";
          const property = privateName ? take() : name(false);
          if (privateName && left.kind === "super")
            fail(
              "super cannot access a private element",
              "SYNTAX_ERROR",
              property,
            );
          left = {
            kind: "member",
            ...(privateName ? { private: true } : {}),
            ...(optional ? { optional: true } : {}),
            object: left,
            property: property.value,
            start: left.start,
            end: end(),
          };
          continue;
        }
        if (eat("[")) {
          const key = expression();
          expect("]");
          left = {
            kind: "index",
            ...(optional ? { optional: true } : {}),
            object: left,
            index: key,
            start: left.start,
            end: end(),
          };
          continue;
        }
        if (min <= 14 && !current().lineBreakBefore && (at("++") || at("--"))) {
          const token = take();
          if (!assignable(left)) fail("invalid update target");
          left = {
            kind: "update",
            target: left,
            operator: token.value === "++" ? "++" : "--",
            prefix: false,
            start: left.start,
            end: token.end,
          };
          continue;
        }
        if (
          min <= 1 &&
          current().kind === "punctuation" &&
          current().value !== "=" &&
          assignmentOperator(current().value)
        ) {
          const operator = take().value;
          const logical =
            operator === "&&=" || operator === "||=" || operator === "??=";
          if (!assignable(left, !logical)) fail("invalid assignment target");
          const value = expression(1, conditionalConsequent, true, allowIn);
          left = {
            kind: "compound",
            target: left,
            operator: operator.slice(0, -1),
            value,
            start: left.start,
            end: value.end,
          };
          continue;
        }
        if (min <= 1 && eat("=")) {
          if (!assignmentTarget(left)) fail("invalid assignment target");
          const value = expression(1, conditionalConsequent, true, allowIn);
          left = {
            kind: "assignment",
            target: left,
            value,
            start: left.start,
            end: value.end,
          };
          continue;
        }
        if (min <= 2 && eat("?")) {
          const consequent = expression(1, true);
          expect(":");
          const alternate = expression(1, conditionalConsequent, true, allowIn);
          left = {
            kind: "conditional",
            test: left,
            consequent,
            alternate,
            start: left.start,
            end: alternate.end,
          };
          continue;
        }
        const op = current(),
          p =
            op.kind === "punctuation" ||
            (op.kind === "identifier" &&
              op.escaped !== true &&
              (op.value === "instanceof" || op.value === "in"))
              ? precedence(op.value)
              : 0;
        if (p === 0 || p < min || (!allowIn && op.value === "in")) break;
        if (
          op.value === "**" &&
          (left.kind === "unary" || left.kind === "await")
        )
          fail(
            "unary exponentiation base requires parentheses",
            "SYNTAX_ERROR",
            left,
          );
        take();
        const right = expression(
          op.value === "**" ? p : p + 1,
          false,
          true,
          allowIn,
        );
        for (const operand of [left, right]) {
          if (
            operand !== undefined &&
            operand.kind === "binary" &&
            ((op.value === "??" &&
              (operand.operator === "||" || operand.operator === "&&")) ||
              ((op.value === "||" || op.value === "&&") &&
                operand.operator === "??"))
          )
            fail("nullish and logical operators require parentheses");
        }
        left = {
          kind: "binary",
          operator: op.value,
          left,
          right,
          start: left.start,
          end: right.end,
        };
      }
      return left;
    } finally {
      depth--;
    }
  }
  function moduleExportName(): Token {
    if (current().kind !== "string") return name(false);
    const token = take();
    for (let i = 0; i < token.value.length; i++) {
      const code = token.value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = token.value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff))
          fail(
            "module export name must be well-formed Unicode",
            "SYNTAX_ERROR",
            token,
          );
      } else if (code >= 0xdc00 && code <= 0xdfff)
        fail(
          "module export name must be well-formed Unicode",
          "SYNTAX_ERROR",
          token,
        );
    }
    return token;
  }
  function importAttributes():
    readonly { readonly key: string; readonly value: string }[] | undefined {
    if (!eat("with")) return undefined;
    expect("{");
    const attributes: { readonly key: string; readonly value: string }[] = [];
    const names = new Set<string>();
    while (!at("}")) {
      const key = current().kind === "string" ? take() : name(false);
      if (names.has(key.value))
        fail("duplicate import attribute", "SYNTAX_ERROR", key);
      names.add(key.value);
      expect(":");
      const value = take();
      if (value.kind !== "string")
        fail("import attribute value must be a string", "SYNTAX_ERROR", value);
      attributes.push({ key: key.value, value: value.value });
      if (!eat(",")) break;
    }
    expect("}");
    return attributes;
  }
  function importDeclaration(): Statement {
    const begin = expect("import").start;
    let typeOnly = false;
    let phase: "defer" | "source" | undefined = undefined;
    const bindings: ImportBinding[] = [];
    if (at("defer") && at("*", 1)) {
      take();
      phase = "defer";
    } else if (
      at("source") &&
      current(1).kind === "identifier" &&
      (!at("from", 1) || at("from", 2))
    ) {
      take();
      phase = "source";
    }
    if (at("type") && !at("from", 1) && !at(",", 1)) {
      take();
      typescriptSyntax();
      typeOnly = true;
    }
    if (current().kind !== "string") {
      if (!at("{") && !at("*")) {
        const local = typeOnly ? name() : bindingName();
        bindings.push({
          imported: "default",
          local: local.value,
          typeOnly,
          namespace: false,
        });
        if (!at("from")) {
          if (phase === "source")
            fail("source imports require a single binding");
          expect(",");
          if (!at("{") && !at("*")) fail("expected named or namespace import");
        }
      }
      if (eat("*")) {
        expect("as");
        bindings.push({
          imported: "*",
          namespace: true,
          local: (typeOnly ? name() : bindingName()).value,
          typeOnly,
        });
      } else if (eat("{")) {
        while (!at("}")) {
          let bindingType = typeOnly;
          if (at("type") && !at("as", 1) && !at(",", 1) && !at("}", 1)) {
            take();
            typescriptSyntax();
            bindingType = true;
          }
          const imported = moduleExportName();
          let local = imported.value;
          if (eat("as")) local = (bindingType ? name() : bindingName()).value;
          else if (
            imported.kind === "string" ||
            reservedName(local) ||
            (!bindingType && restrictedIdentifier(local))
          )
            fail("import binding requires alias");
          bindings.push({
            imported: imported.value,
            namespace: false,
            local,
            typeOnly: bindingType,
          });
          if (!eat(",")) break;
        }
        expect("}");
      }
      expect("from");
    } else if (typeOnly) fail("type-only imports require bindings");
    const specifier = take();
    if (specifier.kind !== "string")
      fail("expected module string", "SYNTAX_ERROR", specifier);
    const attributes = importAttributes();
    semi();
    const declaration: ImportDeclaration = {
      attributes,
      phase,
      start: begin,
      end: end(),
      specifier: specifier.value,
      specifierSpan: { start: specifier.start, end: specifier.end },
      typeOnly,
      bindings,
    };
    imports.push(declaration);
    return { kind: "import", declaration, start: begin, end: end() };
  }
  function exportDeclaration(begin: number): Statement {
    const typeOnly = eat("type"),
      star = eat("*");
    if (typeOnly) typescriptSyntax();
    const bindings: ExportBinding[] = [];
    let quotedLocal: Token | undefined;
    if (star && eat("as"))
      bindings.push({
        local: "*",
        exported: moduleExportName().value,
        typeOnly,
        namespace: true,
      });
    if (!star) {
      expect("{");
      while (!at("}")) {
        let bindingType = typeOnly;
        if (at("type") && !at("as", 1) && !at(",", 1) && !at("}", 1)) {
          take();
          typescriptSyntax();
          bindingType = true;
        }
        const localName = moduleExportName();
        const local = localName.value;
        if (localName.kind === "string") quotedLocal = localName;
        const exported = eat("as") ? moduleExportName().value : local;
        bindings.push({
          local,
          exported,
          typeOnly: bindingType,
          namespace: false,
        });
        if (!eat(",")) break;
      }
      expect("}");
    }
    let source: ImportDeclaration | undefined;
    if (eat("from")) {
      const specifier = take();
      if (specifier.kind !== "string")
        fail("expected module string", "SYNTAX_ERROR", specifier);
      source = {
        attributes: importAttributes(),
        start: begin,
        end: end(),
        specifier: specifier.value,
        specifierSpan: { start: specifier.start, end: specifier.end },
        typeOnly,
        bindings: [],
      };
    } else if (star) fail("star export requires a source module");
    if (source === undefined && quotedLocal !== undefined)
      fail(
        "local export requires an identifier binding",
        "SYNTAX_ERROR",
        quotedLocal,
      );
    semi();
    if (source !== undefined) {
      source = { ...source, end: end() };
      imports.push(source);
    }
    return {
      kind: "export",
      declaration: {
        bindings: star && bindings.length === 0 ? undefined : bindings,
        source,
        typeOnly,
        start: begin,
        end: end(),
      },
      start: begin,
      end: end(),
    };
  }
  function requiredBlock(): BlockStatement {
    if (!at("{")) fail("expected block", "SYNTAX_ERROR");
    const body = statement(false);
    if (body.kind !== "block") throw "block parser invariant";
    return body;
  }
  function variableDeclaration(
    mode: "const" | "let" | "var",
    begin: number,
    exported: boolean,
    forInitializer: boolean,
    first: VariableBinding | undefined = undefined,
  ): Statement {
    const declarations: VariableBinding[] = [];
    let binding = first;
    do {
      if (binding === undefined)
        binding = variableBinding(mode, true, !forInitializer);
      if (
        (mode === "const" ||
          binding.kind === "object-binding" ||
          binding.kind === "array-binding") &&
        binding.initializer === undefined
      )
        fail("declaration requires initializer");
      declarations.push(binding);
      binding = undefined;
    } while (eat(","));
    if (forInitializer) expect(";");
    else semi();
    return {
      kind: "variable",
      mode,
      exported,
      declarations,
      start: begin,
      end: end(),
    };
  }
  function statement(
    top: boolean,
    allowDeclaration: boolean = true,
    forInitializer: boolean = false,
    functionPosition: "none" | "if" | "label" = "none",
    switchClause: boolean = false,
  ): Statement {
    enter();
    try {
      const begin = current().start;
      if (staticAwait && current().value === "await")
        fail("await is reserved in class static blocks");
      if (current().kind === "identifier" && at(":", 1)) {
        const name = take();
        if (reservedName(name.value))
          fail("invalid label", "SYNTAX_ERROR", name);
        expect(":");
        if (labels.some((label) => label.name === name.value))
          fail("duplicate label", "SYNTAX_ERROR", name);
        let ahead = 0;
        while (current(ahead).kind === "identifier" && at(":", ahead + 1))
          ahead += 2;
        const iteration = ["for", "while", "do"].includes(current(ahead).value);
        labels.push({ name: name.value, iteration });
        let body: Statement;
        try {
          body = statement(
            false,
            false,
            false,
            allowDeclaration || functionPosition === "label" ? "label" : "none",
          );
        } finally {
          labels.pop();
        }
        return {
          kind: "label",
          name: name.value,
          body,
          start: begin,
          end: end(),
        };
      }
      let exported = false;
      if (
        at("declare") &&
        [
          "function",
          "class",
          "const",
          "let",
          "var",
          "namespace",
          "module",
          "enum",
          "interface",
          "global",
          "abstract",
          "type",
          "async",
        ].includes(current(1).value)
      ) {
        // TypeScript allows no line break after `declare`; JavaScript would
        // read an expression statement instead.
        if (current(1).lineBreakBefore)
          fail(
            "line break after declare in an ambient declaration",
            "UNSUPPORTED_SYNTAX",
          );
        return ambientDeclaration(begin);
      }
      if (at("import") && !at("(", 1) && !at(".", 1)) {
        if (goal !== "module")
          fail("import declarations require module source", "SYNTAX_ERROR");
        if (!top) fail("imports must be top-level");
        return importDeclaration();
      }
      if (eat("export")) {
        if (goal !== "module")
          fail("export declarations require module source", "SYNTAX_ERROR");
        if (!top) fail("exports must be top-level");
        exported = true;
        if (eat("default")) {
          const start = current().start;
          const asynchronous =
            at("async") && at("function", 1) && !current(1).lineBreakBefore;
          let value: Expression;
          let declaration = true;
          if (language !== "javascript" && at("abstract") && at("class", 1))
            take();
          if (eat("class")) {
            const definition = classDefinition(start, false);
            value = { kind: "class-expression", definition, start, end: end() };
          } else if (asynchronous || at("function")) {
            if (asynchronous) take();
            expect("function");
            value = functionExpression(start, false, false, asynchronous);
          } else {
            declaration = false;
            value = expression(1);
            semi();
          }
          return {
            kind: "export-default",
            declaration,
            value,
            start: begin,
            end: end(),
          };
        }
        if (at("{") || at("*") || (at("type") && (at("{", 1) || at("*", 1))))
          return exportDeclaration(begin);
        if (at("declare") && language !== "javascript")
          return ambientDeclaration(begin);
        if (
          !at("function") &&
          !(at("async") && at("function", 1) && !current(1).lineBreakBefore) &&
          !at("class") &&
          !(language !== "javascript" && at("abstract") && at("class", 1)) &&
          !(language !== "javascript" && at("enum")) &&
          !(language !== "javascript" && at("const") && at("enum", 1)) &&
          !at("const") &&
          !at("let") &&
          !at("var") &&
          !at("interface") &&
          !at("type")
        )
          fail(
            "invalid or unsupported export form",
            language === "javascript" ? "SYNTAX_ERROR" : "UNSUPPORTED_SYNTAX",
          );
      }
      if (
        at("type") &&
        current(1).kind === "identifier" &&
        (at("=", 2) || at("<", 2))
      ) {
        typescriptSyntax();
        if (!allowDeclaration) fail("type declaration requires a block");
        take();
        const id = name(),
          parameters = typeParameters();
        expect("=");
        const annotation = type();
        semi();
        return {
          kind: "type-alias",
          typeParameters: parameters,
          name: id.value,
          exported,
          type: annotation,
          start: begin,
          end: end(),
        };
      }
      if (
        language !== "javascript" &&
        (at("enum") || (at("const") && at("enum", 1)))
      ) {
        if (!allowDeclaration) fail("enum declaration requires a block");
        return enumDeclaration(begin, exported);
      }
      if (
        language !== "javascript" &&
        at("abstract") &&
        at("class", 1) &&
        !current(1).lineBreakBefore
      ) {
        typescriptSyntax();
        take();
      }
      const classDecorators = at("@") ? decorators() : undefined;
      if (classDecorators !== undefined && !at("class"))
        fail("decorators require a class");
      const classStart = current().start;
      if (eat("class")) {
        if (!allowDeclaration)
          fail("class declaration requires a block", "SYNTAX_ERROR");
        const definition = classDefinition(
          exported ? classStart : begin,
          true,
          classDecorators,
        );
        const className = definition.name;
        if (className === undefined) throw "CLASS_NAME_INVARIANT";
        return {
          kind: "class",
          name: className,
          exported,
          definition,
          start: begin,
          end: end(),
        };
      }
      // JavaScript has no interface declarations: outside `export`, a leading
      // `interface` is an identifier (sloppy) or a strict-mode reserved word.
      if ((language !== "javascript" || exported) && eat("interface")) {
        typescriptSyntax();
        if (!allowDeclaration) fail("interface declaration requires a block");
        const id = name(),
          parameters = typeParameters(),
          bases: TypeNode[] = [];
        if (eat("extends"))
          do {
            bases.push(typeReference());
          } while (eat(","));
        expect("{");
        const members = propertiesBody();
        return {
          kind: "interface",
          typeParameters: parameters,
          bases,
          name: id.value,
          exported,
          ...members,
          start: begin,
          end: end(),
        };
      }
      if (eat("{")) {
        const statements: Statement[] = [];
        while (!at("}")) {
          if (current().kind === "eof") fail("unterminated block");
          listStatement(statements, statement(false));
        }
        expect("}");
        return { kind: "block", statements, start: begin, end: end() };
      }
      // In a Statement-only position, sloppy `let` can be an identifier
      // followed by ASI. The ExpressionStatement restriction still forbids let [.
      const awaitUsing =
        at("await") && at("using", 1) && !current(1).lineBreakBefore;
      const usingOffset = awaitUsing ? 1 : 0;
      if (
        at("using", usingOffset) &&
        current(usingOffset + 1).kind === "identifier" &&
        !current(usingOffset + 1).lineBreakBefore
      ) {
        if (
          !allowDeclaration ||
          exported ||
          switchClause ||
          (top && goal !== "module")
        )
          fail(
            "resource declaration requires a block, function or module body",
          );
        if (awaitUsing && awaitContext !== 2)
          fail("await using requires an async function or module body");
        if (awaitUsing) take();
        take();
        const declarations: VariableBinding[] = [];
        do {
          if (current().kind !== "identifier")
            fail("resource binding must be an identifier");
          const binding = variableBinding("const", true, !forInitializer);
          if (binding.initializer === undefined)
            fail("resource declaration requires an initializer");
          declarations.push(binding);
        } while (eat(","));
        if (forInitializer) expect(";");
        else semi();
        return {
          kind: "variable",
          mode: "const",
          disposal: awaitUsing ? "async" : "sync",
          exported: false,
          declarations,
          start: begin,
          end: end(),
        };
      }
      const declarationLet =
        lexicalLet() &&
        (allowDeclaration ||
          strict ||
          at("[", 1) ||
          !current(1).lineBreakBefore);
      if (at("const") || declarationLet || at("var")) {
        if (!allowDeclaration && !at("var"))
          fail("lexical declaration requires a block");
        const modeToken = take(),
          mode: "const" | "let" | "var" =
            modeToken.value === "const"
              ? "const"
              : modeToken.value === "var"
                ? "var"
                : "let";
        return variableDeclaration(mode, begin, exported, forInitializer);
      }
      const functionStart = current().start;
      const asyncFunction =
        at("async") && at("function", 1) && !current(1).lineBreakBefore;
      if (asyncFunction) take();
      if (eat("function")) {
        if (
          !allowDeclaration &&
          !(
            functionPosition !== "none" &&
            !strict &&
            !asyncFunction &&
            !at("*")
          )
        )
          fail("function declaration requires a block");
        const generator = eat("*");
        const id = bindingName();
        const generics = typeParameters();
        if (new Set(generics).size !== generics.length)
          fail("duplicate type parameter");
        const previousStrict = strict;
        const previousSuper = superProperty;
        const previousSuperCall = superCall;
        const previousNewTarget = newTargetAllowed;
        const previousStaticAwait = staticAwait;
        const previousAwaitContext = awaitContext,
          previousYieldContext = yieldContext,
          previousYieldAllowed = yieldAllowed;
        staticAwait = false;
        newTargetAllowed = true;
        superProperty = false;
        superCall = false;
        strict = functionStrict();
        const bodyStrict = strict;
        if (reservedName(id.value) || restrictedIdentifier(id.value))
          fail("invalid strict function name", "SYNTAX_ERROR", id);
        awaitContext = asyncFunction ? 1 : 0;
        yieldContext = generator;
        yieldAllowed = false;
        const params = parameters(false, true, false);
        const returnType = eat(":") ? type() : undefined;
        if (!at("{")) fail("expected function body");
        const previousLoops = loops,
          previousLabels = labels,
          previousSwitches = switches;
        loops = 0;
        switches = 0;
        labels = [];
        functions++;
        let body: Statement;
        yieldAllowed = generator;
        awaitContext = asyncFunction ? 2 : 0;
        try {
          body = statement(false);
        } finally {
          awaitContext = previousAwaitContext;
          yieldContext = previousYieldContext;
          yieldAllowed = previousYieldAllowed;
          strict = previousStrict;
          superProperty = previousSuper;
          superCall = previousSuperCall;
          newTargetAllowed = previousNewTarget;
          staticAwait = previousStaticAwait;
          functions--;
          loops = previousLoops;
          switches = previousSwitches;
          labels = previousLabels;
        }
        if (body.kind !== "block") throw "function block invariant";
        functionDirectives(params, body);
        return {
          kind: "function",
          generator,
          async: asyncFunction,
          strict: bodyStrict,
          typeParameters: generics,
          name: id.value,
          ...functionParameters(params),
          returnType,
          body,
          exported,
          sourceStart: exported ? functionStart : undefined,
          start: begin,
          end: end(),
        };
      }
      if (eat("try")) {
        const body = requiredBlock();
        let handler: CatchClause | undefined;
        if (at("catch")) {
          const begin = take().start;
          let binding: VariableBinding | undefined;
          if (eat("(")) {
            binding = variableBinding(at("{") ? "let" : "var");
            if (binding.initializer !== undefined)
              fail("catch binding cannot have an initializer", "SYNTAX_ERROR");
            expect(")");
          }
          const body = requiredBlock();
          handler = { binding, body, start: begin, end: body.end };
        }
        const finalizer = eat("finally") ? requiredBlock() : undefined;
        if (handler === undefined && finalizer === undefined)
          fail("try requires catch or finally", "SYNTAX_ERROR");
        return {
          kind: "try",
          body,
          handler,
          finalizer,
          start: begin,
          end: end(),
        };
      }
      if (eat("if")) {
        expect("(");
        const test = expression();
        expect(")");
        const consequent = statement(false, false, false, "if"),
          alternate = eat("else")
            ? statement(false, false, false, "if")
            : undefined;
        return {
          kind: "if",
          test,
          consequent,
          alternate,
          start: begin,
          end: end(),
        };
      }
      if (eat("switch")) {
        expect("(");
        const value = expression();
        expect(")");
        expect("{");
        const clauses: SwitchClause[] = [];
        let hasDefault = false;
        switches++;
        try {
          while (!at("}")) {
            const start = current().start;
            let test: Expression | undefined;
            if (eat("case")) test = expression();
            else if (eat("default")) {
              if (hasDefault) fail("duplicate default clause");
              hasDefault = true;
              test = undefined;
            } else fail("expected case or default clause");
            expect(":");
            const statements: Statement[] = [];
            while (
              !at("case") &&
              !at("default") &&
              !at("}") &&
              current().kind !== "eof"
            )
              listStatement(
                statements,
                statement(false, true, false, "none", true),
              );
            clauses.push({ test, statements, start, end: end() });
          }
          expect("}");
        } finally {
          switches--;
        }
        return {
          kind: "switch",
          expression: value,
          clauses,
          start: begin,
          end: end(),
        };
      }
      if (eat("for")) {
        const awaitLoop = eat("await");
        if (awaitLoop && awaitContext !== 2)
          fail("for await requires an async function or module body");
        expect("(");
        let initializer: Statement | undefined;
        let parsedInitializer = false;
        const awaitResource =
          at("await") && at("using", 1) && !current(1).lineBreakBefore;
        const resourceOffset = awaitResource ? 1 : 0;
        const resourceLoop =
          at("using", resourceOffset) &&
          (awaitResource || !at("of", resourceOffset + 1)) &&
          current(resourceOffset + 1).kind === "identifier" &&
          !current(resourceOffset + 1).lineBreakBefore &&
          at("of", resourceOffset + 2);
        if (
          resourceLoop ||
          at("var") ||
          ((at("let") || at("const") || at("var")) &&
            (at("of", 2) || at("in", 2) || at("[", 1) || at("{", 1)))
        ) {
          if (resourceLoop && awaitResource) {
            if (awaitContext !== 2)
              fail("await using requires an async function or module body");
            take();
          }
          const token = take();
          const mode: "const" | "let" | "var" =
            resourceLoop || token.value === "const"
              ? "const"
              : token.value === "var"
                ? "var"
                : "let";
          const binding = variableBinding(mode, true, false);
          if (!at("in") && !at("of")) {
            initializer = variableDeclaration(
              mode,
              token.start,
              false,
              true,
              binding,
            );
            parsedInitializer = true;
          } else {
            if (binding.type !== undefined)
              fail("iteration binding cannot have a type annotation");
            if (
              binding.initializer !== undefined &&
              (strict ||
                !at("in") ||
                mode !== "var" ||
                binding.kind === "object-binding" ||
                binding.kind === "array-binding")
            )
              fail("iteration binding cannot have an initializer");
            const enumerate = eat("in");
            if (awaitLoop && enumerate) fail("for await requires of");
            if (!enumerate) expect("of");
            const iterable = expression(enumerate ? 0 : 1);
            expect(")");
            loops++;
            let body: Statement;
            try {
              body = statement(false, false);
            } finally {
              loops--;
            }
            return {
              kind: enumerate ? "for-in" : "for-of",
              await: awaitLoop,
              disposal: resourceLoop
                ? awaitResource
                  ? "async"
                  : "sync"
                : undefined,
              mode,
              binding,
              iterable,
              body,
              start: begin,
              end: end(),
            };
          }
        }
        if (!parsedInitializer) {
          if (eat(";")) initializer = undefined;
          else if (
            lexicalLet() ||
            at("const") ||
            at("var") ||
            (at("using", resourceOffset) &&
              (awaitResource ||
                !at("of", resourceOffset + 1) ||
                at("=", resourceOffset + 2)) &&
              current(resourceOffset + 1).kind === "identifier" &&
              !current(resourceOffset + 1).lineBreakBefore)
          )
            initializer = statement(false, true, true);
          else {
            const head = current(),
              start = head.start,
              value = expression(0, false, true, false);
            if (at("in") || at("of")) {
              const enumerate = eat("in");
              if (awaitLoop && enumerate) fail("for await requires of");
              if (!enumerate) expect("of");
              if (
                !enumerate &&
                head.escaped !== true &&
                (head.value === "let" ||
                  (!awaitLoop &&
                    head.value === "async" &&
                    value.kind === "identifier"))
              )
                fail(
                  "invalid leading token in for-of assignment head",
                  "SYNTAX_ERROR",
                  head,
                );
              if (!assignmentTarget(value))
                fail("invalid iteration assignment target", "SYNTAX_ERROR");
              const iterable = expression(enumerate ? 0 : 1);
              expect(")");
              loops++;
              let body: Statement;
              try {
                body = statement(false, false);
              } finally {
                loops--;
              }
              return {
                kind: enumerate ? "for-in-assignment" : "for-of-assignment",
                await: awaitLoop,
                target: value,
                iterable,
                body,
                start: begin,
                end: end(),
              };
            }
            expect(";");
            initializer = {
              kind: "expression",
              expression: value,
              start,
              end: end(),
            };
          }
        }
        if (awaitLoop) fail("for await requires an of head");
        const test = at(";") ? undefined : expression();
        expect(";");
        const update = at(")") ? undefined : expression();
        expect(")");
        loops++;
        let body: Statement;
        try {
          body = statement(false, false);
        } finally {
          loops--;
        }
        return {
          kind: "for",
          initializer,
          test,
          update,
          body,
          start: begin,
          end: end(),
        };
      }
      if (eat("do")) {
        loops++;
        let body: Statement;
        try {
          body = statement(false, false);
        } finally {
          loops--;
        }
        expect("while");
        expect("(");
        const test = expression();
        expect(")");
        // The do-while grammar permits insertion here even without a line break.
        eat(";");
        return { kind: "do-while", body, test, start: begin, end: end() };
      }
      if (eat("with")) {
        if (strict) fail("with is forbidden in strict code", "SYNTAX_ERROR");
        expect("(");
        if (at(")")) fail("with requires an object expression", "SYNTAX_ERROR");
        const object = expression();
        expect(")");
        const body = statement(false, false);
        return { kind: "with", object, body, start: begin, end: end() };
      }
      if (eat("while")) {
        expect("(");
        const test = expression();
        expect(")");
        loops++;
        let body: Statement;
        try {
          body = statement(false, false);
        } finally {
          loops--;
        }
        return { kind: "while", test, body, start: begin, end: end() };
      }
      if (eat("throw")) {
        if (current().lineBreakBefore) fail("line break after throw");
        const value = expression();
        semi();
        return { kind: "throw", expression: value, start: begin, end: end() };
      }
      if (eat("return")) {
        if (functions === 0) fail("return outside function");
        const value =
          current().lineBreakBefore ||
          at(";") ||
          at("}") ||
          current().kind === "eof"
            ? undefined
            : expression();
        semi();
        return { kind: "return", expression: value, start: begin, end: end() };
      }
      if (at("break") || at("continue")) {
        const token = take();
        let label: string | undefined;
        if (!current().lineBreakBefore && current().kind === "identifier") {
          const name = take();
          if (reservedName(name.value))
            fail("invalid label", "SYNTAX_ERROR", name);
          const target = labels.find(
            (candidate) =>
              candidate !== undefined && candidate.name === name.value,
          );
          if (
            target === undefined ||
            (token.value === "continue" && !target.iteration)
          )
            fail("invalid control transfer label", "SYNTAX_ERROR", name);
          label = name.value;
        } else if (
          loops === 0 &&
          (token.value === "continue" || switches === 0)
        )
          fail("control transfer outside loop or switch");
        semi();
        return {
          kind: token.value === "break" ? "break" : "continue",
          label,
          start: begin,
          end: end(),
        };
      }
      if (eat("debugger")) {
        semi();
        return { kind: "debugger", start: begin, end: end() };
      }
      if (eat(";")) return { kind: "empty", start: begin, end: end() };
      if (
        current().kind === "identifier" &&
        reservedName(current().value) &&
        ![
          "true",
          "false",
          "null",
          "this",
          "super",
          "yield",
          "await",
          "typeof",
          "void",
          "delete",
          "new",
          "import",
        ].includes(current().value)
      )
        fail(
          "invalid or unsupported statement",
          language === "javascript" ? "SYNTAX_ERROR" : "UNSUPPORTED_SYNTAX",
        );
      const value = expression();
      semi();
      return {
        kind: "expression",
        expression: value,
        start: begin,
        end: end(),
      };
    } finally {
      depth--;
    }
  }
  const statements: Statement[] = [];
  try {
    strict = strict || directiveStrict(0);
    while (current().kind !== "eof") listStatement(statements, statement(true));
    for (const error of coverErrors) {
      if (error === undefined) throw "cover grammar invariant";
      if (!assignmentPatterns.has(error.node))
        fail(error.message, "SYNTAX_ERROR", error.token);
    }
  } catch (error) {
    if (error !== abort) throw error;
  }
  if (failure !== undefined) return { ok: false, error: failure };
  return {
    ok: true,
    value: { statements, imports, strict, start: 0, end: source.text.length },
  };
}
