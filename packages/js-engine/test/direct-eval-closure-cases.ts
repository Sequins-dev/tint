// Runtime-compiled entries: functions created by direct eval code, called while
// or after the eval runs, plus result completion and identifier-read ordering in
// eval and dynamic Function code. Each case runs alone in a fresh realm and
// throws on deviation; shared by the Node lowered-output oracle test and the
// native fixture (tools/verify-test262-native-direct-eval-closure.ts), which also
// checks every expectation against Node. The skip-early-err shapes are those of
// Test262 annexB/language/eval-code/direct/*-skip-early-err-* variants.
export const directEvalClosurePrelude = `function check(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ": " + actual + " !== " + expected);
}
function throwsReference(fn) {
  try { fn(); } catch (error) { return error.constructor === ReferenceError; }
  return false;
}
`;
/** A documented reason to skip one reference: Node deviating from the
 * specification, or the lowered Node oracle lacking a host facade. Native
 * execution always runs every case. */
export interface DirectEvalClosureExemptions {
  readonly nodeDeviation?: string;
  readonly oracleUnsupported?: string;
}
export const directEvalClosureCases: readonly (readonly [
  name: string,
  source: string,
  exemptions?: DirectEvalClosureExemptions,
])[] = [
  [
    "typeof an unresolvable name inside function-level eval",
    'function f(){ return eval("typeof zz"); } check(f(),"undefined","typeof")',
  ],
  [
    "closure created by function-level eval reads a resolvable name",
    'var seen=5; function f(){ return eval("(function(){ return seen; })")(); } check(f(),5,"resolvable")',
  ],
  [
    "closure throw caught inside the function-level eval code",
    'function f(){ return eval("var r=0; try { (function(){ throw 7; })(); } catch (e) { r=e; } r"); } check(f(),7,"caught in eval")',
  ],
  [
    "closure created by function-level eval throws a value to a Script caller",
    'function f(){ return eval("(function(){ throw 7; })"); } var g=f(), r; try { g(); } catch (e) { r=e; } check(r,7,"thrown to Script")',
  ],
  [
    "returned closure reads an unresolvable name at call time",
    'function f(){ return eval("(function(){ return zz; })"); } var g=f(); check(throwsReference(g),true,"unresolvable at call time"); globalThis.zz=3; check(g(),3,"created later resolves")',
  ],
  [
    "unresolvable read inside function-level eval passed to a Script function",
    'function f(){ return eval("throwsReference(function(){ zz; })"); } check(f(),true,"function eval closure")',
  ],
  [
    "unresolvable read inside global-level eval passed to a Script function",
    'check(eval("throwsReference(function(){ zz; })"),true,"global eval closure")',
  ],
  [
    "a closure that is never called does not throw",
    'function f(){ return typeof eval("(function(){ return zz; })"); } check(f(),"function","not executed")',
  ],
  [
    "strict function-level eval closure reads an unresolvable name",
    'function f(){ "use strict"; return eval("throwsReference(function(){ zz; })"); } check(f(),true,"strict eval closure")',
  ],
  [
    "destructured catch parameter inside global-level eval",
    'eval("var r; try { throw {}; } catch ({ dz }) { r = dz; }"); check(r,undefined,"destructured catch"); check("dz" in globalThis,false,"no global leak")',
  ],
  [
    "destructured catch inside function-level eval with a block function",
    'function f(){ eval("try { throw {}; } catch ({ g }) {{ function g(){} }}"); return typeof g; } check(f(),"undefined","no copy over a destructured catch"); check("g" in globalThis,false,"no global leak")',
  ],
  [
    "skip-early-err block shape in function-level eval",
    '(function(){ eval("check(throwsReference(function(){ f; }),true,\\"before\\"); check(typeof f,\\"undefined\\",\\"typeof before\\"); { let f = 123; { function f(){} } } check(throwsReference(function(){ f; }),true,\\"after\\"); check(typeof f,\\"undefined\\",\\"typeof after\\");"); })(); check("f" in globalThis,false,"no global leak")',
  ],
  [
    "skip-early-err try shape in global-level eval",
    'eval("check(throwsReference(function(){ f; }),true,\\"before\\"); try { throw {}; } catch ({ f }) {{ function f(){} }} check(throwsReference(function(){ f; }),true,\\"after\\"); check(typeof f,\\"undefined\\",\\"typeof after\\");"); check("f" in globalThis,false,"no global leak")',
  ],
  [
    "identifier reads through a with object keep HasBinding, unscopables and Get order",
    'var log=[]; var p=new Proxy({v:1},{has(t,k){log.push("has:"+String(k));return k in t;},get(t,k){log.push("get:"+String(k));return t[k];}}); function f(){ with(p){ return eval("v"); } } check(f(),1,"value"); check(log.join(),"has:eval,has:v,get:Symbol(Symbol.unscopables),has:v,get:v","trap order"); log.length=0; function g(){ with(p){ return eval("typeof v"); } } check(g(),"number","typeof value"); check(log.join(),"has:eval,has:v,get:Symbol(Symbol.unscopables),has:v,get:v","typeof trap order")',
    {
      nodeDeviation:
        "Object Environment Record GetBindingValue performs HasProperty before Get (ECMA-262 9.1.1.2.6); V8 omits the second has trap",
    },
  ],
  [
    "typeof a caller binding in its temporal dead zone throws",
    'function f(){ var r=eval("try { typeof t; false; } catch (e) { e.constructor===ReferenceError; }"); let t; return r; } check(f(),true,"typeof TDZ")',
  ],
  [
    "a throwing global getter read by eval code propagates its value",
    'Object.defineProperty(globalThis,"gg",{get(){ throw 9; },configurable:true}); var r; eval("try { gg; } catch (e) { r=e; }"); check(r,9,"getter abrupt")',
  ],
  [
    "indirect eval reads unresolvable names",
    'check((0,eval)("typeof zz"),"undefined","indirect typeof"); check(throwsReference(function(){ (0,eval)("zz"); }),true,"indirect read"); check((0,eval)("(function(){ return typeof zz; })")(),"undefined","indirect closure typeof")',
  ],
  [
    "dynamic Function bodies read unresolvable names",
    'check(Function("return typeof zz")(),"undefined","function typeof"); check(throwsReference(Function("return zz")),true,"function read"); check(throwsReference(Function("\'use strict\'; return zz")),true,"strict function read")',
    {
      oracleUnsupported:
        "the lowered Node realm installs no dynamic Function compiler",
    },
  ],
];
