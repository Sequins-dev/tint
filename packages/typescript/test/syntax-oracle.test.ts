import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { createSourceText } from "@tint/source/text";
import { parseModule, type Expression } from "@tint/typescript/syntax";
function tint(node: Expression): unknown {
  switch (node.kind) {
    case "spread":
      return ["spread", tint(node.value)];
    case "array":
      return ["array", ...node.elements.map(tint)];
    case "new":
      return [
        "new",
        tint(node.callee),
        node.typeArguments.length,
        ...node.arguments.map(tint),
      ];
    case "object":
      return [
        "object",
        ...node.properties.map((p) =>
          p.kind === "spread"
            ? ["spread", tint(p.value)]
            : [p.name, p.shorthand, tint(p.value)],
        ),
      ];
    case "arrow":
      assert.notEqual(node.body.kind, "block");
      if (node.body.kind === "block")
        throw new Error("expression oracle requires concise body");
      return [
        "arrow",
        node.parameters.map((p) => {
          assert.notEqual(p.kind, "pattern-parameter");
          if (p.kind === "pattern-parameter")
            throw new Error("expression oracle requires identifier parameters");
          return p.name;
        }),
        tint(node.body),
      ];
    case "identifier":
      return node.name;
    case "number":
    case "string":
    case "boolean":
      return node.value;
    case "null":
      return null;
    case "group":
      return ["group", tint(node.expression)];
    case "binary":
      return [node.operator, tint(node.left), tint(node.right)];
    case "assignment":
      return ["=", tint(node.target), tint(node.value)];
    case "unary":
      return [node.operator, tint(node.operand)];
    case "call":
      return [
        node.optional ? "optional-call" : "call",
        tint(node.callee),
        node.typeArguments?.length ?? 0,
        ...node.arguments.map(tint),
      ];
    case "member":
      return [
        node.optional ? "optional-member" : "member",
        tint(node.object),
        node.property,
      ];
    case "index":
      return [
        node.optional ? "optional-index" : "index",
        tint(node.object),
        tint(node.index),
      ];
    case "conditional":
      return [
        "?",
        tint(node.test),
        tint(node.consequent),
        tint(node.alternate),
      ];
  }
}
function upstream(node: ts.Expression): unknown {
  if (ts.isSpreadElement(node)) return ["spread", upstream(node.expression)];
  if (ts.isArrayLiteralExpression(node))
    return ["array", ...node.elements.map(upstream)];
  if (ts.isNewExpression(node))
    return [
      "new",
      upstream(node.expression),
      node.typeArguments?.length ?? 0,
      ...(node.arguments ?? []).map(upstream),
    ];
  if (ts.isObjectLiteralExpression(node))
    return [
      "object",
      ...node.properties.map((p) => {
        if (ts.isSpreadAssignment(p)) return ["spread", upstream(p.expression)];
        if (ts.isShorthandPropertyAssignment(p))
          return [p.name.text, true, p.name.text];
        assert.ok(ts.isPropertyAssignment(p));
        assert.ok(
          ts.isIdentifier(p.name) ||
            ts.isStringLiteral(p.name) ||
            ts.isNumericLiteral(p.name),
        );
        return [p.name.text, false, upstream(p.initializer)];
      }),
    ];
  if (ts.isArrowFunction(node)) {
    assert.ok(!ts.isBlock(node.body));
    return [
      "arrow",
      node.parameters.map((p) => p.name.getText()),
      upstream(node.body),
    ];
  }
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isStringLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isParenthesizedExpression(node))
    return ["group", upstream(node.expression)];
  if (ts.isBinaryExpression(node))
    return [
      node.operatorToken.getText(),
      upstream(node.left),
      upstream(node.right),
    ];
  if (ts.isPrefixUnaryExpression(node))
    return [ts.tokenToString(node.operator), upstream(node.operand)];
  if (ts.isTypeOfExpression(node)) return ["typeof", upstream(node.expression)];
  if (ts.isVoidExpression(node)) return ["void", upstream(node.expression)];
  if (ts.isCallExpression(node))
    return [
      node.questionDotToken ? "optional-call" : "call",
      upstream(node.expression),
      node.typeArguments?.length ?? 0,
      ...node.arguments.map(upstream),
    ];
  if (ts.isPropertyAccessExpression(node))
    return [
      node.questionDotToken ? "optional-member" : "member",
      upstream(node.expression),
      node.name.text,
    ];
  if (ts.isElementAccessExpression(node))
    return [
      node.questionDotToken ? "optional-index" : "index",
      upstream(node.expression),
      upstream(node.argumentExpression),
    ];
  if (ts.isConditionalExpression(node))
    return [
      "?",
      upstream(node.condition),
      upstream(node.whenTrue),
      upstream(node.whenFalse),
    ];
  throw new Error("oracle case missing: " + ts.SyntaxKind[node.kind]);
}
test("expression trees match the pinned TypeScript parser across precedence pairs", () => {
  const operators = [
    "||",
    "&&",
    "|",
    "^",
    "&",
    "==",
    "!=",
    "===",
    "!==",
    "<",
    ">",
    "<=",
    ">=",
    "<<",
    ">>",
    ">>>",
    "+",
    "-",
    "*",
    "/",
    "%",
  ];
  const examples = [
    '({"value": 1, "\\u006eext": 2, "": 3})',
    "({0x10: 1, 1_000: 2, 1e2: 3, 0.5: 4})",
    "id<number>(3)",
    "f<Box<Pair<number,string>>>(x)",
    "f<number>(x).value",
    "f<number>(x)<g<string>(y)",
    "a < b > (c)",
    "f<(x:number)=>number>(g)",
    "[]",
    "[1,[2,3],a=4,]",
    "new C",
    "new C(1).x",
    "new C(1)(2)",
    "new new C(1)(2)",
    "new C.x",
    "new C[x](1).y",
    "new (factory())(1)",
    "new C().m()",
    "new Map<string,readonly number[]>()",
    "new C<T>() < x",
    "!new C()",

    "a=b=c",
    "a ? (b) : c",
    "a ? (b) : c => c",
    "a ? (b): number => b : c",
    "a ? x => (b) : c => c",
    "a ? (b) : c ? (d) : e",
    "(x => x)(1)",
    "a ? x => x + 1 : y => y * 2",
    "x => y => ({x, y: y + 1})",
    "({a: 1, run: (x: number) => x + 1, empty: () => 0,})",
    "f(x => x, (y) => y ? 1 : 2)",
    "(x): number => x",
    "() => (x: number): number => x",
    "a?b=c:d?e:f",
    "!f(a, b)[x].value",
    'typeof x === "number"',
    "void f()",
    "-1 + +2 * ~3",
    "a?.3:0",
    "(a+b)*c",
    "true?false:null",
  ];
  for (const a of operators)
    for (const b of operators) examples.push(`a ${a} b ${b} c`);
  examples.push(
    "[head(), ...items, tail()]",
    "({...input, value: next(), ...other})",
    "[...(condition ? first : second)]",
  );
  examples.push(
    "a?.b.c()",
    "(a?.b).c()",
    "a.b?.(c())",
    "a?.[key()]?.b",
    "a?.<number>(1)",
    "new (a?.b)()",
    "new A()?.b",
  );
  examples.push(
    "(a=1,b=2,a+b)",
    "f((a,b),c)",
    "[a,(b,c),d]",
    "({a:(b,c),d})",
    "(x=>x, y=>y)",
    "(a ? b : c,d)",
  );
  for (const expression of examples) {
    const text = expression + ";",
      bytes = new TextEncoder().encode(text),
      source = createSourceText(bytes, bytes.length);
    assert.equal(source.ok, true);
    const parsed = parseModule(source.value);
    assert.equal(parsed.ok, true, text);
    const stmt = parsed.value.statements[0];
    assert.ok(stmt?.kind === "expression");
    const reference = ts.createSourceFile(
      "fixture.ts",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    ).statements[0];
    assert.ok(reference && ts.isExpressionStatement(reference));
    assert.deepEqual(
      tint(stmt.expression),
      upstream(reference.expression),
      text,
    );
    assert.equal(stmt.expression.start, reference.expression.getStart());
    assert.equal(stmt.expression.end, reference.expression.end);
  }
});
test("optional property flags and spans match the TypeScript oracle", () => {
  const text =
    "interface Options { readonly count?:number; value:number|undefined; readonly?:boolean; readonly readonlyFlag?:boolean }";
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const actual = parsed.value.statements[0];
  assert.ok(actual?.kind === "interface");
  const file = ts.createSourceFile(
    "input.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const expected = file.statements[0];
  assert.ok(expected && ts.isInterfaceDeclaration(expected));
  assert.deepEqual(
    actual.properties.map((p) => [
      p.name,
      p.optional === true,
      p.readonly,
      p.start,
      p.end,
    ]),
    expected.members.map((p) => {
      assert.ok(ts.isPropertySignature(p));
      return [
        p.name.getText(file),
        p.questionToken !== undefined,
        p.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ??
          false,
        p.getStart(file),
        p.type!.end,
      ];
    }),
  );
});
