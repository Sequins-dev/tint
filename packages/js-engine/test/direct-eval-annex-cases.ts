// Sloppy direct-eval Annex B.3.2.3 block-function copies (with B.3.4 catch
// exemptions). Each case runs alone in a fresh realm and throws on deviation;
// shared by the Node lowered-output oracle test and the native fixture
// (tools/verify-test262-native-direct-eval-annex.ts), which also checks every
// expectation against Node.
export const directEvalAnnexPrelude = `function check(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ": " + actual + " !== " + expected);
}
`;
export const directEvalAnnexCases: readonly (readonly [
  name: string,
  source: string,
])[] = [
  [
    "catch parameter is exempt and the copy reaches the function var",
    'function f(){try{throw 1;}catch(g){eval("{ function g(){return 3;} }");var inner=g;}return [inner,typeof g].join();} check(f(),"1,function","catch parameter")',
  ],
  [
    "function-level eval writes the function var without a global leak",
    'function f(){var r=eval("var before=typeof k; { function k(){} } [before, typeof k].join()"); return r+","+typeof k;} check(f(),"undefined,function,function","function eval"); check(typeof globalThis.k,"undefined","no global leak")',
  ],
  [
    "global-level eval writes the global object",
    'eval("{ function gk(){ return 7; } }"); check(typeof globalThis.gk,"function","global-level eval"); check(gk(),7,"global value")',
  ],
  [
    "global lexical conflict skips admission",
    'let gl=1; eval("{ function gl(){} }"); check(gl,1,"global lexical kept"); check(typeof globalThis.gl,"undefined","no global property")',
  ],
  [
    "function lexical conflict skips the copy",
    'function f(){ let q=1; eval("{ function q(){} }"); return q;} check(f(),1,"lexical conflict skips copy")',
  ],
  [
    "intervening block lexical skips admission",
    'function f(){ { let bl=1; eval("{ function bl(){} }"); check(bl,1,"block lexical kept"); } return typeof bl;} check(f(),"undefined","no var created")',
  ],
  [
    "arrow eval targets the arrow var environment",
    'function f(){ var inside=(()=>(eval("{ function m(){} }"), typeof m))(); return inside+","+typeof m;} check(f(),"function,undefined","arrow eval targets the arrow var env")',
  ],
  [
    "nested eval targets the outer function var environment",
    'function f(){ eval(\'eval("{ function nn(){} }")\'); return typeof nn;} check(f(),"function","nested eval"); check(typeof globalThis.nn,"undefined","no global leak")',
  ],
  [
    "with scope receives no copy",
    'function f(){ var o={}; with(o){ eval("{ function wq(){} }"); } return [typeof wq, "wq" in o].join();} check(f(),"function,false","with scope"); check(typeof globalThis.wq,"undefined","no global leak")',
  ],
  [
    "parameter expression eval copies into the parameter var environment",
    'function f(a = eval("{ function pp(){ return 1; } }")){ return typeof pp;} check(f(),"function","parameter eval"); check(typeof globalThis.pp,"undefined","no global leak")',
  ],
  [
    "the copy happens when the declaration is evaluated",
    'function f(){ eval("var get=function(){return typeof h;}; var x0=get(); { var x1=get(); function h(){} var x2=get(); } var x3=get();"); return [x0,x1,x2,x3].join();} check(f(),"undefined,undefined,function,function","copy timing")',
  ],
  [
    "abrupt block completion skips the copy",
    'function f(){ eval("try { { throw 0; function n(){} } } catch(e){}"); return typeof n;} check(f(),"undefined","abrupt block skips copy")',
  ],
  [
    "strict eval has no Annex B copy",
    'function f(){ eval("\\\'use strict\\\'; { function s(){} }"); return typeof s;} check(f(),"undefined","strict eval has no annex copy")',
  ],
  [
    "strict caller eval has no Annex B copy",
    'function f(){ "use strict"; eval("{ function sc(){} }"); return typeof sc;} check(f(),"undefined","strict caller"); check(typeof globalThis.sc,"undefined","no global leak")',
  ],
  [
    "an existing var is overwritten",
    'function f(){ var w=5; eval("{ function w(){} }"); return typeof w;} check(f(),"function","existing var overwritten")',
  ],
];
