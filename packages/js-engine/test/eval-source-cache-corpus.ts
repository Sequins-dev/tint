/** Programs that evaluate identical eval sources repeatedly in different
 * callers, strictness, constructor contexts and realms. Shared by the lowered
 * differential test and the native benchmark image builder. */
export const evalSourceCacheCorpus: Readonly<Record<string, string>> = {
  callerScopes: `
    function f() { var x = "f"; return eval("x"); }
    function g() { var x = "g"; return eval("x"); }
    print(f() + g() + f() + g());`,
  callerDeclarations: `
    function h(n) { eval("var d = n * 2"); return d; }
    print([h(1), h(2), h(3)].join(","));
    print(typeof d);`,
  strictness: `
    function s1() { "use strict"; eval("var sv = 1"); return typeof sv; }
    function s2() { eval("var sv = 1"); return typeof sv; }
    print([s1(), s2(), s1(), s2()].join(","));`,
  newTarget: `
    function nt() { return eval("new.target"); }
    print(nt() === undefined);
    print(new nt() === nt);
    print(nt() === undefined);
    function arrow() { return (() => eval("new.target"))(); }
    print(String(arrow()) + "|" + (new arrow() === arrow));`,
  nestedEval: `
    function n() { return eval('eval("new.target")'); }
    print(n() === undefined && new n() === n && n() === undefined);`,
  indirectGlobals: `
    var ie = eval;
    for (var i = 0; i < 3; i++)
      print(ie("var gi = typeof gi === 'number' ? gi + 1 : 0; gi"));`,
  freshErrors: `
    var errors = [];
    for (var i = 0; i < 3; i++)
      try { eval("throw new Error('e')"); } catch (e) { errors.push(e); }
    print(errors[0] !== errors[1] && errors[1] !== errors[2] && errors[0].message === "e");`,
  freshFunctions: `
    var f1 = eval("(function () { return 1; })"), f2 = eval("(function () { return 1; })");
    print(f1 !== f2);
    print(f1() + f2());`,
  closures: `
    function mk(v) { return eval("(function () { return v; })"); }
    var a = mk(1), b = mk(2);
    print(a() + "," + b() + "," + a());`,
  lexical: `
    var seen = [];
    for (var i = 0; i < 3; i++) seen.push(eval("let q = i; q"));
    print(seen.join(","));
    print(typeof q);`,
  completionValues: `
    for (var i = 0; i < 2; i++) {
      print(eval("99; do { -99; try { 39 } catch (e) { -1 } finally { 42; break; -2 }; } while (false);"));
      print(eval("99; do { -99; try { [].x.x } catch (e) { -1; } finally { break; -3 }; } while (false);"));
    }`,
  privateNames: `
    class C {
      #x = "cx";
      read() { return eval("this.#x"); }
    }
    class D {
      #y = "dy";
      read() {
        try { return eval("this.#x"); } catch (e) { return e instanceof SyntaxError; }
      }
    }
    var c = new C(), d = new D();
    print([c.read(), d.read(), c.read(), d.read()].join(","));`,
  functionIdentity: `
    var made = [];
    for (var i = 0; i < 2; i++) made.push(eval("(function named(a) { return a + 1; })"));
    print(made[0] !== made[1]);
    print(made[0].toString() === made[1].toString());
    print(made[0].toString());
    print(made[0].name + made[1](1));`,
  arrowContexts: `
    var top = [];
    for (var i = 0; i < 2; i++)
      try { top.push((() => eval("new.target"))()); } catch (e) { top.push(e instanceof SyntaxError); }
    function inside() { return (() => eval("new.target"))(); }
    print(top.join(",") + "|" + inside() + "|" + (new inside() === inside));`,
  freshSyntaxErrors: `
    var direct = [], indirect = [], ie = eval;
    for (var i = 0; i < 2; i++) {
      try { eval("let let = 1"); } catch (e) { direct.push(e); }
      try { ie("var 1x"); } catch (e) { indirect.push(e); }
    }
    print(direct[0] !== direct[1] && direct[1] instanceof SyntaxError);
    print(indirect[0] !== indirect[1] && indirect[1] instanceof SyntaxError);`,
  templateSites: `
    function tag(s) { return s; }
    var inner = eval("var r = []; for (var i = 0; i < 2; i++) r.push(tag\`w\`); r");
    print(inner[0] === inner[1]);
    var again = eval("var r = []; for (var i = 0; i < 2; i++) r.push(tag\`w\`); r");
    print(again[0] === again[1] && again[0] !== inner[0]);
    var a = eval("tag\`x\`"), b = eval("tag\`x\`");
    print(a !== b && a.raw[0] === "x");`,
  syntaxErrorsRepeat: `
    for (var i = 0; i < 2; i++)
      try { eval("let let = 1"); } catch (e) { print(e instanceof SyntaxError); }`,
};
