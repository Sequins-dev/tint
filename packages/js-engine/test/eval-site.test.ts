import test from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import { lowerScript, lowerEvalScript } from "../src/lowering/index.ts";
function lower(source: string, indirect = false) {
  const parsed = parseScript(createSourceTextView(source));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const result = (indirect ? lowerEvalScript : lowerScript)(
    parsed.value,
    source,
  );
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function nodes(value: unknown, kind: string): any[] {
  if (Array.isArray(value)) return value.flatMap((x) => nodes(x, kind));
  if (value === null || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  return [
    ...(node.kind === kind ? [node] : []),
    ...Object.values(node).flatMap((x) => nodes(x, kind)),
  ];
}
function sites(source: string, indirect = false) {
  const module = lower(source, indirect);
  const guards = nodes(module, "call").filter(
    (x) =>
      x.callee.name === "callEvalCandidate" ||
      x.callee.name === "callEvalTailCandidate",
  );
  const declarations = nodes(module, "variable").flatMap((x) => x.declarations);
  return guards.map((guard) => {
    assert.equal(guard.arguments.length, 7);
    const flags = guard.arguments[5];
    assert.equal(flags.kind, "number");
    const site = declarations.find((x) => x.name === guard.arguments[6].name);
    return {
      flags: flags.value,
      site,
      argument: guard.arguments[6],
      declarations,
    };
  });
}
function fields(site: any) {
  assert.equal(site.type.name, "DirectEvalSite");
  assert.equal(site.initializer.kind, "object");
  assert.deepEqual(
    site.initializer.properties.map((x: any) => x.name),
    [
      "scriptOrModule",
      "lexical",
      "variables",
      "catches",
      "thisValue",
      "newTarget",
      "home",
      "derived",
      "activeFunction",
      "privateEnvironment",
    ],
  );
  return Object.fromEntries(
    site.initializer.properties.map((x: any) => [x.name, x.value]),
  );
}
test("Script sites carry caller state with fixed strict and function bits", () => {
  for (const [source, bits] of [
    ["eval(x)", 0],
    ["'use strict';eval(x)", 1],
    ["function f(){eval(x)}", 2],
    ["function f(){(()=>eval(x))()}", 2],
    ["(()=>eval(x))()", 0],
  ] as const) {
    const [s] = sites(source);
    assert.ok(s);
    assert.equal(s.flags, bits);
    const f = fields(s.site);
    assert.equal(f.scriptOrModule.name, "$script");
    assert.equal(f.catches.name, "undefined");
  }
});
test("indirect eval sites distinguish their lexical and variable records", () => {
  for (const strict of [false, true]) {
    const [s] = sites((strict ? "'use strict';" : "") + "eval(x)", true);
    assert.ok(s);
    const f = fields(s.site);
    assert.equal(f.scriptOrModule.property, "hostDefined");
    if (strict) assert.equal(f.variables.name, "$scope");
    else assert.equal(f.variables.callee.name, "createGlobalScope");
  }
});
test("catch sites construct explicitly typed inner-to-outer links", () => {
  const [s] = sites("try{}catch(a){try{}catch({b}){eval(x)}}");
  assert.ok(s);
  const f = fields(s.site);
  const links = s.declarations.filter(
    (x: any) => x.type?.name === "DirectEvalCatch",
  );
  assert.equal(links.length, 2);
  assert.equal(links[0].type.arguments[0].name, "unknown");
  assert.equal(
    links[1].initializer.properties.find((x: any) => x.name === "outer").value
      .name,
    links[0].name,
  );
  assert.equal(f.catches.name, links[1].name);
});
test("private callers carry explicitly typed private-name links", () => {
  for (const [source, bits] of [
    ["class C{#x;m(){eval(x)}}", 71],
    ["class C{#x;x=eval(x)}", 103],
  ] as const) {
    const [s] = sites(source);
    assert.ok(s);
    assert.equal(s.flags, bits);
    const f = fields(s.site);
    const link = s.declarations.find(
      (x: any) => x.name === f.privateEnvironment.name,
    );
    assert.equal(link.type.name, "DirectEvalPrivateName");
    assert.deepEqual(
      link.initializer.properties.map((x: any) => x.name),
      ["name", "outer"],
    );
  }
});
test("methods, fields and derived callers carry typed capabilities", () => {
  for (const [source, bits] of [
    ["var o={m(){eval(x)}}", 6],
    ["class C{m(){eval(x)}}", 7],
    ["class C{x=eval(x)}", 39],
    ["class C{x=(()=>eval(x))()}", 39],
    ["class C{x=function(){eval(x)}}", 3],
    ["class C{static{(()=>eval(x))()}}", 7],
    ["class D extends B{constructor(){eval(7);super()}}", 15],
    ["class D extends B{constructor(){(()=>eval(7))();super()}}", 15],
  ] as const) {
    const [s] = sites(source);
    assert.ok(s);
    assert.equal(s.flags, bits, source);
    const f = fields(s.site);
    if (bits & 8) {
      assert.equal(f.thisValue.name, "undefined");
      assert.match(f.derived.name, /^\$receiver/);
      assert.match(f.activeFunction.name, /^\$callee/);
    } else {
      assert.equal(f.derived.name, "undefined");
      assert.equal(f.activeFunction.name, "undefined");
    }
    if (bits & 4) assert.notEqual(f.home.name, "undefined");
  }
});

test("catch metadata resets across function boundaries and strict calls", () => {
  for (const source of [
    "try{}catch(e){function f(){eval(x)}}",
    "'use strict';try{}catch(e){eval(x)}",
  ]) {
    const [s] = sites(source);
    assert.ok(s);
    assert.equal(fields(s.site).catches.name, "undefined");
    assert.equal(
      s.declarations.filter((x: any) => x.type?.name === "DirectEvalCatch")
        .length,
      0,
    );
  }
});
test("parameter eval sites use the separate variable record", () => {
  const [s] = sites("function f(a=eval(7)){let body=1;return a}");
  assert.ok(s);
  const f = fields(s.site);
  assert.notEqual(f.lexical.name, f.variables.name);
  const variable = s.declarations.find((x: any) => x.name === f.variables.name);
  assert.equal(variable.initializer.callee.name, "createDeclarativeScope");
});
test("derived candidates add no derived-this read, including lexical arrows", () => {
  for (const body of ["eval(7)", "(()=>eval(7))()"]) {
    const source = "class D extends B{constructor(){" + body + ";super()}}";
    const control = source.replace(body, "void 7");
    const count = (source: string) =>
      nodes(lower(source), "call").filter(
        (x) => x.callee.name === "getDerivedThis",
      ).length;
    assert.equal(count(source), count(control));
  }
});

test("eval sites capture enclosing this independently of the eval call receiver", () => {
  const [s] = sites("eval(7)");
  assert.ok(s);
  const f = fields(s.site);
  assert.equal(f.thisValue.kind, "member");
  assert.equal(f.thisValue.object.name, "$global");
  assert.equal(f.thisValue.property, "thisValue");
});
